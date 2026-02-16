"""AnnotationJob — assignment of images to annotators for labeling."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.enums import AnnotationJobStatus


class AnnotationJob(Base):
    __tablename__ = "annotation_jobs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    assigned_to: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    batch_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[AnnotationJobStatus] = mapped_column(
        Enum(AnnotationJobStatus, name="annotation_job_status", create_constraint=False),
        nullable=False,
        default=AnnotationJobStatus.PENDING,
    )
    # {image_id_str: "pending"|"in_progress"|"done"|"review"}
    image_ids: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)

    project: Mapped["Project"] = relationship(back_populates="annotation_jobs")
    assignee: Mapped["User | None"] = relationship(foreign_keys=[assigned_to])
