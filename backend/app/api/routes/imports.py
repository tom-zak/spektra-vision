"""Import routes for YOLO v4 PyTorch format datasets."""
import io
import zipfile
from pathlib import PurePosixPath
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image as PILImage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_role
from app.core.config import get_settings
from app.models.annotation import Annotation
from app.models.enums import ImageSplit, ImageStatus
from app.models.image import Image
from app.models.label import Label
from app.models.project import Project
from app.services.storage import ensure_bucket, get_s3_client

router = APIRouter(prefix="/projects", tags=["import"], dependencies=[Depends(get_current_user)])

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLIT_MAP = {"train": ImageSplit.TRAIN, "valid": ImageSplit.VALID, "test": ImageSplit.TEST}

DEFAULT_COLORS = [
    "#38bdf8", "#f87171", "#4ade80", "#facc15",
    "#c084fc", "#fb923c", "#2dd4bf", "#f472b6",
    "#818cf8", "#a3e635", "#fbbf24", "#e879f9",
]


def _parse_classes(text: str) -> list[str]:
    """Parse _classes.txt – one class name per line, 0-indexed."""
    return [line.strip() for line in text.splitlines() if line.strip()]


def _parse_annotations(text: str) -> dict[str, list[tuple[int, int, int, int, int]]]:
    """Parse _annotations.txt – ``filename x1,y1,x2,y2,cls [...]`` per line.

    Returns mapping filename → list of (x1, y1, x2, y2, class_index).
    """
    mapping: dict[str, list[tuple[int, int, int, int, int]]] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        filename = parts[0]
        boxes: list[tuple[int, int, int, int, int]] = []
        for part in parts[1:]:
            nums = part.split(",")
            if len(nums) != 5:
                continue
            x1, y1, x2, y2, cls = int(nums[0]), int(nums[1]), int(nums[2]), int(nums[3]), int(nums[4])
            boxes.append((x1, y1, x2, y2, cls))
        mapping[filename] = boxes
    return mapping


async def _ensure_labels(
    db: AsyncSession, project_id: UUID, class_names: list[str],
) -> dict[int, UUID]:
    """Create labels that don't exist yet. Returns class_index → label_id map."""
    result = await db.execute(select(Label).where(Label.project_id == project_id))
    existing_labels = result.scalars().all()
    existing = {label.name: label.id for label in existing_labels}
    used_colors = len(existing_labels)

    index_to_id: dict[int, UUID] = {}
    for idx, name in enumerate(class_names):
        if name in existing:
            index_to_id[idx] = existing[name]
        else:
            color = DEFAULT_COLORS[used_colors % len(DEFAULT_COLORS)]
            used_colors += 1
            label = Label(
                project_id=project_id,
                name=name,
                path=name.replace(" ", "_"),
                color=color,
            )
            db.add(label)
            await db.flush()
            index_to_id[idx] = label.id
            existing[name] = label.id
    await db.flush()
    return index_to_id


@router.post(
    "/{project_id}/import/yolov4-pytorch",
    dependencies=[Depends(require_role("ADMIN"))],
)
async def import_yolov4_pytorch(
    project_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Import a YOLO v4 PyTorch dataset from a ZIP archive.

    Expected ZIP layout::

        <root>/
            train/
                _classes.txt
                _annotations.txt
                image1.jpg
                ...
            valid/
                _classes.txt
                _annotations.txt
                ...
            test/
                ...

    The _classes.txt contains one class name per line (0-indexed).
    The _annotations.txt has lines like:
        filename x1,y1,x2,y2,class_id [x1,y1,x2,y2,class_id ...]
    """
    # Validate project
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    # Read ZIP
    content = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")

    # Index ZIP entries by split
    splits_data: dict[str, dict] = {}  # split_name → {classes_txt, annotations_txt, images: {name: bytes}}

    for entry in zf.namelist():
        if entry.endswith("/"):
            continue
        pp = PurePosixPath(entry)
        parts = pp.parts

        # Find the split folder (train/valid/test) – may be nested under a root dir
        split_name = None
        relative_name = None
        for i, part in enumerate(parts):
            if part.lower() in SPLIT_MAP:
                split_name = part.lower()
                relative_name = str(PurePosixPath(*parts[i + 1:])) if i + 1 < len(parts) else None
                break

        if split_name is None or relative_name is None:
            continue

        if split_name not in splits_data:
            splits_data[split_name] = {"classes_txt": None, "annotations_txt": None, "images": {}}

        if relative_name == "_classes.txt":
            splits_data[split_name]["classes_txt"] = zf.read(entry).decode("utf-8")
        elif relative_name == "_annotations.txt":
            splits_data[split_name]["annotations_txt"] = zf.read(entry).decode("utf-8")
        elif PurePosixPath(relative_name).suffix.lower() in IMAGE_EXTENSIONS:
            splits_data[split_name]["images"][relative_name] = entry  # store zip path

    if not splits_data:
        raise HTTPException(status_code=400, detail="No train/valid/test splits found in ZIP")

    # Gather a unified classes list (prefer train)
    classes_text = None
    for preferred in ["train", "valid", "test"]:
        if preferred in splits_data and splits_data[preferred]["classes_txt"]:
            classes_text = splits_data[preferred]["classes_txt"]
            break

    if classes_text is None:
        raise HTTPException(status_code=400, detail="No _classes.txt found in any split folder")

    class_names = _parse_classes(classes_text)
    index_to_label_id = await _ensure_labels(db, project_id, class_names)

    # Upload images and create annotations
    settings = get_settings()
    ensure_bucket()
    s3 = get_s3_client()
    total_images = 0
    total_annotations = 0

    for split_name, sdata in splits_data.items():
        split_enum = SPLIT_MAP[split_name]
        annotations_map = _parse_annotations(sdata["annotations_txt"] or "")

        for image_name, zip_path in sdata["images"].items():
            image_bytes = zf.read(zip_path)
            key = f"{project_id}/{uuid4()}-{PurePosixPath(image_name).name}"

            # Upload to S3
            s3.put_object(Bucket=settings.minio_bucket, Key=key, Body=image_bytes)

            # Get dimensions
            try:
                with PILImage.open(io.BytesIO(image_bytes)) as img:
                    width, height = img.size
            except Exception:
                width, height = None, None

            # Create Image record
            image = Image(
                project_id=project_id,
                storage_path=key,
                filename=PurePosixPath(image_name).name,
                width=width,
                height=height,
                meta={"width": width, "height": height, "split": split_name},
                split=split_enum,
                status=ImageStatus.NEW,
            )
            db.add(image)
            await db.flush()
            total_images += 1

            # Create annotations for this image
            boxes = annotations_map.get(PurePosixPath(image_name).name, [])
            for x1, y1, x2, y2, cls_idx in boxes:
                label_id = index_to_label_id.get(cls_idx)
                if label_id is None:
                    continue
                annotation = Annotation(
                    image_id=image.id,
                    label_id=label_id,
                    geometry={
                        "type": "bbox",
                        "x": x1,
                        "y": y1,
                        "width": x2 - x1,
                        "height": y2 - y1,
                    },
                    is_prediction=False,
                )
                db.add(annotation)
                total_annotations += 1

            # Mark images with annotations as DONE
            if boxes:
                image.status = ImageStatus.DONE

    await db.commit()
    zf.close()

    return {
        "imported_images": total_images,
        "imported_annotations": total_annotations,
        "labels": len(class_names),
        "splits": list(splits_data.keys()),
    }
