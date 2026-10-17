"""Commission holds: stop agent commission (and hide the rates from agents) for a company / product from a date,
e.g. when the insurer terminates its grid. Policies with risk start before the hold date are paid as normal."""
from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import current_user, require_roles
from lib.db import db
from models.commission import AgentHoldNotice, CommissionHold, CommissionHoldIn, HoldReleaseIn
from models.masters import PRODUCT_TYPES
from models.user import User
from routers.commission import _today

router = APIRouter(tags=["commission-holds"])
admin_only = require_roles("admin")


def _iso(v: str, label: str) -> str:
    try:
        return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} must be a date (YYYY-MM-DD)")


@router.get("/commission/holds", response_model=List[CommissionHold])
async def list_holds(_: User = Depends(admin_only)):
    docs = await db.commission_holds.find({}, {"_id": 0}).sort([("released_on", 1), ("hold_from", -1)]).to_list(1000)
    return [CommissionHold(**d) for d in docs]


@router.get("/commission/my-holds", response_model=List[AgentHoldNotice])
async def my_holds(user: User = Depends(current_user)):
    """Holds that stop the signed-in agent's rates now or soon (dashboard notice). Other roles get an empty list."""
    if user.role != "agent":
        return []
    today = _today()
    me = await db.users.find_one({"id": user.id}, {"_id": 0, "agent_group": 1}) or {}
    out = []
    for h in await db.commission_holds.find({"$or": [{"released_on": None}, {"released_on": {"$gt": today}}]}, {"_id": 0}).sort("hold_from", 1).to_list(500):
        scoped = bool(h.get("agent_ids") or h.get("agent_groups"))
        if scoped and user.id not in (h.get("agent_ids") or []) and (not me.get("agent_group") or me["agent_group"] not in (h.get("agent_groups") or [])):
            continue
        out.append(AgentHoldNotice(id=h["id"], insurer=h.get("insurer"), product=h.get("product") or h.get("product_type") or "All products",
                                   hold_from=h["hold_from"], released_on=h.get("released_on"), reason=h.get("reason"), upcoming=h["hold_from"] > today))
    return out


@router.post("/commission/holds", response_model=CommissionHold)
async def create_hold(body: CommissionHoldIn, user: User = Depends(admin_only)):
    body.insurer = (body.insurer or "").strip() or None
    body.product_type = (body.product_type or "").strip() or None
    body.product = (body.product or "").strip() or None
    body.reason = (body.reason or "").strip() or None
    body.hold_from = _iso(body.hold_from, "Hold from")
    if body.product_type and body.product_type not in PRODUCT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown product type '{body.product_type}'")
    if body.product and body.product not in PRODUCT_TYPES.get(body.product_type or "", []):
        raise HTTPException(status_code=400, detail=f"'{body.product}' is not a {body.product_type or 'known'} product")
    if body.agent_ids and await db.users.count_documents({"id": {"$in": body.agent_ids}, "role": "agent"}) != len(set(body.agent_ids)):
        raise HTTPException(status_code=400, detail="Unknown partner in the selection")
    if body.agent_groups and await db.agent_groups.count_documents({"name": {"$in": body.agent_groups}}) != len(set(body.agent_groups)):
        raise HTTPException(status_code=400, detail="Unknown partner group in the selection")
    body.broker_ids = sorted(set(body.broker_ids))
    if body.broker_ids and await db.brokers.count_documents({"id": {"$in": body.broker_ids}}) != len(body.broker_ids):
        raise HTTPException(status_code=400, detail="Unknown channel partner in the selection")
    hold = CommissionHold(**body.model_dump(), created_by_name=user.full_name)
    await db.commission_holds.insert_one(hold.model_dump())
    return hold


@router.post("/commission/holds/{id}/release", response_model=CommissionHold)
async def release_hold(id: str, body: HoldReleaseIn, user: User = Depends(admin_only)):
    doc = await db.commission_holds.find_one({"id": id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Hold not found")
    if doc.get("released_on"):
        raise HTTPException(status_code=409, detail="This hold is already released")
    on = _iso(body.released_on or _today(), "Release date")
    if on < doc["hold_from"]:
        raise HTTPException(status_code=400, detail=f"Release date must be on or after the hold date {doc['hold_from']} — delete the hold instead")
    await db.commission_holds.update_one({"id": id}, {"$set": {"released_on": on, "released_by_name": user.full_name}})
    return CommissionHold(**{**doc, "released_on": on, "released_by_name": user.full_name})


@router.delete("/commission/holds/{id}")
async def delete_hold(id: str, _: User = Depends(admin_only)):
    """Remove a hold completely (as if it never existed) — e.g. created by mistake."""
    if not (await db.commission_holds.delete_one({"id": id})).deleted_count:
        raise HTTPException(status_code=404, detail="Hold not found")
    return {"ok": True}
