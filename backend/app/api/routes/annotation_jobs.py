"""Annotation job routes — assign images to annotators, track progress."""

import random
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_role
from app.models.annotation_job import AnnotationJob
from app.models.enums import AnnotationJobStatus
from app.models.image import Image
from app.models.user import User
from app.schemas.annotation_jobs import (
    AnnotationJobCreate,
    AnnotationJobImageUpdate,
    AnnotationJobRead,
    AnnotationJobUpdate,
)

router = APIRouter(prefix="/annotation-jobs", tags=["annotation-jobs"], dependencies=[Depends(get_current_user)])


def _to_read(job: AnnotationJob) -> AnnotationJobRead:
    image_map: dict[str, str] = job.image_ids or {}
    return AnnotationJobRead(
        id=job.id,
        project_id=job.project_id,
        assigned_to=job.assigned_to,
        assignee_email=job.assignee.email if job.assignee else None,
        batch_name=job.batch_name,
        instructions=job.instructions,
        status=job.status.value,
        image_ids=image_map,
        total_images=len(image_map),
        completed_images=sum(1 for v in image_map.values() if v == "done"),
        created_at=job.created_at,
        created_by=job.created_by,
    )


@router.post("", response_model=AnnotationJobRead, dependencies=[Depends(require_role("ADMIN"))])
async def create_annotation_job(
    payload: AnnotationJobCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnnotationJobRead:
    """Create a new annotation assignment (ADMIN only).

    Supply either ``image_ids`` (specific images) **or** ``image_count``
    (randomly pick N unassigned images from the project).
    """
    if not payload.image_ids and not payload.image_count:
        raise HTTPException(status_code=400, detail="Provide image_ids or image_count")

    if payload.image_count and not payload.image_ids:
        # Collect IDs already in active annotation jobs for this project
        active_jobs = await db.execute(
            select(AnnotationJob.image_ids).where(
                AnnotationJob.project_id == payload.project_id,
                AnnotationJob.status.notin_([AnnotationJobStatus.DONE]),
            )
        )
        already_assigned: set[str] = set()
        for (ids_map,) in active_jobs:
            if ids_map:
                already_assigned.update(ids_map.keys())

        # Fetch all project images not already assigned
        all_images = await db.execute(
            select(Image.id).where(Image.project_id == payload.project_id)
        )
        available = [str(row[0]) for row in all_images if str(row[0]) not in already_assigned]
        if len(available) < payload.image_count:
            raise HTTPException(
                status_code=400,
                detail=f"Only {len(available)} unassigned images available, requested {payload.image_count}",
            )
        chosen = random.sample(available, payload.image_count)
        image_map = {img_id: "pending" for img_id in chosen}
    else:
        image_map = {str(img_id): "pending" for img_id in payload.image_ids}  # type: ignore[union-attr]

    job = AnnotationJob(
        project_id=payload.project_id,
        assigned_to=payload.assigned_to,
        batch_name=payload.batch_name,
        instructions=payload.instructions,
        image_ids=image_map,
        created_by=user.id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job, attribute_names=["assignee"])
    return _to_read(job)


@router.get("", response_model=list[AnnotationJobRead])
async def list_annotation_jobs(
    project_id: UUID | None = None,
    assigned_to: UUID | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AnnotationJobRead]:
    """List annotation jobs, filtered. Annotators see only their own."""
    query = select(AnnotationJob)
    if project_id:
        query = query.where(AnnotationJob.project_id == project_id)
    if user.role.value == "ANNOTATOR":
        query = query.where(AnnotationJob.assigned_to == user.id)
    elif assigned_to:
        query = query.where(AnnotationJob.assigned_to == assigned_to)
    if status:
        try:
            query = query.where(AnnotationJob.status == AnnotationJobStatus(status))
        except ValueError:
            pass
    query = query.order_by(AnnotationJob.created_at.desc())
    result = await db.execute(query)
    jobs = result.scalars().all()
    # Eagerly load assignee for email display
    for j in jobs:
        await db.refresh(j, attribute_names=["assignee"])
    return [_to_read(j) for j in jobs]


@router.get("/{job_id}", response_model=AnnotationJobRead)
async def get_annotation_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnnotationJobRead:
    """Get annotation job detail."""
    result = await db.execute(select(AnnotationJob).where(AnnotationJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Annotation job not found")
    # Annotators can only see their own
    if user.role.value == "ANNOTATOR" and job.assigned_to != user.id:
        raise HTTPException(status_code=403, detail="Not your assignment")
    await db.refresh(job, attribute_names=["assignee"])
    return _to_read(job)


@router.patch("/{job_id}", response_model=AnnotationJobRead)
async def update_annotation_job(
    job_id: UUID,
    payload: AnnotationJobUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnnotationJobRead:
    """Update annotation job. ADMIN can change anything; assignee can transition status."""
    result = await db.execute(select(AnnotationJob).where(AnnotationJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Annotation job not found")

    is_admin = user.role.value == "ADMIN"
    is_assignee = job.assigned_to == user.id

    if not is_admin and not is_assignee:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    if payload.status is not None:
        try:
            new_status = AnnotationJobStatus(payload.status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {payload.status}")
        job.status = new_status

    if is_admin:
        if payload.assigned_to is not None:
            job.assigned_to = payload.assigned_to
        if payload.batch_name is not None:
            job.batch_name = payload.batch_name
        if payload.instructions is not None:
            job.instructions = payload.instructions

    await db.commit()
    await db.refresh(job, attribute_names=["assignee"])
    return _to_read(job)


@router.patch("/{job_id}/images/{image_id}", response_model=AnnotationJobRead)
async def update_annotation_job_image(
    job_id: UUID,
    image_id: UUID,
    payload: AnnotationJobImageUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnnotationJobRead:
    """Update per-image status within an annotation job."""
    result = await db.execute(select(AnnotationJob).where(AnnotationJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Annotation job not found")

    is_admin = user.role.value == "ADMIN"
    is_assignee = job.assigned_to == user.id
    if not is_admin and not is_assignee:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    image_key = str(image_id)
    image_map: dict[str, str] = dict(job.image_ids or {})
    if image_key not in image_map:
        raise HTTPException(status_code=404, detail="Image not in this annotation job")

    image_map[image_key] = payload.status
    job.image_ids = image_map

    await db.commit()
    await db.refresh(job, attribute_names=["assignee"])
    return _to_read(job)


@router.delete("/{job_id}", dependencies=[Depends(require_role("ADMIN"))])
async def delete_annotation_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete an annotation job (ADMIN only)."""
    result = await db.execute(select(AnnotationJob).where(AnnotationJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Annotation job not found")
    await db.delete(job)
    await db.commit()
    return {"ok": True}
