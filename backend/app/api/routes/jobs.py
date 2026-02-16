import json as _json
from uuid import UUID

from celery import Celery
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_role
from app.models.user import User
from app.core.config import get_settings
from app.models.job import Job
from app.models.enums import JobStatus
from app.schemas.jobs import JobCreate, JobRead, MODEL_ARCHITECTURES, ModelArchInfo, GpuEstimateResponse, JobProgress
from app.services.gpu_estimator import estimate_vram, suggest_max_batch
from app.services.redis import get_redis

router = APIRouter(prefix="/jobs", tags=["jobs"], dependencies=[Depends(get_current_user)])


def _get_celery() -> Celery:
    settings = get_settings()
    return Celery("spektra_worker", broker=settings.redis_url)


@router.get("/model-architectures", response_model=list[ModelArchInfo])
async def list_model_architectures() -> list[ModelArchInfo]:
    """List available model architectures with their metadata."""
    return [
        ModelArchInfo(key=key, **info)
        for key, info in MODEL_ARCHITECTURES.items()
    ]


@router.get("/estimate-gpu", response_model=GpuEstimateResponse)
async def estimate_gpu(
    model_arch: str = "yolo11n.pt",
    batch: int = 8,
    imgsz: int = 640,
) -> GpuEstimateResponse:
    """Estimate GPU VRAM required for a training configuration."""
    est = estimate_vram(model_arch=model_arch, batch=batch, imgsz=imgsz)
    max_batch = suggest_max_batch(model_arch=model_arch, imgsz=imgsz, vram_gb=16.0)
    return GpuEstimateResponse(
        model_params_mb=round(est.model_params_mb, 1),
        optimizer_mb=round(est.optimizer_mb, 1),
        activation_mb=round(est.activation_mb, 1),
        cuda_overhead_mb=round(est.cuda_overhead_mb, 1),
        total_mb=round(est.total_mb, 1),
        total_gb=round(est.total_gb, 2),
        fits_gpus=est.fits_gpus,
        tight_gpus=est.tight_gpus,
        too_small_gpus=est.too_small_gpus,
        suggested_max_batch_16gb=max_batch,
    )


