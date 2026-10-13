"""Receivable rules saved through any upload / editor are watched until every agent has a payable for them."""
from lib.db import db
from models.common import now_utc


async def note_receivable(rule_id: str) -> None:
    await db.payable_alerts.update_one(
        {"rule_id": rule_id}, {"$set": {"dismissed": False, "updated_at": now_utc()}, "$setOnInsert": {"rule_id": rule_id, "created_at": now_utc()}}, upsert=True)
