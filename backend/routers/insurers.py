"""Insurance company master: built-in list + companies the admin adds manually."""
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import current_user, require_roles
from lib.commission import refresh_custom_insurers
from lib.db import db
from models.insurer import Insurer, InsurerIn
from models.masters import INSURERS
from models.user import User

router = APIRouter()


def _clean(body: InsurerIn) -> dict:
    d = body.model_dump()
    d["name"] = " ".join(d["name"].split())
    d["keywords"] = sorted({k.strip().lower() for k in d["keywords"] if k.strip()} | {d["name"].lower()})
    return d


async def _name_taken(name: str, exclude_id: str = "") -> bool:
    if name.lower() in {n.lower() for n, _ in INSURERS}:
        return True
    q = {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}, "id": {"$ne": exclude_id}}
    return bool(await db.insurers.find_one(q, {"_id": 1}))


@router.get("/insurers", response_model=List[Insurer])
async def list_insurers(_: User = Depends(current_user)):
    custom = await db.insurers.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    builtin = [Insurer(id=f"builtin-{i}", name=n, keywords=k, builtin=True) for i, (n, k) in enumerate(INSURERS)]
    return [*[Insurer(**c) for c in custom], *builtin]


@router.post("/insurers", response_model=Insurer)
async def create_insurer(body: InsurerIn, _: User = Depends(require_roles("admin"))):
    d = _clean(body)
    if await _name_taken(d["name"]):
        raise HTTPException(status_code=409, detail=f"{d['name']} already exists")
    ins = Insurer(**d)
    await db.insurers.insert_one(ins.model_dump())
    await refresh_custom_insurers()
    return ins


@router.put("/insurers/{id}", response_model=Insurer)
async def update_insurer(id: str, body: InsurerIn, _: User = Depends(require_roles("admin"))):
    old = await db.insurers.find_one({"id": id}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Only companies added by admin can be edited")
    d = _clean(body)
    if await _name_taken(d["name"], id):
        raise HTTPException(status_code=409, detail=f"{d['name']} already exists")
    if d["name"] != old["name"]:  # keep existing rules / margins pointing at the company
        await db.commission_rules.update_many({"insurer": old["name"]}, {"$set": {"insurer": d["name"]}})
        await db.agent_groups.update_many({"margins.insurer": old["name"]}, {"$set": {"margins.$[m].insurer": d["name"]}}, array_filters=[{"m.insurer": old["name"]}])
    await db.insurers.update_one({"id": id}, {"$set": d})
    await refresh_custom_insurers()
    return Insurer(**{**old, **d})


@router.delete("/insurers/{id}")
async def delete_insurer(id: str, _: User = Depends(require_roles("admin"))):
    old = await db.insurers.find_one({"id": id}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Only companies added by admin can be deleted")
    used = await db.commission_rules.count_documents({"insurer": old["name"]})
    if used:
        raise HTTPException(status_code=409, detail=f"{old['name']} is used in {used} commission rule(s) — mark it inactive instead")
    await db.insurers.delete_one({"id": id})
    await refresh_custom_insurers()
    return {"ok": True}
