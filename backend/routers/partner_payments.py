"""Partner partial payments (oldest outstanding first) + the payment typed at upload (checked against the premium)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_roles
from lib.db import db
from lib.history import history
from models.common import now_utc
from models.policy import PaymentEntry, Policy
from models.recon import Allocation, PartnerPaymentIn, Settlement, UploadPaymentAction
from models.user import User
from routers.recon import _party_name, _policies, _row

router = APIRouter(tags=["recon"])
admin_only = require_roles("admin")
PENDING = ("uploaded", "processing", "duplicate", "failed")  # a duplicate / unread upload never takes the payment — it keeps waiting


async def _outstanding(agent_id: str) -> float:
    return round(sum(r.outstanding for p in await _policies("agent", agent_id) if (r := _row(p, "agent"))), 2)


async def _oldest_first(agent_id: str, amount: float, first: Optional[str] = None) -> tuple[list[Allocation], float]:
    """Spread `amount` over the partner's outstanding policies, `first` policy first, then oldest first (each ≤ its outstanding)."""
    rows = [r for p in await _policies("agent", agent_id) if (r := _row(p, "agent")) and r.outstanding > 0]
    rows.sort(key=lambda r: r.policy_id != first)  # stable: keeps oldest-first order for the rest
    left, allocs = round(amount, 2), []
    for r in rows:
        if left <= 0:
            break
        amt = round(min(left, r.outstanding), 2)
        left = round(left - amt, 2)
        allocs.append(Allocation(policy_id=r.policy_id, policy_number=r.policy_number, reg_no=r.reg_no, amount=amt))
    return allocs, left


async def _write(s: Settlement, label_ref: str) -> Settlement:
    for a in s.allocations:
        entry = PaymentEntry(amount=a.amount, reference=label_ref, paid_on=s.paid_on, recorded_by_name=s.created_by_name, settlement_id=s.id)
        await db.policies.update_one({"id": a.policy_id}, {"$push": {"payments": entry.model_dump(),
                                                                     "history": history(None, "Premium received from partner", f"₹{a.amount:,.2f} · {label_ref}")},
                                                         "$set": {"updated_at": now_utc()}})
    s.balance_after = await _outstanding(s.party_id)
    await db.premium_settlements.insert_one(s.model_dump())
    return s


@router.post("/recon/partner-payment", response_model=Settlement)
async def record_partner_payment(body: PartnerPaymentIn, user: User = Depends(admin_only)):
    """Partial payment from a partner — clears the oldest outstanding policies first; any extra stays on-account."""
    name = await _party_name("agent", body.agent_id)
    allocs, left = await _oldest_first(body.agent_id, body.amount)
    s = Settlement(kind="agent", party_id=body.agent_id, party_name=name, amount=round(body.amount, 2), mode=body.mode,
                   reference=(body.reference or "").strip() or None, paid_on=body.paid_on, allocations=allocs, unallocated=left,
                   created_by_name=user.full_name, note="Partial payment · oldest outstanding first")
    ref = f"{body.mode}{' · ' + s.reference if s.reference else ''} · batch {s.id[:8]}"
    return await _write(s, ref)


@router.get("/recon/partner-payments/{agent_id}", response_model=List[Settlement])
async def partner_payment_log(agent_id: str, _: User = Depends(admin_only)):
    docs = await db.premium_settlements.find({"kind": "agent", "party_id": agent_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Settlement(**d) for d in docs]


# ---------- payment typed at upload ----------
async def apply_upload_payment(policy_id: str) -> None:
    """Once the premium is known: apply the held upload payment if it is within the premium, else ask the admin to approve."""
    doc = await db.policies.find_one({"id": policy_id, "upload_payment.status": "waiting"}, {"_id": 0})
    if not doc or doc.get("is_deleted") or doc.get("status") in PENDING:
        return
    gross = (doc.get("fields") or {}).get("gross_premium")
    if gross is None:
        return
    up = doc["upload_payment"]
    if up["amount"] <= gross + 0.009:
        entry = PaymentEntry(amount=up["amount"], reference=up.get("reference"), paid_on=up["paid_on"], recorded_by_name=up["recorded_by_name"])
        await db.policies.update_one({"id": policy_id, "upload_payment.status": "waiting"},
                                     {"$push": {"payments": entry.model_dump(), "history": history(None, "Payment at upload applied", f"₹{up['amount']:,.2f}")},
                                      "$unset": {"upload_payment": ""}, "$set": {"updated_at": now_utc()}})
        return
    await db.policies.update_one({"id": policy_id, "upload_payment.status": "waiting"},
                                 {"$set": {"upload_payment.status": "needs_approval", "upload_payment.gross": gross, "updated_at": now_utc()},
                                  "$push": {"history": history(None, "Payment above premium", f"₹{up['amount']:,.2f} entered · premium ₹{gross:,.2f} — waiting for admin approval")}})


@router.post("/policies/{id}/upload-payment", response_model=Policy)
async def act_on_upload_payment(id: str, body: UploadPaymentAction, user: User = Depends(admin_only)):
    doc = await db.policies.find_one({"id": id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc or not doc.get("upload_payment"):
        raise HTTPException(status_code=404, detail="No upload payment waiting on this policy")
    up = doc["upload_payment"]
    if body.action == "discard":
        await db.policies.update_one({"id": id}, {"$unset": {"upload_payment": ""}, "$push": {"history": history(user, "Upload payment discarded", f"₹{up['amount']:,.2f}")}})
    elif body.action == "correct":
        if not body.amount:
            raise HTTPException(status_code=400, detail="Enter the correct amount")
        await db.policies.update_one({"id": id}, {"$set": {"upload_payment.amount": round(body.amount, 2), "upload_payment.status": "waiting"},
                                                  "$push": {"history": history(user, "Upload payment corrected", f"₹{up['amount']:,.2f} → ₹{body.amount:,.2f}")}})
        await apply_upload_payment(id)
    else:
        if up.get("status") != "needs_approval":
            raise HTTPException(status_code=409, detail="This payment does not need approval")
        claimed = await db.policies.find_one_and_update({"id": id, "upload_payment.status": "needs_approval"}, {"$unset": {"upload_payment": ""}})
        if not claimed:
            raise HTTPException(status_code=409, detail="Already handled")
        p = Policy(**doc)
        allocs, left = await _oldest_first(p.agent_id, up["amount"], first=id)
        own = next((a.amount for a in allocs if a.policy_id == id), 0)
        excess = round(up["amount"] - own, 2)
        pol_no = p.fields.policy_number or p.fields.vehicle_reg_no or p.file_name
        note = f"Excess ₹{excess:,.2f} adjusted from policy {pol_no} dated {up['paid_on']}" if excess > 0 else None
        s = Settlement(kind="agent", party_id=p.agent_id, party_name=await _party_name("agent", p.agent_id), amount=up["amount"], mode="Paid at upload",
                       reference=up.get("reference"), paid_on=up["paid_on"], allocations=allocs, unallocated=left,
                       created_by_name=user.full_name, note=note)
        ref = f"Paid at upload (approved){' · ' + s.reference if s.reference else ''}{' · excess from ' + pol_no if excess > 0 else ''} · batch {s.id[:8]}"
        await _write(s, ref)
        await db.policies.update_one({"id": id}, {"$push": {"history": history(user, "Upload payment approved", f"₹{up['amount']:,.2f} vs premium ₹{(up.get('gross') or 0):,.2f}" + (f" · {note}" if note else ""))}})
    return Policy(**await db.policies.find_one({"id": id}, {"_id": 0}))
