"""Pydantic schemas for annotation jobs (image assignment/batching)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AnnotationJobCreate(BaseModel):
    project_id: UUID
    assigned_to: UUID | None = None
    batch_name: str | None = None
    instructions: str | None = None
    image_ids: list[UUID] | None = None
    image_count: int | None = Field(None, ge=1, description="Randomly assign this many images instead of selecting specific ones")


class AnnotationJobRead(BaseModel):
    id: UUID
    project_id: UUID
    assigned_to: UUID | None
    assignee_email: str | None = None
    batch_name: str | None
    instructions: str | None
    status: str
    image_ids: dict[str, str]  # {image_id: status}
    total_images: int
    completed_images: int
    created_at: datetime | None
    created_by: UUID | None


class AnnotationJobUpdate(BaseModel):
    status: str | None = None
    assigned_to: UUID | None = None
    batch_name: str | None = None
    instructions: str | None = None


class AnnotationJobImageUpdate(BaseModel):
    status: Literal["pending", "in_progress", "done", "review"]
