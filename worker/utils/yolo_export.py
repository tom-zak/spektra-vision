import os
import tempfile
from pathlib import Path
from typing import Any

import yaml
from PIL import Image, ImageOps

from worker.utils.storage import get_s3_client
from worker.utils.settings import get_settings


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _download_object(key: str, dest: Path) -> None:
    settings = get_settings()
    s3 = get_s3_client()
    dest.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(settings.minio_bucket, key, str(dest))


def _bbox_from_geometry(geometry: dict[str, Any]) -> tuple[float, float, float, float] | None:
    # Support both short ("w","h") and long ("width","height") key names
    if all(k in geometry for k in ("x", "y")):
        w = geometry.get("w") or geometry.get("width")
        h = geometry.get("h") or geometry.get("height")
        if w is not None and h is not None:
            return float(geometry["x"]), float(geometry["y"]), float(w), float(h)
    points = geometry.get("points")
    if not points:
        return None
    xs = points[0::2]
    ys = points[1::2]
    if not xs or not ys:
        return None
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    return float(x_min), float(y_min), float(x_max - x_min), float(y_max - y_min)


def _yolo_line(class_index: int, bbox: tuple[float, float, float, float], width: int, height: int) -> str:
    x, y, w, h = bbox
    cx = (x + w / 2) / width
    cy = (y + h / 2) / height
    nw = w / width
    nh = h / height
    return f"{class_index} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}"


# ---- Preprocessing helpers ----

def _apply_preprocessing(img: Image.Image, config: dict) -> tuple[Image.Image, dict]:
    """Apply preprocessing steps to a PIL image.

    Returns (transformed_image, transform_info) where transform_info contains:
        scale_x, scale_y: coordinate scale factors
        offset_x, offset_y: pixel offset from padding (fit mode)
    """
    transform = {"scale_x": 1.0, "scale_y": 1.0, "offset_x": 0, "offset_y": 0}

    if config.get("auto_orient", True):
        img = ImageOps.exif_transpose(img)

    if config.get("grayscale", False):
        img = img.convert("L").convert("RGB")

    resize = config.get("resize")
    if resize:
        target_size = int(resize)
        orig_w, orig_h = img.size
        resize_mode = config.get("resize_mode", "stretch")
        if resize_mode == "fit":
            # Uniform scale to fit within target, then pad
            scale = min(target_size / orig_w, target_size / orig_h)
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            img_resized = img.resize((new_w, new_h), Image.LANCZOS)
            pad_x = (target_size - new_w) // 2
            pad_y = (target_size - new_h) // 2
            canvas = Image.new("RGB", (target_size, target_size), (114, 114, 114))
            canvas.paste(img_resized, (pad_x, pad_y))
            img = canvas
            transform["scale_x"] = scale
            transform["scale_y"] = scale
            transform["offset_x"] = pad_x
            transform["offset_y"] = pad_y
        else:
            img = img.resize((target_size, target_size), Image.LANCZOS)
            transform["scale_x"] = target_size / orig_w if orig_w else 1.0
            transform["scale_y"] = target_size / orig_h if orig_h else 1.0

    contrast = config.get("contrast")
    if contrast == "CLAHE":
        try:
            import numpy as np
            import cv2
            arr = np.array(img)
            lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            lab[:, :, 0] = clahe.apply(lab[:, :, 0])
            arr = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
            img = Image.fromarray(arr)
        except ImportError:
            pass  # cv2 not available, skip CLAHE

    return img, transform


# ---- Augmentation helpers ----

def _build_augmentation_pipeline(config: dict):
    """Build an albumentations Compose pipeline from augmentation config. Returns None if no augmentations."""
    try:
        import albumentations as A
    except ImportError:
        return None

    transforms: list = []

    if config.get("flip_horizontal", False):
        transforms.append(A.HorizontalFlip(p=0.5))
    if config.get("flip_vertical", False):
        transforms.append(A.VerticalFlip(p=0.5))

    rotate_deg = config.get("rotate_degrees", 0)
    if rotate_deg:
        transforms.append(A.Rotate(limit=int(rotate_deg), p=0.5, border_mode=0))

    brightness_pct = config.get("brightness_pct", 0)
    if brightness_pct:
        limit = float(brightness_pct) / 100.0
        transforms.append(A.RandomBrightnessContrast(brightness_limit=limit, contrast_limit=0, p=0.5))

    blur_px = config.get("blur_px", 0)
    if blur_px:
        transforms.append(A.Blur(blur_limit=int(blur_px), p=0.5))

    noise_pct = config.get("noise_pct", 0)
    if noise_pct:
        var_limit = float(noise_pct) * 100.0
        transforms.append(A.GaussNoise(var_limit=(0, var_limit), p=0.5))

    cutout_pct = config.get("cutout_pct", 0)
    if cutout_pct:
        num_holes = max(1, int(cutout_pct * 10))
        transforms.append(A.CoarseDropout(max_holes=num_holes, max_height=32, max_width=32, p=0.5))

    if not transforms:
        return None

    return A.Compose(
        transforms,
        bbox_params=A.BboxParams(format="yolo", label_fields=["class_labels"], min_visibility=0.3),
    )


