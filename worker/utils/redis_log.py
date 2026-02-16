import json
from datetime import datetime, timezone

import redis as _sync_redis
from redis.asyncio import Redis

from worker.utils.settings import get_settings


def get_redis() -> Redis:
    settings = get_settings()
    return Redis.from_url(settings.redis_url, decode_responses=True)


def get_sync_redis() -> _sync_redis.Redis:
    """Return a **synchronous** Redis client.

    Use this from YOLO training callbacks where ``asyncio.run()`` already
    owns the thread's event loop, making ``loop.run_until_complete()``
    illegal on any auxiliary loop.
    """
    settings = get_settings()
    return _sync_redis.Redis.from_url(settings.redis_url, decode_responses=True)


# ---------------------------------------------------------------------------
# Async helpers (safe inside coroutines / ``await``)
# ---------------------------------------------------------------------------

async def publish_log(channel: str, message: str, *, progress: dict | None = None) -> None:
    """Publish a log message to Redis pubsub AND persist in a Redis list.

    The list key follows the pattern ``job_log_history:<job_id>`` where the
    job_id is extracted from the channel name (``job_logs:<job_id>``).
    Entries expire after 7 days.

    If *progress* is provided, a structured progress event is also published
    on the same channel and cached in ``job_progress:<job_id>`` for REST
    polling.  Both ops share a single Redis connection to avoid the
    nested-event-loop issue when called from sync YOLO callbacks.
    """
    redis = get_redis()
    try:
        pipe = redis.pipeline()

        # 1. Publish the human-readable log line
        pipe.publish(channel, message)

        # 2. Persist log in history list
        entry = json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "line": message})
        if channel.startswith("job_logs:"):
            job_id = channel[len("job_logs:") :]
            if job_id:
                list_key = f"job_log_history:{job_id}"
                pipe.rpush(list_key, entry)
                pipe.expire(list_key, 7 * 24 * 3600)  # 7 day TTL

        # 3. If progress data supplied, publish + cache it
        if progress is not None:
            payload = json.dumps({"type": "progress", **progress})
            pipe.publish(channel, payload)
            if channel.startswith("job_logs:"):
                job_id = channel[len("job_logs:") :]
                if job_id:
                    progress_key = f"job_progress:{job_id}"
                    pipe.set(progress_key, payload)
                    pipe.expire(progress_key, 24 * 3600)  # 24h TTL

        await pipe.execute()
    finally:
        await redis.close()


async def publish_progress(channel: str, progress: dict) -> None:
    """Publish a structured progress event (no log line).

    Prefer ``publish_log(..., progress=data)`` from async contexts, or
    ``sync_publish_log`` / ``sync_publish_progress`` from sync callbacks.
    """
    redis = get_redis()
    try:
        payload = json.dumps({"type": "progress", **progress})
        pipe = redis.pipeline()
        pipe.publish(channel, payload)
        if channel.startswith("job_logs:"):
            job_id = channel[len("job_logs:") :]
            if job_id:
                progress_key = f"job_progress:{job_id}"
                pipe.set(progress_key, payload)
                pipe.expire(progress_key, 24 * 3600)
        await pipe.execute()
    finally:
        await redis.close()


# ---------------------------------------------------------------------------
# Synchronous helpers (for YOLO training callbacks inside asyncio.run)
# ---------------------------------------------------------------------------

def sync_publish_log(channel: str, message: str, *, progress: dict | None = None) -> None:
    """Synchronous version of ``publish_log``.

    Uses a plain (blocking) Redis client so it works from YOLO callbacks
    that execute inside ``asyncio.run()`` — where a secondary event loop
    cannot call ``run_until_complete()``.
    """
    r = get_sync_redis()
    try:
        pipe = r.pipeline()
        pipe.publish(channel, message)
        entry = json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "line": message})
        if channel.startswith("job_logs:"):
            job_id = channel[len("job_logs:") :]
            if job_id:
                list_key = f"job_log_history:{job_id}"
                pipe.rpush(list_key, entry)
                pipe.expire(list_key, 7 * 24 * 3600)
        if progress is not None:
            payload = json.dumps({"type": "progress", **progress})
            pipe.publish(channel, payload)
            if channel.startswith("job_logs:"):
                job_id = channel[len("job_logs:") :]
                if job_id:
                    pipe.set(f"job_progress:{job_id}", payload)
                    pipe.expire(f"job_progress:{job_id}", 24 * 3600)
        pipe.execute()
    finally:
        r.close()


def sync_publish_progress(channel: str, progress: dict) -> None:
    """Synchronous version of ``publish_progress``."""
    r = get_sync_redis()
    try:
        payload = json.dumps({"type": "progress", **progress})
        pipe = r.pipeline()
        pipe.publish(channel, payload)
        if channel.startswith("job_logs:"):
            job_id = channel[len("job_logs:") :]
            if job_id:
                pipe.set(f"job_progress:{job_id}", payload)
                pipe.expire(f"job_progress:{job_id}", 24 * 3600)
        pipe.execute()
    finally:
        r.close()
