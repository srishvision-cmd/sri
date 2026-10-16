"""Insurance company master: built-in list + companies the admin adds manually."""
import re
from collections import defaultdict
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import current_user, require_roles
from lib.commission import refresh_custom_insurers
from lib.db import db
from lib.payable_dedup import sync_keys
from lib.history import history
from models.common import now_utc
from models.insurer import Insurer, InsurerDupEntry, InsurerDupGroup, InsurerIn, InsurerMergeIn, InsurerMergeResult
from models.masters import INSURERS
from models.user import User

router = APIRouter()


def name_key(name: Optional[str]) -> str:
    """Same insurer if equal after lower-casing and dropping punctuation / extra spaces."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).split())


async def _master() -> list[Insurer]:
    custom = await db.insurers.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    builtin = [Insurer(id=f"builtin-{i}", name=n, keywords=k, builtin=True) for i, (n, k) in enumerate(INSURERS)]
    return [*[Insurer(**c) for c in custom], *builtin]


async def master_name(raw: Optional[str]) -> Optional[str]:
    """OCR import: an insurer name that matches a master entry (case-insensitive, punctuation ignored) is stored as
    that entry's exact name, so no new spelling of an existing company appears. Anything else is kept as read."""
    k = name_key(raw)
    if not k:
        return raw
    hit = next((m.name for m in await _master() if name_key(m.name) == k), None)
    return hit or raw


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
    return await _master()


async def _dup_groups() -> list[InsurerDupGroup]:
    by_key: dict[str, list[Insurer]] = defaultdict(list)
    for m in await _master():
        by_key[name_key(m.name)].append(m)
    dups = {k: v for k, v in by_key.items() if k and len(v) > 1}
    if not dups:
        return []
    spellings: dict[str, list[str]] = defaultdict(list)
    for n in await db.policies.distinct("fields.insurer"):
        if isinstance(n, str) and name_key(n) in dups:
            spellings[name_key(n)].append(n)
    out = []
    for k, ms in sorted(dups.items()):
        entries = [InsurerDupEntry(id=m.id, name=m.name, builtin=m.builtin, keywords=m.keywords,
                                   policies=await db.policies.count_documents({"fields.insurer": m.name}),
                                   rules=await db.commission_rules.count_documents({"insurer": m.name})) for m in ms]
        keep = max(entries, key=lambda e: (e.builtin, e.policies + e.rules))
        out.append(InsurerDupGroup(key=k, canonical_id=keep.id, entries=entries, policy_names=sorted(spellings[k])))
    return out


@router.get("/insurers/duplicates", response_model=List[InsurerDupGroup])
async def list_duplicates(_: User = Depends(require_roles("admin"))):
    """Review list only — nothing changes until the admin confirms a merge."""
    return await _dup_groups()


@router.post("/insurers/merge", response_model=InsurerMergeResult)
async def merge_duplicates(body: InsurerMergeIn, user: User = Depends(require_roles("admin"))):
    """Keep one entry per insurer: policies, commission rules and agent-group margins that use a duplicate's name (or any
    other spelling of it on policies) are relinked to the kept name, the duplicate's OCR words are added to the kept
    entry, then the duplicate entry is removed. Policy records are only renamed (with a history note) — never deleted."""
    groups = {g.key: g for g in await _dup_groups()}
    plan = []
    for req in body.groups:
        g = next((x for x in groups.values() if any(e.id == req.canonical_id for e in x.entries)), None)
        if not g:
            raise HTTPException(status_code=404, detail="That company is no longer listed as a duplicate — refresh the list")
        ids = {e.id: e for e in g.entries}
        keep = ids[req.canonical_id]
        for mid in req.merge_ids:
            if mid not in ids or mid == keep.id:
                raise HTTPException(status_code=400, detail=f"{mid} is not a duplicate of {keep.name}")
            if ids[mid].builtin:
                raise HTTPException(status_code=400, detail=f"{ids[mid].name} is a built-in company — keep it and merge the others into it")
        plan.append((keep, [ids[m] for m in dict.fromkeys(req.merge_ids)], g.policy_names))
    res = InsurerMergeResult(merged=0, policies_relinked=0, rules_relinked=0)
    for keep, drops, spellings in plan:
        names = sorted({*(d.name for d in drops), *spellings} - {keep.name})
        for n in names:
            note = f"Insurance company relinked: \"{n}\" → \"{keep.name}\" (master duplicate merge)"
            r = await db.policies.update_many({"fields.insurer": n}, {"$set": {"fields.insurer": keep.name, "updated_at": now_utc()},
                                                                       "$push": {"history": history(user, "Insurance company relinked", note)}})
            res.policies_relinked += r.modified_count
            r = await db.commission_rules.update_many({"insurer": n}, {"$set": {"insurer": keep.name}})
            await sync_keys({"insurer": keep.name})
            res.rules_relinked += r.modified_count
            await db.agent_groups.update_many({"margins.insurer": n}, {"$set": {"margins.$[m].insurer": keep.name}}, array_filters=[{"m.insurer": n}])
        if not keep.builtin:  # keep every OCR spelling the duplicates knew about
            words = sorted({*keep.keywords, *(w for d in drops for w in d.keywords), *(d.name.lower() for d in drops)})
            await db.insurers.update_one({"id": keep.id}, {"$set": {"keywords": words}})
        r = await db.insurers.delete_many({"id": {"$in": [d.id for d in drops]}})
        res.merged += r.deleted_count
    await refresh_custom_insurers()
    return res


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
        await sync_keys({"insurer": d["name"]})
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
