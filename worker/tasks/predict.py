import asyncio
import json
import shutil
import traceback
from pathlib import Path
from uuid import UUID

import numpy as np
from celery import shared_task
from sqlalchemy import text
from ultralytics import YOLO

from worker.utils.db import dispose_engine, run_in_session
from worker.utils.db_queries import fetch_images, fetch_images_by_ids, fetch_labels, insert_predictions
from worker.utils.redis_log import get_redis, publish_log
from worker.utils.settings import get_settings
from worker.utils.storage import get_s3_client


async def _update_job(job_id: UUID, status: str) -> None:
    async def _exec(session):
        await session.execute(
            text("UPDATE jobs SET status = :status WHERE id = :job_id"),
            {"status": status, "job_id": job_id},
        )
        await session.commit()

    await run_in_session(_exec)


async def _flush_logs_to_db(job_id: UUID) -> None:
    """Read accumulated log entries from Redis list and persist to the ``jobs.logs`` column."""
    redis = get_redis()
    try:
        list_key = f"job_log_history:{job_id}"
        raw_entries = await redis.lrange(list_key, 0, -1)
        entries = [json.loads(e) for e in raw_entries] if raw_entries else []

        async def _exec(session):
            await session.execute(
                text("UPDATE jobs SET logs = CAST(:logs AS jsonb) WHERE id = :job_id"),
                {"logs": json.dumps(entries), "job_id": job_id},
            )
            await session.commit()

        await run_in_session(_exec)
        await redis.delete(list_key)
    finally:
        await redis.close()


def _mask_to_polygon(mask_xy: np.ndarray, simplify: int = 4) -> list[float]:
    """Convert a mask contour (Nx2 array of x,y coords) to a flat [x1,y1,x2,y2,...] list.

    Optionally downsample points by taking every `simplify`-th point.
    """
    if simplify > 1 and len(mask_xy) > simplify * 3:
        mask_xy = mask_xy[::simplify]
    return [round(float(v), 1) for pt in mask_xy for v in pt]


@shared_task(name="predict_dataset")
def predict_dataset(
    job_id: str,
    logs_channel: str,
    project_id: str,
    model_path: str,
    limit: int = 50,
    image_ids: list[str] | None = None,
) -> None:
    infer_dir = Path("/tmp") / "spektra_infer" / job_id

    async def _run() -> None:
        try:
            await _update_job(UUID(job_id), "RUNNING")
            await publish_log(logs_channel, "Starting inference")
            labels = await fetch_labels(UUID(project_id))
            label_ids = [label["id"] for label in labels]

            # Determine which images to process
            if image_ids:
                images = await fetch_images_by_ids([UUID(iid) for iid in image_ids])
                await publish_log(logs_channel, f"Running inference on {len(images)} specific image(s)")
            else:
                images = await fetch_images(UUID(project_id), limit=limit)

            # Download model if it's an S3 key
            settings = get_settings()
            s3 = get_s3_client()
            local_model = model_path
            if model_path.startswith("models/"):
                local_model_path = Path("/tmp") / "spektra_models" / Path(model_path).name
                local_model_path.parent.mkdir(parents=True, exist_ok=True)
                if not local_model_path.exists():
                    s3.download_file(settings.minio_bucket, model_path, str(local_model_path))
                local_model = str(local_model_path)

            # Load model once
            model = YOLO(local_model)

            for image in images:
                filename = image.get("filename") or f"{image['id']}.jpg"
                local_path = infer_dir / filename
                local_path.parent.mkdir(parents=True, exist_ok=True)
                s3.download_file(
                    settings.minio_bucket,
                    image["storage_path"],
                    str(local_path),
                )
                results = model.predict(str(local_path), verbose=False)
                mapped = []
                for result in results:
                    has_masks = result.masks is not None and result.masks.xy is not None

                    # ---- Segmentation masks (polygon annotations) ----
                    if has_masks:
                        mask_confs = result.boxes.conf if result.boxes is not None else None
                        mask_classes = result.boxes.cls if result.boxes is not None else None
                        for i, mask_xy in enumerate(result.masks.xy):
                            if len(mask_xy) < 3:
                                continue
                            class_idx = int(mask_classes[i].item()) if mask_classes is not None else 0
                            if class_idx >= len(label_ids):
                                continue
                            conf = float(mask_confs[i].item()) if mask_confs is not None else None
                            points = _mask_to_polygon(mask_xy)
                            mapped.append(
                                {
                                    "label_id": label_ids[class_idx],
                                    "geometry": {"points": points},
                                    "confidence": conf,
                                }
                            )

                    # ---- Bounding-box only (detection annotations) ----
                    elif result.boxes is not None:
                        for box in result.boxes:
                            xyxy = box.xyxy[0].tolist()
                            x1, y1, x2, y2 = xyxy
                            class_idx = int(box.cls[0].item())
                            if class_idx >= len(label_ids):
                                continue
                            mapped.append(
                                {
                                    "label_id": label_ids[class_idx],
                                    "geometry": {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1},
                                    "confidence": float(box.conf[0].item()),
                                }
                            )

                await insert_predictions(UUID(image["id"]), mapped)
                await publish_log(logs_channel, f"Predicted {len(mapped)} annotations for {image['id']}")

            await publish_log(logs_channel, "Inference complete")
            await _update_job(UUID(job_id), "COMPLETED")
            await _flush_logs_to_db(UUID(job_id))
        except Exception:
            tb = traceback.format_exc()
            await publish_log(logs_channel, f"ERROR: {tb}")
            await _update_job(UUID(job_id), "FAILED")
            await _flush_logs_to_db(UUID(job_id))
        finally:
            if infer_dir.exists():
                shutil.rmtree(infer_dir, ignore_errors=True)
            await dispose_engine()

    asyncio.run(_run())
