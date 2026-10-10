"""One-time data fixes, run in the background at startup (each guarded by a flag in db.migrations)."""
import logging

from lib.db import db
from models.common import now_utc
from models.policy import product_category

logger = logging.getLogger(__name__)


async def _fix_3w_categories() -> int:
    """'Auto Secure' product names were read as 3-wheelers — re-derive every policy tagged 3W."""
    fixed = 0
    q = {"fields.product_category": {"$in": ["PCV - 3W Auto", "GCV - 3W Goods Carrying"]}}
    async for d in db.policies.find(q, {"_id": 0, "id": 1, "fields": 1}):
        f = d.get("fields") or {}
        hint = " ".join(str(f.get(k) or "") for k in ("product_name", "plan_name"))
        new = product_category(f, hint, True)
        if new and new != f.get("product_category"):
            await db.policies.update_one({"id": d["id"]}, {
                "$set": {"fields.product_category": new, "updated_at": now_utc()},
                "$push": {"history": {"at": now_utc(), "by_name": "System", "by_role": "system", "action": "Product corrected",
                                      "note": f"{f.get('product_category')} → {new} (3-wheeler detection fix)"}},
            })
            fixed += 1
    return fixed


MIGRATIONS = [("fix_3w_categories_v1", _fix_3w_categories)]


async def run_migrations() -> None:
    for key, fn in MIGRATIONS:
        try:
            if await db.migrations.find_one({"key": key}):
                continue
            n = await fn()
            await db.migrations.insert_one({"key": key, "done_at": now_utc(), "changed": n})
            logger.info("Migration %s done (%s changed)", key, n)
        except Exception:
            logger.exception("Migration %s failed", key)
