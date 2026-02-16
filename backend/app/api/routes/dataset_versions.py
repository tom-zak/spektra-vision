import random
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_role
from app.models.annotation import Annotation
from app.models.dataset_version import DatasetVersion
from app.models.enums import ImageSplit, VersionStatus
from app.models.image import Image
from app.models.label import Label
from app.models.project import Project
from app.schemas.dataset_versions import (
    DatasetHealthResponse,
    DatasetVersionCreate,
    DatasetVersionDetail,
    DatasetVersionRead,
    SplitAssignment,
)
from app.services.presign import create_presigned_get

router = APIRouter(
    prefix="/projects",
    tags=["dataset-versions"],
    dependencies=[Depends(get_current_user)],
)


def _version_to_read(v: DatasetVersion) -> DatasetVersionRead:
    return DatasetVersionRead(
        id=v.id,
        project_id=v.project_id,
        version_number=v.version_number,
        name=v.name,
        status=v.status,
        train_pct=v.train_pct,
        valid_pct=v.valid_pct,
        test_pct=v.test_pct,
        preprocessing=v.preprocessing or {},
        augmentation=v.augmentation or {},
        num_images=v.num_images,
        num_train=v.num_train,
        num_valid=v.num_valid,
        num_test=v.num_test,
        num_annotations=v.num_annotations,
        num_classes=v.num_classes,
        created_at=v.created_at,
    )


# ---------- Dataset Versions ----------


