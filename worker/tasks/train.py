import asyncio
import logging
import shutil
import signal
import threading
import traceback
from pathlib import Path
from uuid import UUID

from celery import shared_task
from sqlalchemy import text
from ultralytics import YOLO

from worker.utils.db import dispose_engine, run_in_session
from worker.utils.db_queries import (
    fetch_annotations,
    fetch_dataset_version,
    fetch_images,
    fetch_images_by_ids,
    fetch_labels,
)
from worker.utils.redis_log import get_redis, publish_log, publish_progress, sync_publish_log, sync_publish_progress
from worker.utils.settings import get_settings
from worker.utils.storage import get_s3_client
from worker.utils.yolo_export import export_dataset

logger = logging.getLogger(__name__)

# Global flag so SIGTERM handler can signal the training loop to stop
_cancel_event = threading.Event()


def _sigterm_handler(signum, frame):
    """Handle SIGTERM from Celery revoke — set cancel flag."""
    _cancel_event.set()


# Install once at import time — Celery sends SIGTERM on revoke(terminate=True)
signal.signal(signal.SIGTERM, _sigterm_handler)


async def _update_job(job_id: UUID, status: str, artifact_path: str | None = None, metrics: dict | None = None) -> None:
    async def _exec(session):
        params: dict = {"status": status, "job_id": job_id}
        sql = "UPDATE jobs SET status = :status"
        if artifact_path is not None:
            sql += ", artifact_path = :artifact_path"
            params["artifact_path"] = artifact_path
        if metrics is not None:
            import json
            sql += ", metrics = CAST(:metrics AS jsonb)"
            params["metrics"] = json.dumps(metrics)
        sql += " WHERE id = :job_id"
        await session.execute(text(sql), params)
        await session.commit()

    await run_in_session(_exec)


async def _flush_logs_to_db(job_id: UUID) -> None:
    """Read accumulated log entries from Redis list and persist to ``jobs.logs``."""
    import json as _json
    redis = get_redis()
    try:
        list_key = f"job_log_history:{job_id}"
        raw_entries = await redis.lrange(list_key, 0, -1)
        entries = [_json.loads(e) for e in raw_entries] if raw_entries else []

        async def _exec(session):
            await session.execute(
                text("UPDATE jobs SET logs = CAST(:logs AS jsonb) WHERE id = :job_id"),
                {"logs": _json.dumps(entries), "job_id": job_id},
            )
            await session.commit()

        await run_in_session(_exec)
        await redis.delete(list_key)
    finally:
        await redis.close()


def _upload_model(local_path: Path, job_id: str) -> str:
    """Upload the best model weights to MinIO with a unique key (never overwrite)."""
    import time as _t
    settings = get_settings()
    s3 = get_s3_client()
    ts = int(_t.time())
    short_id = job_id[:8] if len(job_id) >= 8 else job_id
    key = f"models/{short_id}_{ts}_{local_path.name}"
    s3.upload_file(str(local_path), settings.minio_bucket, key)
    return key


