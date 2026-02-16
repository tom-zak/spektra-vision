from uuid import UUID, uuid4

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import ImageSplit, ImageStatus, ReviewStatus


class Image(Base):
    __tablename__ = "images"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    filename: Mapped[str | None] = mapped_column(String(255))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    status: Mapped[ImageStatus] = mapped_column(
        Enum(ImageStatus), default=ImageStatus.NEW, nullable=False
    )
    split: Mapped[ImageSplit] = mapped_column(
        Enum(ImageSplit, name="image_split", create_constraint=False),
        default=ImageSplit.UNASSIGNED, nullable=False,
    )
    is_null: Mapped[bool] = mapped_column(default=False, nullable=False)
    review_status: Mapped[ReviewStatus] = mapped_column(
        Enum(ReviewStatus, name="review_status", create_constraint=False), default=ReviewStatus.UNREVIEWED, nullable=False
    )
    reviewed_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    review_comment: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="images")
    annotations: Mapped[list["Annotation"]] = relationship(back_populates="image", cascade="all, delete-orphan", passive_deletes=True)
    annotation_history: Mapped[list["AnnotationHistory"]] = relationship(back_populates="image", cascade="all, delete-orphan", passive_deletes=True)
    tags: Mapped[list["Tag"]] = relationship(secondary="image_tags", back_populates="images")

    __mapper_args__ = {"version_id_col": version}
