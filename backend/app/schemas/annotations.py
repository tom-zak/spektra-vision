from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AnnotationRead(BaseModel):
    id: UUID
    label_id: UUID
    geometry: dict[str, Any]
    confidence: float | None = None
    is_prediction: bool = False
    version: int = 1


class AnnotationOp(BaseModel):
    action: Literal["create", "update", "delete"]
    id: UUID | None = None
    label_id: UUID | None = None
    geometry: dict[str, Any] | None = None
    confidence: float | None = None
    is_prediction: bool | None = None
    version: int | None = None  # required for update/delete (optimistic lock)


class AnnotationBulkUpdate(BaseModel):
    ops: list[AnnotationOp] = Field(default_factory=list)


class AnnotationBulkResponse(BaseModel):
    annotations: list[AnnotationRead] = Field(default_factory=list)


class AnnotationHistoryRead(BaseModel):
    id: UUID
    annotation_id: UUID | None = None
    image_id: UUID
    label_id: UUID | None = None
    geometry: dict[str, Any] | None = None
    action: str
    version: int | None = None
    changed_by: UUID | None = None
    changed_at: str
    snapshot: dict[str, Any] | None = None
