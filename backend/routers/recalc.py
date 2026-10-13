"""Admin-only commission recalculation with preview + audit trail, and the missing-payables dashboard alert."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_roles
from lib.db import db
from lib.snapshot import blocked_reason, fresh_values, resnapshot, values_of
from lib.commission import commissions_for
from models.recalc import CommissionAudit, MissingPayableAgent, MissingPayables, RecalcApplyIn, RecalcPreview, RecalcPreviewIn, RecalcResult, RecalcRow
from models.user import User
from routers.commission import _today
from routers.commission_grid import agent_label
from routers.rule_tools import _current, payable_source

router = APIRouter()
admin_only = require_roles("admin")
LIVE = {"is_deleted": {"$ne": True}}


async def _load(ids: list[str]) -> list[dict]:
    ids = list(dict.fromkeys(ids))
    docs = await db.policies.find({"id": {"$in": ids}, **LIVE}, {"_id": 0, "history": 0}).to_list(len(ids))
    if len(docs) != len(ids):
        raise HTTPException(status_code=404, detail="Some selected policies were not found — refresh and try again")
    order = {pid: i for i, pid in enumerate(ids)}
    return sorted(docs, key=lambda d: order[d["id"]])


async def _preview(docs: list[dict]) -> RecalcPreview:
    current = await commissions_for(docs)  # the stored snapshot (frozen now if it was not yet)
    out = RecalcPreview()
    for d in docs:
        before, after = values_of(current.get(d["id"])), values_of(await fresh_values(d))
        f = d.get("fields") or {}
        row = RecalcRow(policy_id=d["id"], policy_number=f.get("policy_number"), customer_name=f.get("customer_name"), agent_name=d.get("agent_name"),
                        status=d.get("status") or "", before=before, after=after, changed=before != after, blocked=blocked_reason(d))
        out.rows.append(row)
        if row.blocked:
            out.blocked += 1
        else:
            out.eligible += 1
            out.changed += int(row.changed)
    return out


@router.post("/commission/recalculate/preview", response_model=RecalcPreview)
async def recalc_preview(body: RecalcPreviewIn, _: User = Depends(admin_only)):
    """Existing (snapshot) vs revised commission for the selected policies — nothing is saved."""
    return await _preview(await _load(body.policy_ids))


@router.post("/commission/recalculate", response_model=RecalcResult)
async def recalc_apply(body: RecalcApplyIn, user: User = Depends(admin_only)):
    """Replace the snapshot of exactly the selected, unsettled policies with today's grid; every change is audited."""
    docs = await _load(body.policy_ids)
    pre = await _preview(docs)
    res = RecalcResult(batch_id=str(uuid.uuid4()), rows=pre.rows, eligible=pre.eligible, changed=pre.changed, blocked=pre.blocked)
    by_id = {d["id"]: d for d in docs}
    for row in res.rows:
        if row.blocked:
            continue
        doc = await db.policies.find_one({"id": row.policy_id}, {"_id": 0, "history": 0}) or by_id[row.policy_id]
        row.before, row.after = await resnapshot(doc, user, "admin_recalculate", body.reason.strip(), res.batch_id)
        row.changed = row.before != row.after
        res.updated += 1
    return res


@router.get("/commission/recalc-log", response_model=list[CommissionAudit])
async def recalc_log(policy_id: Optional[str] = None, _: User = Depends(admin_only)):
    q = {"policy_id": policy_id} if policy_id else {}
    return await db.commission_audit.find(q, {"_id": 0}).sort("at", -1).to_list(500)


# ---------- missing payables alert ----------
async def _watched() -> tuple[list[dict], list[dict]]:
    """Alert docs + the current live version of each watched receivable rule (old ids follow superseded_by)."""
    alerts = await db.payable_alerts.find({"dismissed": False}, {"_id": 0}).to_list(2000)
    if not alerts:
        return [], []
    today = _today()
    rules = {r["id"]: r for r in await db.commission_rules.find({"kind": "receivable"}, {"_id": 0}).to_list(10000)}
    live, seen = [], set()
    for a in alerts:
        r = rules.get(a["rule_id"])
        for _ in range(50):
            if not r or r.get("superseded_by") in (None, "ended"):
                break
            r = rules.get(r["superseded_by"])
        if r and not r.get("superseded_by") and r.get("active", True) and (not r.get("valid_to") or r["valid_to"] >= today) and r["id"] not in seen:
            seen.add(r["id"])
            live.append(r)
    return alerts, live


@router.get("/commission/missing-payables", response_model=MissingPayables)
async def missing_payables(_: User = Depends(admin_only)):
    """Agents with no payable (own rule, group margin / rule or common rule) on recently uploaded receivables. Rules that every
    agent is now covered on stop being watched, so the alert clears by itself."""
    alerts, recs = await _watched()
    if not recs:
        return MissingPayables()
    today = _today()
    pays = [r for r in await _current("payable") if r.get("active", True) and (not r.get("valid_to") or r["valid_to"] >= today)]
    agents = await db.users.find({"role": "agent", "active": {"$ne": False}}, {"_id": 0}).sort("username", 1).to_list(5000)
    groups = {g["name"]: g for g in await db.agent_groups.find({}, {"_id": 0}).to_list(500)}
    covered = {r["id"] for r in recs}
    out = MissingPayables(rule_count=len(recs), since=min(a["created_at"] for a in alerts))
    for a in agents:
        g = groups.get(a.get("agent_group")) if a.get("agent_group") else None
        names = []
        for rec in recs:
            if payable_source(rec, a["id"], a.get("agent_group"), g, pays, today)[0] == "missing":
                names.append(rec["name"])
                covered.discard(rec["id"])
        if names:
            out.agents.append(MissingPayableAgent(agent_id=a["id"], agent_label=agent_label(a), missing_count=len(names), receivables=names))
    if covered:  # every agent has a payable now → stop watching these rules
        await db.payable_alerts.update_many({"rule_id": {"$in": list(covered)}}, {"$set": {"dismissed": True, "resolved": True}})
    out.rule_count = len(recs) - len(covered)
    return out


@router.post("/commission/missing-payables/dismiss", response_model=MissingPayables)
async def dismiss_missing_payables(_: User = Depends(admin_only)):
    await db.payable_alerts.update_many({"dismissed": False}, {"$set": {"dismissed": True}})
    return MissingPayables()