@shared_task(name="train_model")
def train_model(
    job_id: str,
    logs_channel: str,
    project_id: str,
    model_arch: str = "yolo11n.pt",
    epochs: int = 20,
    batch: int = 8,
    imgsz: int = 640,
    checkpoint: str = "coco",
    dataset_version_id: str | None = None,
) -> None:
    dataset_dir: Path | None = None
    _cancel_event.clear()

    # ---- helpers for sync callbacks ----
    import time as _time
    _timing = {"job_start": 0.0, "epoch_start": 0.0}

    def _sync_publish(msg: str, *, progress: dict | None = None) -> None:
        """Publish a log message (+ optional progress) from a sync callback.

        Uses synchronous Redis so it works inside YOLO callbacks where
        ``asyncio.run()`` already owns the thread's event loop.
        """
        try:
            sync_publish_log(logs_channel, msg, progress=progress)
        except Exception:
            logger.debug("Could not publish log: %s", msg)

    def _sync_publish_progress(data: dict) -> None:
        """Publish a progress-only event from a sync context."""
        try:
            sync_publish_progress(logs_channel, data)
        except Exception:
            logger.debug("Could not publish progress")

    def _check_cancelled() -> bool:
        """Return True and publish message if task was cancelled."""
        if _cancel_event.is_set():
            _sync_publish("Training cancelled by user")
            return True
        return False

    # ---- YOLO callbacks ----
    _batch_counter = {"i": 0}  # closure-safe mutable counter

    def on_train_epoch_end(trainer):
        """Called at end of each training epoch — publish summary line."""
        if _check_cancelled():
            raise KeyboardInterrupt("Job cancelled")
        _batch_counter["i"] = 0  # reset for next epoch
        epoch = trainer.epoch + 1
        total = trainer.epochs
        loss_items = trainer.label_loss_items(trainer.tloss)
        loss_str = "  ".join(f"{k}={v:.4f}" for k, v in loss_items.items()) if isinstance(loss_items, dict) else str(loss_items)

        # Structured progress with ETA
        now = _time.monotonic()
        elapsed = now - _timing["job_start"] if _timing["job_start"] else 0
        secs_per_epoch = elapsed / epoch if epoch > 0 else 0
        remaining_epochs = total - epoch
        eta_secs = secs_per_epoch * remaining_epochs
        _timing["epoch_start"] = now

        # Single call: log line + progress (avoids double event-loop issue)
        _sync_publish(f"Epoch {epoch}/{total}  {loss_str}", progress={
            "epoch": epoch,
            "total_epochs": total,
            "batch": 0,
            "total_batches": 0,
            "pct": round(100 * epoch / total, 1),
            "elapsed_secs": round(elapsed, 1),
            "eta_secs": round(eta_secs, 1),
            "phase": "training",
        })

    def on_train_batch_end(trainer):
        """Called at end of each batch — publish progress at intervals."""
        if _check_cancelled():
            raise KeyboardInterrupt("Job cancelled")
        _batch_counter["i"] += 1
        batch_i = _batch_counter["i"]
        nb = trainer.nbs if hasattr(trainer, "nbs") else len(trainer.train_loader)
        epoch = trainer.epoch + 1
        total_epochs = trainer.epochs
        # Publish every 10 batches or at the end of the epoch
        if batch_i % 10 == 0 or batch_i == nb:
            pct = round(100 * batch_i / nb)
            # Compute progress data for piggybacking
            overall_pct = ((epoch - 1) + batch_i / max(nb, 1)) / max(total_epochs, 1) * 100
            now = _time.monotonic()
            elapsed = now - _timing["job_start"] if _timing["job_start"] else 0
            fraction_done = overall_pct / 100
            eta_secs = (elapsed / fraction_done * (1 - fraction_done)) if fraction_done > 0.01 else 0
            _sync_publish(f"Epoch {epoch}/{total_epochs}  batch {batch_i}/{nb}  ({pct}%)", progress={
                "epoch": epoch,
                "total_epochs": total_epochs,
                "batch": batch_i,
                "total_batches": nb,
                "pct": round(overall_pct, 1),
                "elapsed_secs": round(elapsed, 1),
                "eta_secs": round(eta_secs, 1),
                "phase": "training",
            })
        # Intermediate progress (no log line) every 5 batches
        elif batch_i % 5 == 0:
            overall_pct = ((epoch - 1) + batch_i / max(nb, 1)) / max(total_epochs, 1) * 100
            now = _time.monotonic()
            elapsed = now - _timing["job_start"] if _timing["job_start"] else 0
            fraction_done = overall_pct / 100
            eta_secs = (elapsed / fraction_done * (1 - fraction_done)) if fraction_done > 0.01 else 0
            _sync_publish_progress({
                "epoch": epoch,
                "total_epochs": total_epochs,
                "batch": batch_i,
                "total_batches": nb,
                "pct": round(overall_pct, 1),
                "elapsed_secs": round(elapsed, 1),
                "eta_secs": round(eta_secs, 1),
                "phase": "training",
            })

    def on_fit_epoch_end(trainer):
        """Called after train+val for an epoch — publish full metrics."""
        if _check_cancelled():
            raise KeyboardInterrupt("Job cancelled")
        epoch = trainer.epoch + 1
        metrics = trainer.metrics
        parts = []
        for k in ("metrics/mAP50(B)", "metrics/mAP50-95(B)", "metrics/precision(B)", "metrics/recall(B)"):
            short = k.split("/")[-1].replace("(B)", "")
            v = metrics.get(k)
            if v is not None:
                parts.append(f"{short}={float(v):.4f}")
        if parts:
            _sync_publish(f"Epoch {epoch}/{trainer.epochs}  val  {'  '.join(parts)}")

    async def _run() -> None:
        nonlocal dataset_dir
        try:
            await _update_job(UUID(job_id), "RUNNING")
            await publish_log(logs_channel, f"Exporting dataset for project {project_id}")
            await publish_progress(logs_channel, {
                "epoch": 0, "total_epochs": epochs,
                "batch": 0, "total_batches": 0,
                "pct": 0, "elapsed_secs": 0, "eta_secs": 0,
                "phase": "preparing",
            })
            labels = await fetch_labels(UUID(project_id))

            # Determine image list and configs based on dataset version
            split_map: dict[str, str] | None = None
            preprocessing: dict | None = None
            augmentation: dict | None = None

            if dataset_version_id:
                version = await fetch_dataset_version(UUID(dataset_version_id))
                if version is None:
                    raise ValueError(f"Dataset version {dataset_version_id} not found")

                snapshot = version.get("image_snapshot") or []
                await publish_log(logs_channel, f"Using dataset version (snapshot: {len(snapshot)} images)")
                image_ids = [UUID(entry["image_id"]) for entry in snapshot]
                images = await fetch_images_by_ids(image_ids)

                # Build split map from snapshot: image_id -> split
                split_map = {
                    entry["image_id"]: entry.get("split", "TRAIN").lower()
                    for entry in snapshot
                }
                preprocessing = version.get("preprocessing")
                augmentation = version.get("augmentation")
            else:
                images = await fetch_images(UUID(project_id))

            annotations = await fetch_annotations([UUID(item["id"]) for item in images])
            dataset_dir = export_dataset(
                labels, images, annotations,
                split_map=split_map,
                preprocessing=preprocessing,
                augmentation=augmentation,
            )

            data_yaml = dataset_dir / "data.yaml"
            await publish_log(logs_channel, f"Training YOLO model {model_arch} (checkpoint={checkpoint})")

            # Determine pretrained flag based on checkpoint selection
            resolved_arch = model_arch
            pretrained: bool | str = True  # default: COCO pretrained
            if checkpoint == "scratch":
                pretrained = False
            elif checkpoint == "coco":
                pretrained = True
            elif checkpoint.startswith("models/"):
                # Previous checkpoint — download from S3
                settings = get_settings()
                s3 = get_s3_client()
                local_ckpt = Path("/tmp") / "spektra_checkpoints" / Path(checkpoint).name
                local_ckpt.parent.mkdir(parents=True, exist_ok=True)
                s3.download_file(settings.minio_bucket, checkpoint, str(local_ckpt))
                await publish_log(logs_channel, f"Loaded checkpoint from {checkpoint}")
                resolved_arch = str(local_ckpt)
                pretrained = False

            # Check cancellation before starting training
            if _cancel_event.is_set():
                await publish_log(logs_channel, "Training cancelled by user before start")
                await _update_job(UUID(job_id), "CANCELLED")
                await _flush_logs_to_db(UUID(job_id))
                return

            model = YOLO(resolved_arch)

            # Register callbacks for live log streaming
            model.add_callback("on_train_epoch_end", on_train_epoch_end)
            model.add_callback("on_train_batch_end", on_train_batch_end)
            model.add_callback("on_fit_epoch_end", on_fit_epoch_end)

            # Determine device: use CUDA if available, else CPU
            import torch
            device: int | str = "cpu"
            if torch.cuda.is_available():
                try:
                    # Probe GPU by moving a small tensor — catches sm_XX mismatch
                    torch.zeros(1, device="cuda:0")
                    device = 0
                except RuntimeError:
                    device = "cpu"
            await publish_log(logs_channel, f"Using device: {'CUDA' if device == 0 else 'CPU'}")

            _timing["job_start"] = _time.monotonic()
            _timing["epoch_start"] = _timing["job_start"]

            try:
                results = model.train(
                    data=str(data_yaml),
                    epochs=epochs,
                    batch=batch,
                    imgsz=imgsz,
                    project=str(dataset_dir / "runs"),
                    name="spektra",
                    verbose=False,
                    pretrained=pretrained,
                    device=device,
                    workers=0,
                )
            except RuntimeError as exc:
                if "CUDA" in str(exc) and device == 0:
                    await publish_log(logs_channel, f"CUDA error, falling back to CPU: {exc}")
                    device = "cpu"
                    results = model.train(
                        data=str(data_yaml),
                        epochs=epochs,
                        batch=batch,
                        imgsz=imgsz,
                        project=str(dataset_dir / "runs"),
                        name="spektra",
                        verbose=False,
                        pretrained=pretrained,
                        device=device,
                        workers=0,
                    )
                else:
                    raise
            except KeyboardInterrupt:
                await publish_log(logs_channel, "Training stopped (cancelled)")
                await _update_job(UUID(job_id), "CANCELLED")
                await _flush_logs_to_db(UUID(job_id))
                return

            # Extract training metrics
            metrics = {}
            try:
                results_dict = results.results_dict if hasattr(results, 'results_dict') else {}
                metrics = {
                    "mAP50": round(float(results_dict.get("metrics/mAP50(B)", 0)), 4),
                    "mAP50_95": round(float(results_dict.get("metrics/mAP50-95(B)", 0)), 4),
                    "precision": round(float(results_dict.get("metrics/precision(B)", 0)), 4),
                    "recall": round(float(results_dict.get("metrics/recall(B)", 0)), 4),
                    "epochs": epochs,
                    "imgsz": imgsz,
                    "batch": batch,
                }
                
                # Read final losses from results.csv (YOLO saves all epoch metrics there)
                csv_path = Path(results.save_dir) / "results.csv"
                if csv_path.exists():
                    import csv
                    with csv_path.open("r") as f:
                        reader = csv.DictReader(f)
                        rows = list(reader)
                        if rows:
                            last_row = rows[-1]
                            # CSV keys vary by task: detection uses "train/box_loss", "train/cls_loss"
                            box_key = next((k for k in last_row.keys() if "box_loss" in k.lower()), None)
                            cls_key = next((k for k in last_row.keys() if "cls_loss" in k.lower()), None)
                            if box_key:
                                metrics["box_loss"] = round(float(last_row[box_key].strip()), 4)
                            if cls_key:
                                metrics["cls_loss"] = round(float(last_row[cls_key].strip()), 4)
                
                await publish_log(logs_channel, f"Metrics: mAP50={metrics['mAP50']}, mAP50-95={metrics['mAP50_95']}, P={metrics['precision']}, R={metrics['recall']}")
            except Exception:
                await publish_log(logs_channel, "Warning: could not extract training metrics")

            # Upload best weights to MinIO
            best_pt = Path(results.save_dir) / "weights" / "best.pt"
            artifact_path: str | None = None
            if best_pt.exists():
                artifact_path = _upload_model(best_pt, job_id)
                await publish_log(logs_channel, f"Model saved to {artifact_path}")

            await publish_log(logs_channel, f"Training complete: {results.save_dir}")
            await publish_progress(logs_channel, {
                "epoch": epochs, "total_epochs": epochs,
                "batch": 0, "total_batches": 0,
                "pct": 100, "elapsed_secs": round(_time.monotonic() - _timing["job_start"], 1),
                "eta_secs": 0, "phase": "completed",
            })
            await _update_job(UUID(job_id), "COMPLETED", artifact_path=artifact_path, metrics=metrics)
            await _flush_logs_to_db(UUID(job_id))
        except Exception:
            tb = traceback.format_exc()
            logger.error("train_model FAILED:\n%s", tb)
            try:
                await publish_log(logs_channel, f"ERROR: {tb}")
            except Exception:
                logger.error("Could not publish error log to Redis")
            try:
                await _update_job(UUID(job_id), "FAILED")
            except Exception:
                logger.error("Could not update job status to FAILED")
            try:
                await _flush_logs_to_db(UUID(job_id))
            except Exception:
                logger.error("Could not flush logs to DB")
        finally:
            # Cleanup temp directory
            if dataset_dir and dataset_dir.exists():
                shutil.rmtree(dataset_dir, ignore_errors=True)
            await dispose_engine()

    asyncio.run(_run())
