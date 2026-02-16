"""GPU VRAM estimation for YOLO training jobs.

Provides conservative peak-VRAM estimates given model architecture,
batch size, and image size.  Numbers are calibrated against measured
Ultralytics YOLO11/v8 runs on A100 / RTX 3090 / T4 GPUs.

The estimation model accounts for:
  - Model parameters (weights + gradients + optimizer states)
  - Activation memory (batch × image-size dependent)
  - CUDA context overhead (~300-500 MB)
  - Safety margin (15%)
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# YOLO model profiles (measured / derived from Ultralytics model zoo)
# ---------------------------------------------------------------------------
# params_m:   number of params in millions
# base_act_mb: measured activation memory at batch=1, imgsz=640 (in MB)
#              This is used as the anchor for scaling.

_YOLO_PROFILES: dict[str, dict] = {
    # YOLO11 family
    "yolo11n.pt": {"params_m": 2.6,  "base_act_mb": 180,  "gflops": 6.5},
    "yolo11s.pt": {"params_m": 9.4,  "base_act_mb": 340,  "gflops": 21.5},
    "yolo11m.pt": {"params_m": 20.1, "base_act_mb": 580,  "gflops": 68.0},
    "yolo11l.pt": {"params_m": 25.3, "base_act_mb": 700,  "gflops": 87.0},
    "yolo11x.pt": {"params_m": 56.9, "base_act_mb": 1200, "gflops": 195.0},
    # YOLOv8 family
    "yolov8n.pt": {"params_m": 3.2,  "base_act_mb": 200,  "gflops": 8.7},
    "yolov8s.pt": {"params_m": 11.2, "base_act_mb": 380,  "gflops": 28.6},
    "yolov8m.pt": {"params_m": 25.9, "base_act_mb": 620,  "gflops": 79.0},
}

# Bytes per parameter during training:
#   fp32 weights (4) + fp32 gradients (4) + Adam m & v (8) = 16 bytes/param
_BYTES_PER_PARAM_TRAIN = 16

# Mixed-precision (AMP): fp16 weights copy (2) + fp32 master copy (4) +
# fp32 gradients (4) + Adam states (8) = 18 bytes/param
_BYTES_PER_PARAM_AMP = 18

# CUDA context + library overhead in MB
_CUDA_OVERHEAD_MB = 400

# Safety margin multiplier
_SAFETY_MULTIPLIER = 1.15

# Reference batch/imgsz used as the measurement anchor
_REF_BATCH = 1
_REF_IMGSZ = 640


# ---------------------------------------------------------------------------
# Common GPU specs for recommendation
# ---------------------------------------------------------------------------

GPU_SPECS: list[dict] = [
    {"name": "T4",           "vram_gb": 16},
    {"name": "RTX 3060",     "vram_gb": 12},
    {"name": "RTX 3080",     "vram_gb": 10},
    {"name": "RTX 3090",     "vram_gb": 24},
    {"name": "RTX 4090",     "vram_gb": 24},
    {"name": "A10G",         "vram_gb": 24},
    {"name": "L4",           "vram_gb": 24},
    {"name": "A100 40GB",    "vram_gb": 40},
    {"name": "A100 80GB",    "vram_gb": 80},
    {"name": "H100 80GB",    "vram_gb": 80},
]


@dataclass
class GpuEstimate:
    """Result of a GPU memory estimation."""

    model_params_mb: float
    optimizer_mb: float
    activation_mb: float
    cuda_overhead_mb: float
    total_mb: float
    total_gb: float
    fits_gpus: list[str]
    tight_gpus: list[str]  # fits but <20% headroom
    too_small_gpus: list[str]

    def to_dict(self) -> dict:
        return {
            "model_params_mb": round(self.model_params_mb, 1),
            "optimizer_mb": round(self.optimizer_mb, 1),
            "activation_mb": round(self.activation_mb, 1),
            "cuda_overhead_mb": round(self.cuda_overhead_mb, 1),
            "total_mb": round(self.total_mb, 1),
            "total_gb": round(self.total_gb, 2),
            "fits_gpus": self.fits_gpus,
            "tight_gpus": self.tight_gpus,
            "too_small_gpus": self.too_small_gpus,
        }


def estimate_vram(
    model_arch: str = "yolo11n.pt",
    batch: int = 8,
    imgsz: int = 640,
    amp: bool = True,
) -> GpuEstimate:
    """Estimate peak GPU VRAM for a YOLO training run.

    Args:
        model_arch: Key from MODEL_ARCHITECTURES (e.g. "yolo11n.pt").
        batch:      Batch size (default 8).
        imgsz:      Input image size in pixels (default 640).
        amp:        Whether automatic mixed precision is used (default True,
                    matching Ultralytics defaults).

    Returns:
        GpuEstimate with a breakdown of memory components.
    """
    profile = _YOLO_PROFILES.get(model_arch)
    if profile is None:
        # Fallback: assume medium-ish model
        profile = {"params_m": 20.0, "base_act_mb": 500, "gflops": 60.0}

    params = profile["params_m"] * 1e6
    bpp = _BYTES_PER_PARAM_AMP if amp else _BYTES_PER_PARAM_TRAIN

    # -- Model parameters + optimizer states --
    param_bytes = params * bpp
    # Split for display: raw weights vs optimizer overhead
    weight_bytes = params * (2 if amp else 4)         # fp16 or fp32 weights
    grad_bytes = params * 4                            # always fp32
    optimizer_bytes = params * 8                       # Adam m + v
    master_bytes = params * 4 if amp else 0            # fp32 master copy

    model_params_mb = (weight_bytes + master_bytes) / (1024 ** 2)
    optimizer_mb = (grad_bytes + optimizer_bytes) / (1024 ** 2)

    # -- Activation memory --
    # Scales linearly with batch and quadratically with image size
    base_act = profile["base_act_mb"]
    img_scale = (imgsz / _REF_IMGSZ) ** 2
    batch_scale = batch / _REF_BATCH
    activation_mb = base_act * img_scale * batch_scale

    # -- Total --
    raw_total = model_params_mb + optimizer_mb + activation_mb + _CUDA_OVERHEAD_MB
    total_mb = raw_total * _SAFETY_MULTIPLIER

    # -- GPU fit check --
    fits: list[str] = []
    tight: list[str] = []
    too_small: list[str] = []

    for gpu in GPU_SPECS:
        vram = gpu["vram_gb"] * 1024  # in MB
        if total_mb <= vram * 0.80:
            fits.append(gpu["name"])
        elif total_mb <= vram:
            tight.append(gpu["name"])
        else:
            too_small.append(gpu["name"])

    return GpuEstimate(
        model_params_mb=model_params_mb,
        optimizer_mb=optimizer_mb,
        activation_mb=activation_mb,
        cuda_overhead_mb=_CUDA_OVERHEAD_MB,
        total_mb=total_mb,
        total_gb=total_mb / 1024,
        fits_gpus=fits,
        tight_gpus=tight,
        too_small_gpus=too_small,
    )


def suggest_max_batch(
    model_arch: str = "yolo11n.pt",
    imgsz: int = 640,
    vram_gb: float = 16.0,
    amp: bool = True,
) -> int:
    """Binary-search for the max batch size that fits in `vram_gb`."""
    lo, hi, best = 1, 256, 1
    while lo <= hi:
        mid = (lo + hi) // 2
        est = estimate_vram(model_arch, batch=mid, imgsz=imgsz, amp=amp)
        if est.total_gb <= vram_gb * 0.85:  # 85% utilisation target
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    # Round down to nearest power of 2 for practical use
    return 2 ** int(math.log2(best)) if best > 1 else 1
