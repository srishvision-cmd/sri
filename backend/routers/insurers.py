"""Insurance company master: built-in list + companies the admin adds manually."""
import logging
import re
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
logger = logging.getLogger("insurers")


def name_key(name: Optional[str]) -> str:
    """Same insurer if equal after lower-casing and dropping punctuation / extra spaces."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).split())


_SUFFIX = {"company", "co", "limited", "ltd", "pvt", "private", "corporation", "corp", "india"}


def family_key(name: Optional[str]) -> tuple:
    """Words of the name without trailing 'Company Limited / Ltd / Pvt …' and a leading 'The'."""
    w = name_key(name).split()
    if w[:1] == ["the"]:
        w = w[1:]
    while len(w) > 2 and w[-1] in _SUFFIX:
        w = w[:-1]
    return tuple(w)


def same_family(a: Optional[str], b: Optional[str]) -> bool:
    """Same insurer: equal ignoring case / punctuation / 'Company Limited', or one name is the other cut short
    (word prefix of at least two words) — e.g. "ICICI Lombard General Insurance" vs "ICICI Lombard General Insurance Compan…"."""
    ka, kb = family_key(a), family_key(b)
    if not ka or not kb:
        return False
    short, long_ = sorted((ka, kb), key=len)
    if short == long_[: len(short)] and len(short) >= 2:
        return True
    # a name cut mid-word ("… Insurance Compan") — compare letters only
    ja, jb = sorted(("".join(ka), "".join(kb)), key=len)
    return len(ja) >= 12 and jb.startswith(ja)


def canonical(names: list[str]) -> str:
    """Longest / most complete spelling; Title-case beats ALL CAPS when both are equally complete."""
    return max(names, key=lambda n: (len(name_key(n).split()), len(name_key(n)), not n.isupper(), n))


def families(names: list[str]) -> list[list[str]]:
    groups: list[list[str]] = []
    for n in dict.fromkeys(x for x in names if x and x.strip()):
        hit = [g for g in groups if any(same_family(n, m) for m in g)]
        merged = [n, *[m for g in hit for m in g]]
        groups = [g for g in groups if g not in hit] + [merged]
    return groups


async def _master() -> list[Insurer]:
    custom = await db.insurers.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    builtin = [Insurer(id=f"builtin-{i}", name=n, keywords=k, builtin=True) for i, (n, k) in enumerate(INSURERS)]
    return [*[Insurer(**c) for c in custom], *builtin]


async def master_name(raw: Optional[str]) -> Optional[str]:
    """OCR import: an insurer name that matches a master entry (case-insensitive, punctuation ignored) is stored as
    that entry's exact name, so no new spelling of an existing company appears. Anything else is kept as read."""
    if not name_key(raw):
        return raw
    # an existing spelling of the same insurer (admin master entry or one already on policies) is reused, so every
    # policy of that insurer carries one name; a built-in short name alone does not replace the full name as read
    master = await _master()
    known = [m.name for m in master if not m.builtin] + [n for n in await db.policies.distinct("fields.insurer") if isinstance(n, str)]
    fam = [n for n in dict.fromkeys(known) if same_family(n, raw)]
    if fam:
        return canonical(fam)
    return next((m.name for m in master if name_key(m.name) == name_key(raw)), raw)


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
    """Every insurer that appears under more than one name — master entries and spellings on policies."""
    master = await _master()
    policy_names = [n for n in await db.policies.distinct("fields.insurer") if isinstance(n, str) and n.strip()]
    out = []
    for fam in families([m.name for m in master] + policy_names):
        ms = [m for m in master if m.name in fam]
        # built-in names are the code list (never shown twice); a group only needs merging when the master entries
        # added by admin + the spellings on policies give more than one name
        if len({*(n for n in fam if n in policy_names), *(m.name for m in ms if not m.builtin)}) < 2:
            continue
        entries = [InsurerDupEntry(id=m.id, name=m.name, builtin=m.builtin, keywords=m.keywords,
                                   policies=await db.policies.count_documents({"fields.insurer": m.name}),
                                   rules=await db.commission_rules.count_documents({"insurer": m.name})) for m in ms]
        name = canonical([n for n in fam if n in policy_names or any(m.name == n and not m.builtin for m in ms)])
        keep = next((e for e in entries if e.name == name), None) or (max(entries, key=lambda e: (e.builtin, e.policies + e.rules)) if entries else None)
        out.append(InsurerDupGroup(key=name_key(name), canonical_id=keep.id if keep else "", canonical_name=name, entries=entries,
                                   policy_names=sorted(n for n in fam if n in policy_names)))
    return sorted(out, key=lambda g: g.key)


