"""Non-destructive first-admin bootstrap.

On startup, if the database has NO admin account yet, create one from backend/.env
(BOOTSTRAP_ADMIN_*). Never deletes or modifies existing users or policies.
"""

import logging
import os

from lib.auth import hash_password
from lib.db import db
from models.user import User

logger = logging.getLogger(__name__)


async def ensure_bootstrap_admin() -> None:
    username = (os.environ.get("BOOTSTRAP_ADMIN_USERNAME") or "").strip().lower()
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD") or ""
    if not username or not password:
        return
    if await db.users.find_one({"role": "admin"}, {"_id": 1}):
        return  # an admin already exists — nothing to do
    admin = User(
        username=username,
        full_name=os.environ.get("BOOTSTRAP_ADMIN_FULL_NAME") or username.title(),
        role="admin",
        branch=os.environ.get("BOOTSTRAP_ADMIN_BRANCH") or None,
        must_change_password=True,
    )
    # upsert on username (unique) so concurrent workers can't create two admins
    res = await db.users.update_one(
        {"username": username},
        {"$setOnInsert": {**admin.model_dump(), "password_hash": hash_password(password)}},
        upsert=True,
    )
    if res.upserted_id is not None:
        logger.info("Created bootstrap admin %s", username)
