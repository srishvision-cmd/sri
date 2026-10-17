"""Bulk rule tools: copy rules to another company / channel partner / date, and the rate matrix editor."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_roles
from lib.commission import derive_payable, group_margin_line, margin_text, overlaps, product_type_of, single_product
from models.masters import PRODUCT_TYPES
from models.commission import (
    AgentPayableRow, AgentPayablesIn, AgentPayablesView, CommissionRule, CommissionRuleIn, MatrixColumn, RateMatrixIn, ReopenRulesIn, RuleCopyIn, RuleToolResult, RuleToolRow,
)
from datetime import datetime, timezone

from lib.payable_alerts import note_receivable
from lib.payable_dedup import ident as rule_ident, sync_keys
from models.user import User
from lib.db import db
from routers.commission import _clean, _signature, _today, _validate, apply_rule_update, delete_rule, insert_rule
from routers.commission_grid import _conditions, agent_label

router = APIRouter()
admin_only = require_roles("admin")
RULE_FIELDS = set(CommissionRuleIn.model_fields) - {"apply_to_past"}


def _ident(r: dict) -> tuple:
    """Same conditions + same agent scope + same start date = the same rule (legacy documents read with defaults)."""
    return rule_ident(r)


async def _current(kind: Optional[str] = None) -> list[dict]:
    q: dict = {"superseded_by": None}
    if kind:
        q["kind"] = kind
    return await db.commission_rules.find(q, {"_id": 0}).to_list(5000)


async def _check(d: dict, exclude_id: str = "") -> Optional[str]:
    try:
        await _validate({**d, "id": exclude_id or "new"}, exclude_id)
    except HTTPException as e:
        return str(e.detail)
    return None


def _clean_or_error(fields: dict) -> tuple[Optional[dict], Optional[str]]:
    try:
        return _clean(CommissionRuleIn(**fields)), None
    except HTTPException as e:
        return None, str(e.detail)
    except ValueError as e:  # pydantic validation
        return None, str(e).split("\n")[-1][:200]


_COUNTER = {"create": "created", "update": "updated", "unchanged": "unchanged", "error": "errors"}


def _tally(res: RuleToolResult) -> RuleToolResult:
    for r in res.rows:
        setattr(res, _COUNTER[r.action], getattr(res, _COUNTER[r.action]) + 1)
    return res


# ---------- copy rules ----------
def _first_word(v: Optional[str]) -> str:
    """Company match the rule list uses: "ICICI", "ICICI Lombard" … are one company."""
    return ((v or "").strip().split() or [""])[0].lower()


def _is_target_rule(r: dict, body: RuleCopyIn) -> bool:
    if body.agent_id:
        return r.get("agent_id") == body.agent_id
    return body.broker_ids is not None and len(body.broker_ids) == 1 and body.broker_ids[0] in (r.get("broker_ids") or [])


def _target_conflicts(d: dict, live: list[dict], body: RuleCopyIn, source_ids: set[str]) -> list[dict]:
    """The target's own current rules for the same company and an overlapping product (no products = all products)."""
    a = set(d.get("products") or [])
    return [r for r in live if r["kind"] == d["kind"] and r["id"] not in source_ids and _is_target_rule(r, body)
            and _first_word(r.get("insurer")) == _first_word(d.get("insurer"))
            and (not a or not r.get("products") or bool(a & set(r["products"])))]


async def _target_label(body: RuleCopyIn) -> Optional[str]:
    if body.agent_id:
        u = await db.users.find_one({"id": body.agent_id, "role": "agent"}, {"_id": 0, "full_name": 1})
        if not u:
            raise HTTPException(status_code=404, detail="Partner not found")
        return u["full_name"]
    if body.broker_ids is not None and len(body.broker_ids) == 1:
        b = await db.brokers.find_one({"id": body.broker_ids[0]}, {"_id": 0, "name": 1})
        if not b:
            raise HTTPException(status_code=404, detail="Channel partner not found")
        return b["name"]
    return None


