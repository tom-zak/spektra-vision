import argparse
import asyncio
import os
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from PIL import Image as PILImage

from app.core.config import get_settings
from app.models.annotation import Annotation
from app.models.image import Image
from app.models.label import Label
from app.models.project import Project
from app.models.enums import ImageSplit, ImageStatus, TaskType
from app.services.storage import ensure_bucket, get_s3_client


SPLIT_MAP = {"train": ImageSplit.TRAIN, "valid": ImageSplit.VALID, "test": ImageSplit.TEST}

DEFAULT_COLORS = [
    "#38bdf8", "#f87171", "#4ade80", "#facc15",
    "#c084fc", "#fb923c", "#2dd4bf", "#f472b6",
    "#818cf8", "#a3e635", "#fbbf24", "#e879f9",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest local images into MinIO and Postgres")
    parser.add_argument("--project-name", default="Vehicles", help="Project name")
    parser.add_argument("--project-type", default="DETECTION", choices=["CLASSIFICATION", "DETECTION", "SEGMENTATION"])
    parser.add_argument("--dataset-root", required=True, help="Root folder containing train/valid/test")
    parser.add_argument("--limit", type=int, default=200, help="Max images to ingest per split")
    parser.add_argument("--import-annotations", action="store_true",
                        help="Import YOLO v4 PyTorch annotations from _annotations.txt")
    return parser.parse_args()


async def get_or_create_project(session: AsyncSession, name: str, task_type: TaskType) -> Project:
    result = await session.execute(select(Project).where(Project.name == name))
    project = result.scalar_one_or_none()
    if project:
        return project
    project = Project(name=name, task_type=task_type, ontology={})
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


async def ensure_labels(session: AsyncSession, project: Project, classes_file: Path) -> dict[int, UUID]:
    """Create labels for each class. Returns class_index → label_id mapping."""
    index_to_id: dict[int, UUID] = {}
    if not classes_file.exists():
        return index_to_id
    result = await session.execute(select(Label).where(Label.project_id == project.id))
    existing_labels = result.scalars().all()
    existing = {label.name: label.id for label in existing_labels}
    used_colors = len(existing_labels)
    class_names = [line.strip() for line in classes_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    for idx, name in enumerate(class_names):
        if name in existing:
            index_to_id[idx] = existing[name]
        else:
            color = DEFAULT_COLORS[used_colors % len(DEFAULT_COLORS)]
            used_colors += 1
            label = Label(project_id=project.id, name=name, path=name.replace(" ", "_"), color=color)
            session.add(label)
            await session.flush()
            index_to_id[idx] = label.id
            existing[name] = label.id
    await session.commit()
    return index_to_id


def parse_annotations_file(annotations_file: Path) -> dict[str, list[tuple[int, int, int, int, int]]]:
    """Parse _annotations.txt – ``filename x1,y1,x2,y2,cls [...]`` per line."""
    mapping: dict[str, list[tuple[int, int, int, int, int]]] = {}
    if not annotations_file.exists():
        return mapping
    for line in annotations_file.read_text(encoding="utf-8").splitlines():
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


async def ingest_images(
    session: AsyncSession,
    project: Project,
    split_dir: Path,
    limit: int,
    import_annotations: bool = False,
    index_to_label_id: dict[int, UUID] | None = None,
) -> tuple[int, int]:
    s3 = get_s3_client()
    count = 0
    anno_count = 0
    split_enum = SPLIT_MAP.get(split_dir.name, ImageSplit.UNASSIGNED)

    # Load annotations map if requested
    annotations_map: dict[str, list[tuple[int, int, int, int, int]]] = {}
    if import_annotations:
        annotations_file = split_dir / "_annotations.txt"
        annotations_map = parse_annotations_file(annotations_file)

    for file in split_dir.iterdir():
        if not file.suffix.lower() in {".jpg", ".jpeg", ".png"}:
            continue
        key = f"{project.id}/{uuid4()}-{file.name}"
        with file.open("rb") as handle:
            payload = handle.read()
        s3.put_object(Bucket=get_settings().minio_bucket, Key=key, Body=payload)
        with PILImage.open(file) as img:
            width, height = img.size

        boxes = annotations_map.get(file.name, [])
        image = Image(
            project_id=project.id,
            storage_path=key,
            filename=file.name,
            width=width,
            height=height,
            meta={"width": width, "height": height, "split": split_dir.name},
            split=split_enum,
            status=ImageStatus.DONE if boxes else ImageStatus.NEW,
        )
        session.add(image)
        await session.flush()

        # Create annotation records
        if import_annotations and index_to_label_id:
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
                session.add(annotation)
                anno_count += 1

        count += 1
        if count >= limit:
            break
    await session.commit()
    return count, anno_count


async def main() -> None:
    args = parse_args()
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    ensure_bucket()

    async with session_factory() as session:
        project = await get_or_create_project(session, args.project_name, TaskType(args.project_type))
        classes_file = Path(args.dataset_root) / "train" / "_classes.txt"
        index_to_label_id = await ensure_labels(session, project, classes_file)

        total_images = 0
        total_annotations = 0
        for split in ["train", "valid", "test"]:
            split_dir = Path(args.dataset_root) / split
            if split_dir.exists():
                imgs, annos = await ingest_images(
                    session, project, split_dir, args.limit,
                    import_annotations=args.import_annotations,
                    index_to_label_id=index_to_label_id,
                )
                total_images += imgs
                total_annotations += annos

    await engine.dispose()
    print(f"Ingested {total_images} images and {total_annotations} annotations into project {args.project_name}")


if __name__ == "__main__":
    os.environ.setdefault("PYTHONPATH", str(Path(__file__).resolve().parents[1]))
    asyncio.run(main())
