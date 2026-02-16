"""Annotation insights — aggregated stats for the insights dashboard."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text, case, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_role
from app.models.annotation_history import AnnotationHistory
from app.models.image import Image
from app.models.enums import ReviewStatus
from app.models.user import User

router = APIRouter(prefix="/insights", tags=["insights"], dependencies=[Depends(require_role("ADMIN", "REVIEWER"))])


class DailyStat(BaseModel):
    date: str
    count: int


class UserStat(BaseModel):
    user_id: str
    email: str | None = None
    annotations_created: int = 0
    annotations_updated: int = 0
    annotations_deleted: int = 0
    total_actions: int = 0


class InsightsResponse(BaseModel):
    annotations_per_day: list[DailyStat] = Field(default_factory=list)
    images_completed_per_day: list[DailyStat] = Field(default_factory=list)
    user_stats: list[UserStat] = Field(default_factory=list)
    total_reviewed: int = 0
    total_approved: int = 0
    total_rejected: int = 0
    rejection_rate: float = 0.0


@router.get("/projects/{project_id}", response_model=InsightsResponse)
async def get_project_insights(
    project_id: UUID,
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
) -> InsightsResponse:
    """Return aggregated annotation insights for a project."""

    # Annotations created per day (last N days)
    ann_per_day_q = (
        select(
            func.to_char(AnnotationHistory.changed_at, "YYYY-MM-DD").label("day"),
            func.count().label("cnt"),
        )
        .join(Image, AnnotationHistory.image_id == Image.id)
        .where(
            Image.project_id == project_id,
            AnnotationHistory.action == "create",
            AnnotationHistory.changed_at >= func.now() - text(f"interval '{days} days'"),
        )
        .group_by(text("day"))
        .order_by(text("day"))
    )
    ann_result = await db.execute(ann_per_day_q)
    annotations_per_day = [DailyStat(date=row.day, count=row.cnt) for row in ann_result]

    # Images completed per day (status = DONE, grouped by created_at or updated implicitly)
    # Since we don't have a "completed_at" column, approximate from annotation_history
    # by counting distinct image_ids with a "create" action per day
    img_per_day_q = (
        select(
            func.to_char(AnnotationHistory.changed_at, "YYYY-MM-DD").label("day"),
            func.count(distinct(AnnotationHistory.image_id)).label("cnt"),
        )
        .join(Image, AnnotationHistory.image_id == Image.id)
        .where(
            Image.project_id == project_id,
            AnnotationHistory.changed_at >= func.now() - text(f"interval '{days} days'"),
        )
        .group_by(text("day"))
        .order_by(text("day"))
    )
    img_result = await db.execute(img_per_day_q)
    images_completed_per_day = [DailyStat(date=row.day, count=row.cnt) for row in img_result]

    # Per-user stats
    user_stats_q = (
        select(
            AnnotationHistory.changed_by,
            func.sum(case((AnnotationHistory.action == "create", 1), else_=0)).label("created"),
            func.sum(case((AnnotationHistory.action == "update", 1), else_=0)).label("updated"),
            func.sum(case((AnnotationHistory.action == "delete", 1), else_=0)).label("deleted"),
            func.count().label("total"),
        )
        .join(Image, AnnotationHistory.image_id == Image.id)
        .where(
            Image.project_id == project_id,
            AnnotationHistory.changed_by.isnot(None),
            AnnotationHistory.changed_at >= func.now() - text(f"interval '{days} days'"),
        )
        .group_by(AnnotationHistory.changed_by)
        .order_by(text("total DESC"))
    )
    user_result = await db.execute(user_stats_q)
    user_rows = user_result.all()

    # Resolve emails
    user_ids = [row.changed_by for row in user_rows if row.changed_by]
    email_map: dict[str, str] = {}
    if user_ids:
        users_result = await db.execute(select(User.id, User.email).where(User.id.in_(user_ids)))
        email_map = {str(u.id): u.email for u in users_result}

    user_stats = [
        UserStat(
            user_id=str(row.changed_by),
            email=email_map.get(str(row.changed_by)),
            annotations_created=row.created,
            annotations_updated=row.updated,
            annotations_deleted=row.deleted,
            total_actions=row.total,
        )
        for row in user_rows
    ]

    # Review / rejection rate
    review_q = (
        select(
            func.count().label("total"),
            func.sum(case((Image.review_status == ReviewStatus.APPROVED, 1), else_=0)).label("approved"),
            func.sum(case((Image.review_status == ReviewStatus.REJECTED, 1), else_=0)).label("rejected"),
        )
        .where(
            Image.project_id == project_id,
            Image.review_status != ReviewStatus.UNREVIEWED,
        )
    )
    review_result = await db.execute(review_q)
    review_row = review_result.one()
    total_reviewed = review_row.total or 0
    total_approved = review_row.approved or 0
    total_rejected = review_row.rejected or 0
    rejection_rate = round(total_rejected / total_reviewed, 4) if total_reviewed > 0 else 0.0

    return InsightsResponse(
        annotations_per_day=annotations_per_day,
        images_completed_per_day=images_completed_per_day,
        user_stats=user_stats,
        total_reviewed=total_reviewed,
        total_approved=total_approved,
        total_rejected=total_rejected,
        rejection_rate=rejection_rate,
    )
