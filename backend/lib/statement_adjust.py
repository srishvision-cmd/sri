"""Premium outstanding deducted from an agent's commission statement → payment entry on each policy (idempotent)."""
from lib.dates import today_iso
from lib.db import db
from lib.history import history
from models.common import now_utc
from models.policy import PaymentEntry, Policy


def adjustment_ref(number: str) -> str:
    return f"Adjusted from commission {number}"


async def record_adjustments(s: dict, by_name: str, paid_on: str | None = None) -> int:
    """Record the deducted premium on every outstanding policy of statement `s` (dict) unless already recorded.
    Done at generation so Agent Outstanding drops at once and a second statement can't deduct the same premium again."""
    ref, n = adjustment_ref(s["number"]), 0
    for o in s.get("outstanding_lines") or []:
        if (o.get("deducted") or 0) <= 0:
            continue
        d = await db.policies.find_one({"id": o["policy_id"]}, {"_id": 0})
        if not d or any((p.get("reference") or "") == ref for p in d.get("payments") or []):
            continue
        amt = round(min(o["deducted"], Policy(**d).outstanding or 0), 2)
        if amt <= 0:
            continue
        entry = PaymentEntry(amount=amt, reference=ref, paid_on=paid_on or today_iso(), recorded_by_name=by_name)
        await db.policies.update_one(
            {"id": o["policy_id"]},
            {"$push": {"payments": entry.model_dump(), "history": {**history(None, "Payment recorded", f"₹{amt:,.2f} · deducted from commission {s['number']}"), "by_name": by_name}},
             "$set": {"updated_at": now_utc()}},
        )
        n += 1
    return n


async def reverse_adjustments(s: dict, user) -> None:
    """Statement deleted → take its deduction payments off the policies again."""
    ref = adjustment_ref(s["number"])
    ids = [o["policy_id"] for o in s.get("outstanding_lines") or [] if (o.get("deducted") or 0) > 0]
    if ids:
        await db.policies.update_many(
            {"id": {"$in": ids}, "payments.reference": ref},
            {"$pull": {"payments": {"reference": ref}}, "$push": {"history": history(user, "Payment removed", f"Statement {s['number']} deleted — premium deduction reversed")},
             "$set": {"updated_at": now_utc()}},
        )
