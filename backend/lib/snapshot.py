"""Permanent commission snapshots: helpers shared by the policy router (corrections) and the admin recalculation router."""
import logging
from typing import Iterable, Optional

from lib.commission import commissions_for
from lib.db import db
from lib.history import history
from models.commission import CommissionResult
from models.recalc import CommissionAudit, CommissionValues
from models.user import User

logger = logging.getLogger(__name__)


def values_of(res: Optional[CommissionResult]) -> CommissionValues:
    res = res or CommissionResult()
    return CommissionValues(**{k: getattr(res, k) for k in CommissionValues.model_fields})


def blocked_reason(doc: dict) -> Optional[str]:
    """Settled commission must never move: policies on a commission statement or with a confirmed on-spot deduction."""
    if doc.get("commission_statement_id"):
        return f"On commission statement {doc.get('commission_statement_no') or ''} — delete the unpaid statement first".replace("  ", " ")
    if doc.get("payment_mode") == "Net of Commission" and doc.get("onspot_status") == "confirmed":
        return "On-spot commission already deducted and bank-confirmed"
    if doc.get("status") not in ("extracted", "verified", "flagged"):
        return f"Policy is {doc.get('status')}"
    return None


async def fresh_values(doc: dict) -> CommissionResult:
    """What today's grid would give this policy (no snapshot read or written)."""
    clean = {k: v for k, v in doc.items() if k != "commission_lock"}
    return (await commissions_for([clean], lock=False)).get(doc["id"]) or CommissionResult()


async def resnapshot(doc: dict, user: Optional[User], action: str, reason: Optional[str], batch_id: Optional[str] = None) -> tuple[CommissionValues, CommissionValues]:
    """Replace ONE policy's snapshot with today's grid and log old → new (history + commission_audit)."""
    before = values_of((await commissions_for([doc], lock=False)).get(doc["id"]))
    await db.policies.update_one({"id": doc["id"]}, {"$unset": {"commission_lock": ""}})
    fresh = await db.policies.find_one({"id": doc["id"]}, {"_id": 0, "history": 0})
    after = values_of((await commissions_for([fresh])).get(doc["id"]))
    if before != after or action == "admin_recalculate":
        audit = CommissionAudit(
            batch_id=batch_id, policy_id=doc["id"], policy_number=(doc.get("fields") or {}).get("policy_number"), action=action, reason=reason,
            by_id=user.id if user else None, by_name=user.full_name if user else "System", by_role=user.role if user else "system",
            before=before, after=after)
        await db.commission_audit.insert_one(audit.model_dump())
        note = (f"Receivable {_money(before.receivable)} → {_money(after.receivable)}; payable {_money(before.payable)} → {_money(after.payable)}"
                + (f" · Reason: {reason}" if reason else ""))
        await db.policies.update_one({"id": doc["id"]}, {"$push": {"history": history(user, "Commission recalculated" if action == "admin_recalculate" else "Commission re-snapshotted", note)}})
    return before, after


async def refresh_after_correction(policy_ids: Iterable[str], user: User, what: str) -> None:
    """Policy data corrected during review (fields / channel partner / agent) → refresh the snapshot of THAT policy only.
    Verified or settled policies keep their snapshot — only an admin 'Recalculate' changes them."""
    for pid in policy_ids:
        doc = await db.policies.find_one({"id": pid}, {"_id": 0, "history": 0})
        if not doc or doc.get("status") == "verified" or blocked_reason(doc):
            continue
        try:
            await resnapshot(doc, user, "policy_corrected", f"Policy data corrected ({what}) before verification")
        except Exception:
            logger.exception("Snapshot refresh failed for %s", pid)


async def snapshot_new(policy_id: str) -> None:
    """Freeze commission as soon as a policy enters MIS (OCR read / manual entry)."""
    doc = await db.policies.find_one({"id": policy_id}, {"_id": 0, "history": 0})
    if doc:
        try:
            await commissions_for([doc])
        except Exception:
            logger.exception("Commission snapshot failed for %s", policy_id)


def _money(v) -> str:
    return "—" if v is None else f"₹{v:,.2f}"