@router.post("", response_model=JobRead, dependencies=[Depends(require_role("ADMIN", "ANNOTATOR"))])
async def create_job(
    payload: JobCreate,
    db: AsyncSession = Depends(get_db),
) -> JobRead:
    resolved_model_arch = payload.model_arch
    if payload.job_type == "train":
        if payload.checkpoint and payload.checkpoint.startswith("models/"):
            prev_result = await db.execute(
                select(Job)
                .where(Job.job_type == "train")
                .where(Job.artifact_path == payload.checkpoint)
                .order_by(Job.created_at.desc())
                .limit(1)
            )
            prev_job = prev_result.scalar_one_or_none()
            if prev_job and prev_job.model_arch:
                resolved_model_arch = prev_job.model_arch
        if resolved_model_arch not in MODEL_ARCHITECTURES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported model_arch: {resolved_model_arch}",
            )

    job = Job(
        project_id=payload.project_id,
        job_type=payload.job_type,
        status=JobStatus.PENDING,
        logs_channel=f"job_logs:{payload.project_id}",
        model_arch=resolved_model_arch,
        hyperparams=payload.hyperparams,
        checkpoint=payload.checkpoint,
        dataset_version_id=payload.dataset_version_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Update logs channel with actual job id
    job.logs_channel = f"job_logs:{job.id}"
    await db.commit()
    await db.refresh(job)

    celery = _get_celery()
    if payload.job_type == "train":
        result = celery.send_task(
            "train_model",
            kwargs={
                "job_id": str(job.id),
                "logs_channel": job.logs_channel,
                "project_id": str(payload.project_id),
                "model_arch": resolved_model_arch,
                "epochs": payload.hyperparams.get("epochs", 20),
                "batch": payload.hyperparams.get("batch", 8),
                "imgsz": payload.hyperparams.get("imgsz", 640),
                "checkpoint": payload.checkpoint or "coco",
                "dataset_version_id": str(payload.dataset_version_id) if payload.dataset_version_id else None,
            },
            queue="train",
        )
        job.celery_task_id = result.id
    elif payload.job_type == "predict":
        model_path = payload.model_path
        if not model_path:
            raise HTTPException(status_code=400, detail="model_path required for predict jobs")
        result = celery.send_task(
            "predict_dataset",
            kwargs={
                "job_id": str(job.id),
                "logs_channel": job.logs_channel,
                "project_id": str(payload.project_id),
                "model_path": model_path,
                "limit": payload.hyperparams.get("limit", 50),
            },
            queue="predict",
        )
        job.celery_task_id = result.id
    await db.commit()
    await db.refresh(job)

    return _job_to_read(job)


@router.post("/auto-annotate", response_model=JobRead, dependencies=[Depends(require_role("ADMIN", "ANNOTATOR"))])
async def auto_annotate(
    project_id: UUID,
    model_path: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
) -> JobRead:
    """Label Assist: run a trained model on unannotated images to generate predictions.

    Creates a predict job targeting images lacking annotations.
    Predictions are saved with is_prediction=True for review.
    If model_path is "latest", resolves to the most recent completed training job's artifact.
    """
    resolved_model_path = model_path

    if model_path == "latest":
        # Find the most recent completed training job with an artifact for this project
        latest_result = await db.execute(
            select(Job)
            .where(Job.project_id == project_id)
            .where(Job.job_type == "train")
            .where(Job.status == JobStatus.COMPLETED)
            .where(Job.artifact_path.isnot(None))
            .order_by(Job.created_at.desc())
            .limit(1)
        )
        latest_job = latest_result.scalar_one_or_none()
        if latest_job is None or not latest_job.artifact_path:
            raise HTTPException(
                status_code=400,
                detail="No completed training job found for this project. Train a model first.",
            )
        resolved_model_path = latest_job.artifact_path

    job = Job(
        project_id=project_id,
        job_type="predict",
        status=JobStatus.PENDING,
        logs_channel="",
        model_arch=None,
        hyperparams={"limit": limit, "auto_annotate": True},
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    job.logs_channel = f"job_logs:{job.id}"
    await db.commit()
    await db.refresh(job)

    celery = _get_celery()
    result = celery.send_task(
        "predict_dataset",
        kwargs={
            "job_id": str(job.id),
            "logs_channel": job.logs_channel,
            "project_id": str(project_id),
            "model_path": resolved_model_path,
            "limit": limit,
        },
        queue="predict",
    )
    job.celery_task_id = result.id
    await db.commit()
    await db.refresh(job)
    return _job_to_read(job)


@router.post("/predict-image", response_model=JobRead, dependencies=[Depends(require_role("ADMIN", "ANNOTATOR"))])
async def predict_single_image(
    project_id: UUID,
    image_id: UUID,
    model_path: str = "latest",
    db: AsyncSession = Depends(get_db),
) -> JobRead:
    """Run inference on a single image using a trained model.

    Predictions are saved with is_prediction=True alongside existing annotations.
    """
    resolved_model_path = model_path
    if model_path == "latest":
        latest_result = await db.execute(
            select(Job)
            .where(Job.project_id == project_id)
            .where(Job.job_type == "train")
            .where(Job.status == JobStatus.COMPLETED)
            .where(Job.artifact_path.isnot(None))
            .order_by(Job.created_at.desc())
            .limit(1)
        )
        latest_job = latest_result.scalar_one_or_none()
        if latest_job is None or not latest_job.artifact_path:
            raise HTTPException(
                status_code=400,
                detail="No completed training job found. Train a model first.",
            )
        resolved_model_path = latest_job.artifact_path

    job = Job(
        project_id=project_id,
        job_type="predict",
        status=JobStatus.PENDING,
        logs_channel="",
        hyperparams={"image_ids": [str(image_id)], "auto_annotate": True},
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    job.logs_channel = f"job_logs:{job.id}"
    await db.commit()
    await db.refresh(job)

    celery = _get_celery()
    result = celery.send_task(
        "predict_dataset",
        kwargs={
            "job_id": str(job.id),
            "logs_channel": job.logs_channel,
            "project_id": str(project_id),
            "model_path": resolved_model_path,
            "image_ids": [str(image_id)],
        },
        queue="predict",
    )
    job.celery_task_id = result.id
    await db.commit()
    await db.refresh(job)
    return _job_to_read(job)


@router.get("", response_model=list[JobRead])
async def list_jobs(
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[JobRead]:
    query = select(Job).order_by(Job.created_at.desc())
    if project_id:
        query = query.where(Job.project_id == project_id)
    result = await db.execute(query)
    jobs = result.scalars().all()
    return [_job_to_read(j) for j in jobs]


@router.get("/{job_id}", response_model=JobRead)
async def get_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> JobRead:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_read(job)


@router.post("/{job_id}/cancel", response_model=JobRead, dependencies=[Depends(require_role("ADMIN", "ANNOTATOR"))])
async def cancel_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> JobRead:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.PENDING, JobStatus.RUNNING):
        raise HTTPException(status_code=400, detail="Job is not running or pending")

    # Revoke the Celery task
    if job.celery_task_id:
        celery = _get_celery()
        celery.control.revoke(job.celery_task_id, terminate=True, signal="SIGTERM")

    # Publish cancellation message to logs channel
    redis = get_redis()
    try:
        await redis.publish(job.logs_channel, "Job cancelled by user")
    finally:
        await redis.close()

    job.status = JobStatus.CANCELLED
    await db.commit()
    await db.refresh(job)
    return _job_to_read(job)


def _job_to_read(job: Job) -> JobRead:
    return JobRead(
        id=job.id,
        project_id=job.project_id,
        job_type=job.job_type,
        status=job.status,
        logs_channel=job.logs_channel,
        model_arch=job.model_arch,
        hyperparams=job.hyperparams or {},
        artifact_path=job.artifact_path,
        created_at=job.created_at,
        dataset_version_id=job.dataset_version_id,
        metrics=job.metrics or {},
        checkpoint=job.checkpoint,
        celery_task_id=job.celery_task_id,
    )


@router.get("/{job_id}/progress", response_model=JobProgress)
async def get_job_progress(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> JobProgress:
    """Return the latest structured progress for a running job.

    Reads from Redis (live snapshot). Returns zero-state for non-running jobs.
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == JobStatus.COMPLETED:
        hp = job.hyperparams or {}
        return JobProgress(
            epoch=hp.get("epochs", 0),
            total_epochs=hp.get("epochs", 0),
            pct=100,
            phase="completed",
        )
    if job.status not in (JobStatus.RUNNING, JobStatus.PENDING):
        return JobProgress(phase=job.status.value.lower())

    redis = get_redis()
    try:
        raw = await redis.get(f"job_progress:{job_id}")
        if raw:
            data = _json.loads(raw)
            data.pop("type", None)
            return JobProgress(**data)
        return JobProgress(phase="pending" if job.status == JobStatus.PENDING else "preparing")
    finally:
        await redis.close()


@router.get("/{job_id}/logs")
async def get_job_logs(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return persisted log entries for a finished (or running) job.

    First tries the database ``jobs.logs`` column (populated on completion).
    Falls back to the Redis ``job_log_history:<id>`` list for running jobs.
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    # If DB has persisted logs, use them
    if job.logs and len(job.logs) > 0:
        return job.logs

    # Fallback: read from Redis list (still running / recently finished)
    redis = get_redis()
    try:
        list_key = f"job_log_history:{job_id}"
        raw_entries = await redis.lrange(list_key, 0, -1)
        return [_json.loads(e) for e in raw_entries] if raw_entries else []
    finally:
        await redis.close()


# ------ WebSocket route (mounted separately) ------

ws_router = APIRouter(prefix="/ws/jobs", tags=["jobs-ws"])


@ws_router.websocket("/{job_id}")
async def stream_job_logs(
    websocket: WebSocket,
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    await websocket.accept()
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        await websocket.close(code=1008)
        return

    redis = get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe(job.logs_channel)

    try:
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            payload = message.get("data")
            if payload is None:
                continue
            await websocket.send_text(str(payload))
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(job.logs_channel)
        await pubsub.close()
        await redis.close()
