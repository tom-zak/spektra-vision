from uuid import UUID

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, case, delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_db, require_role
from app.models.user import User
from app.models.image import Image
from app.models.annotation import Annotation
from app.models.annotation_history import AnnotationHistory
from app.models.enums import ImageStatus
from app.models.project import Project
from app.models.job import Job
from app.models.dataset_version import DatasetVersion
from app.models.tag import Tag, image_tags
from app.models.label import Label
from app.schemas.images import ImageListItem, ImageListResponse, LabelSummary
from app.schemas.projects import ProjectCreate, ProjectRead, ProjectUpdate
from app.schemas.tags import TagOut
from app.services.presign import create_presigned_get

router = APIRouter(prefix="/projects", tags=["projects"], dependencies=[Depends(get_current_user)])


@router.post("", response_model=ProjectRead, dependencies=[Depends(require_role("ADMIN"))])
async def create_project(payload: ProjectCreate, db: AsyncSession = Depends(get_db)) -> ProjectRead:
    project = Project(name=payload.name, task_type=payload.task_type, ontology=payload.ontology)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return ProjectRead(id=project.id, name=project.name, task_type=project.task_type, ontology=project.ontology, version=project.version)


@router.get("", response_model=list[ProjectRead])
async def list_projects(db: AsyncSession = Depends(get_db)) -> list[ProjectRead]:
    result = await db.execute(select(Project))
    projects = result.scalars().all()
    return [
        ProjectRead(id=p.id, name=p.name, task_type=p.task_type, ontology=p.ontology, version=p.version) for p in projects
    ]


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(project_id: UUID, db: AsyncSession = Depends(get_db)) -> ProjectRead:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectRead(id=project.id, name=project.name, task_type=project.task_type, ontology=project.ontology, version=project.version)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: UUID, db: AsyncSession = Depends(get_db)) -> None:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    # DB-level ON DELETE CASCADE (migration 20260210_cascade_deletes) handles all children
    await db.delete(project)
    await db.commit()


@router.patch("/{project_id}", response_model=ProjectRead, dependencies=[Depends(require_role("ADMIN"))])
async def update_project(project_id: UUID, payload: ProjectUpdate, db: AsyncSession = Depends(get_db)) -> ProjectRead:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.name is not None:
        project.name = payload.name
    if payload.task_type is not None:
        project.task_type = payload.task_type
    if payload.ontology is not None:
        project.ontology = payload.ontology
    await db.commit()
    await db.refresh(project)
    return ProjectRead(id=project.id, name=project.name, task_type=project.task_type, ontology=project.ontology, version=project.version)


@router.get("/{project_id}/stats")
async def get_project_stats(project_id: UUID, db: AsyncSession = Depends(get_db)) -> dict:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    result = await db.execute(
        select(Image.status, func.count(Image.id))
        .where(Image.project_id == project_id)
        .group_by(Image.status)
    )
    counts = {row[0].value: row[1] for row in result.all()}
    total = sum(counts.values())
    anno_count = await db.execute(
        select(func.count(Annotation.id))
        .join(Image, Annotation.image_id == Image.id)
        .where(Image.project_id == project_id)
    )
    return {
        "total_images": total,
        "images_by_status": counts,
        "total_annotations": anno_count.scalar() or 0,
    }


