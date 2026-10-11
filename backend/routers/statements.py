from datetime import date, datetime, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from lib.auth import current_user, require_roles
from lib.commission import commissions_for
from lib.db import db
from lib.statement_docs import statement_pdf, statement_xlsx
from models.common import now_utc
from routers.recon import allocate_stale_batches
from models.policy import NET_OF_COMMISSION, OUTSTANDING_MODES, PaymentEntry, Policy
from models.statement import CommissionStatement, OutstandingLine, StatementGenerateIn, StatementLine, StatementPaidIn
from models.user import User
from lib.history import history

router = APIRouter(tags=["statements"])
admin_only = require_roles("admin")
IST = ZoneInfo("Asia/Kolkata")
LIVE = {"is_deleted": {"$ne": True}, "status": {"$nin": ["duplicate", "processing", "failed"]}}


def period_range(body: StatementGenerateIn) -> tuple[str, str]:
    try:
        if body.period_type == "custom":
            f, t = date.fromisoformat(body.from_date or ""), date.fromisoformat(body.to_date or "")
        else:
            ref = date.fromisoformat(body.ref_date) if body.ref_date else datetime.now(IST).date()
            if body.period_type == "daily":
                f = t = ref
            elif body.period_type == "weekly":
                f = ref - timedelta(days=ref.weekday())
                t = f + timedelta(days=6)
            else:
                f = ref.replace(day=1)
                t = (f.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Enter valid dates")
    if f > t:
        raise HTTPException(status_code=400, detail="'From' date must be on or before 'To' date")
    return f.isoformat(), t.isoformat()


def _utc_bounds(f: str, t: str) -> tuple[datetime, datetime]:
    start = datetime.combine(date.fromisoformat(f), datetime.min.time(), IST)
    end = datetime.combine(date.fromisoformat(t), datetime.min.time(), IST) + timedelta(days=1)
    return start.astimezone(ZoneInfo("UTC")), end.astimezone(ZoneInfo("UTC"))


async def _load(id: str, user: User) -> CommissionStatement:
    doc = await db.commission_statements.find_one({"id": id}, {"_id": 0})
    if not doc or (user.role != "admin" and doc["agent_id"] != user.id):
        raise HTTPException(status_code=404, detail="Statement not found")
    if user.role == "backoffice":
        raise HTTPException(status_code=403, detail="Not allowed")
    s = CommissionStatement(**doc)
    missing = [l for l in s.lines if not l.commission_rate]
    if missing:  # statements made before the % column: show the rate the grid gives these policies
        docs = await db.policies.find({"id": {"$in": [l.policy_id for l in missing]}}, {"_id": 0}).to_list(5000)
        comm = await commissions_for(docs)
        for l in missing:
            c = comm.get(l.policy_id)
            l.commission_rate = c.payable_rate if c else None
    return s


@router.post("/statements", response_model=CommissionStatement)
async def generate(body: StatementGenerateIn, user: User = Depends(admin_only)):
    await allocate_stale_batches(body.agent_id)  # a batch "paid at upload" must be on the policies before the outstanding is read
    agent = await db.users.find_one({"id": body.agent_id, "role": "agent"}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if await db.commission_statements.find_one({"agent_id": body.agent_id, "status": "generated"}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="This agent already has an unpaid statement — mark it paid or delete it first")
    f, t = period_range(body)
    start, end = _utc_bounds(f, t)

    docs = await db.policies.find(
        {**LIVE, "agent_id": body.agent_id, "created_at": {"$gte": start, "$lt": end},
         "$or": [{"commission_statement_id": None}, {"commission_statement_id": {"$exists": False}}]},
        {"_id": 0},
    ).sort("created_at", 1).to_list(5000)
    comm = await commissions_for(docs)
    lines = []
    for d in docs:
        c = comm.get(d["id"])
        if d.get("payment_mode") == NET_OF_COMMISSION:  # commission already kept by the agent on the spot
            continue
        if c and (c.payable or 0) > 0:
            fl = Policy(**d).fields
            lines.append(StatementLine(policy_id=d["id"], policy_number=fl.policy_number, reg_no=fl.vehicle_reg_no, insured_name=fl.insured_name,
                                       insurer=fl.insurer, product=fl.product_category, start_date=fl.start_date, net_premium=fl.net_premium,
                                       payable=round(c.payable, 2), rule_name=c.payable_rule_name,
                                       commission_rate=(c.payable_rate or "") + (" (capped at receivable)" if c.capped else "") or None))

    out_docs = await db.policies.find({**LIVE, "agent_id": body.agent_id, "payment_mode": {"$in": OUTSTANDING_MODES}}, {"_id": 0}).sort("created_at", 1).to_list(5000)
    total_payable = round(sum(l.payable for l in lines), 2)
    budget = total_payable
    outs = []
    for d in out_docs:
        p = Policy(**d)
        if (p.outstanding or 0) <= 0:
            continue
        ded = round(min(budget, p.outstanding), 2)
        budget = round(budget - ded, 2)
        outs.append(OutstandingLine(policy_id=p.id, policy_number=p.fields.policy_number, reg_no=p.fields.vehicle_reg_no, insured_name=p.fields.insured_name,
                                    payment_mode=p.payment_mode, gross_premium=p.fields.gross_premium, outstanding=p.outstanding, deducted=ded))
    if not lines and not outs:
        raise HTTPException(status_code=400, detail="No commission or outstanding for this agent in the selected period")
    total_out = round(sum(o.outstanding for o in outs), 2)
    deducted = round(sum(o.deducted for o in outs), 2)
    seq = await db.commission_statements.count_documents({"number": {"$regex": f"^CS-{f[:7].replace('-', '')}-"}}) + 1
    s = CommissionStatement(
        number=f"CS-{f[:7].replace('-', '')}-{seq:04d}", agent_id=agent["id"], agent_name=agent["full_name"], agent_code=agent["username"].upper(),
        branch=agent.get("branch"), period_type=body.period_type, from_date=f, to_date=t, lines=lines, outstanding_lines=outs,
        total_payable=total_payable, total_outstanding=total_out, outstanding_deducted=deducted,
        outstanding_balance=round(total_out - deducted, 2), net_payable=round(total_payable - deducted, 2), created_by_name=user.full_name,
    )
    await db.commission_statements.insert_one(s.model_dump())
    if lines:  # lock these policies so they are never paid twice
        await db.policies.update_many({"id": {"$in": [l.policy_id for l in lines]}}, {"$set": {"commission_statement_id": s.id, "commission_statement_no": s.number}})
    return s


@router.get("/statements", response_model=List[CommissionStatement])
async def list_statements(agent_id: Optional[str] = None, status: Optional[str] = None, user: User = Depends(current_user)):
    if user.role == "backoffice":
        raise HTTPException(status_code=403, detail="Not allowed")
    q: dict = {"agent_id": user.id} if user.role == "agent" else ({"agent_id": agent_id} if agent_id else {})
    if status:
        q["status"] = status
    return [CommissionStatement(**d) for d in await db.commission_statements.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)]


@router.get("/statements/{id}", response_model=CommissionStatement)
async def get_statement(id: str, user: User = Depends(current_user)):
    return await _load(id, user)


@router.get("/statements/{id}/pdf")
async def get_pdf(id: str, user: User = Depends(current_user)):
    s = await _load(id, user)
    return Response(statement_pdf(s), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{s.number}_{s.agent_code}.pdf"'})


@router.get("/statements/{id}/excel")
async def get_excel(id: str, user: User = Depends(current_user)):
    s = await _load(id, user)
    return Response(statement_xlsx(s), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{s.number}_{s.agent_code}.xlsx"'})


@router.post("/statements/{id}/paid", response_model=CommissionStatement)
async def mark_paid(id: str, body: StatementPaidIn, user: User = Depends(admin_only)):
    s = await _load(id, user)
    if s.status == "paid":
        raise HTTPException(status_code=409, detail="Statement is already marked paid")
    res = await db.commission_statements.update_one(
        {"id": id, "status": "generated"},
        {"$set": {"status": "paid", "paid_date": body.paid_date, "utr": body.utr.strip(), "paid_by_name": user.full_name}},
    )
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="Statement is already marked paid")
    note = f"{s.number} · {body.paid_date} · UTR {body.utr.strip()}"
    await db.policies.update_many(
        {"id": {"$in": [l.policy_id for l in s.lines]}},
        {"$set": {"commission_paid": True, "commission_paid_date": body.paid_date, "commission_utr": body.utr.strip(), "updated_at": now_utc()},
         "$push": {"history": history(user, "Commission paid", note)}},
    )
    for o in s.outstanding_lines:  # recover the deducted premium on each outstanding policy
        if o.deducted <= 0:
            continue
        d = await db.policies.find_one({"id": o.policy_id}, {"_id": 0})
        if not d:
            continue
        amt = round(min(o.deducted, Policy(**d).outstanding or 0), 2)
        if amt <= 0:
            continue
        entry = PaymentEntry(amount=amt, reference=f"Adjusted from commission {s.number}", paid_on=body.paid_date, recorded_by_name=user.full_name)
        await db.policies.update_one(
            {"id": o.policy_id},
            {"$push": {"payments": entry.model_dump(), "history": history(user, "Payment recorded", f"₹{amt:,.2f} · commission adjustment {s.number}")},
             "$set": {"updated_at": now_utc()}},
        )
    return await _load(id, user)


@router.delete("/statements/{id}")
async def delete_statement(id: str, user: User = Depends(admin_only)):
    s = await _load(id, user)
    if s.status == "paid":
        raise HTTPException(status_code=409, detail="Paid statements cannot be deleted")
    await db.policies.update_many({"commission_statement_id": id}, {"$set": {"commission_statement_id": None, "commission_statement_no": None}})
    await db.commission_statements.delete_one({"id": id})
    return {"ok": True}