@router.post("/commission/rules/copy", response_model=RuleToolResult)
async def copy_rules(body: RuleCopyIn, _: User = Depends(admin_only)):
    """All-or-nothing: if any copy has a problem nothing is saved and every row shows its error.
    Copying to one channel partner / agent never touches the source rules; the target's own rules for the same company +
    product are kept (those copies skipped) unless on_conflict="overwrite", which stops only the target's rules."""
    sources = {r["id"]: r for r in await db.commission_rules.find({"id": {"$in": body.rule_ids}}, {"_id": 0}).to_list(500)}
    if len(sources) != len(set(body.rule_ids)):
        raise HTTPException(status_code=404, detail="Some selected rules no longer exist — refresh and try again")
    if body.agent_id and any(s["kind"] != "payable" for s in sources.values()):
        raise HTTPException(status_code=400, detail="Partners apply to payable rules only — receivable rules copy to a channel partner")
    target = await _target_label(body)
    today = _today()
    live = [r for r in await _current() if r.get("active", True) and (not r.get("valid_to") or r["valid_to"] >= today)]
    taken = {_ident(r): r["id"] for r in live}
    res, ready, stop = RuleToolResult(preview=body.preview), [], set()
    # rules in the set that already belong to the target are not copied — they count as the target's existing rules
    own = {sid for sid, s in sources.items() if target and _is_target_rule(s, body)}
    for sid in body.rule_ids:
        src = sources[sid]
        if sid in own:
            res.rows.append(RuleToolRow(key=sid, name=src["name"], action="unchanged", error=f"Already {target}'s own rule — not copied"))
            continue
        f = {k: src.get(k) for k in RULE_FIELDS if k in src}
        if body.insurer is not None:
            if src.get("insurer") and src["insurer"] in (f.get("name") or ""):
                f["name"] = f["name"].replace(src["insurer"], body.insurer.strip())
            f["insurer"] = body.insurer.strip() or None
        if body.broker_ids is not None:
            f["broker_ids"] = body.broker_ids
        if body.agent_id:
            f["agent_id"], f["agent_group"] = body.agent_id, None
        if target and target not in (f.get("name") or ""):
            f["name"] = f"{f.get('name') or 'Rule'} · {target}"
        if body.valid_from is not None:
            f["valid_from"] = body.valid_from or None
        if body.valid_to is not None:
            f["valid_to"] = body.valid_to or None
        if sid in body.rates:
            f.update(body.rates[sid].model_dump())
        f["active"] = True
        d, err = _clean_or_error(f)
        row = RuleToolRow(key=sid, name=(d or f).get("name") or src["name"], action="create")
        clash = _target_conflicts(d, live, body, set(sources) - own) if d and target and not err else []
        row.conflicts = [c["name"] for c in clash]
        if clash and body.on_conflict == "keep":
            row.action = "unchanged"  # default: target keeps its existing rules, this copy is skipped
            res.rows.append(row)
            continue
        if clash:
            shared = next((c for c in clash if body.broker_ids is not None and set(c.get("broker_ids") or []) != set(body.broker_ids)), None)
            if shared:
                err = f"\"{shared['name']}\" is shared with other channel partners — edit it on its own instead of overwriting"
        replaced = {c["id"] for c in clash}
        if d and not err and taken.get(_ident(d)) == "new":  # two source rules (e.g. different partners) collapse onto the target
            row.action, row.error = "unchanged", "Same conditions as another rule in this copy — only the first one is copied"
            res.rows.append(row)
            continue
        if d and not err and taken.get(_ident(d)) not in (None, *replaced):
            err = "An identical rule already exists — change the company, channel partner or start date"
        if d and not err:
            err = await _check(d)
        if err:
            row.action, row.error = "error", err
        res.rows.append(row)
        if d and not err:
            taken[_ident(d)] = "new"
            stop |= replaced
            ready.append((sid, d))
    _tally(res)
    if body.preview or res.errors:
        return res
    for cid in stop:  # only the target's own rules — sources are excluded in _target_conflicts
        await delete_rule(cid, _)
    by_key = {r.key: r for r in res.rows}
    for sid, d in ready:
        by_key[sid].rule_id = (await insert_rule(d)).id
    return res


# ---------- rate matrix ----------
def _cell_rule(base: dict, age: Optional[str], col: MatrixColumn) -> dict:
    return {**base, "vehicle_ages": [age] if age else [], "rtos": col.rtos, "gvw_min": col.gvw_min, "gvw_max": col.gvw_max}


