from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import ImageSplit, ImageStatus
from app.schemas.tags import TagOut


class LabelSummary(BaseModel):
    id: UUID
    name: str
    color: str | None = None
    count: int = 0
    ai_count: int = 0


class PresignedPost(BaseModel):
    image_id: UUID
    storage_path: str
    url: str
    fields: dict[str, str]


class PresignedGet(BaseModel):
    url: str
    expires_in: int = Field(default=900, ge=1)


class ImageUploadRequest(BaseModel):
    project_id: UUID


class ImageUploadResult(BaseModel):
    image_id: UUID
    storage_path: str
    meta: dict[str, Any]


class ImageUploadResponse(BaseModel):
    uploaded: list[ImageUploadResult] = Field(default_factory=list)
    presigned: list[PresignedPost] = Field(default_factory=list)


class ImageListItem(BaseModel):
    id: UUID
    status: ImageStatus
    storage_path: str
    width: int | None
    height: int | None
    url: str
    meta: dict[str, Any]
    created_at: datetime | None = None
    version: int = 1
    split: str = "UNASSIGNED"
    is_null: bool = False
    review_status: str = "UNREVIEWED"
    reviewed_by: UUID | None = None
    review_comment: str | None = None
    tags: list[TagOut] = Field(default_factory=list)
    annotation_count: int = 0
    prediction_count: int = 0
    labels: list[LabelSummary] = Field(default_factory=list)


class ImageListResponse(BaseModel):
    items: list[ImageListItem] = Field(default_factory=list)
    next_after_created_at: datetime | None = None
    next_after_id: UUID | None = None


class ImageUploadCompleteRequest(BaseModel):
    filename: str | None = None


class ImageUploadCompleteResponse(BaseModel):
    image_id: UUID
    storage_path: str
    meta: dict[str, Any]
    width: int | None = None
    height: int | None = None


class ImageStatusUpdate(BaseModel):
    status: ImageStatus


class ImageReviewRequest(BaseModel):
    review_status: str  # APPROVED | REJECTED | NEEDS_REVISION
    comment: str | None = None


class ImageReviewResponse(BaseModel):
    image_id: UUID
    review_status: str
    reviewed_by: UUID | None = None
    review_comment: str | None = None


class ImageNullUpdate(BaseModel):
    is_null: bool


class ImageSplitUpdate(BaseModel):
    split: ImageSplit
