"""Payable rules: one rule per agent scope + conditions + dates.

`dedup_key` is a hash of that identity, set only on current (not superseded), active payable rules and backed by a
unique partial index, so the database itself refuses a second identical payable rule. Receivable rules never get a key.
"""
import hashlib
import json
import logging
from typing import Optional

from pymongo.errors import DuplicateKeyError

from lib.commission import signature
from lib.db import db
from models.commission import CommissionRuleIn

log = logging.getLogger("payable_dedup")
INDEX = "payable_dedup_unique"


# older rule documents miss fields added later (cover, fuel_types …) — read them with the model's defaults so
# "missing" and "default" compare equal (cover missing == "any")
_DEFAULTS = {k: f.get_default(call_default_factory=True) for k, f in CommissionRuleIn.model_fields.items() if not f.is_required()}


def ident(r: dict) -> tuple:
    """Same conditions + same agent scope + same start date = the same rule (rates are not part of it)."""
    r = {**_DEFAULTS, **{k: v for k, v in r.items() if v is not None}}
    return (r["kind"], r.get("agent_group") or "", r.get("agent_id") or "", r.get("valid_from") or "", *signature(r))


def payable_key(r: dict) -> Optional[str]:
    if r.get("kind") != "payable" or r.get("superseded_by") or r.get("active") is False:
        return None
    return hashlib.sha1(json.dumps([*ident(r), r.get("valid_to") or ""], default=str).encode()).hexdigest()


async def ensure_index() -> None:
    try:
        await db.commission_rules.create_index("dedup_key", unique=True, name=INDEX, partialFilterExpression={"dedup_key": {"$exists": True}})
    except Exception as exc:  # never block startup
        log.warning("Could not create %s: %s", INDEX, exc)


async def sync_keys(query: dict) -> int:
    """Recompute dedup_key for the payable rules matching `query`. An existing duplicate (left from before the index)
    simply stays without a key — it is listed by the duplicate finder; nothing is deleted here."""
    clashes = 0
    async for d in db.commission_rules.find({**query, "kind": "payable"}, {"_id": 0}):
        k = payable_key(d)
        if k == d.get("dedup_key"):
            continue
        if k is None:
            await db.commission_rules.update_one({"id": d["id"]}, {"$unset": {"dedup_key": ""}})
            continue
        try:
            await db.commission_rules.update_one({"id": d["id"]}, {"$set": {"dedup_key": k}})
        except DuplicateKeyError:
            clashes += 1
            await db.commission_rules.update_one({"id": d["id"]}, {"$unset": {"dedup_key": ""}})
            log.warning("Payable rule %s (%s) duplicates another rule — left without dedup_key", d["id"], d.get("name"))
    return clashes


async def setup() -> None:
    await ensure_index()
    n = await sync_keys({})
    log.info("Payable dedup keys synced (%s existing duplicates without key)", n)