def export_dataset(
    labels: list[dict[str, Any]],
    images: list[dict[str, Any]],
    annotations: dict[str, list[dict[str, Any]]],
    *,
    split_map: dict[str, str] | None = None,
    preprocessing: dict | None = None,
    augmentation: dict | None = None,
) -> Path:
    """Export images + annotations to YOLO format.

    Args:
        labels: label rows from DB
        images: image rows from DB
        annotations: dict mapping image_id -> list of annotation rows
        split_map: optional dict mapping image_id -> split string (from dataset version snapshot)
        preprocessing: optional preprocessing config dict
        augmentation: optional augmentation config dict
    """
    tmpdir = Path(tempfile.mkdtemp(prefix="spektra_yolo_"))
    train_images_dir = tmpdir / "images" / "train"
    val_images_dir = tmpdir / "images" / "val"
    train_labels_dir = tmpdir / "labels" / "train"
    val_labels_dir = tmpdir / "labels" / "val"
    _ensure_dir(train_images_dir)
    _ensure_dir(val_images_dir)
    _ensure_dir(train_labels_dir)
    _ensure_dir(val_labels_dir)

    label_ids = [label["id"] for label in labels]
    label_map = {label_id: idx for idx, label_id in enumerate(label_ids)}

    preprocess_cfg = preprocessing or {}
    augment_cfg = augmentation or {}
    aug_pipeline = _build_augmentation_pipeline(augment_cfg) if augment_cfg else None
    output_per_image = int(augment_cfg.get("output_per_image", 1))

    for image in images:
        key = image["storage_path"]
        filename = image.get("filename") or f"{image['id']}.jpg"
        image_id_str = str(image["id"])

        # Determine split from split_map (version snapshot) or fallback to meta
        if split_map and image_id_str in split_map:
            raw_split = split_map[image_id_str].lower()
        else:
            raw_split = (image.get("meta", {}).get("split") or "train").lower()
        use_val = raw_split in {"valid", "val", "validation"}
        is_train = not use_val

        # Download image
        tmp_download = tmpdir / "downloads" / filename
        _download_object(key, tmp_download)

        # Open with Pillow for preprocessing
        try:
            pil_img = Image.open(tmp_download).convert("RGB")
        except Exception:
            continue

        # Apply preprocessing
        if preprocess_cfg:
            pil_img, transform = _apply_preprocessing(pil_img, preprocess_cfg)
            new_w, new_h = pil_img.size
            scale_x = transform["scale_x"]
            scale_y = transform["scale_y"]
            offset_x = transform["offset_x"]
            offset_y = transform["offset_y"]
        else:
            new_w, new_h = pil_img.size
            scale_x, scale_y = 1.0, 1.0
            offset_x, offset_y = 0, 0

        width = image.get("width") or image.get("meta", {}).get("width") or new_w
        height = image.get("height") or image.get("meta", {}).get("height") or new_h

        # Build YOLO label lines (before augmentation, in pixel coords)
        yolo_bboxes: list[tuple[float, float, float, float]] = []
        yolo_classes: list[int] = []
        for annotation in annotations.get(image_id_str, []):
            label_id = annotation.get("label_id")
            if label_id not in label_map:
                continue
            bbox = _bbox_from_geometry(annotation.get("geometry", {}))
            if bbox is None:
                continue
            # Scale bbox if preprocessed (handle offset for fit/pad mode)
            x, y, w, h = bbox
            x = x * scale_x + offset_x
            y = y * scale_y + offset_y
            w *= scale_x
            h *= scale_y
            # Convert to YOLO normalized format
            cx = (x + w / 2) / new_w
            cy = (y + h / 2) / new_h
            nw = w / new_w
            nh = h / new_h
            yolo_bboxes.append((cx, cy, nw, nh))
            yolo_classes.append(label_map[label_id])

        # Determine how many copies to produce (copy 0 = clean original, 1..N-1 = augmented)
        copies = output_per_image if (is_train and aug_pipeline and output_per_image > 1) else 1

        import numpy as np
        img_array = np.array(pil_img)

        for copy_idx in range(copies):
            suffix = f"_aug{copy_idx}" if copy_idx > 0 else ""
            out_filename = f"{Path(filename).stem}{suffix}.jpg"

            if is_train and aug_pipeline and copy_idx > 0:
                # Apply augmentation (copy 0 is always the clean original)
                try:
                    augmented = aug_pipeline(
                        image=img_array,
                        bboxes=yolo_bboxes,
                        class_labels=yolo_classes,
                    )
                    aug_img = Image.fromarray(augmented["image"])
                    aug_bboxes = augmented["bboxes"]
                    aug_classes = augmented["class_labels"]
                except Exception:
                    aug_img = pil_img
                    aug_bboxes = yolo_bboxes
                    aug_classes = yolo_classes
            else:
                aug_img = pil_img
                aug_bboxes = yolo_bboxes
                aug_classes = yolo_classes

            dest_img = (val_images_dir if use_val else train_images_dir) / out_filename
            aug_img.save(dest_img, "JPEG", quality=95)

            label_lines = [
                f"{cls} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}"
                for (cx, cy, nw, nh), cls in zip(aug_bboxes, aug_classes)
            ]
            label_dest = (val_labels_dir if use_val else train_labels_dir) / f"{Path(out_filename).stem}.txt"
            label_dest.write_text("\n".join(label_lines), encoding="utf-8")

    data = {
        "path": str(tmpdir),
        "train": "images/train",
        "val": "images/val",
        "names": [label.get("name", f"class_{idx}") for idx, label in enumerate(labels)],
    }
    (tmpdir / "data.yaml").write_text(yaml.safe_dump(data), encoding="utf-8")
    return tmpdir
