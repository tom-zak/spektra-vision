from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_role
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.auth import TokenResponse, UserLogin, UserRead, UserRegister, UserUpdate
from app.services.auth import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=201)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)) -> UserRead:
    # Check duplicate email
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    # First user in the system becomes ADMIN automatically
    user_count = await db.execute(select(func.count(User.id)))
    is_first = (user_count.scalar() or 0) == 0
    role = UserRole.ADMIN if is_first else (UserRole(body.role) if body.role in UserRole.__members__ else UserRole.ANNOTATOR)
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        role=role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserRead(id=user.id, email=user.email, role=user.role.value)


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(str(user.id), user.role.value)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(get_current_user)) -> UserRead:
    return UserRead(id=user.id, email=user.email, role=user.role.value)


# ---- User Management (ADMIN only) ----

@router.get("/users", response_model=list[UserRead], dependencies=[Depends(require_role("ADMIN"))])
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserRead]:
    result = await db.execute(select(User).order_by(User.created_at))
    users = result.scalars().all()
    return [UserRead(id=u.id, email=u.email, role=u.role.value) for u in users]


@router.patch("/users/{user_id}", response_model=UserRead, dependencies=[Depends(require_role("ADMIN"))])
async def update_user(
    user_id: str,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    from uuid import UUID as _UUID
    user = await db.get(User, _UUID(user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.role is not None:
        if payload.role not in UserRole.__members__:
            raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {list(UserRole.__members__.keys())}")
        user.role = UserRole(payload.role)
    if payload.email is not None:
        user.email = payload.email
    await db.commit()
    await db.refresh(user)
    return UserRead(id=user.id, email=user.email, role=user.role.value)


@router.delete("/users/{user_id}", status_code=204, dependencies=[Depends(require_role("ADMIN"))])
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    from uuid import UUID as _UUID
    uid = _UUID(user_id)
    if uid == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = await db.get(User, uid)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
