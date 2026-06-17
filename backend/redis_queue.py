import os
import redis.asyncio as aioredis
from dotenv import load_dotenv

load_dotenv()

STREAM_KEY = "screening_jobs"
GROUP_NAME = "screening_workers"
STREAM_MAXLEN = 1000
RECLAIM_IDLE_MS = 60_000


async def get_redis() -> aioredis.Redis:
    return await aioredis.from_url(
        os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        decode_responses=True
    )


async def ensure_group(client: aioredis.Redis) -> None:
    try:
        await client.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
    except Exception:
        pass  # Group already exists


async def enqueue_job(client: aioredis.Redis, job_id: int) -> str:
    return await client.xadd(
        STREAM_KEY,
        {"job_id": str(job_id)},
        maxlen=STREAM_MAXLEN,
        approximate=True
    )


async def read_jobs(
    client: aioredis.Redis,
    consumer_name: str,
    count: int = 10,
    block_ms: int = 5000
) -> list:
    result = await client.xreadgroup(
        GROUP_NAME, consumer_name,
        {STREAM_KEY: ">"},
        count=count,
        block=block_ms
    )
    if not result:
        return []
    # result is [(stream_key, [(msg_id, {field: val}), ...])]
    return result[0][1]


async def ack_job(client: aioredis.Redis, msg_id: str) -> None:
    await client.xack(STREAM_KEY, GROUP_NAME, msg_id)


async def reclaim_stale_jobs(
    client: aioredis.Redis,
    consumer_name: str,
    count: int = 10
) -> list:
    result = await client.xautoclaim(
        STREAM_KEY, GROUP_NAME, consumer_name,
        min_idle_time=RECLAIM_IDLE_MS,
        start_id="0-0",
        count=count
    )
    # result is (next_start_id, [(msg_id, {field: val}), ...], [deleted_ids])
    return result[1] if result else []


async def queue_depth(client: aioredis.Redis) -> dict:
    length = await client.xlen(STREAM_KEY)
    pending_info = await client.xpending(STREAM_KEY, GROUP_NAME)
    pending = pending_info.get("pending", 0) if isinstance(pending_info, dict) else 0
    return {"stream_length": length, "pending": pending}
