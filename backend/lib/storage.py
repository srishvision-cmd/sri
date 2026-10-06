"""Emergent Object Storage: put/get bytes. All access goes through the backend (no presigned URLs)."""

import logging
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
    for attempt in range(2):
        key = await init_storage(force=attempt == 1)
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.put(
                f"{STORAGE_URL}/objects/{path}",
                headers={"X-Storage-Key": key, "Content-Type": content_type},
                content=data,
            )
        if resp.status_code == 404 and attempt == 0:
            continue  # stale storage key — re-init once
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("unreachable")


async def get_object(path: str) -> tuple[bytes, str]:
    """Download bytes. Returns (content, content_type)."""
    for attempt in range(2):
        key = await init_storage(force=attempt == 1)
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key})
        if resp.status_code == 404 and attempt == 0:
            continue
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    raise RuntimeError("unreachable")


def object_path(owner_id: str, object_id: str, ext: str) -> str:
    return f"{APP_NAME}/policies/{owner_id}/{object_id}{ext}"
