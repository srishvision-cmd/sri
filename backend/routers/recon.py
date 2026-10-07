"""Premium reconciliation: agent → Srishvision (agent's outstanding) and Srishvision → broker (premium remitted)."""

import io
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from lib.auth import require_roles
from lib.db import db
from models.common import now_utc
from models.policy import OUTSTANDING_MODES, PaymentEntry, Policy
from models.recon import Allocation, ReconKind, ReconParty, ReconPolicy, Settlement, SettlementIn
from models.user import User
from routers.policies import history

router = APIRouter(prefix="/recon", tags=["recon"])
admin_only = require_roles("admin")
LIVE = {"is_deleted": {"$ne": True}, "status": {"$nin": ["duplicate", "processing", "failed"]}}


def _row(p: Policy, kind: ReconKind) -> Optional[ReconPolicy]:
    gross = p.fields.gross_premium
    if gross is None:
        return None
    if kind == "agent":
        if p.payment_mode not in OUTSTANDING_MODES:
            return None
        paid, out = p.amount_paid or 0, p.outstanding or 0
    else:
        paid, out = p.broker_paid, p.broker_outstanding or 0
    return ReconPolicy(policy_id=p.id, policy_number=p.fields.policy_number, reg_no=p.fields.vehicle_reg_no, insured_name=p.fields.insured_name,
                       insurer=p.fields.insurer, uploaded_on=p.created_at.strftime("%Y-%m-%d"), premium=gross, paid=round(paid, 2), outstanding=round(out, 2))


async def _policies(kind: ReconKind, party_id: Optional[str] = None) -> List[Policy]:
    q: dict = {**LIVE}
    if kind == "agent":
        q["payment_mode"] = {"$in": OUTSTANDING_MODES}
        if party_id:
            q["agent_id"] = party_id
    else:
        q["broker_id"] = {"$nin": [None, ""]} if not party_id else party_id
    return [Policy(**d) for d in await db.policies.find(q, {"_id": 0}).sort("created_at", 1).to_list(20000)]


