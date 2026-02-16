import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from worker.utils.settings import get_settings

# Cache engine per event-loop so multiple calls within one asyncio.run() reuse
# the same pool, but a new Celery task (new loop) gets a fresh engine.
_engine_cache: dict[int, AsyncEngine] = {}


def _get_engine() -> AsyncEngine:
    loop = asyncio.get_running_loop()
    loop_id = id(loop)
    if loop_id not in _engine_cache:
        # Evict stale entries from previous (now-closed) loops
        for old_id in list(_engine_cache):
            if old_id != loop_id:
                _engine_cache.pop(old_id, None)
        settings = get_settings()
        _engine_cache[loop_id] = create_async_engine(
            settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=2,
        )
    return _engine_cache[loop_id]


async def run_in_session(fn: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    """Run *fn* inside a short-lived session.

    The engine is cached per event-loop so that asyncpg connections are always
    attached to the current loop (Celery forks create a new loop per task via
    ``asyncio.run``).
    """
    engine = _get_engine()
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        return await fn(session)


async def dispose_engine() -> None:
    """Dispose the engine for the current loop (call at end of task)."""
    loop_id = id(asyncio.get_running_loop())
    engine = _engine_cache.pop(loop_id, None)
    if engine:
        await engine.dispose()


def run_async(fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(fn())