def _same_cell(r: dict, want: dict) -> bool:
    """An existing rule fills a matrix cell when its conditions are exactly the cell's (nothing extra)."""
    eq = lambda k: sorted(r.get(k) or []) == sorted(want.get(k) or [])  # noqa: E731
    num = lambda k: (r.get(k) is None and want.get(k) is None) or (r.get(k) is not None and want.get(k) is not None and float(r[k]) == float(want[k]))  # noqa: E731
    return (r["kind"] == want["kind"] and (r.get("insurer") or "").lower() == want["insurer"].lower()
            and all(eq(k) for k in ("broker_ids", "products", "vehicle_ages", "rtos"))
            and all(num(k) for k in ("gvw_min", "gvw_max")) and (r.get("agent_group") or None) == want.get("agent_group")
            and (r.get("agent_id") or None) == want.get("agent_id")
            and not any(r.get(k) for k in ("makes", "fuel_types", "business_types", "model", "cc_min", "cc_max", "seating_min", "seating_max"))
            and (r.get("ncb") or "any") == "any" and (r.get("cover") or "any") == "any")


@router.post("/commission/matrix", response_model=RuleToolResult)
async def save_matrix(body: RateMatrixIn, _: User = Depends(admin_only)):
    """Each filled cell = one rule (company + partners + products + age band + RTO group / GVW slab). Existing rules
    for a cell get the new rate (versioned from `valid_from` / today); empty cells are left as they are."""
    if body.kind == "receivable" and (body.agent_group or body.agent_id):
        raise HTTPException(status_code=400, detail="Partner / group apply to payable rules only")
    current = [r for r in await _current(body.kind) if r.get("active", True)]
    base = {"kind": body.kind, "insurer": body.insurer.strip(), "broker_ids": sorted(set(body.broker_ids)), "products": body.products,
            "agent_group": body.agent_group or None, "agent_id": body.agent_id or None}
    res, todo = RuleToolResult(preview=body.preview), []
    for c in body.cells:
        if c.value is None:
            continue
        if c.col >= len(body.columns):
            raise HTTPException(status_code=400, detail="Cell column out of range")
        col = body.columns[c.col]
        key, label = f"{c.age or ''}|{c.col}", f"{c.age or 'All ages'} · {col.label}"
        want = _cell_rule(base, c.age, col)
        old = next((r for r in current if _same_cell(r, want)), None)
        if old:
            if old.get(body.component) is not None and float(old[body.component]) == c.value:
                res.rows.append(RuleToolRow(key=key, name=label, action="unchanged", rule_id=old["id"]))
                continue
            f = {k: old.get(k) for k in RULE_FIELDS if k in old}
            f[body.component] = c.value
            f["valid_from"] = body.valid_from or None
            d, err = _clean_or_error(f)
            err = err or await _check(d, old["id"])
            res.rows.append(RuleToolRow(key=key, name=label, action="error" if err else "update", error=err, rule_id=old["id"]))
            if not err:
                todo.append((key, old, d))
        else:
            name = " · ".join(x for x in (body.insurer.strip(), ", ".join(body.products) if len(body.products) <= 2 else f"{len(body.products)} products", c.age, col.label) if x)
            d, err = _clean_or_error({**want, "name": name[:120], "active": True, body.component: c.value, "valid_from": body.valid_from or None})
            err = err or await _check(d)
            res.rows.append(RuleToolRow(key=key, name=label, action="error" if err else "create", error=err))
            if not err:
                todo.append((key, None, d))
    _tally(res)
    if body.preview or res.errors:
        return res
    by_key = {r.key: r for r in res.rows}
    for key, old, d in todo:
        saved = await apply_rule_update(old, d) if old else await insert_rule(d)
        by_key[key].rule_id = saved.id
    return res


# ---------- reopen ended rules ----------
def _scope(r: dict) -> tuple:
    return (r["kind"], r.get("agent_group") or "", r.get("agent_id") or "", tuple(sorted(r.get("broker_ids") or [])), *_signature(r))