@router.get("/{project_id}/images", response_model=ImageListResponse)
async def list_project_images(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
    after_created_at: datetime | None = None,
    after_id: UUID | None = None,
    status: ImageStatus | None = None,
    review_status: str | None = None,
    tag: str | None = None,
    tag_id: UUID | None = None,
    label_id: UUID | None = None,
    annotation_source: str | None = None,
) -> ImageListResponse:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    query = select(Image).options(selectinload(Image.tags)).where(Image.project_id == project_id)
    if after_created_at is not None:
        if after_id is None:
            raise HTTPException(status_code=400, detail="after_id required with after_created_at")
        query = query.where(
            or_(
                Image.created_at > after_created_at,
                and_(Image.created_at == after_created_at, Image.id > after_id),
            )
        )
    if status is not None:
        query = query.where(Image.status == status)
    if review_status is not None:
        query = query.where(Image.review_status == review_status)
    if tag_id is not None:
        query = query.join(image_tags).where(image_tags.c.tag_id == tag_id)
    elif tag:
        query = query.where(Image.meta.contains({"tags": [tag]}))

    # Filter by label (images with at least one annotation using this label)
    if label_id is not None:
        query = query.where(
            Image.id.in_(
                select(Annotation.image_id).where(Annotation.label_id == label_id)
            )
        )

    # Filter by annotation source
    if annotation_source:
        _has_ai = exists(
            select(Annotation.id).where(Annotation.image_id == Image.id, Annotation.is_prediction.is_(True))
        )
        _has_manual = exists(
            select(Annotation.id).where(Annotation.image_id == Image.id, Annotation.is_prediction.is_(False))
        )
        _has_any = exists(
            select(Annotation.id).where(Annotation.image_id == Image.id)
        )
        if annotation_source == "ai":
            query = query.where(_has_ai)
        elif annotation_source == "manual":
            query = query.where(_has_manual)
        elif annotation_source == "both":
            query = query.where(_has_ai).where(_has_manual)
        elif annotation_source == "none":
            query = query.where(~_has_any)

    query = query.order_by(Image.id).limit(limit + 1)

    result = await db.execute(query)
    images = result.scalars().all()
    has_more = len(images) > limit
    if has_more:
        images = images[:limit]

    # Build annotation summary per image
    image_ids = [img.id for img in images]
    ann_map: dict[UUID, list[LabelSummary]] = {}
    ann_counts: dict[UUID, tuple[int, int]] = {}  # (total, ai_count)
    if image_ids:
        ann_result = await db.execute(
            select(
                Annotation.image_id,
                Label.id.label("label_id"),
                Label.name.label("label_name"),
                Label.color.label("label_color"),
                func.count(Annotation.id).label("total"),
                func.sum(case((Annotation.is_prediction.is_(True), 1), else_=0)).label("ai_count"),
            )
            .join(Label, Annotation.label_id == Label.id)
            .where(Annotation.image_id.in_(image_ids))
            .group_by(Annotation.image_id, Label.id, Label.name, Label.color)
        )
        for row in ann_result.all():
            img_id = row.image_id
            ann_map.setdefault(img_id, []).append(
                LabelSummary(id=row.label_id, name=row.label_name, color=row.label_color, count=row.total, ai_count=row.ai_count)
            )
            prev = ann_counts.get(img_id, (0, 0))
            ann_counts[img_id] = (prev[0] + row.total, prev[1] + row.ai_count)

    items: list[ImageListItem] = []
    for image in images:
        url = create_presigned_get(image.storage_path)
        width = image.width or image.meta.get("width") if image.meta else None
        height = image.height or image.meta.get("height") if image.meta else None
        total, ai = ann_counts.get(image.id, (0, 0))
        items.append(
            ImageListItem(
                id=image.id,
                status=image.status,
                storage_path=image.storage_path,
                width=width,
                height=height,
                url=url,
                meta=image.meta,
                created_at=image.created_at,
                version=image.version,
                split=image.split.value if image.split else "UNASSIGNED",
                is_null=image.is_null if image.is_null is not None else False,
                review_status=image.review_status.value if image.review_status else "UNREVIEWED",
                reviewed_by=image.reviewed_by,
                review_comment=image.review_comment,
                tags=[TagOut(id=t.id, name=t.name, color=t.color, project_id=t.project_id) for t in image.tags],
                annotation_count=total,
                prediction_count=ai,
                labels=ann_map.get(image.id, []),
            )
        )
    next_after_created_at = images[-1].created_at if has_more and images else None
    next_after_id = images[-1].id if has_more and images else None
    return ImageListResponse(
        items=items,
        next_after_created_at=next_after_created_at,
        next_after_id=next_after_id,
    )