@router.get("/insurers/duplicates", response_model=List[InsurerDupGroup])
async def list_duplicates(_: User = Depends(require_roles("admin"))):
    """Review list only — nothing changes until the admin confirms a merge."""
    return await _dup_groups()


@router.post("/insurers/merge", response_model=InsurerMergeResult)
async def merge_duplicates(body: InsurerMergeIn, user: User = Depends(require_roles("admin"))):
    """Keep one entry per insurer: policies, commission rules and agent-group margins that use a duplicate's name (or any
    other spelling of it on policies) are relinked to the kept name, the duplicate's OCR words are added to the kept
    entry, then the duplicate entry is removed. Policy records are only renamed (with a history note) — never deleted."""
    groups = await _dup_groups()
    plan = []
    for req in body.groups:
        g = next((x for x in groups if x.key == req.key), None) if req.key else None
        g = g or next((x for x in groups if req.canonical_id and any(e.id == req.canonical_id for e in x.entries)), None)
        if not g:
            raise HTTPException(status_code=404, detail="That company is no longer listed as a duplicate — refresh the list")
        name = req.canonical_name or next((e.name for e in g.entries if e.id == req.canonical_id), g.canonical_name)
        if name not in {*(e.name for e in g.entries), *g.policy_names}:
            raise HTTPException(status_code=400, detail=f"{name} is not one of the names in this group")
        plan.append((g, name))
    for g, name in plan:  # shown in the server log before anything changes
        logger.warning("Insurer merge plan: keep %r ← %s", name, sorted({*(e.name for e in g.entries), *g.policy_names} - {name}))
    res = InsurerMergeResult(merged=0, policies_relinked=0, rules_relinked=0)
    for g, name in plan:
        customs = [e for e in g.entries if not e.builtin]
        keep = next((e for e in customs if e.name == name), None) or (customs[0] if customs and not any(e.builtin and e.name == name for e in g.entries) else None)
        drops = [e for e in customs if keep is None or e.id != keep.id]
        for n in sorted({*g.policy_names, *(e.name for e in customs)} - {name}):
            note = f"Insurance company relinked: \"{n}\" → \"{name}\" (duplicate merge)"
            r = await db.policies.update_many({"fields.insurer": n}, {"$set": {"fields.insurer": name, "updated_at": now_utc()},
                                                                       "$push": {"history": history(user, "Insurance company relinked", note)}})
            res.policies_relinked += r.modified_count
            if any(e.name == n for e in customs):  # rules / margins that used a removed master entry follow it
                r = await db.commission_rules.update_many({"insurer": n}, {"$set": {"insurer": name}})
                await sync_keys({"insurer": name})
                res.rules_relinked += r.modified_count
                await db.agent_groups.update_many({"margins.insurer": n}, {"$set": {"margins.$[m].insurer": name}}, array_filters=[{"m.insurer": n}])
        if keep:  # one master record, under the complete name, that still recognises every old spelling
            words = sorted({*keep.keywords, *(w for d in drops for w in d.keywords), *(x.lower() for x in [*g.policy_names, *(d.name for d in drops), keep.name])})
            await db.insurers.update_one({"id": keep.id}, {"$set": {"name": name, "keywords": words}})
        r = await db.insurers.delete_many({"id": {"$in": [d.id for d in drops]}})
        res.merged += r.deleted_count + len([n for n in g.policy_names if n != name])
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
