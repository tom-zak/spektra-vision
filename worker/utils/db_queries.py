import json
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text

from worker.utils.db import run_in_session


def _normalize_row(row: dict[str, Any]) -> dict[str, Any]:
    """Convert asyncpg-native UUID values to strings so downstream code can use them safely."""
    return {k: str(v) if hasattr(v, 'int') and hasattr(v, 'hex') and not isinstance(v, (int, str)) else v for k, v in row.items()}


async def fetch_labels(project_id: UUID) -> list[dict[str, Any]]:
    async def _exec(session):
        result = await session.execute(
            text("SELECT id, name FROM labels WHERE project_id = :project_id ORDER BY path"),
            {"project_id": project_id},
        )
        return [_normalize_row(dict(row)) for row in result.mappings().all()]

    return await run_in_session(_exec)


async def fetch_images(project_id: UUID, limit: int | None = None) -> list[dict[str, Any]]:
    async def _exec(session):
        sql = (
            "SELECT id, storage_path, filename, width, height, meta "
            "FROM images WHERE project_id = :project_id ORDER BY id"
        )
        if limit:
            sql += " LIMIT :limit"
        result = await session.execute(
            text(sql),
            {"project_id": project_id, "limit": limit},
        )
        return [_normalize_row(dict(row)) for row in result.mappings().all()]

    return await run_in_session(_exec)


async def fetch_annotations(image_ids: list[UUID]) -> dict[str, list[dict[str, Any]]]:
    if not image_ids:
        return {}

    async def _exec(session):
        result = await session.execute(
            text(
                "SELECT id, image_id, label_id, geometry, confidence "
                "FROM annotations WHERE image_id = ANY(:image_ids) AND is_prediction = FALSE"
            ),
            {"image_ids": [str(uid) for uid in image_ids]},
        )
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in result.mappings().all():
            image_id = str(row["image_id"])
            grouped.setdefault(image_id, []).append(_normalize_row(dict(row)))
        return grouped

    return await run_in_session(_exec)


async def fetch_dataset_version(version_id: UUID) -> dict[str, Any] | None:
    """Fetch a dataset version row including image_snapshot, preprocessing, augmentation."""
    async def _exec(session):
        result = await session.execute(
            text(
                "SELECT id, project_id, version_number, image_snapshot, "
                "preprocessing, augmentation "
                "FROM dataset_versions WHERE id = :version_id"
            ),
            {"version_id": version_id},
        )
        row = result.mappings().first()
        return _normalize_row(dict(row)) if row else None

    return await run_in_session(_exec)


async def fetch_images_by_ids(image_ids: list[UUID]) -> list[dict[str, Any]]:
    """Fetch images by a list of IDs (used for dataset-version snapshots)."""
    if not image_ids:
        return []

    async def _exec(session):
        result = await session.execute(
            text(
                "SELECT id, storage_path, filename, width, height, meta "
                "FROM images WHERE id = ANY(:image_ids) ORDER BY id"
            ),
            {"image_ids": [str(uid) for uid in image_ids]},
        )
        return [_normalize_row(dict(row)) for row in result.mappings().all()]

    return await run_in_session(_exec)


async def insert_predictions(image_id: UUID, predictions: list[dict[str, Any]]) -> None:
    async def _exec(session):
        for pred in predictions:
            await session.execute(
                text(
                    "INSERT INTO annotations (id, image_id, label_id, geometry, confidence, is_prediction) "
                    "VALUES (:id, :image_id, :label_id, CAST(:geometry AS jsonb), :confidence, TRUE)"
                ),
                {
                    "id": str(uuid4()),
                    "image_id": str(image_id),
                    "label_id": str(pred["label_id"]),
                    "geometry": json.dumps(pred["geometry"]),
                    "confidence": pred.get("confidence"),
                },
            )
        await session.commit()

    await run_in_session(_exec)
