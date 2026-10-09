import re
from datetime import date, datetime, timedelta, timezone
from typing import List
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lib.auth import current_user, require_roles
from lib.commission import check_against, commissions_for, derive_payable, explain_policy, group_margin, insurer_matches, product_type_of
from lib.db import db
from models.commission import AgentGroup, AgentGroupIn, GroupMarginsIn, AgentRate, AgentRateCard, Broker, BrokerIn, CommissionResult, CommissionRule, CommissionRuleIn
from models.common import now_utc
from models.masters import CommissionMasters, masters
from models.user import User
from routers.policies import load_scoped

router = APIRouter(tags=["commission"])
IST = ZoneInfo("Asia/Kolkata")
admin_only = require_roles("admin")
reviewers = require_roles("admin", "backoffice")


# ---------- brokers ----------
@router.get("/brokers", response_model=List[Broker])
async def list_brokers(_: User = Depends(current_user)):  # agents pick the broker at upload too
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
    d = body.model_dump(exclude={"apply_to_past"})
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
    if d["valid_from"] and d["valid_to"] and d["valid_from"] > d["valid_to"]:
        raise HTTPException(status_code=400, detail="'Applicable from' date must be on or before 'Applicable to' date")
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


def _today() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def _created_today(doc: dict) -> bool:
    c = doc.get("created_at")
    return isinstance(c, datetime) and (c if c.tzinfo else c.replace(tzinfo=timezone.utc)).astimezone(IST).strftime("%Y-%m-%d") == _today()


