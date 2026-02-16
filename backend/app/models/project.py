from uuid import UUID, uuid4

from sqlalchemy import Enum, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import TaskType


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    ontology: Mapped[dict] = mapped_column(JSONB, default=dict)
    task_type: Mapped[TaskType] = mapped_column(Enum(TaskType), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    images: Mapped[list["Image"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    labels: Mapped[list["Label"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    tags: Mapped[list["Tag"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    jobs: Mapped[list["Job"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    dataset_versions: Mapped[list["DatasetVersion"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    annotation_jobs: Mapped[list["AnnotationJob"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)

    __mapper_args__ = {"version_id_col": version}
