from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.api.deps import get_current_user, get_db
from app.models.tag import Tag
from app.models.project import Project
from app.schemas.tags import TagCreate, TagOut, TagUpdate

router = APIRouter(prefix="/tags", tags=["tags"], dependencies=[Depends(get_current_user)])


def _tag_to_out(tag: Tag) -> TagOut:
    return TagOut(id=tag.id, name=tag.name, color=tag.color, project_id=tag.project_id)


@router.get("/projects/{project_id}", response_model=list[TagOut])
async def list_project_tags(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> list[TagOut]:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    result = await db.execute(
        select(Tag).where(Tag.project_id == project_id).order_by(Tag.name)
    )
    return [_tag_to_out(t) for t in result.scalars().all()]


@router.post("/projects/{project_id}", response_model=TagOut, status_code=201)
async def create_tag(
    project_id: UUID,
    payload: TagCreate,
    db: AsyncSession = Depends(get_db),
) -> TagOut:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    tag = Tag(project_id=project_id, name=payload.name, color=payload.color)
    db.add(tag)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Tag '{payload.name}' already exists in this project")
    await db.refresh(tag)
    return _tag_to_out(tag)


@router.patch("/{tag_id}", response_model=TagOut)
async def update_tag(
    tag_id: UUID,
    payload: TagUpdate,
    db: AsyncSession = Depends(get_db),
) -> TagOut:
    tag = await db.get(Tag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    if payload.name is not None:
        tag.name = payload.name
    if payload.color is not None:
        tag.color = payload.color
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Tag '{payload.name}' already exists in this project")
    await db.refresh(tag)
    return _tag_to_out(tag)


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    tag = await db.get(Tag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    await db.delete(tag)
    await db.commit()
