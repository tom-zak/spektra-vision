from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import VersionStatus


# ---------- Preprocessing option schemas ----------

class PreprocessingConfig(BaseModel):
    """Image preprocessing applied before training."""
    resize: int | None = Field(default=640, description="Resize images to NxN pixels")
    auto_orient: bool = Field(default=True, description="Auto-orient based on EXIF")
    grayscale: bool = Field(default=False, description="Convert to grayscale")
    contrast: str | None = Field(default=None, description="Contrast adjustment: 'adaptive' | 'histogram' | None")
    tile: int | None = Field(default=None, description="Tile images into NxN grid (e.g. 2 for 2x2)")


# ---------- Augmentation option schemas ----------

class AugmentationConfig(BaseModel):
    """Image augmentation options applied to training split."""
    flip_horizontal: bool = Field(default=True, description="Random horizontal flip")
    flip_vertical: bool = Field(default=False, description="Random vertical flip")
    rotate_degrees: int = Field(default=0, ge=0, le=45, description="Max rotation degrees")
    brightness_pct: float = Field(default=0.0, ge=0, le=0.5, description="Brightness adjustment ±%")
    blur_px: float = Field(default=0.0, ge=0, le=5.0, description="Gaussian blur max px")
    noise_pct: float = Field(default=0.0, ge=0, le=0.1, description="Noise injection %")
    cutout_pct: float = Field(default=0.0, ge=0, le=0.5, description="Random cutout %")
    mosaic: bool = Field(default=False, description="Mosaic augmentation")
    mixup: float = Field(default=0.0, ge=0, le=0.5, description="MixUp alpha")
    output_per_image: int = Field(default=1, ge=1, le=10, description="Augmented copies per training image")


# ---------- Dataset version schemas ----------

class DatasetVersionCreate(BaseModel):
    name: str | None = None
    train_pct: float = Field(default=0.7, ge=0.0, le=1.0)
    valid_pct: float = Field(default=0.2, ge=0.0, le=1.0)
    test_pct: float = Field(default=0.1, ge=0.0, le=1.0)
    preprocessing: PreprocessingConfig = Field(default_factory=PreprocessingConfig)
    augmentation: AugmentationConfig = Field(default_factory=AugmentationConfig)
    filter_tag_id: str | None = Field(default=None, description="Only include images with this tag")


class DatasetVersionRead(BaseModel):
    id: UUID
    project_id: UUID
    version_number: int
    name: str | None
    status: VersionStatus
    train_pct: float
    valid_pct: float
    test_pct: float
    preprocessing: dict[str, Any]
    augmentation: dict[str, Any]
    num_images: int
    num_train: int
    num_valid: int
    num_test: int
    num_annotations: int
    num_classes: int
    created_at: datetime | None


class DatasetVersionDetail(DatasetVersionRead):
    image_snapshot: list[dict[str, Any]]


# ---------- Split management ----------

class SplitAssignment(BaseModel):
    train_pct: float = Field(default=0.7, ge=0.0, le=1.0)
    valid_pct: float = Field(default=0.2, ge=0.0, le=1.0)
    test_pct: float = Field(default=0.1, ge=0.0, le=1.0)


class DatasetHealthResponse(BaseModel):
    total_images: int
    annotated_images: int
    unannotated_images: int
    null_images: int
    total_annotations: int
    annotations_per_image: float
    class_balance: dict[str, int]
    split_counts: dict[str, int]
    images_by_status: dict[str, int]