@router.post("/commission/rules/reopen-ended", response_model=RuleToolResult)
async def reopen_ended(body: ReopenRulesIn, _: User = Depends(admin_only)):
    """Clear the past To date of ended rules so they are current again. Skips rules a newer version already continues."""
    today = _today()
    live = await _current()
    res = RuleToolResult(preview=body.preview)
    todo: list[dict] = []
    for rid in dict.fromkeys(body.rule_ids):
        doc = next((r for r in live if r["id"] == rid), None)
        if not doc:
            res.rows.append(RuleToolRow(key=rid, name=rid, action="error", error="Rule not found (or an old version)"))
            continue
        row = RuleToolRow(key=rid, name=doc["name"], action="update", rule_id=rid)
        end = doc.get("valid_to")
        if not end or end >= today:
            row.action = "unchanged"
        else:
            nxt = next((r for r in live if r["id"] != rid and _scope(r) == _scope(doc) and (r.get("valid_from") or "") > end), None)
            err = f"A newer rule continues it from {nxt['valid_from']} — edit that one" if nxt else await _check({**doc, "valid_to": None}, rid)
            if err:
                row.action, row.error = "error", err
            else:
                todo.append(doc)
        res.rows.append(row)
    _tally(res)
    if body.preview or res.errors:
        return res
    now = datetime.now(timezone.utc)
    for doc in todo:
        await db.commission_rules.update_one({"id": doc["id"]}, {"$set": {"valid_to": None, "updated_at": now}})
        if doc["kind"] == "receivable":
            await note_receivable(doc["id"])
        else:
            await sync_keys({"id": doc["id"]})
    return res


# ---------- agent-wise payables ----------
def _rates_of(d: dict):
    from models.commission import CompareRates
    return CompareRates(**{k: d.get(k) for k in ("od_percent", "tp_percent", "net_percent", "odtp_percent", "flat_amount")})


def payable_source(rec: dict, agent_id: str, group: Optional[str], g: Optional[dict], pays: list[dict], today: str):
    """What an agent is paid on one receivable rule: agent rule > group margin > group rule > common rule > missing."""
    prods = rec.get("products") or []
    exact = next((p for p in pays if p.get("agent_id") == agent_id and _signature(p) == _signature(rec)), None)
    own = exact or next((p for p in pays if p.get("agent_id") == agent_id and overlaps(p, rec)), None)
    line = None if own else group_margin_line((g or {}).get("margins") or [], rec.get("insurer"), None, product_type_of(prods), today, single_product(prods))
    grp = None if own or line is not None else next((p for p in pays if group and p.get("agent_group") == group and not p.get("agent_id") and overlaps(p, rec)), None)
    common = None if own or line is not None or grp else next((p for p in pays if not p.get("agent_group") and not p.get("agent_id") and overlaps(p, rec)), None)
    if own:
        return "agent_rule", f"Partner rule · {own['name']}", _rates_of(own), exact
    if line is not None:
        return "group_margin", f"Group {group} margin ({margin_text(line)})", _rates_of(derive_payable(rec, line)), exact
    if grp:
        return "group_rule", f"Group {group} rule · {grp['name']}", _rates_of(grp), exact
    if common:
        return "common_rule", f"Common rule · {common['name']}", _rates_of(common), exact
    return "missing", "No payable — partner gets nothing", None, exact