async def _party_name(kind: ReconKind, party_id: str) -> str:
    doc = await (db.users if kind == "agent" else db.brokers).find_one({"id": party_id}, {"_id": 0, "full_name": 1, "name": 1, "username": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Agent not found" if kind == "agent" else "Broker not found")
    return f"{doc['full_name']} ({doc['username'].upper()})" if kind == "agent" else doc["name"]


@router.get("/summary", response_model=List[ReconParty])
async def summary(kind: ReconKind, _: User = Depends(admin_only)):
    parties: dict = {}
    for p in await _policies(kind):
        r = _row(p, kind)
        if not r:
            continue
        pid, name = (p.agent_id, f"{p.agent_name} ({p.agent_code})") if kind == "agent" else (p.broker_id, p.broker_name or "")
        g = parties.setdefault(pid, ReconParty(party_id=pid, party_name=name, policies=0, premium=0, paid=0, outstanding=0, outstanding_policies=0))
        g.policies += 1
        g.premium = round(g.premium + r.premium, 2)
        g.paid = round(g.paid + r.paid, 2)
        g.outstanding = round(g.outstanding + r.outstanding, 2)
        g.outstanding_policies += 1 if r.outstanding > 0 else 0
    return sorted(parties.values(), key=lambda g: g.outstanding, reverse=True)


@router.get("/policies", response_model=List[ReconPolicy])
async def party_policies(kind: ReconKind, party_id: str, only_outstanding: bool = False, _: User = Depends(admin_only)):
    rows = [r for p in await _policies(kind, party_id) if (r := _row(p, kind))]
    return [r for r in rows if r.outstanding > 0] if only_outstanding else rows


@router.get("/settlements", response_model=List[Settlement])
async def settlements(kind: ReconKind, party_id: Optional[str] = None, _: User = Depends(admin_only)):
    q: dict = {"kind": kind, **({"party_id": party_id} if party_id else {})}
    return [Settlement(**d) for d in await db.premium_settlements.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)]


@router.post("/settlements", response_model=Settlement)
async def record_settlement(body: SettlementIn, user: User = Depends(admin_only)):
    """One lump-sum receipt / remittance allocated across policies (chosen ones in order, else oldest first)."""
    name = await _party_name(body.kind, body.party_id)
    rows = {r.policy_id: r for p in await _policies(body.kind, body.party_id) if (r := _row(p, body.kind)) and r.outstanding > 0}
    order = [i for i in body.policy_ids if i in rows] if body.policy_ids else list(rows)
    if body.policy_ids and len(order) != len(set(body.policy_ids)):
        raise HTTPException(status_code=400, detail="Some selected policies have no outstanding for this party")
    total = round(sum(rows[i].outstanding for i in order), 2)
    if not order:
        raise HTTPException(status_code=400, detail="Nothing outstanding to settle")
    if body.amount > total + 0.009:
        raise HTTPException(status_code=400, detail=f"Amount ₹{body.amount:,.2f} is more than the outstanding ₹{total:,.2f} of the selected policies")
    left, allocs = round(body.amount, 2), []
    for pid in order:
        if left <= 0:
            break
        amt = round(min(left, rows[pid].outstanding), 2)
        left = round(left - amt, 2)
        allocs.append(Allocation(policy_id=pid, policy_number=rows[pid].policy_number, reg_no=rows[pid].reg_no, amount=amt))
    s = Settlement(kind=body.kind, party_id=body.party_id, party_name=name, amount=round(body.amount, 2), mode=body.mode,
                   reference=(body.reference or "").strip() or None, paid_on=body.paid_on, allocations=allocs, created_by_name=user.full_name)
    field = "payments" if body.kind == "agent" else "broker_payments"
    label = "Premium received from agent" if body.kind == "agent" else "Premium paid to broker"
    for a in allocs:
        ref = f"{body.mode}{' · ' + s.reference if s.reference else ''} · batch {s.id[:8]}"
        entry = PaymentEntry(amount=a.amount, reference=ref, paid_on=body.paid_on, recorded_by_name=user.full_name)
        await db.policies.update_one({"id": a.policy_id}, {"$push": {field: entry.model_dump(), "history": history(user, label, f"₹{a.amount:,.2f} · {ref}")},
                                                         "$set": {"updated_at": now_utc()}})
    await db.premium_settlements.insert_one(s.model_dump())
    return s


@router.get("/export")
async def export(kind: ReconKind, party_id: str, _: User = Depends(admin_only)):
    name = await _party_name(kind, party_id)
    rows = [r for p in await _policies(kind, party_id) if (r := _row(p, kind))]
    sets = await db.premium_settlements.find({"kind": kind, "party_id": party_id}, {"_id": 0}).sort("paid_on", 1).to_list(2000)
    wb = Workbook()
    ws = wb.active
    ws.title = "Recon"
    hdr = lambda: [setattr(c, "font", Font(bold=True, color="FFFFFF")) or setattr(c, "fill", PatternFill("solid", fgColor="1E3A5F")) for c in ws[ws.max_row]]  # noqa: E731
    title = "Agent → Srishvision premium recon" if kind == "agent" else "Srishvision → Broker premium recon"
    ws.append([f"{title} · {name}"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([])
    ws.append(["Policy No", "Reg No", "Insured", "Insurer", "Uploaded", "Premium", "Paid", "Outstanding"])
    hdr()
    for r in rows:
        ws.append([r.policy_number, r.reg_no, r.insured_name, r.insurer, r.uploaded_on, r.premium, r.paid, r.outstanding])
        ws.cell(ws.max_row, 1).number_format = "@"
    ws.append(["TOTAL", "", "", "", "", round(sum(r.premium for r in rows), 2), round(sum(r.paid for r in rows), 2), round(sum(r.outstanding for r in rows), 2)])
    for c in ws[ws.max_row]:
        c.font = Font(bold=True)
    ws.append([])
    ws.append(["Settlements"])
    ws.cell(ws.max_row, 1).font = Font(bold=True)
    ws.append(["Date", "Mode", "Reference", "Amount", "Policies (amount)"])
    hdr()
    for s in sets:
        ws.append([s["paid_on"], s["mode"], s.get("reference"), s["amount"], ", ".join(f"{a.get('policy_number')} ({a['amount']:,.0f})" for a in s["allocations"])])
    for col, w in zip("ABCDEFGH", (28, 14, 26, 26, 12, 14, 14, 14)):
        ws.column_dimensions[col].width = w
    out = io.BytesIO()
    wb.save(out)
    safe = "".join(ch if ch.isalnum() else "_" for ch in name)[:40]
    return Response(out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="Recon_{kind}_{safe}.xlsx"'})
