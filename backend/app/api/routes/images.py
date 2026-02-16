import asyncio
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from app.api.deps import get_current_user, get_db, require_role
from app.models.user import User
from app.core.config import get_settings
from app.db.session import async_session
from app.models.image import Image
from app.models.annotation import Annotation
from app.models.annotation_history import AnnotationHistory
from app.models.project import Project
from app.models.tag import Tag
from app.schemas.annotations import AnnotationBulkResponse, AnnotationBulkUpdate, AnnotationHistoryRead, AnnotationRead
from app.schemas.images import (
    ImageNullUpdate,
    ImageReviewRequest,
    ImageReviewResponse,
    ImageSplitUpdate,
    ImageStatusUpdate,
    ImageUploadCompleteRequest,
    ImageUploadCompleteResponse,
    ImageUploadResponse,
    ImageUploadResult,
    PresignedGet,
    PresignedPost,
)
from app.schemas.tags import BulkTagsUpdate, ImageTagsUpdate
from app.services.exif import extract_exif
from app.services.presign import create_presigned_get, create_presigned_post
from app.services.storage import ensure_bucket, get_s3_client

router = APIRouter(prefix="/images", tags=["images"], dependencies=[Depends(get_current_user)])


async def _update_meta(
    session: AsyncSession,
    image_id: UUID,
    meta: dict[str, Any],
    filename: str | None = None,
) -> None:
    result = await session.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        return
    image.meta = meta
    if filename:
        image.filename = filename
    if meta.get("width"):
        image.width = int(meta["width"])
    if meta.get("height"):
        image.height = int(meta["height"])
    await session.commit()


async def _process_exif(image_id: UUID, image_bytes: bytes, filename: str | None = None) -> None:
    meta = extract_exif(image_bytes)
    async with async_session() as session:
        await _update_meta(session, image_id, meta, filename)


def _process_exif_from_storage(image_id: UUID, storage_path: str, filename: str | None = None) -> None:
    """Synchronous background task: fetches image from S3, extracts EXIF, updates DB."""
    settings = get_settings()
    s3 = get_s3_client()
    response = s3.get_object(Bucket=settings.minio_bucket, Key=storage_path)
    payload = response["Body"].read()
    meta = extract_exif(payload)

    # Use a fresh event loop since BackgroundTasks runs in a thread
    import asyncio
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_update_meta_standalone(image_id, meta, filename))
    finally:
        loop.close()


async def _update_meta_standalone(image_id: UUID, meta: dict, filename: str | None = None) -> None:
    async with async_session() as session:
        await _update_meta(session, image_id, meta, filename)


@router.post("/upload", response_model=ImageUploadResponse)
async def upload_images(
    project_id: UUID = Form(...),
    files: list[UploadFile] | None = File(default=None),
    db: AsyncSession = Depends(get_db),
) -> ImageUploadResponse:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    settings = get_settings()
    ensure_bucket()

    uploaded: list[ImageUploadResult] = []
    presigned: list[PresignedPost] = []

    if files:
        s3 = get_s3_client()
        for upload in files:
            payload = await upload.read()
            key = f"{project_id}/{uuid4()}-{upload.filename}"
            s3.put_object(
                Bucket=settings.minio_bucket,
                Key=key,
                Body=payload,
                ContentType=upload.content_type or "application/octet-stream",
            )
            image = Image(
                project_id=project_id,
                storage_path=key,
                filename=upload.filename,
                meta={},
            )
            db.add(image)
            await db.commit()
            await db.refresh(image)
            asyncio.create_task(_process_exif(image.id, payload, upload.filename))
            uploaded.append(ImageUploadResult(image_id=image.id, storage_path=key, meta=image.meta))
    else:
        key = f"{project_id}/{uuid4()}"
        image = Image(project_id=project_id, storage_path=key, meta={})
        db.add(image)
        await db.commit()
        await db.refresh(image)
        presigned_data = create_presigned_post(key)
        presigned.append(
            PresignedPost(
                image_id=image.id,
                storage_path=key,
                url=presigned_data["url"],
                fields=presigned_data["fields"],
            )
        )

    return ImageUploadResponse(uploaded=uploaded, presigned=presigned)


