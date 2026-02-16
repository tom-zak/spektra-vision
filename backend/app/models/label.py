from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.types import UserDefinedType
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class LtreeType(UserDefinedType):
    """Custom SQLAlchemy type for PostgreSQL ltree columns."""

    cache_ok = True

    def get_col_spec(self) -> str:
        return "LTREE"

    def bind_processor(self, dialect):
        def process(value):
            return value
        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            return value
        return process


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(LtreeType, nullable=False)
    color: Mapped[str | None] = mapped_column(String(7))

    project: Mapped["Project"] = relationship(back_populates="labels")
    annotations: Mapped[list["Annotation"]] = relationship(back_populates="label", cascade="all, delete-orphan", passive_deletes=True)

    __table_args__ = (Index("ix_labels_path", "path", postgresql_using="gist"),)
