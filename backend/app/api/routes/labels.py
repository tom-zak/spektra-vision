from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_role
from app.models.user import User
from app.models.label import Label
from app.models.project import Project
from app.schemas.labels import LabelCreate, LabelRead, LabelUpdate

router = APIRouter(prefix="/projects", tags=["labels"], dependencies=[Depends(get_current_user)])


@router.get("/{project_id}/labels", response_model=list[LabelRead])
async def list_labels(project_id: UUID, db: AsyncSession = Depends(get_db)) -> list[LabelRead]:
    result = await db.execute(select(Label).where(Label.project_id == project_id).order_by(Label.path))
    labels = result.scalars().all()
    return [
        LabelRead(id=label.id, name=label.name, path=str(label.path), color=label.color)
        for label in labels
    ]


@router.post("/{project_id}/labels", response_model=LabelRead, status_code=201, dependencies=[Depends(require_role("ADMIN"))])
async def create_label(
    project_id: UUID,
    payload: LabelCreate,
    db: AsyncSession = Depends(get_db),
) -> LabelRead:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    label = Label(
        project_id=project_id,
        name=payload.name,
        path=payload.path,
        color=payload.color,
    )
    db.add(label)
    await db.commit()
    await db.refresh(label)
    return LabelRead(id=label.id, name=label.name, path=str(label.path), color=label.color)


@router.patch("/{project_id}/labels/{label_id}", response_model=LabelRead)
async def update_label(
    project_id: UUID,
    label_id: UUID,
    payload: LabelUpdate,
    db: AsyncSession = Depends(get_db),
) -> LabelRead:
    result = await db.execute(
        select(Label).where(Label.id == label_id, Label.project_id == project_id)
    )
    label = result.scalar_one_or_none()
    if label is None:
        raise HTTPException(status_code=404, detail="Label not found")
    if payload.name is not None:
        label.name = payload.name
    if payload.color is not None:
        label.color = payload.color
    await db.commit()
    await db.refresh(label)
    return LabelRead(id=label.id, name=label.name, path=str(label.path), color=label.color)


@router.delete("/{project_id}/labels/{label_id}", status_code=204, dependencies=[Depends(require_role("ADMIN"))])
async def delete_label(
    project_id: UUID,
    label_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(Label).where(Label.id == label_id, Label.project_id == project_id)
    )
    label = result.scalar_one_or_none()
    if label is None:
        raise HTTPException(status_code=404, detail="Label not found")
    await db.delete(label)
    await db.commit()
