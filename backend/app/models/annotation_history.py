from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class AnnotationHistory(Base):
    __tablename__ = "annotation_history"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    annotation_id: Mapped[UUID | None] = mapped_column(ForeignKey("annotations.id", ondelete="SET NULL"), nullable=True)
    image_id: Mapped[UUID] = mapped_column(ForeignKey("images.id"), nullable=False, index=True)
    label_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    geometry: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)  # "create", "update", "delete"
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    changed_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    image: Mapped["Image"] = relationship(back_populates="annotation_history")