@router.post("/{image_id}/complete", response_model=ImageUploadCompleteResponse)
async def complete_upload(
    image_id: UUID,
    payload: ImageUploadCompleteRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> ImageUploadCompleteResponse:
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")

    background_tasks.add_task(
        _process_exif_from_storage,
        image.id,
        image.storage_path,
        payload.filename,
    )

    return ImageUploadCompleteResponse(
        image_id=image.id,
        storage_path=image.storage_path,
        meta=image.meta,
        width=image.width,
        height=image.height,
    )


@router.get("/{image_id}/url", response_model=PresignedGet)
async def get_image_url(
    image_id: UUID,
    db: AsyncSession = Depends(get_db),
    expires_in: int = 900,
) -> PresignedGet:
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")

    url = create_presigned_get(image.storage_path, expires=expires_in)
    return PresignedGet(url=url, expires_in=expires_in)


@router.get("/{image_id}/annotations", response_model=list[AnnotationRead])
async def list_annotations(image_id: UUID, db: AsyncSession = Depends(get_db)) -> list[AnnotationRead]:
    result = await db.execute(select(Annotation).where(Annotation.image_id == image_id))
    annotations = result.scalars().all()
    return [
        AnnotationRead(
            id=item.id,
            label_id=item.label_id,
            geometry=item.geometry,
            confidence=item.confidence,
            is_prediction=item.is_prediction,
            version=item.version,
        )
        for item in annotations
    ]


@router.patch("/{image_id}/annotations", response_model=AnnotationBulkResponse)
async def update_annotations(
    image_id: UUID,
    payload: AnnotationBulkUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnnotationBulkResponse:
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")

    for op in payload.ops:
        if op.action == "create":
            if op.label_id is None or op.geometry is None:
                raise HTTPException(status_code=400, detail="Missing label_id or geometry")
            annotation = Annotation(
                image_id=image_id,
                label_id=op.label_id,
                geometry=op.geometry,
                confidence=op.confidence,
                is_prediction=bool(op.is_prediction) if op.is_prediction is not None else False,
            )
            db.add(annotation)
            await db.flush()  # get the generated id
            db.add(AnnotationHistory(
                annotation_id=annotation.id,
                image_id=image_id,
                label_id=op.label_id,
                geometry=op.geometry,
                action="create",
                version=annotation.version,
                changed_by=user.id,
                snapshot={"confidence": op.confidence, "is_prediction": bool(op.is_prediction) if op.is_prediction else False},
            ))
        elif op.action == "update":
            if op.id is None:
                raise HTTPException(status_code=400, detail="Missing annotation id")
            result = await db.execute(select(Annotation).where(Annotation.id == op.id))
            annotation = result.scalar_one_or_none()
            if annotation is None:
                continue
            # Optimistic locking: if client sends a version, verify it matches
            if op.version is not None and annotation.version != op.version:
                raise HTTPException(
                    status_code=409,
                    detail=f"Annotation {op.id} was modified by another user (expected version {op.version}, found {annotation.version})",
                )
            # Capture pre-update state for history
            prev_snapshot = {
                "label_id": str(annotation.label_id),
                "geometry": annotation.geometry,
                "confidence": annotation.confidence,
                "is_prediction": annotation.is_prediction,
            }
            if op.label_id is not None:
                annotation.label_id = op.label_id
            if op.geometry is not None:
                annotation.geometry = op.geometry
            if op.confidence is not None:
                annotation.confidence = op.confidence
            if op.is_prediction is not None:
                annotation.is_prediction = op.is_prediction
            db.add(AnnotationHistory(
                annotation_id=annotation.id,
                image_id=image_id,
                label_id=annotation.label_id,
                geometry=annotation.geometry,
                action="update",
                version=annotation.version,
                changed_by=user.id,
                snapshot={"before": prev_snapshot},
            ))
        elif op.action == "delete":
            if op.id is None:
                raise HTTPException(status_code=400, detail="Missing annotation id")
            result = await db.execute(select(Annotation).where(Annotation.id == op.id))
            annotation = result.scalar_one_or_none()
            if annotation is not None:
                # Flush history BEFORE deleting — the FK target must still exist
                db.add(AnnotationHistory(
                    annotation_id=annotation.id,
                    image_id=image_id,
                    label_id=annotation.label_id,
                    geometry=annotation.geometry,
                    action="delete",
                    version=annotation.version,
                    changed_by=user.id,
                    snapshot={"confidence": annotation.confidence, "is_prediction": annotation.is_prediction},
                ))
                await db.flush()  # persist history row while annotation still exists
                await db.delete(annotation)

    try:
        await db.commit()
    except (StaleDataError, IntegrityError):
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict: resource was modified by another user. Please reload and retry.")

    result = await db.execute(select(Annotation).where(Annotation.image_id == image_id))
    annotations = result.scalars().all()
    return AnnotationBulkResponse(
        annotations=[
            AnnotationRead(
                id=item.id,
                label_id=item.label_id,
                geometry=item.geometry,
                confidence=item.confidence,
                is_prediction=item.is_prediction,
                version=item.version,
            )
            for item in annotations
        ]
    )


@router.patch("/{image_id}/status")
async def update_image_status(
    image_id: UUID,
    payload: ImageStatusUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    image.status = payload.status
    try:
        await db.commit()
    except StaleDataError:
        raise HTTPException(status_code=409, detail="Conflict: image was modified by another user.")
    return {"id": str(image.id), "status": image.status.value, "version": image.version}


@router.delete("/{image_id}", status_code=204)
async def delete_image(
    image_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    # Delete from object storage
    try:
        settings = get_settings()
        s3 = get_s3_client()
        s3.delete_object(Bucket=settings.minio_bucket, Key=image.storage_path)
    except Exception:
        pass  # Best-effort cleanup
    await db.delete(image)
    await db.commit()


@router.get("/{image_id}/annotations/history", response_model=list[AnnotationHistoryRead])
async def get_annotation_history(
    image_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> list[AnnotationHistoryRead]:
    result = await db.execute(select(Image).where(Image.id == image_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Image not found")
    result = await db.execute(
        select(AnnotationHistory)
        .where(AnnotationHistory.image_id == image_id)
        .order_by(AnnotationHistory.changed_at.desc())
    )
    rows = result.scalars().all()
    return [
        AnnotationHistoryRead(
            id=r.id,
            annotation_id=r.annotation_id,
            image_id=r.image_id,
            label_id=r.label_id,
            geometry=r.geometry,
            action=r.action,
            version=r.version,
            changed_by=r.changed_by,
            changed_at=r.changed_at.isoformat() if r.changed_at else "",
            snapshot=r.snapshot,
        )
        for r in rows
    ]


@router.patch(
    "/{image_id}/review",
    response_model=ImageReviewResponse,
    dependencies=[Depends(require_role("ADMIN", "REVIEWER"))],
)
async def review_image(
    image_id: UUID,
    payload: ImageReviewRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ImageReviewResponse:
    """Set / update the review status of an image (ADMIN or REVIEWER only)."""
    from app.models.enums import ReviewStatus

    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    try:
        review_status = ReviewStatus(payload.review_status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid review_status: {payload.review_status}")
    image.review_status = review_status
    image.reviewed_by = user.id
    image.review_comment = payload.comment
    try:
        await db.commit()
    except StaleDataError:
        raise HTTPException(status_code=409, detail="Conflict: image was modified by another user.")
    return ImageReviewResponse(
        image_id=image.id,
        review_status=image.review_status.value,
        reviewed_by=image.reviewed_by,
        review_comment=image.review_comment,
    )


@router.patch("/{image_id}/null")
async def mark_null(
    image_id: UUID,
    payload: ImageNullUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark or unmark an image as null (background image with no objects)."""
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    image.is_null = payload.is_null
    if payload.is_null:
        # When marking as null, also mark the image as DONE
        from app.models.enums import ImageStatus
        image.status = ImageStatus.DONE
    try:
        await db.commit()
    except StaleDataError:
        raise HTTPException(status_code=409, detail="Conflict: image was modified by another user.")
    return {"id": str(image.id), "is_null": image.is_null, "status": image.status.value}


@router.patch("/{image_id}/split")
async def update_image_split(
    image_id: UUID,
    payload: ImageSplitUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Manually set the train/valid/test split for an image."""
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    image.split = payload.split
    try:
        await db.commit()
    except StaleDataError:
        raise HTTPException(status_code=409, detail="Conflict: image was modified by another user.")
    return {"id": str(image.id), "split": image.split.value}


# ---- Image Tags ----


@router.put("/{image_id}/tags")
async def set_image_tags(
    image_id: UUID,
    payload: ImageTagsUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Replace all tags on an image (set semantics)."""
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Image).options(selectinload(Image.tags)).where(Image.id == image_id)
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")

    if payload.tag_ids:
        tag_result = await db.execute(select(Tag).where(Tag.id.in_(payload.tag_ids)))
        tags = list(tag_result.scalars().all())
    else:
        tags = []

    image.tags = tags
    try:
        await db.commit()
    except StaleDataError:
        raise HTTPException(status_code=409, detail="Conflict: image was modified by another user.")
    return {
        "image_id": str(image.id),
        "tags": [{"id": str(t.id), "name": t.name, "color": t.color} for t in image.tags],
    }


@router.patch("/bulk-tags")
async def bulk_update_tags(
    payload: BulkTagsUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Add/remove tags across multiple images."""
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Image).options(selectinload(Image.tags)).where(Image.id.in_(payload.image_ids))
    )
    images = list(result.scalars().all())

    add_tags: list[Tag] = []
    remove_tags: list[Tag] = []
    if payload.add_tag_ids:
        r = await db.execute(select(Tag).where(Tag.id.in_(payload.add_tag_ids)))
        add_tags = list(r.scalars().all())
    if payload.remove_tag_ids:
        r = await db.execute(select(Tag).where(Tag.id.in_(payload.remove_tag_ids)))
        remove_tags = list(r.scalars().all())

    add_set = set(t.id for t in add_tags)
    remove_set = set(t.id for t in remove_tags)

    for image in images:
        current_ids = set(t.id for t in image.tags)
        # Add new tags
        for tag in add_tags:
            if tag.id not in current_ids:
                image.tags.append(tag)
        # Remove tags
        image.tags = [t for t in image.tags if t.id not in remove_set]

    await db.commit()
    return {"updated": len(images)}
