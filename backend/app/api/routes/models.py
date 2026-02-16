"""Trained model registry — lists models produced by completed training jobs.

Includes management: rename, add notes, delete artifact.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_role
from app.models.job import Job
from app.models.enums import JobStatus

router = APIRouter(prefix="/models", tags=["models"], dependencies=[Depends(get_current_user)])


class TrainedModel(BaseModel):
    job_id: UUID
    project_id: UUID
    artifact_path: str
    model_arch: str | None
    metrics: dict
    created_at: str | None
    dataset_version_id: UUID | None
    display_name: str | None = None
    notes: str | None = None


class ModelUpdate(BaseModel):
    display_name: str | None = None
    notes: str | None = None


def _job_to_model(job: Job) -> TrainedModel:
    meta = job.metrics or {}
    return TrainedModel(
        job_id=job.id,
        project_id=job.project_id,
        artifact_path=job.artifact_path,  # type: ignore[arg-type]
        model_arch=job.model_arch,
        metrics={k: v for k, v in meta.items() if k not in ("_display_name", "_notes")},
        created_at=str(job.created_at) if job.created_at else None,
        dataset_version_id=job.dataset_version_id,
        display_name=meta.get("_display_name"),
        notes=meta.get("_notes"),
    )


@router.get("/projects/{project_id}", response_model=list[TrainedModel])
async def list_trained_models(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> list[TrainedModel]:
    """Return all trained models for a project (completed train jobs with artifacts)."""
    result = await db.execute(
        select(Job)
        .where(
            Job.project_id == project_id,
            Job.job_type == "train",
            Job.status == JobStatus.COMPLETED,
            Job.artifact_path.isnot(None),
        )
        .order_by(Job.created_at.desc())
    )
    jobs = result.scalars().all()
    return [_job_to_model(job) for job in jobs]


@router.patch("/projects/{project_id}/{job_id}", response_model=TrainedModel, dependencies=[Depends(require_role("ADMIN"))])
async def update_model(
    project_id: UUID,
    job_id: UUID,
    payload: ModelUpdate,
    db: AsyncSession = Depends(get_db),
) -> TrainedModel:
    """Update model metadata (display name, notes). ADMIN only."""
    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.project_id == project_id)
    )
    job = result.scalar_one_or_none()
    if not job or job.artifact_path is None:
        raise HTTPException(status_code=404, detail="Model not found")

    meta = dict(job.metrics or {})
    if payload.display_name is not None:
        meta["_display_name"] = payload.display_name
    if payload.notes is not None:
        meta["_notes"] = payload.notes
    job.metrics = meta

    await db.commit()
    await db.refresh(job)
    return _job_to_model(job)


@router.delete("/projects/{project_id}/{job_id}", dependencies=[Depends(require_role("ADMIN"))])
async def delete_model(
    project_id: UUID,
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Remove model artifact reference (does not delete S3 object). ADMIN only."""
    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.project_id == project_id)
    )
    job = result.scalar_one_or_none()
    if not job or job.artifact_path is None:
        raise HTTPException(status_code=404, detail="Model not found")

    job.artifact_path = None
    await db.commit()
    return {"ok": True}
