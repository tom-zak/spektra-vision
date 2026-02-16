from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import TaskType


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    task_type: TaskType
    ontology: dict[str, Any] = Field(default_factory=dict)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    task_type: TaskType | None = None
    ontology: dict[str, Any] | None = None


class ProjectRead(BaseModel):
    id: UUID
    name: str
    task_type: TaskType
    ontology: dict[str, Any]
    version: int = 1
