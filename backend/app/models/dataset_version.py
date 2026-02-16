from uuid import UUID, uuid4

from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.enums import VersionStatus


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[VersionStatus] = mapped_column(
        Enum(VersionStatus), default=VersionStatus.GENERATING, nullable=False
    )

    # Split configuration: ratios should sum to 1.0
    train_pct: Mapped[float] = mapped_column(Float, default=0.7, nullable=False)
    valid_pct: Mapped[float] = mapped_column(Float, default=0.2, nullable=False)
    test_pct: Mapped[float] = mapped_column(Float, default=0.1, nullable=False)

    # Preprocessing config (resize, auto-orient, grayscale, contrast, tile)
    preprocessing: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Augmentation config (flip, rotate, brightness, blur, noise, cutout, mosaic, etc.)
    augmentation: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Snapshot counts
    num_images: Mapped[int] = mapped_column(Integer, default=0)
    num_train: Mapped[int] = mapped_column(Integer, default=0)
    num_valid: Mapped[int] = mapped_column(Integer, default=0)
    num_test: Mapped[int] = mapped_column(Integer, default=0)
    num_annotations: Mapped[int] = mapped_column(Integer, default=0)
    num_classes: Mapped[int] = mapped_column(Integer, default=0)

    # Frozen image IDs snapshot (JSON array of {image_id, split})
    image_snapshot: Mapped[dict] = mapped_column(JSONB, default=list)

    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    project: Mapped["Project"] = relationship(back_populates="dataset_versions")
