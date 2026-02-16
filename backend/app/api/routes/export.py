import io
import zipfile
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.models.annotation import Annotation
from app.models.image import Image
from app.models.label import Label
from app.models.project import Project

router = APIRouter(prefix="/projects", tags=["export"], dependencies=[Depends(get_current_user)])


def _bbox_from_geometry(geometry: dict[str, Any]) -> tuple[float, float, float, float] | None:
    if all(k in geometry for k in ("x", "y", "w", "h")):
        return float(geometry["x"]), float(geometry["y"]), float(geometry["w"]), float(geometry["h"])
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


@router.get("/{project_id}/export")
async def export_annotations(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    format: str = Query("yolo", description="Export format: yolo"),
) -> StreamingResponse:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if format != "yolo":
        raise HTTPException(status_code=400, detail="Unsupported format. Supported: yolo")

    # Fetch labels
    result = await db.execute(
        select(Label).where(Label.project_id == project_id).order_by(Label.path)
    )
    labels = result.scalars().all()
    label_map: dict[UUID, int] = {label.id: idx for idx, label in enumerate(labels)}

    # Fetch images
    result = await db.execute(select(Image).where(Image.project_id == project_id))
    images = result.scalars().all()

    # Fetch all annotations
    image_ids = [img.id for img in images]
    annotations_by_image: dict[UUID, list[Annotation]] = {img_id: [] for img_id in image_ids}
    if image_ids:
        result = await db.execute(
            select(Annotation).where(Annotation.image_id.in_(image_ids))
        )
        for ann in result.scalars().all():
            annotations_by_image[ann.image_id].append(ann)

    # Build zip in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # classes.txt
        class_lines = [label.name for label in labels]
        zf.writestr("classes.txt", "\n".join(class_lines))

        # One .txt per image
        for img in images:
            w = img.width or (img.meta.get("width") if img.meta else None)
            h = img.height or (img.meta.get("height") if img.meta else None)
            if not w or not h:
                continue

            lines: list[str] = []
            for ann in annotations_by_image.get(img.id, []):
                if ann.label_id not in label_map:
                    continue
                bbox = _bbox_from_geometry(ann.geometry)
                if bbox is None:
                    continue
                lines.append(_yolo_line(label_map[ann.label_id], bbox, int(w), int(h)))

            stem = img.filename.rsplit(".", 1)[0] if img.filename else str(img.id)
            zf.writestr(f"labels/{stem}.txt", "\n".join(lines))

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{project.name}_yolo_export.zip"'},
    )