@router.get("/{project_id}/suggest")
async def suggest_images(
    project_id: UUID,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Active-learning: return images ranked by prediction uncertainty.

    Strategy:
    1. Images with NO predictions at all get top priority (need labeling most).
    2. Images with predictions are ranked by the lowest max-confidence across
       their predicted annotations (least certain first).
    """
    from sqlalchemy import case, literal_column, outerjoin, desc

    # Subquery: per-image max confidence among prediction annotations
    from sqlalchemy.sql import expression as expr

    pred_conf = (
        select(
            Annotation.image_id,
            func.max(Annotation.confidence).label("max_conf"),
        )
        .where(Annotation.is_prediction.is_(True))
        .group_by(Annotation.image_id)
        .subquery()
    )

    query = (
        select(
            Image.id,
            Image.storage_path,
            pred_conf.c.max_conf,
        )
        .outerjoin(pred_conf, Image.id == pred_conf.c.image_id)
        .where(Image.project_id == project_id)
        .where(Image.status != ImageStatus.DONE)
        .order_by(
            # NULLs first → images with no predictions
            pred_conf.c.max_conf.asc().nulls_first(),
        )
        .limit(limit)
    )
    result = await db.execute(query)
    rows = result.all()
    return [
        {
            "image_id": str(row.id),
            "storage_path": row.storage_path,
            "uncertainty": round(1.0 - (row.max_conf or 0.0), 4),
            "url": create_presigned_get(row.storage_path),
        }
        for row in rows
    ]


@router.get("/{project_id}/label-comparison")
async def label_comparison(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Compare AI predictions vs manual annotations per class and per image."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    # Per-class breakdown
    class_result = await db.execute(
        select(
            Label.id.label("label_id"),
            Label.name.label("label_name"),
            Label.color.label("label_color"),
            func.count(Annotation.id).label("total"),
            func.sum(case((Annotation.is_prediction.is_(True), 1), else_=0)).label("ai_count"),
            func.sum(case((Annotation.is_prediction.is_(False), 1), else_=0)).label("manual_count"),
            func.count(func.distinct(Annotation.image_id)).label("image_count"),
        )
        .join(Label, Annotation.label_id == Label.id)
        .join(Image, Annotation.image_id == Image.id)
        .where(Image.project_id == project_id)
        .group_by(Label.id, Label.name, Label.color)
        .order_by(Label.name)
    )
    per_class = [
        {
            "label_id": str(row.label_id),
            "label_name": row.label_name,
            "label_color": row.label_color,
            "total": row.total,
            "ai_count": row.ai_count,
            "manual_count": row.manual_count,
            "image_count": row.image_count,
        }
        for row in class_result.all()
    ]

    # Per-image summary: images that have BOTH AI and manual annotations
    _has_ai = (
        select(func.count(Annotation.id))
        .where(Annotation.image_id == Image.id, Annotation.is_prediction.is_(True))
        .correlate(Image)
        .scalar_subquery()
    )
    _has_manual = (
        select(func.count(Annotation.id))
        .where(Annotation.image_id == Image.id, Annotation.is_prediction.is_(False))
        .correlate(Image)
        .scalar_subquery()
    )

    img_result = await db.execute(
        select(
            Image.id,
            Image.filename,
            Image.storage_path,
            _has_ai.label("ai_count"),
            _has_manual.label("manual_count"),
        )
        .where(Image.project_id == project_id)
        .where(
            or_(
                _has_ai > 0,
                _has_manual > 0,
            )
        )
        .order_by(Image.id)
        .limit(200)
    )
    per_image = [
        {
            "image_id": str(row.id),
            "filename": row.filename or str(row.id)[:8],
            "url": create_presigned_get(row.storage_path),
            "ai_count": row.ai_count,
            "manual_count": row.manual_count,
        }
        for row in img_result.all()
    ]

    # Summary counters
    total_ai = sum(r["ai_count"] for r in per_class)
    total_manual = sum(r["manual_count"] for r in per_class)
    images_with_both = sum(1 for r in per_image if r["ai_count"] > 0 and r["manual_count"] > 0)
    images_ai_only = sum(1 for r in per_image if r["ai_count"] > 0 and r["manual_count"] == 0)
    images_manual_only = sum(1 for r in per_image if r["ai_count"] == 0 and r["manual_count"] > 0)

    total_images_result = await db.execute(
        select(func.count(Image.id)).where(Image.project_id == project_id)
    )
    total_images = total_images_result.scalar() or 0
    images_neither = total_images - images_with_both - images_ai_only - images_manual_only

    return {
        "per_class": per_class,
        "per_image": per_image,
        "summary": {
            "total_ai": total_ai,
            "total_manual": total_manual,
            "images_with_both": images_with_both,
            "images_ai_only": images_ai_only,
            "images_manual_only": images_manual_only,
            "images_neither": images_neither,
        },
    }
