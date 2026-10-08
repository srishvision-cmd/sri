"""Premium reconciliation: agent → Srishvision (agent's outstanding) and Srishvision → broker (premium remitted)."""

import io
from datetime import date, datetime, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from lib.auth import require_roles
from lib.db import db
from models.common import now_utc
from lib.commission import commissions_for
from models.policy import OUTSTANDING_MODES, PaymentEntry, Policy, effective_broker_mode
from models.recon import Allocation, BrokerStatement, BrokerStatementRow, ReconKind, ReconParty, ReconPolicy, Settlement, SettlementIn
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


async def _on_account(kind: ReconKind, party_id: Optional[str] = None) -> dict:
    """Unallocated balance per party = Σ unallocated of live batches − Σ On-account batches."""
    q: dict = {"kind": kind, "reversed": {"$ne": True}, **({"party_id": party_id} if party_id else {})}
    bal: dict = {}
    async for s in db.premium_settlements.find(q, {"_id": 0, "party_id": 1, "mode": 1, "amount": 1, "unallocated": 1}):
        delta = -s["amount"] if s["mode"] == "On-account" else s.get("unallocated", 0)
        bal[s["party_id"]] = round(bal.get(s["party_id"], 0) + delta, 2)
    return bal


@router.get("/summary", response_model=List[ReconParty])
async def summary(kind: ReconKind, _: User = Depends(admin_only)):
    credit = await _on_account(kind)
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
    for g in parties.values():
        g.on_account = credit.get(g.party_id, 0)
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
    """One lump-sum receipt / remittance.

    Single outstanding case → applied automatically (excess kept on-account).
    Multiple outstanding cases → caller must pick the cases and type the amount for each.
    Any amount not allocated stays as the party's on-account balance; mode "On-account" spends that balance.
    """
    name = await _party_name(body.kind, body.party_id)
    rows = {r.policy_id: r for p in await _policies(body.kind, body.party_id) if (r := _row(p, body.kind)) and r.outstanding > 0}
    amount = round(body.amount, 2)
    on_acc = body.mode == "On-account"
    if on_acc:
        bal = (await _on_account(body.kind, body.party_id)).get(body.party_id, 0)
        if amount > bal + 0.009:
            raise HTTPException(status_code=400, detail=f"On-account balance is only ₹{bal:,.2f}")
    plan: list[tuple[str, float]] = []
    if body.allocations:
        seen = set()
        for a in body.allocations:
            if a.policy_id not in rows or a.policy_id in seen:
                raise HTTPException(status_code=400, detail="Some selected policies have no outstanding for this party")
            seen.add(a.policy_id)
            r = rows[a.policy_id]
            if a.amount > r.outstanding + 0.009:
                raise HTTPException(status_code=400, detail=f"₹{a.amount:,.2f} is more than the outstanding ₹{r.outstanding:,.2f} on {r.policy_number or r.reg_no}")
            plan.append((a.policy_id, round(a.amount, 2)))
    elif len(rows) > 1:
        raise HTTPException(status_code=400, detail=f"{len(rows)} cases are outstanding — select the cases and enter the amount for each")
    elif len(rows) == 1:
        pid = next(iter(rows))
        plan.append((pid, round(min(amount, rows[pid].outstanding), 2)))
    allocated = round(sum(a for _, a in plan), 2)
    if allocated > amount + 0.009:
        raise HTTPException(status_code=400, detail=f"Case amounts ₹{allocated:,.2f} are more than the payment ₹{amount:,.2f}")
    if on_acc and (not plan or abs(allocated - amount) > 0.009):
        raise HTTPException(status_code=400, detail="On-account adjustment must be fully allocated to cases")
    allocs = [Allocation(policy_id=pid, policy_number=rows[pid].policy_number, reg_no=rows[pid].reg_no, amount=amt) for pid, amt in plan]
    s = Settlement(kind=body.kind, party_id=body.party_id, party_name=name, amount=amount, mode=body.mode,
                   reference=(body.reference or "").strip() or None, paid_to=body.paid_to if body.kind == "broker" else None, paid_on=body.paid_on, allocations=allocs,
                   unallocated=0 if on_acc else round(amount - allocated, 2), created_by_name=user.full_name)
    field = "payments" if body.kind == "agent" else "broker_payments"
    label = "Premium received from agent" if body.kind == "agent" else "Premium paid to broker"
    for a in allocs:
        ref = f"{body.mode}{' · ' + s.reference if s.reference else ''}{' · to ' + s.paid_to if s.paid_to else ''} · batch {s.id[:8]}"
        entry = PaymentEntry(amount=a.amount, reference=ref, paid_on=body.paid_on, recorded_by_name=user.full_name, settlement_id=s.id)
        await db.policies.update_one({"id": a.policy_id}, {"$push": {field: entry.model_dump(), "history": history(user, label, f"₹{a.amount:,.2f} · {ref}")},
                                                         "$set": {"updated_at": now_utc()}})
    await db.premium_settlements.insert_one(s.model_dump())
    return s


