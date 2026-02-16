from uuid import UUID, uuid4

from sqlalchemy import Boolean, Float, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    image_id: Mapped[UUID] = mapped_column(ForeignKey("images.id"), nullable=False)
    label_id: Mapped[UUID] = mapped_column(ForeignKey("labels.id"), nullable=False)
    geometry: Mapped[dict] = mapped_column(JSONB, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    is_prediction: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    image: Mapped["Image"] = relationship(back_populates="annotations")
    label: Mapped["Label"] = relationship(back_populates="annotations")

    __mapper_args__ = {"version_id_col": version}
