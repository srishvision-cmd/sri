"""Bulk rule tools: copy rules to another company / channel partner / date, and the rate matrix editor."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_roles
from models.commission import (
    CommissionRuleIn, MatrixColumn, RateMatrixIn, RuleCopyIn, RuleToolResult, RuleToolRow,
)
from models.user import User
from lib.db import db
from routers.commission import _clean, _signature, _validate, apply_rule_update, insert_rule

router = APIRouter()
admin_only = require_roles("admin")
RULE_FIELDS = set(CommissionRuleIn.model_fields) - {"apply_to_past"}


def _ident(r: dict) -> tuple:
    """Same conditions + same agent scope + same start date = the same rule."""
    return (r["kind"], r.get("agent_group") or "", r.get("agent_id") or "", r.get("valid_from") or "", *_signature(r))


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
@router.post("/commission/rules/copy", response_model=RuleToolResult)
async def copy_rules(body: RuleCopyIn, _: User = Depends(admin_only)):
    """All-or-nothing: if any copy has a problem nothing is saved and every row shows its error."""
    sources = {r["id"]: r for r in await db.commission_rules.find({"id": {"$in": body.rule_ids}}, {"_id": 0}).to_list(500)}
    if len(sources) != len(set(body.rule_ids)):
        raise HTTPException(status_code=404, detail="Some selected rules no longer exist — refresh and try again")
    taken = {_ident(r) for r in await _current()}
    res, ready = RuleToolResult(preview=body.preview), []
    for sid in body.rule_ids:
        src = sources[sid]
        f = {k: src.get(k) for k in RULE_FIELDS if k in src}
        if body.insurer is not None:
            if src.get("insurer") and src["insurer"] in (f.get("name") or ""):
                f["name"] = f["name"].replace(src["insurer"], body.insurer.strip())
            f["insurer"] = body.insurer.strip() or None
        if body.broker_ids is not None:
            f["broker_ids"] = body.broker_ids
        if body.valid_from is not None:
            f["valid_from"] = body.valid_from or None
        if body.valid_to is not None:
            f["valid_to"] = body.valid_to or None
        if sid in body.rates:
            f.update(body.rates[sid].model_dump())
        f["active"] = True
        d, err = _clean_or_error(f)
        if d and _ident(d) in taken:
            err = "An identical rule already exists — change the company, channel partner or start date"
        if d and not err:
            err = await _check(d)
        res.rows.append(RuleToolRow(key=sid, name=(d or f).get("name") or src["name"], action="error" if err else "create", error=err))
        if d and not err:
            taken.add(_ident(d))
            ready.append((sid, d))
    _tally(res)
    if body.preview or res.errors:
        return res
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
        raise HTTPException(status_code=400, detail="Agent / group apply to payable rules only")
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