@router.get("/{project_id}/versions", response_model=list[DatasetVersionRead])
async def list_versions(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> list[DatasetVersionRead]:
    result = await db.execute(
        select(DatasetVersion)
        .where(DatasetVersion.project_id == project_id)
        .order_by(DatasetVersion.version_number.desc())
    )
    return [_version_to_read(v) for v in result.scalars().all()]


@router.get("/{project_id}/versions/{version_id}", response_model=DatasetVersionDetail)
async def get_version(
    project_id: UUID,
    version_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> DatasetVersionDetail:
    result = await db.execute(
        select(DatasetVersion).where(
            DatasetVersion.id == version_id,
            DatasetVersion.project_id == project_id,
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    read = _version_to_read(version)
    return DatasetVersionDetail(
        **read.model_dump(),
        image_snapshot=version.image_snapshot or [],
    )


@router.post(
    "/{project_id}/versions",
    response_model=DatasetVersionRead,
    status_code=201,
    dependencies=[Depends(require_role("ADMIN", "ANNOTATOR"))],
)
async def create_version(
    project_id: UUID,
    payload: DatasetVersionCreate,
    db: AsyncSession = Depends(get_db),
) -> DatasetVersionRead:
    """Generate a new dataset version — snapshot current images with split assignment."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate split percentages sum to ~1.0
    total_pct = payload.train_pct + payload.valid_pct + payload.test_pct
    if abs(total_pct - 1.0) > 0.01:
        raise HTTPException(status_code=400, detail="Split percentages must sum to 1.0")

    # Get next version number
    result = await db.execute(
        select(func.coalesce(func.max(DatasetVersion.version_number), 0))
        .where(DatasetVersion.project_id == project_id)
    )
    next_version = (result.scalar() or 0) + 1

    # Fetch all annotated (non-null) images, optionally filtered by tag
    img_query = select(Image).where(
        Image.project_id == project_id,
        Image.is_null.is_(False),
    )
    if payload.filter_tag_id:
        from app.models.tag import image_tags
        img_query = img_query.join(image_tags).where(
            image_tags.c.tag_id == UUID(payload.filter_tag_id)
        )
    result = await db.execute(img_query)
    images = list(result.scalars().all())

    if not images:
        raise HTTPException(status_code=400, detail="No images available for versioning")

    # Count annotations
    image_ids = [img.id for img in images]
    anno_count_result = await db.execute(
        select(func.count(Annotation.id)).where(Annotation.image_id.in_(image_ids))
    )
    total_annotations = anno_count_result.scalar() or 0

    # Count classes
    class_count_result = await db.execute(
        select(func.count(Label.id)).where(Label.project_id == project_id)
    )
    num_classes = class_count_result.scalar() or 0

    # Assign splits randomly based on percentages
    random.shuffle(images)
    n = len(images)
    n_train = max(1, round(n * payload.train_pct))
    n_valid = max(0, round(n * payload.valid_pct))
    n_test = n - n_train - n_valid

    snapshot: list[dict[str, Any]] = []
    for i, img in enumerate(images):
        if i < n_train:
            split = "TRAIN"
        elif i < n_train + n_valid:
            split = "VALID"
        else:
            split = "TEST"
        snapshot.append({
            "image_id": str(img.id),
            "split": split,
            "filename": img.filename,
            "storage_path": img.storage_path,
        })

        # Also update the image's split field
        img.split = ImageSplit(split)

    version = DatasetVersion(
        project_id=project_id,
        version_number=next_version,
        name=payload.name or f"v{next_version}",
        status=VersionStatus.READY,
        train_pct=payload.train_pct,
        valid_pct=payload.valid_pct,
        test_pct=payload.test_pct,
        preprocessing=payload.preprocessing.model_dump(),
        augmentation=payload.augmentation.model_dump(),
        num_images=n,
        num_train=n_train,
        num_valid=n_valid,
        num_test=n_test,
        num_annotations=total_annotations,
        num_classes=num_classes,
        image_snapshot=snapshot,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return _version_to_read(version)


@router.delete(
    "/{project_id}/versions/{version_id}",
    status_code=204,
    dependencies=[Depends(require_role("ADMIN", "ANNOTATOR"))],
)
async def delete_version(
    project_id: UUID,
    version_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(DatasetVersion).where(
            DatasetVersion.id == version_id,
            DatasetVersion.project_id == project_id,
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    await db.delete(version)
    await db.commit()


# ---------- Split Management ----------


@router.post(
    "/{project_id}/splits/auto",
    dependencies=[Depends(require_role("ADMIN", "ANNOTATOR"))],
)
async def auto_assign_splits(
    project_id: UUID,
    payload: SplitAssignment,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Auto-assign train/valid/test splits to all images in the project."""
    total_pct = payload.train_pct + payload.valid_pct + payload.test_pct
    if abs(total_pct - 1.0) > 0.01:
        raise HTTPException(status_code=400, detail="Split percentages must sum to 1.0")

    result = await db.execute(
        select(Image).where(Image.project_id == project_id)
    )
    images = list(result.scalars().all())
    if not images:
        return {"assigned": 0}

    random.shuffle(images)
    n = len(images)
    n_train = max(1, round(n * payload.train_pct))
    n_valid = max(0, round(n * payload.valid_pct))

    counts = {"TRAIN": 0, "VALID": 0, "TEST": 0}
    for i, img in enumerate(images):
        if i < n_train:
            img.split = ImageSplit.TRAIN
            counts["TRAIN"] += 1
        elif i < n_train + n_valid:
            img.split = ImageSplit.VALID
            counts["VALID"] += 1
        else:
            img.split = ImageSplit.TEST
            counts["TEST"] += 1

    await db.commit()
    return {"assigned": n, "splits": counts}


# ---------- Dataset Health ----------


@router.get("/{project_id}/health", response_model=DatasetHealthResponse)
async def dataset_health(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> DatasetHealthResponse:
    """Comprehensive dataset health check with class balance and coverage stats."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    # Image counts
    result = await db.execute(
        select(func.count(Image.id)).where(Image.project_id == project_id)
    )
    total_images = result.scalar() or 0

    result = await db.execute(
        select(func.count(Image.id)).where(
            Image.project_id == project_id, Image.is_null.is_(True)
        )
    )
    null_images = result.scalar() or 0

    # Images with at least one annotation
    from sqlalchemy import distinct
    result = await db.execute(
        select(func.count(distinct(Annotation.image_id)))
        .join(Image, Annotation.image_id == Image.id)
        .where(Image.project_id == project_id)
    )
    annotated_images = result.scalar() or 0
    unannotated_images = total_images - annotated_images - null_images

    # Total annotations
    result = await db.execute(
        select(func.count(Annotation.id))
        .join(Image, Annotation.image_id == Image.id)
        .where(Image.project_id == project_id)
    )
    total_annotations = result.scalar() or 0
    annotations_per_image = round(total_annotations / max(total_images, 1), 2)

    # Class balance
    result = await db.execute(
        select(Label.name, func.count(Annotation.id))
        .join(Annotation, Label.id == Annotation.label_id)
        .join(Image, Annotation.image_id == Image.id)
        .where(Image.project_id == project_id)
        .group_by(Label.name)
    )
    class_balance = {row[0]: row[1] for row in result.all()}

    # Split counts
    result = await db.execute(
        select(Image.split, func.count(Image.id))
        .where(Image.project_id == project_id)
        .group_by(Image.split)
    )
    split_counts = {row[0].value: row[1] for row in result.all()}

    # Images by status
    result = await db.execute(
        select(Image.status, func.count(Image.id))
        .where(Image.project_id == project_id)
        .group_by(Image.status)
    )
    images_by_status = {row[0].value: row[1] for row in result.all()}

    return DatasetHealthResponse(
        total_images=total_images,
        annotated_images=annotated_images,
        unannotated_images=unannotated_images,
        null_images=null_images,
        total_annotations=total_annotations,
        annotations_per_image=annotations_per_image,
        class_balance=class_balance,
        split_counts=split_counts,
        images_by_status=images_by_status,
    )
