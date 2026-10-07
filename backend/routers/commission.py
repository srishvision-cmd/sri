import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lib.auth import require_roles
from lib.commission import check_against, commissions_for, explain_policy
from lib.db import db
from models.commission import AgentGroup, AgentGroupIn, Broker, BrokerIn, CommissionResult, CommissionRule, CommissionRuleIn
from models.common import now_utc
from models.masters import CommissionMasters, masters
from models.user import User
from routers.policies import load_scoped

router = APIRouter(tags=["commission"])
admin_only = require_roles("admin")
reviewers = require_roles("admin", "backoffice")


# ---------- brokers ----------
@router.get("/brokers", response_model=List[Broker])
async def list_brokers(_: User = Depends(reviewers)):
    return [Broker(**d) for d in await db.brokers.find({}, {"_id": 0}).sort("name", 1).to_list(1000)]


async def _unique_broker(name: str, exclude: str = "") -> None:
    if await db.brokers.find_one({"name": {"$regex": f"^{re.escape(name.strip())}$", "$options": "i"}, "id": {"$ne": exclude}}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="A broker with this name already exists")


@router.post("/brokers", response_model=Broker)
async def create_broker(body: BrokerIn, _: User = Depends(admin_only)):
    await _unique_broker(body.name)
    b = Broker(**{**body.model_dump(), "name": body.name.strip(), "aliases": [a.strip() for a in body.aliases if a.strip()]})
    await db.brokers.insert_one(b.model_dump())
    return b


@router.put("/brokers/{id}", response_model=Broker)
async def update_broker(id: str, body: BrokerIn, _: User = Depends(admin_only)):
    await _unique_broker(body.name, id)
    upd = {**body.model_dump(), "name": body.name.strip(), "aliases": [a.strip() for a in body.aliases if a.strip()]}
    res = await db.brokers.update_one({"id": id}, {"$set": upd})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Broker not found")
    await db.policies.update_many({"broker_id": id}, {"$set": {"broker_name": upd["name"]}})
    return Broker(**await db.brokers.find_one({"id": id}, {"_id": 0}))


# ---------- agent groups ----------
@router.get("/agent-groups", response_model=List[AgentGroup])
async def list_groups(_: User = Depends(reviewers)):
    return [AgentGroup(**d) for d in await db.agent_groups.find({}, {"_id": 0}).sort("name", 1).to_list(200)]


