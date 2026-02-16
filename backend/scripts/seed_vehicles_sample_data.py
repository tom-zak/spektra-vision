import argparse
import asyncio
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.models.annotation_history import AnnotationHistory
from app.models.annotation_job import AnnotationJob
from app.models.dataset_version import DatasetVersion
from app.models.enums import (
    AnnotationJobStatus,
    ImageStatus,
    JobStatus,
    ReviewStatus,
    TaskType,
    UserRole,
    VersionStatus,
)
from app.models.image import Image
from app.models.job import Job
from app.models.project import Project
from app.models.user import User

SEED_SOURCE = "vehicles_demo"
SEED_IMAGE_PREFIX = "seed/vehicles"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed Vehicles sample data")
    parser.add_argument("--project-name", default="Vehicles", help="Project name to seed")
    parser.add_argument(
        "--project-type",
        default="DETECTION",
        choices=["CLASSIFICATION", "DETECTION", "SEGMENTATION"],
        help="Task type for new project (ignored if project exists)",
    )
    parser.add_argument("--images", type=int, default=36, help="Number of sample images to create")
    parser.add_argument("--days", type=int, default=14, help="Number of insight days to seed")
    return parser.parse_args()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


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


async def get_or_create_user(session: AsyncSession, email: str, role: UserRole) -> User:
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        return user
    user = User(email=email, password_hash="seeded", role=role)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def ensure_seed_images(session: AsyncSession, project: Project, total: int) -> list[Image]:
    result = await session.execute(
        select(Image).where(
            Image.project_id == project.id,
            Image.storage_path.like(f"{SEED_IMAGE_PREFIX}/%"),
        )
    )
    existing = result.scalars().all()
    if len(existing) >= total:
        return existing[:total]

    created = list(existing)
    start_idx = len(existing)
    for idx in range(start_idx, total):
        filename = f"vehicle_{idx + 1:03d}.jpg"
        storage_path = f"{SEED_IMAGE_PREFIX}/{project.id}/{uuid4()}-{filename}"
        status = ImageStatus.DONE if idx % 3 == 0 else ImageStatus.IN_PROGRESS
        review_status = ReviewStatus.UNREVIEWED
        if idx % 5 == 0:
            review_status = ReviewStatus.APPROVED
        elif idx % 7 == 0:
            review_status = ReviewStatus.REJECTED
        elif idx % 9 == 0:
            review_status = ReviewStatus.NEEDS_REVISION

        image = Image(
            project_id=project.id,
            storage_path=storage_path,
            filename=filename,
            width=1280,
            height=720,
            meta={"seed": SEED_SOURCE, "index": idx + 1},
            status=status,
            review_status=review_status,
        )
        session.add(image)
        created.append(image)

    await session.commit()
    return created


def build_image_map(images: list[Image], done: int, in_progress: int, review: int) -> dict:
    mapping: dict[str, str] = {}
    for image in images[:done]:
        mapping[str(image.id)] = "done"
    for image in images[done:done + in_progress]:
        mapping[str(image.id)] = "in_progress"
    for image in images[done + in_progress:done + in_progress + review]:
        mapping[str(image.id)] = "review"
    for image in images[done + in_progress + review:]:
        mapping[str(image.id)] = "pending"
    return mapping


def resolve_job_status(image_map: dict[str, str]) -> AnnotationJobStatus:
    values = set(image_map.values())
    if values == {"done"}:
        return AnnotationJobStatus.DONE
    if "review" in values:
        return AnnotationJobStatus.REVIEW
    if "in_progress" in values or "done" in values:
        return AnnotationJobStatus.IN_PROGRESS
    return AnnotationJobStatus.PENDING


async def ensure_annotation_jobs(
    session: AsyncSession,
    project: Project,
    users: list[User],
    images: list[Image],
) -> None:
    batches = [
        ("Seed Batch A", 8, 4, 2),
        ("Seed Batch B", 4, 6, 0),
        ("Seed Batch C", 6, 0, 3),
    ]
    for idx, (batch_name, done, in_progress, review) in enumerate(batches):
        result = await session.execute(
            select(AnnotationJob).where(
                AnnotationJob.project_id == project.id,
                AnnotationJob.batch_name == batch_name,
            )
        )
        if result.scalar_one_or_none():
            continue

        start = idx * 12
        subset = images[start:start + 12]
        image_map = build_image_map(subset, done, in_progress, review)
        job = AnnotationJob(
            project_id=project.id,
            assigned_to=users[idx % len(users)].id,
            batch_name=batch_name,
            instructions="Label vehicles: draw tight boxes around visible vehicles.",
            status=resolve_job_status(image_map),
            image_ids=image_map,
            created_by=users[0].id,
        )
        session.add(job)

    await session.commit()


