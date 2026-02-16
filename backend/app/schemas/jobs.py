from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import JobStatus


# Predefined model architectures with display metadata
MODEL_ARCHITECTURES = {
    "yolo11n.pt": {"name": "YOLO11 Nano", "size": "nano", "params": "2.6M"},
    "yolo11s.pt": {"name": "YOLO11 Small", "size": "small", "params": "9.4M"},
    "yolo11m.pt": {"name": "YOLO11 Medium", "size": "medium", "params": "20.1M"},
    "yolo11l.pt": {"name": "YOLO11 Large", "size": "large", "params": "25.3M"},
    "yolo11x.pt": {"name": "YOLO11 XLarge", "size": "xlarge", "params": "56.9M"},
    "yolov8n.pt": {"name": "YOLOv8 Nano", "size": "nano", "params": "3.2M"},
    "yolov8s.pt": {"name": "YOLOv8 Small", "size": "small", "params": "11.2M"},
    "yolov8m.pt": {"name": "YOLOv8 Medium", "size": "medium", "params": "25.9M"},
}

CHECKPOINT_OPTIONS = {
    "coco": "Pre-trained on COCO (recommended for first model)",
    "previous": "Continue from previous training checkpoint",
    "scratch": "Random initialization (advanced)",
}


class JobCreate(BaseModel):
    project_id: UUID
    job_type: str = Field(default="train", pattern="^(train|predict)$")
    model_arch: str = "yolo11n.pt"
    hyperparams: dict[str, Any] = Field(default_factory=lambda: {"epochs": 20, "batch": 8, "imgsz": 640})
    model_path: str | None = None  # for predict jobs, the S3 key of trained model
    checkpoint: str | None = Field(default="coco", description="Checkpoint: 'coco' | 'previous' | 'scratch' | S3 key")
    dataset_version_id: UUID | None = None


class JobRead(BaseModel):
    id: UUID
    project_id: UUID
    job_type: str
    status: JobStatus
    logs_channel: str
    model_arch: str | None
    hyperparams: dict[str, Any]
    artifact_path: str | None
    created_at: datetime | None
    dataset_version_id: UUID | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    checkpoint: str | None = None
    celery_task_id: str | None = None


class JobLogStreamInfo(BaseModel):
    job_id: UUID
    logs_channel: str


class ModelArchInfo(BaseModel):
    key: str
    name: str
    size: str
    params: str


class GpuEstimateResponse(BaseModel):
    """GPU VRAM estimation breakdown."""
    model_params_mb: float
    optimizer_mb: float
    activation_mb: float
    cuda_overhead_mb: float
    total_mb: float
    total_gb: float
    fits_gpus: list[str]
    tight_gpus: list[str]
    too_small_gpus: list[str]
    suggested_max_batch_16gb: int


class JobProgress(BaseModel):
    """Structured training progress snapshot."""
    epoch: int = 0
    total_epochs: int = 0
    batch: int = 0
    total_batches: int = 0
    pct: float = 0.0
    elapsed_secs: float = 0.0
    eta_secs: float = 0.0
    phase: str = "pending"  # pending | preparing | training | completed