@router.get("/commission/agent-payables/{agent_id}", response_model=AgentPayablesView)
async def agent_payables(agent_id: str, _: User = Depends(admin_only)):
    """Every current receivable rule and what this agent is paid on it — agent rule > group margin > group rule > common rule."""
    agent = await db.users.find_one({"id": agent_id, "role": "agent"}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=404, detail="Partner not found")
    group = agent.get("agent_group")
    g = await db.agent_groups.find_one({"name": group}, {"_id": 0}) if group else None
    today = _today()
    live = [r for r in await _current() if r.get("active", True) and (not r.get("valid_to") or r["valid_to"] >= today)]
    recs = sorted([r for r in live if r["kind"] == "receivable"], key=lambda r: ((r.get("insurer") or "~").lower(), r["name"].lower()))
    pays = [r for r in live if r["kind"] == "payable"]
    brokers = {b["id"]: b["name"] for b in await db.brokers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    view = AgentPayablesView(agent_id=agent_id, agent_label=agent_label(agent), agent_group=group)
    for rec in recs:
        prods = rec.get("products") or []
        ptype = product_type_of(prods)
        product = "All products" if not prods else (f"{ptype} (all)" if ptype and set(prods) == set(PRODUCT_TYPES.get(ptype, [])) else ", ".join(prods))
        src, label, rates, exact = payable_source(rec, agent_id, group, g, pays, today)
        view.rows.append(AgentPayableRow(
            receivable_id=rec["id"], insurer=rec.get("insurer"), product=product, products=prods,
            broker=", ".join(brokers.get(b, "") for b in rec.get("broker_ids") or []) or None, receivable_name=rec["name"],
            conditions=_conditions(rec), receivable=_rates_of(rec), payable=rates, source=src, source_label=label,
            agent_rule_id=exact["id"] if exact else None))
    return view


@router.post("/commission/agent-payables", response_model=RuleToolResult)
async def save_agent_payables(body: AgentPayablesIn, _: User = Depends(admin_only)):
    """Edited cells → the agent's own payable rule with exactly the receivable's conditions (created or updated)."""
    agent = await db.users.find_one({"id": body.agent_id, "role": "agent"}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=404, detail="Partner not found")
    current = await _current()
    by_id = {r["id"]: r for r in current}
    mine = [r for r in current if r["kind"] == "payable" and r.get("agent_id") == body.agent_id]
    res, todo = RuleToolResult(preview=body.preview), []
    for e in body.rows:
        rec = by_id.get(e.receivable_id)
        if not rec or rec["kind"] != "receivable":
            res.rows.append(RuleToolRow(key=e.receivable_id, name="?", action="error", error="Receivable rule not found — refresh"))
            continue
        rates = e.rates.model_dump()
        old = next((p for p in mine if _signature(p) == _signature(rec)), None)
        if old:
            if all((old.get(k) is None and v is None) or (old.get(k) is not None and v is not None and float(old[k]) == v) for k, v in rates.items()):
                res.rows.append(RuleToolRow(key=e.receivable_id, name=old["name"], action="unchanged", rule_id=old["id"]))
                continue
            f = {**{k: old.get(k) for k in RULE_FIELDS if k in old}, **rates, "valid_from": body.valid_from or None, "valid_to": body.valid_to or old.get("valid_to")}
            d, err = _clean_or_error(f)
            err = err or await _check(d, old["id"])
            res.rows.append(RuleToolRow(key=e.receivable_id, name=old["name"], action="error" if err else "update", error=err, rule_id=old["id"]))
            if not err:
                todo.append((e.receivable_id, old, d))
            continue
        if not any(v is not None for v in rates.values()):
            continue
        f = {k: rec.get(k) for k in RULE_FIELDS if k in rec}
        f.update(rates, kind="payable", agent_id=body.agent_id, agent_group=None, active=True, valid_from=body.valid_from or rec.get("valid_from"),
                 valid_to=body.valid_to or rec.get("valid_to"),
                 name=f"{rec['name']} · {agent['username'].upper()}"[:120])
        d, err = _clean_or_error(f)
        err = err or await _check(d)
        res.rows.append(RuleToolRow(key=e.receivable_id, name=f["name"], action="error" if err else "create", error=err))
        if not err:
            todo.append((e.receivable_id, None, d))
    _tally(res)
    if body.preview or res.errors:
        return res
    by_key = {r.key: r for r in res.rows}
    for key, old, d in todo:
        by_key[key].rule_id = (await apply_rule_update(old, d) if old else await insert_rule(d)).id
    await detach_from_group(body.agent_id, skip={k for k, _, _ in todo})
    return res


@router.post("/commission/rules", response_model=CommissionRule)
async def create_rule(body: CommissionRuleIn, _: User = Depends(admin_only)):
    """Lives here (not routers/commission.py) so commission.py never imports rule_tools — no circular import."""
    rule = await insert_rule(_clean(body))
    if rule.kind == "payable" and rule.agent_id:  # agent-specific payable → agent leaves their group (groups phased out)
        await detach_from_group(rule.agent_id, skip=set())
    return rule


async def detach_from_group(agent_id: str, skip: set[str] = frozenset()) -> int:
    """Agent now has their own payables → copy whatever the group still gives them into agent rules (so nothing is
    lost), then take the agent out of the group. Agent groups are being phased out."""
    agent = await db.users.find_one({"id": agent_id, "role": "agent"}, {"_id": 0, "agent_group": 1, "username": 1})
    if not agent or not agent.get("agent_group"):
        return 0
    view, n = await agent_payables(agent_id), 0
    recs = {r["id"]: r for r in await _current("receivable")}
    for row in view.rows:
        if row.receivable_id in skip or row.source not in ("group_margin", "group_rule") or not row.payable or row.receivable_id not in recs:
            continue
        rec = recs[row.receivable_id]
        f = {k: rec.get(k) for k in RULE_FIELDS if k in rec}
        f.update(row.payable.model_dump(), kind="payable", agent_id=agent_id, agent_group=None, active=True,
                 name=f"{rec['name']} · {agent['username'].upper()}"[:120])
        d, err = _clean_or_error(f)
        if d and not (err or await _check(d)):
            await insert_rule(d)
            n += 1
    await db.users.update_one({"id": agent_id}, {"$set": {"agent_group": None}})
    return n