async def ensure_dataset_versions(session: AsyncSession, project: Project, images: list[Image]) -> list[DatasetVersion]:
    base_result = await session.execute(
        select(func.max(DatasetVersion.version_number)).where(DatasetVersion.project_id == project.id)
    )
    current_max = base_result.scalar_one() or 0

    versions: list[DatasetVersion] = []
    names = ["Vehicles Seed v1", "Vehicles Seed v2", "Vehicles Seed v3"]
    for idx, name in enumerate(names, start=1):
        existing = await session.execute(
            select(DatasetVersion).where(
                DatasetVersion.project_id == project.id,
                DatasetVersion.name == name,
            )
        )
        found = existing.scalar_one_or_none()
        if found:
            versions.append(found)
            continue

        created_at = utcnow() - timedelta(days=90 - idx * 25)
        num_images = min(len(images), 30 + idx * 2)
        num_train = int(num_images * 0.7)
        num_valid = int(num_images * 0.2)
        num_test = num_images - num_train - num_valid
        snapshot = []
        for i in range(min(num_images, len(images))):
            if i < num_train:
                split = "train"
            elif i < num_train + num_valid:
                split = "valid"
            else:
                split = "test"
            snapshot.append({"image_id": str(images[i].id), "split": split})

        version = DatasetVersion(
            project_id=project.id,
            version_number=current_max + idx,
            name=name,
            status=VersionStatus.READY,
            train_pct=0.7,
            valid_pct=0.2,
            test_pct=0.1,
            preprocessing={"resize": 1280, "auto_orient": True},
            augmentation={"flip": True, "rotate": 10, "blur": 0.05},
            num_images=num_images,
            num_train=num_train,
            num_valid=num_valid,
            num_test=num_test,
            num_annotations=num_images * 3,
            num_classes=5,
            image_snapshot=snapshot,
            created_at=created_at,
        )
        session.add(version)
        versions.append(version)

    await session.commit()
    return versions


async def ensure_insights_history(
    session: AsyncSession,
    project: Project,
    users: list[User],
    images: list[Image],
    days: int,
) -> None:
    existing = await session.execute(
        select(func.count())
        .select_from(AnnotationHistory)
        .join(Image, AnnotationHistory.image_id == Image.id)
        .where(
            Image.project_id == project.id,
            AnnotationHistory.snapshot["seed_source"].as_string() == SEED_SOURCE,
        )
    )
    if (existing.scalar_one() or 0) > 0:
        return

    rng = Random(42)
    actions = ["create", "update", "delete"]
    start_day = utcnow() - timedelta(days=days - 1)

    history_rows: list[AnnotationHistory] = []
    for day_offset in range(days):
        day = start_day + timedelta(days=day_offset)
        for _ in range(3):
            image = rng.choice(images)
            user = rng.choice(users)
            action = rng.choice(actions)
            changed_at = day + timedelta(minutes=rng.randint(5, 600))
            history_rows.append(
                AnnotationHistory(
                    image_id=image.id,
                    label_id=None,
                    geometry={"type": "bbox", "x": 120, "y": 80, "width": 320, "height": 180},
                    action=action,
                    version=1,
                    changed_by=user.id,
                    changed_at=changed_at,
                    snapshot={"seed_source": SEED_SOURCE, "action": action},
                )
            )

    session.add_all(history_rows)
    await session.commit()


async def ensure_model_jobs(
    session: AsyncSession,
    project: Project,
    dataset_versions: list[DatasetVersion],
) -> None:
    artifacts = [
        ("Vehicles Base", "s3://spektra/models/vehicles_base.pt", 0.64, 0.71, 0.66),
        ("Vehicles v2", "s3://spektra/models/vehicles_v2.pt", 0.72, 0.78, 0.7),
        ("Vehicles Night", "s3://spektra/models/vehicles_night.pt", 0.58, 0.62, 0.55),
    ]

    for idx, (name, artifact, map50, precision, recall) in enumerate(artifacts):
        result = await session.execute(
            select(Job).where(
                Job.project_id == project.id,
                Job.artifact_path == artifact,
            )
        )
        if result.scalar_one_or_none():
            continue

        dataset_version = dataset_versions[min(idx, len(dataset_versions) - 1)]
        job = Job(
            project_id=project.id,
            job_type="train",
            status=JobStatus.COMPLETED,
            logs_channel=f"seed-train-{idx + 1}",
            model_arch="yolov8m",
            hyperparams={"epochs": 50, "batch": 8, "imgsz": 1280},
            artifact_path=artifact,
            created_at=utcnow() - timedelta(days=10 - idx * 3),
            dataset_version_id=dataset_version.id,
            metrics={
                "mAP50": map50,
                "precision": precision,
                "recall": recall,
                "loss": round(2.4 - idx * 0.3, 3),
                "_display_name": name,
                "_notes": "Seeded model entry",
            },
            logs=["seeded job"],
        )
        session.add(job)

    await session.commit()


async def main() -> None:
    args = parse_args()
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as session:
        project = await get_or_create_project(session, args.project_name, TaskType(args.project_type))

        users = [
            await get_or_create_user(session, "admin+vehicles@example.com", UserRole.ADMIN),
            await get_or_create_user(session, "annotator.alex@example.com", UserRole.ANNOTATOR),
            await get_or_create_user(session, "annotator.riley@example.com", UserRole.ANNOTATOR),
            await get_or_create_user(session, "reviewer.jordan@example.com", UserRole.REVIEWER),
        ]

        images = await ensure_seed_images(session, project, args.images)

        for image in images:
            if image.review_status != ReviewStatus.UNREVIEWED and image.reviewed_by is None:
                image.reviewed_by = users[-1].id
        await session.commit()

        await ensure_annotation_jobs(session, project, users[1:3], images)
        dataset_versions = await ensure_dataset_versions(session, project, images)
        await ensure_insights_history(session, project, users, images, args.days)
        await ensure_model_jobs(session, project, dataset_versions)

    await engine.dispose()
    print(f"Seeded sample data for project: {project.name}")


if __name__ == "__main__":
    os.environ.setdefault("PYTHONPATH", str(Path(__file__).resolve().parents[1]))
    asyncio.run(main())
