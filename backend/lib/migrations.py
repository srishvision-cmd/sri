"""One-time data fixes, run in the background at startup (each guarded by a flag in db.migrations)."""
import logging

from lib.db import db
from models.common import now_utc
from models.policy import age_bucket, product_category, vehicle_age

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


async def _recap_vehicle_age() -> int:
    """Re-derive vehicle age with year capping (5y 1d → 6) on every existing policy."""
    fixed = 0
    async for d in db.policies.find({"fields.start_date": {"$nin": [None, ""]}}, {"_id": 0, "id": 1, "fields": 1}):
        f = d.get("fields") or {}
        age = vehicle_age(f.get("start_date"), f.get("registration_date"), f.get("mfg_year"))
        bucket = age_bucket(age) if age is not None else None
        if age != f.get("vehicle_age_years") or bucket != f.get("vehicle_age_bucket"):
            await db.policies.update_one({"id": d["id"]}, {"$set": {"fields.vehicle_age_years": age, "fields.vehicle_age_bucket": bucket}})
            fixed += 1
    return fixed


async def _rule_makes_and_long_term() -> int:
    """Rules: single `make` → `makes` list; product 'Private Car 1+5 (Long Term)' renamed to '3+3'."""
    old, new = "Private Car 1+5 (Long Term)", "Private Car 3+3 (Long Term)"
    n = 0
    async for r in db.commission_rules.find({"make": {"$exists": True}}, {"_id": 0, "id": 1, "make": 1}):
        await db.commission_rules.update_one({"id": r["id"]}, {"$set": {"makes": [r["make"]] if r.get("make") else []}, "$unset": {"make": ""}})
        n += 1
    n += (await db.commission_rules.update_many({"products": old}, {"$set": {"products.$": new}})).modified_count
    n += (await db.policies.update_many({"fields.product_category": old}, {"$set": {"fields.product_category": new}})).modified_count
    return n


async def _business_type_backfill() -> int:
    """Existing policies: New where the vehicle is clearly new (or Renewal/Rollover if a previous insurer was read); others stay blank to edit."""
    from lib.business_type import infer_business_type
    n = 0
    async for d in db.policies.find({"fields.business_type": {"$in": [None, ""]}}, {"_id": 0, "id": 1, "fields": 1}):
        bt = infer_business_type(d.get("fields") or {}, allow_used=False)
        if bt:
            await db.policies.update_one({"id": d["id"]}, {"$set": {"fields.business_type": bt}})
            n += 1
    return n


async def _pcv_subtypes() -> int:
    """'PCV - Others' policies: re-derive with seats / usage (Taxi ≤7, Maxi Cab 8-12, Bus 13+, School / Staff Bus)."""
    n = 0
    async for d in db.policies.find({"fields.product_category": "PCV - Others"}, {"_id": 0, "id": 1, "fields": 1}):
        f = d.get("fields") or {}
        hint = " ".join(str(f.get(k) or "") for k in ("product_name", "plan_name"))
        new = product_category(f, hint, True)
        if new and new != "PCV - Others":
            await db.policies.update_one({"id": d["id"]}, {
                "$set": {"fields.product_category": new, "updated_at": now_utc()},
                "$push": {"history": {"at": now_utc(), "by_name": "System", "by_role": "system", "action": "Product corrected",
                                      "note": f"PCV - Others → {new} (seating / usage detection)"}},
            })
            n += 1
    return n


async def _rule_broker_ids() -> int:
    """Rules: single `broker_id` → `broker_ids` list (a rule can now cover several channel partners)."""
    n = 0
    async for r in db.commission_rules.find({"broker_id": {"$exists": True}}, {"_id": 0, "id": 1, "broker_id": 1, "broker_ids": 1}):
        ids = r.get("broker_ids") or ([r["broker_id"]] if r.get("broker_id") else [])
        await db.commission_rules.update_one({"id": r["id"]}, {"$set": {"broker_ids": ids}, "$unset": {"broker_id": ""}})
        n += 1
    return n


MIGRATIONS = [("fix_3w_categories_v1", _fix_3w_categories), ("vehicle_age_capping_v1", _recap_vehicle_age),
              ("rule_makes_long_term_v1", _rule_makes_and_long_term),
              ("business_type_backfill_v1", _business_type_backfill), ("rule_broker_ids_v1", _rule_broker_ids), ("pcv_subtypes_v1", _pcv_subtypes)]


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