@router.put("/commission/rules/{id}", response_model=CommissionRule)
async def update_rule(id: str, body: CommissionRuleIn, _: User = Depends(admin_only)):
    """Rate changes are versioned: the new rate applies from its effective date; earlier policies keep the old rate."""
    old = await db.commission_rules.find_one({"id": id}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Rule not found")
    if old.get("superseded_by"):
        raise HTTPException(status_code=409, detail="This is an old version — edit the current rule instead")
    d = _clean(body)
    if body.apply_to_past:  # correct the rule for every policy (incl. already uploaded ones): overwrite + drop its older versions
        root = old.get("version_of") or old["id"]
        await db.commission_rules.delete_many({"$or": [{"id": root}, {"version_of": root}], "id": {"$ne": id}})
        await _validate({**d, "id": id}, id)
        await db.commission_rules.update_one({"id": id}, {"$set": {**d, "updated_at": now_utc()}})
        return CommissionRule(**await db.commission_rules.find_one({"id": id}, {"_id": 0}))
    eff = d["valid_from"] or _today()
    # only overwrite when the new date does not leave any earlier period on the old rate
    in_place = bool(old.get("valid_from")) and eff <= old["valid_from"]
    if in_place:
        await _validate({**d, "id": id}, id)
        await db.commission_rules.update_one({"id": id}, {"$set": {**d, "updated_at": now_utc()}})
        return CommissionRule(**await db.commission_rules.find_one({"id": id}, {"_id": 0}))
    if d["valid_to"] and d["valid_to"] < eff:
        raise HTTPException(status_code=400, detail="'Applicable to' date must be on or after the new effective date")
    new = CommissionRule(**{**d, "valid_from": eff}, version_of=old.get("version_of") or old["id"])
    await _validate(new.model_dump(), id)
    end = (date.fromisoformat(eff) - timedelta(days=1)).isoformat()
    if old.get("valid_to") and old["valid_to"] < end:
        end = old["valid_to"]
    await db.commission_rules.insert_one(new.model_dump())
    await db.commission_rules.update_one({"id": id}, {"$set": {"valid_to": end, "superseded_by": new.id, "updated_at": now_utc()}})
    return new


@router.delete("/commission/rules/{id}")
async def delete_rule(id: str, _: User = Depends(admin_only)):
    """Rules added today are removed; older rules are stopped from today so past policies keep their commission."""
    doc = await db.commission_rules.find_one({"id": id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Rule not found")
    if _created_today(doc):
        await db.commission_rules.delete_one({"id": id})
        # re-open the previous version this one replaced
        await db.commission_rules.update_one({"superseded_by": id}, {"$set": {"superseded_by": None, "valid_to": doc.get("valid_to")}})
        return {"ok": True, "ended": False}
    end = (date.fromisoformat(_today()) - timedelta(days=1)).isoformat()
    await db.commission_rules.update_one({"id": id}, {"$set": {"valid_to": end, "superseded_by": "ended", "updated_at": now_utc()}})
    return {"ok": True, "ended": True}


@router.get("/commission/masters", response_model=CommissionMasters)
async def commission_masters(_: User = Depends(current_user)):  # agents read labels for their rate card
    m = masters()
    custom = [d["name"] for d in await db.insurers.find({"active": True}, {"_id": 0, "name": 1}).sort("name", 1).to_list(500)]
    m.insurers = [*m.insurers, *[n for n in custom if n not in m.insurers]]
    return m


class GroupMembersIn(BaseModel):
    agent_ids: List[str]


@router.put("/agent-groups/{id}/margins", response_model=AgentGroup)
async def set_group_margins(id: str, body: GroupMarginsIn, _: User = Depends(require_roles("admin"))):
    g = await db.agent_groups.find_one({"id": id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    seen = set()
    for m in body.margins:
        m.insurer = (m.insurer or "").strip() or None
        m.product_type = (m.product_type or "").strip() or None
        if (m.insurer, m.product_type) in seen:
            raise HTTPException(status_code=400, detail=f"{m.insurer or 'All other companies'} · {m.product_type or 'All products'} is listed twice")
        seen.add((m.insurer, m.product_type))
    await db.agent_groups.update_one({"id": id}, {"$set": {"margins": [m.model_dump() for m in body.margins]}})
    return AgentGroup(**{**g, "margins": [m.model_dump() for m in body.margins]})


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


_SIG_KEYS = ("insurer", "broker_id", "ncb", "cover", "gvw_min", "gvw_max", "cc_min", "cc_max", "seating_min", "seating_max", "make", "model")


def _signature(r: dict) -> tuple:
    """All matching conditions except the agent/group ones."""
    lists = tuple(tuple(sorted(r.get(k) or [])) for k in ("products", "rtos", "vehicle_ages", "fuel_types"))
    return tuple((str(r.get(k) or "")).lower() for k in _SIG_KEYS) + lists


def _covers(p: dict, r: dict) -> bool:
    """True when every policy rule `r` matches is also matched by rule `p` (p is equal or broader)."""
    if p.get("insurer") and not (r.get("insurer") and insurer_matches(p["insurer"], r["insurer"])):
        return False
    for k in ("broker_id", "make", "model"):
        if p.get(k) and str(p[k]).lower() != str(r.get(k) or "").lower():
            return False
    for k in ("products", "vehicle_ages", "fuel_types"):
        if p.get(k) and not (r.get(k) and set(r[k]) <= set(p[k])):
            return False
    if p.get("rtos") and not (r.get("rtos") and all(any(x.startswith(y) for y in p["rtos"]) for x in r["rtos"])):
        return False
    for k in ("ncb", "cover"):
        if (p.get(k) or "any") != "any" and (p.get(k) or "any") != (r.get(k) or "any"):
            return False
    for dim in ("gvw", "cc", "seating"):
        lo, hi = p.get(f"{dim}_min"), p.get(f"{dim}_max")
        rlo, rhi = r.get(f"{dim}_min"), r.get(f"{dim}_max")
        if lo is not None and (rlo is None or rlo < lo):
            return False
        if hi is not None and (rhi is None or rhi > hi):
            return False
    if p.get("valid_to") and (not r.get("valid_to") or r["valid_to"] > p["valid_to"]):
        return False
    return True


@router.get("/commission/my-rates", response_model=AgentRateCard)
async def my_rates(agent_id: str = "", user: User = Depends(current_user)):
    """Payable commission rates that apply to an agent today or later. Agents always get their own; admin may preview any agent."""
    if user.role == "agent":
        agent_id = user.id
    elif user.role != "admin":
        raise HTTPException(status_code=403, detail="Only agents and admin can view the agent rate card")
    agent = await db.users.find_one({"id": agent_id, "role": "agent"}, {"_id": 0, "id": 1, "full_name": 1, "username": 1, "agent_group": 1}) if agent_id else None
    if agent_id and not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    today = _today()
    q = {"kind": "payable", "active": True, "$or": [{"valid_to": None}, {"valid_to": {"$gte": today}}]}
    rules = await db.commission_rules.find(q, {"_id": 0}).to_list(5000)
    group = (agent or {}).get("agent_group")
    if agent:
        rules = [r for r in rules if r.get("agent_id") in (None, agent["id"]) and r.get("agent_group") in (None, group)]
    else:  # admin without an agent picked: rates common to every agent
        rules = [r for r in rules if not r.get("agent_id") and not r.get("agent_group")]
    margins = []
    if group:
        margins = ((await db.agent_groups.find_one({"name": group}, {"_id": 0, "margins": 1})) or {}).get("margins") or []
    if margins:  # auto grid from receivable rules replaces the manual group / common payable rules for covered companies
        rules = [r for r in rules if r.get("agent_id") or group_margin(margins, r.get("insurer"), ptype=product_type_of(r.get("products") or [])) is None]
        recs = await db.commission_rules.find({**q, "kind": "receivable"}, {"_id": 0}).to_list(5000)
        for rec in recs:
            m = group_margin(margins, rec.get("insurer"), ptype=product_type_of(rec.get("products") or []))
            if m is not None:
                rules.append({**derive_payable(rec, m), "id": f"auto-{rec['id']}", "agent_group": group, "agent_id": None})
    # a personal / group rule with the same conditions always wins over the common one (higher match score),
    # so never show the overridden common/group rate to this agent
    level = lambda r: 2 if r.get("agent_id") else 1 if r.get("agent_group") else 0  # noqa: E731
    best_level: dict = {}
    for r in rules:
        if not r.get("valid_from") or r["valid_from"] <= today:
            best_level[_signature(r)] = max(best_level.get(_signature(r), 0), level(r))
    rules = [r for r in rules if level(r) >= best_level.get(_signature(r), 0)]
    # the payout engine always uses a matching personal rule first — hide any other rate a personal rule fully covers
    personal = [r for r in rules if r.get("agent_id") and (not r.get("valid_from") or r["valid_from"] <= today)]
    rules = [r for r in rules if r.get("agent_id") or not any(_covers(p, r) for p in personal)]
    brokers = {b["id"]: b["name"] for b in await db.brokers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    rates = [
        AgentRate(**{k: r.get(k) for k in AgentRate.model_fields if k in r}, broker_name=brokers.get(r.get("broker_id") or ""),
                  personal=bool(r.get("agent_id")), group_rate=bool(r.get("agent_group")), upcoming=bool(r.get("valid_from") and r["valid_from"] > today))
        for r in rules
    ]
    rates.sort(key=lambda a: (a.insurer or "~", ",".join(a.products), a.valid_from or ""))
    return AgentRateCard(
        agent_name=agent["full_name"] if agent else None, agent_code=agent["username"].upper() if agent else None,
        agent_group=group, as_of=today, rates=rates,
    )


@router.get("/policies/{id}/commission", response_model=CommissionResult)
async def policy_commission(id: str, user: User = Depends(admin_only)):
    doc = await load_scoped(id, user)
    res = (await commissions_for([doc])).get(id) or CommissionResult(note="No commission rules set up yet")
    if res.receivable is None or res.payable is None:
        res.misses = await explain_policy(doc)
    return res
