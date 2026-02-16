from uuid import UUID, uuid4

from sqlalchemy import Column, ForeignKey, String, Table, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# M2M association table
image_tags = Table(
    "image_tags",
    Base.metadata,
    Column("image_id", PG_UUID(as_uuid=True), ForeignKey("images.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", PG_UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7))

    project: Mapped["Project"] = relationship(back_populates="tags")
    images: Mapped[list["Image"]] = relationship(secondary=image_tags, back_populates="tags")

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_tag_project_name"),
    )
