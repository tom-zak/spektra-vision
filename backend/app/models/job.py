from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.enums import JobStatus


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    job_type: Mapped[str] = mapped_column(String(50), nullable=False, default="train")
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), nullable=False, default=JobStatus.PENDING)
    logs_channel: Mapped[str] = mapped_column(String(255), nullable=False)
    model_arch: Mapped[str | None] = mapped_column(String(255))
    hyperparams: Mapped[dict] = mapped_column(JSONB, default=dict)
    artifact_path: Mapped[str | None] = mapped_column(String(1024))
    created_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Dataset version this job trained on (optional)
    dataset_version_id: Mapped[UUID | None] = mapped_column(ForeignKey("dataset_versions.id"), nullable=True)
    # Training metrics (mAP, precision, recall, loss, etc.)
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Checkpoint: "scratch" | "coco" | path to previous model weights
    checkpoint: Mapped[str | None] = mapped_column(String(1024))
    # Celery task ID for revocation
    celery_task_id: Mapped[str | None] = mapped_column(String(255))
    # Persisted log lines for historical viewing
    logs: Mapped[list] = mapped_column(JSONB, default=list)

    project: Mapped["Project"] = relationship(back_populates="jobs")
