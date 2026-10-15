"""Emergent Object Storage: put/get bytes. All access goes through the backend (no presigned URLs)."""

import asyncio
import logging
import random  # backoff jitter only — not security sensitive
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
import os

from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")
logger = logging.getLogger(__name__)

# `or`, not a default= argument: the platform sets this to "" when it has no value.
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "gi-mis"

_storage_key: str | None = None


async def init_storage(force: bool = False) -> str:
    """Session-scoped key, minted once and reused. force=True re-mints after a 404 on a dead key."""
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ["EMERGENT_LLM_KEY"]})
        resp.raise_for_status()
        _storage_key = resp.json()["storage_key"]
    return _storage_key


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload bytes. Returns {"path", "size", "etag"}; always persist the returned path."""
    for attempt in range(4):
        key = await init_storage(force=attempt == 1)
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.put(
                    f"{STORAGE_URL}/objects/{path}",
                    headers={"X-Storage-Key": key, "Content-Type": content_type},
                    content=data,
                )
        except httpx.TransportError:
            if attempt == 3:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))
            continue
        if resp.status_code == 404 and attempt == 0:
            continue  # stale storage key — re-init once
        if (resp.status_code == 429 or resp.status_code >= 500) and attempt < 3:  # storage throttled/busy — back off (honour Retry-After) and retry
            wait = _retry_wait(resp, attempt)
            logger.warning("Storage PUT %s → %s, retry %d in %.1fs", path, resp.status_code, attempt + 1, wait)
            await asyncio.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("unreachable")


GET_ATTEMPTS = 5
MAX_WAIT = 20.0  # seconds — cap for both Retry-After and exponential backoff


def _retry_wait(resp: Optional[httpx.Response], attempt: int) -> float:
    """Seconds to wait before the next try: the server's Retry-After (seconds or HTTP date) if given, else 1, 2, 4, 8 s + jitter."""
    ra = resp.headers.get("Retry-After") if resp is not None else None
    if ra:
        try:
            return min(max(float(ra), 0.0), MAX_WAIT)
        except ValueError:
            try:
                when = parsedate_to_datetime(ra)
                return min(max((when - datetime.now(timezone.utc)).total_seconds(), 0.0), MAX_WAIT)
            except (TypeError, ValueError):
                pass
    return min(2 ** attempt + random.uniform(0, 0.5), MAX_WAIT)


def is_throttled(exc: BaseException) -> bool:
    """True when storage was still busy (429 / 5xx) after every retry — callers answer 503 'try again', not 502."""
    return isinstance(exc, httpx.HTTPStatusError) and (exc.response.status_code == 429 or exc.response.status_code >= 500)


async def get_object(path: str) -> tuple[bytes, str]:
    """Download bytes. Returns (content, content_type). Retries 429 / 5xx / network errors with backoff."""
    stale_retried = False
    for attempt in range(GET_ATTEMPTS):
        last = attempt == GET_ATTEMPTS - 1
        key = await init_storage(force=stale_retried and attempt == 1)
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key})
        except httpx.TransportError:
            if last:
                raise
            await asyncio.sleep(_retry_wait(None, attempt))
            continue
        if resp.status_code == 404 and not stale_retried:
            stale_retried = True  # stale storage key — re-init once
            continue
        if (resp.status_code == 429 or resp.status_code >= 500) and not last:
            wait = _retry_wait(resp, attempt)
            logger.warning("Storage GET %s → %s, retry %d in %.1fs", path, resp.status_code, attempt + 1, wait)
            await asyncio.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    raise RuntimeError("unreachable")


def object_path(owner_id: str, object_id: str, ext: str) -> str:
    return f"{APP_NAME}/policies/{owner_id}/{object_id}{ext}"


async def delete_object(path: Optional[str]) -> bool:
    """Best-effort delete (used for rejected duplicates); never raises."""
    if not path:
        return False
    try:
        key = await init_storage()
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key})
        return resp.status_code < 300
    except Exception:
        logger.warning("Could not delete stored object %s", path)
        return False