@router.post("/settlements/{id}/reverse", response_model=Settlement)
async def reverse_settlement(id: str, user: User = Depends(admin_only)):
    """Undo a whole batch: removes its payment entries from every case so their outstanding comes back."""
    doc = await db.premium_settlements.find_one({"id": id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Settlement not found")
    s = Settlement(**doc)
    if s.reversed:
        raise HTTPException(status_code=409, detail="Settlement already reversed")
    if s.unallocated > 0:
        bal = (await _on_account(s.kind, s.party_id)).get(s.party_id, 0)
        if bal - s.unallocated < -0.009:
            raise HTTPException(status_code=409, detail="Its on-account balance was already used — reverse the On-account batch first")
    field = "payments" if s.kind == "agent" else "broker_payments"
    tag = f"batch {s.id[:8]}"
    for a in s.allocations:
        pol = await db.policies.find_one({"id": a.policy_id}, {"_id": 0, field: 1})
        keep = [e for e in (pol or {}).get(field, []) if not (e.get("settlement_id") == s.id or (not e.get("settlement_id") and tag in (e.get("reference") or "")))]
        await db.policies.update_one({"id": a.policy_id}, {"$set": {field: keep, "updated_at": now_utc()},
                                                         "$push": {"history": history(user, "Settlement reversed", f"₹{a.amount:,.2f} · {tag}")}})
    s.reversed, s.reversed_by_name, s.reversed_at = True, user.full_name, now_utc()
    await db.premium_settlements.update_one({"id": id}, {"$set": {"reversed": True, "reversed_by_name": s.reversed_by_name, "reversed_at": s.reversed_at}})
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
    ws.append(["Date", "Mode", "Reference", "Amount", "On-account", "Status", "Policies (amount)"])
    hdr()
    for s in sets:
        ws.append([s["paid_on"], s["mode"], s.get("reference"), s["amount"], s.get("unallocated", 0), "Reversed" if s.get("reversed") else "Active",
                   ", ".join(f"{a.get('policy_number')} ({a['amount']:,.0f})" for a in s["allocations"])])
    ws.append([])
    ws.append(["On-account balance", "", "", (await _on_account(kind, party_id)).get(party_id, 0)])
    ws.cell(ws.max_row, 1).font = Font(bold=True)
    for col, w in zip("ABCDEFGH", (28, 14, 26, 26, 12, 14, 14, 14)):
        ws.column_dimensions[col].width = w
    out = io.BytesIO()
    wb.save(out)
    safe = "".join(ch if ch.isalnum() else "_" for ch in name)[:40]
    return Response(out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="Recon_{kind}_{safe}.xlsx"'})


IST = ZoneInfo("Asia/Kolkata")


async def _broker_statement(broker_id: str, date_from: Optional[str], date_to: Optional[str]) -> BrokerStatement:
    name = await _party_name("broker", broker_id)
    q: dict = {**LIVE, "broker_id": broker_id}
    rng: dict = {}
    if date_from:
        rng["$gte"] = datetime.combine(date.fromisoformat(date_from), datetime.min.time(), IST)
    if date_to:
        rng["$lt"] = datetime.combine(date.fromisoformat(date_to), datetime.min.time(), IST) + timedelta(days=1)
    if rng:
        q["created_at"] = rng
    docs = await db.policies.find(q, {"_id": 0, "history": 0}).sort("created_at", 1).to_list(20000)
    comm = await commissions_for(docs)
    rows: List[BrokerStatementRow] = []
    for d in docs:
        p = Policy(**d)
        f = p.fields
        if f.gross_premium is None:
            continue
        c = comm.get(p.id)
        rec = round(c.receivable or 0, 2) if c else 0.0
        pending = p.broker_outstanding or 0
        rows.append(BrokerStatementRow(
            policy_id=p.id, customer_name=f.insured_name, policy_number=f.policy_number, reg_no=f.vehicle_reg_no, rto=f.rto, insurer=f.insurer,
            product=f.product_category or f.product_name, uploaded_on=p.created_at.astimezone(IST).strftime("%Y-%m-%d"),
            gross_premium=f.gross_premium, od_premium=f.od_premium, tp_premium=f.tp_premium, net_premium=f.net_premium,
            commission_percent=round(rec / f.net_premium * 100, 2) if f.net_premium else None, commission=rec,
            paid_by=effective_broker_mode(p.broker_payment_mode, None if p.broker_payments else p.payment_mode),
            premium_paid=p.broker_paid, pending_premium=pending,
            payment_details="; ".join(f"{e.paid_on or ''} Rs.{e.amount:,.0f} {e.reference or ''}".strip() for e in p.broker_payments) or None))
    tc = round(sum(r.commission for r in rows), 2)
    tp = round(sum(r.pending_premium for r in rows), 2)
    return BrokerStatement(broker_id=broker_id, broker_name=name, date_from=date_from, date_to=date_to, rows=rows,
                           total_premium=round(sum(r.gross_premium for r in rows), 2), total_commission=tc, total_pending_premium=tp, net=round(tc - tp, 2))


@router.get("/broker-statement", response_model=BrokerStatement)
async def broker_statement(broker_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None, _: User = Depends(admin_only)):
    """Commission the broker owes Srishvision vs premium Srishvision still owes the broker → one net figure."""
    return await _broker_statement(broker_id, date_from, date_to)


@router.get("/broker-statement/excel")
async def broker_statement_excel(broker_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None, _: User = Depends(admin_only)):
    st = await _broker_statement(broker_id, date_from, date_to)
    wb = Workbook()
    ws = wb.active
    ws.title = "Broker Statement"
    period = f"{st.date_from or 'start'} to {st.date_to or 'today'}"
    ws.append([f"Srishvision · Commission & Premium Statement · {st.broker_name} · {period}"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([])
    heads = ["Customer Name", "Policy No", "Reg No", "RTO", "Insurer", "Product", "Uploaded", "Gross Premium", "OD Premium", "TP Premium", "Net Premium",
             "Commission %", "Commission Amt", "Premium Paid By Srishvision", "Premium Paid", "Pending Premium", "Payment Details"]
    ws.append(heads)
    for c in ws[ws.max_row]:
        c.font, c.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1E3A5F")
    for r in st.rows:
        ws.append([r.customer_name, r.policy_number, r.reg_no, r.rto, r.insurer, r.product, r.uploaded_on, r.gross_premium, r.od_premium, r.tp_premium,
                   r.net_premium, r.commission_percent, r.commission, r.paid_by, r.premium_paid, r.pending_premium, r.payment_details])
        ws.cell(ws.max_row, 2).number_format = "@"
    ws.append(["TOTAL", "", "", "", "", "", "", st.total_premium, "", "", "", "", st.total_commission, "", "", st.total_pending_premium])
    for c in ws[ws.max_row]:
        c.font = Font(bold=True)
    ws.append([])
    for label, val in (("Commission payable by broker (Payout)", st.total_commission), ("Less: premium pending to broker", st.total_pending_premium),
                       ("Net " + ("payable by broker to Srishvision" if st.net >= 0 else "payable by Srishvision to broker"), abs(st.net))):
        ws.append([label, "", "", "", "", "", "", "", "", "", "", "", val])
        ws.cell(ws.max_row, 1).font = Font(bold=True)
        ws.cell(ws.max_row, 13).font = Font(bold=True)
    for col, w in zip("ABCDEFGHIJKLMNOPQ", (28, 24, 13, 8, 18, 18, 11, 13, 11, 11, 12, 12, 14, 14, 13, 14, 40)):
        ws.column_dimensions[col].width = w
    for row in ws.iter_rows(min_row=4):
        for c in row[7:16]:
            if isinstance(c.value, (int, float)):
                c.number_format = "#,##0.00"
    out = io.BytesIO()
    wb.save(out)
    safe = "".join(ch if ch.isalnum() else "_" for ch in st.broker_name)[:40]
    return Response(out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="Broker_Statement_{safe}.xlsx"'})
