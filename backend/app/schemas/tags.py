from uuid import UUID

from pydantic import BaseModel, Field


class TagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class TagUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class TagOut(BaseModel):
    id: UUID
    name: str
    color: str | None
    project_id: UUID


class ImageTagsUpdate(BaseModel):
    """Set operation — replace all tags on an image."""
    tag_ids: list[UUID]


class BulkTagsUpdate(BaseModel):
    """Additive/subtractive for multi-image ops."""
    image_ids: list[UUID] = Field(..., min_length=1)
    add_tag_ids: list[UUID] = Field(default_factory=list)
    remove_tag_ids: list[UUID] = Field(default_factory=list)