@router.post("/agent-groups", response_model=AgentGroup)
async def create_group(body: AgentGroupIn, _: User = Depends(admin_only)):
    name = body.name.strip()
    if await db.agent_groups.find_one({"name": name}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Group already exists")
    g = AgentGroup(name=name)
    await db.agent_groups.insert_one(g.model_dump())
    return g


@router.delete("/agent-groups/{id}")
async def delete_group(id: str, _: User = Depends(admin_only)):
    g = await db.agent_groups.find_one({"id": id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    used = await db.users.count_documents({"agent_group": g["name"]}) + await db.commission_rules.count_documents({"agent_group": g["name"]})
    if used:
        raise HTTPException(status_code=409, detail="Group is used by agents or rules — reassign them first")
    await db.agent_groups.delete_one({"id": id})
    return {"ok": True}


# ---------- commission rules (admin only) ----------
@router.get("/commission/rules", response_model=List[CommissionRule])
async def list_rules(_: User = Depends(admin_only)):
    return [CommissionRule(**d) for d in await db.commission_rules.find({}, {"_id": 0}).sort("updated_at", -1).to_list(5000)]


def _clean(body: CommissionRuleIn) -> dict:
    d = body.model_dump()
    for k in ("insurer", "make", "model", "broker_id", "agent_group", "agent_id", "valid_from", "valid_to"):
        d[k] = (d[k] or "").strip() or None
    d["rtos"] = sorted({r.strip().upper().replace(" ", "") for r in d["rtos"] if r.strip()})
    if d["kind"] == "receivable":
        d["agent_group"] = d["agent_id"] = None
    if not any(d[c] is not None for c in ("od_percent", "tp_percent", "net_percent", "odtp_percent", "flat_amount")):
        raise HTTPException(status_code=400, detail="Enter at least one commission value (OD %, TP %, Net %, OD+TP % or flat ₹)")
    for dim in ("gvw", "cc", "seating"):
        lo, hi = d[f"{dim}_min"], d[f"{dim}_max"]
        if lo is not None and hi is not None and lo > hi:
            raise HTTPException(status_code=400, detail=f"{dim.upper()} 'from' must be ≤ 'to'")
    return d


async def _validate(rule: dict, exclude_id: str = "") -> None:
    others = await db.commission_rules.find({"id": {"$ne": exclude_id}, "active": True}, {"_id": 0}).to_list(5000)
    if not rule["active"]:
        return
    if rule["kind"] == "payable":
        err = check_against(rule, [r for r in others if r["kind"] == "receivable"])
    else:  # lowering a receivable must not leave an existing payable above it
        err = next((e for p in others if p["kind"] == "payable" and (e := check_against(p, [{**rule, "name": rule["name"]}]))), None)
        if err:
            err = f"{err} — lower the payable rule first"
    if err:
        raise HTTPException(status_code=400, detail=err)


@router.post("/commission/rules", response_model=CommissionRule)
async def create_rule(body: CommissionRuleIn, _: User = Depends(admin_only)):
    d = _clean(body)
    await _validate(d)
    rule = CommissionRule(**d)
    await db.commission_rules.insert_one(rule.model_dump())
    return rule


@router.put("/commission/rules/{id}", response_model=CommissionRule)
async def update_rule(id: str, body: CommissionRuleIn, _: User = Depends(admin_only)):
    d = _clean(body)
    await _validate({**d, "id": id}, id)
    res = await db.commission_rules.update_one({"id": id}, {"$set": {**d, "updated_at": now_utc()}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Rule not found")
    return CommissionRule(**await db.commission_rules.find_one({"id": id}, {"_id": 0}))


@router.delete("/commission/rules/{id}")
async def delete_rule(id: str, _: User = Depends(admin_only)):
    res = await db.commission_rules.delete_one({"id": id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}


@router.get("/commission/masters", response_model=CommissionMasters)
async def commission_masters(_: User = Depends(reviewers)):
    return masters()


class GroupMembersIn(BaseModel):
    agent_ids: List[str]


@router.put("/agent-groups/{id}/members")
async def set_group_members(id: str, body: GroupMembersIn, _: User = Depends(admin_only)):
    """Put exactly these agents in the group (agents removed from the list leave the group)."""
    g = await db.agent_groups.find_one({"id": id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.users.update_many({"agent_group": g["name"], "id": {"$nin": body.agent_ids}}, {"$set": {"agent_group": None}})
    res = await db.users.update_many({"role": "agent", "id": {"$in": body.agent_ids}}, {"$set": {"agent_group": g["name"]}})
    return {"ok": True, "members": res.matched_count}


@router.delete("/brokers/{id}")
async def delete_broker(id: str, _: User = Depends(admin_only)):
    used = await db.policies.count_documents({"broker_id": id, "is_deleted": {"$ne": True}}) + await db.commission_rules.count_documents({"broker_id": id})
    if used:
        raise HTTPException(status_code=409, detail="Broker is used by policies or rules — mark it inactive instead")
    res = await db.brokers.delete_one({"id": id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Broker not found")
    await db.users.update_many({"broker_id": id}, {"$set": {"broker_id": None}})
    return {"ok": True}


@router.get("/commission/insurers", response_model=List[str])
async def insurer_suggestions(_: User = Depends(admin_only)):
    names = await db.policies.distinct("fields.insurer", {"is_deleted": {"$ne": True}})
    return sorted({n.strip() for n in names if isinstance(n, str) and n.strip()})


@router.get("/policies/{id}/commission", response_model=CommissionResult)
async def policy_commission(id: str, user: User = Depends(admin_only)):
    doc = await load_scoped(id, user)
    res = (await commissions_for([doc])).get(id) or CommissionResult(note="No commission rules set up yet")
    if res.receivable is None or res.payable is None:
        res.misses = await explain_policy(doc)
    return res
