"""One-time go-live reset: wipe every demo/test policy and user, then create the first real admin.

Runs on startup but only once per database — guarded by a marker doc in `app_state`, so later
restarts/deploys never touch live data. Admin credentials come from backend/.env.
"""

import logging
import os

from lib.auth import hash_password
from lib.db import db
from models.common import now_utc
from models.user import User

logger = logging.getLogger(__name__)
MARKER = "live_reset_v1"


async def run_live_reset_once() -> None:
    username = (os.environ.get("BOOTSTRAP_ADMIN_USERNAME") or "").strip().lower()
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD") or ""
    if not username or not password:
        return
    # claim the marker atomically first so concurrent workers can't both run the wipe
    res = await db.app_state.update_one({"_id": MARKER}, {"$setOnInsert": {"started_at": now_utc()}}, upsert=True)
    if res.upserted_id is None:
        return
    p = await db.policies.delete_many({})
    u = await db.users.delete_many({})
    admin = User(
        username=username,
        full_name=os.environ.get("BOOTSTRAP_ADMIN_FULL_NAME") or username.title(),
        role="admin",
        branch=os.environ.get("BOOTSTRAP_ADMIN_BRANCH") or None,
        must_change_password=True,
    )
    await db.users.insert_one({**admin.model_dump(), "password_hash": hash_password(password)})
    await db.app_state.update_one({"_id": MARKER}, {"$set": {"done_at": now_utc(), "policies_deleted": p.deleted_count, "users_deleted": u.deleted_count}})
    logger.info("Go-live reset: removed %d policies and %d users, created admin %s", p.deleted_count, u.deleted_count, username)
