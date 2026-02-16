from uuid import UUID

from pydantic import BaseModel, Field


class LabelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    path: str = Field(min_length=1)
    color: str | None = None


class LabelUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class LabelRead(BaseModel):
    id: UUID
    name: str
    path: str
    color: str | None
