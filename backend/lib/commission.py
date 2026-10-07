"""Commission grid matching: pick the most specific active rule, compute ₹ amounts, enforce payable ≤ receivable."""

import re
from typing import List, Optional

from lib.db import db
from models.commission import COMPONENTS, CommissionResult
from models.masters import INSURER_KEYWORDS
from models.policy import derive_fields

PCT = ("od_percent", "tp_percent", "net_percent", "odtp_percent")


def _lc(v) -> str:
    return str(v or "").strip().lower()


def _norm_rto(v) -> str:
    return str(v or "").upper().replace(" ", "").replace("-", "")


def policy_context(doc: dict, agent: Optional[dict] = None) -> dict:
    f = derive_fields(doc.get("fields") or {})
    return {
        "insurer": f.get("insurer"),
        "broker_id": doc.get("broker_id"),
        "agent_id": doc.get("agent_id"),
        "agent_group": (agent or {}).get("agent_group"),
        "product": f.get("product_category"),
        "rto": f.get("rto") or f.get("vehicle_reg_no"),
        "ncb": f.get("ncb_percent"),
        "gvw": f.get("gvw"),
        "cc": f.get("cc"),
        "seating": f.get("seating_capacity"),
        "make": f.get("make"),
        "model": f.get("model"),
        "start": (f.get("start_date") or "")[:10] or None,
        "od": f.get("od_premium") or 0,
        "tp": f.get("tp_premium") or 0,
        "net": f.get("net_premium") or 0,
    }


def _words(s) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).split())


def insurer_matches(rule_insurer: str, policy_insurer) -> bool:
    text = _words(policy_insurer)
    keys = INSURER_KEYWORDS.get(rule_insurer) or [_words(rule_insurer)]
    return bool(text) and any(k in text for k in keys)


def make_matches(rule_make: str, policy_make) -> bool:
    """'Maruti Suzuki' matches OCR 'MARUTI' / 'MARUTI SUZUKI INDIA LTD' — compare on the first word."""
    a, b = _words(rule_make), _words(policy_make)
    if not a or not b:
        return False
    return a in b or b in a or a.split()[0] == b.split()[0]


def _in_range(v, lo, hi) -> bool:
    if lo is None and hi is None:
        return True
    if v is None:
        return False
    return (lo is None or v >= lo) and (hi is None or v <= hi)


def match_score(rule: dict, ctx: dict) -> Optional[int]:
    """Number of conditions the rule sets (all must match), or None if it doesn't apply."""
    score = 0
    if rule.get("insurer"):
        if not insurer_matches(rule["insurer"], ctx["insurer"]):
            return None
        score += 1
    for key in ("broker_id", "agent_id", "agent_group"):
        if rule.get(key):
            if rule[key] != ctx.get(key):
                return None
            score += 1
    if rule.get("products"):
        if ctx["product"] not in rule["products"]:
            return None
        score += 1
    if rule.get("rtos"):
        rto = _norm_rto(ctx["rto"])
        if not rto or not any(rto.startswith(_norm_rto(p)) for p in rule["rtos"]):
            return None
        score += 1
    ncb = rule.get("ncb") or "any"
    if ncb != "any":
        has = (ctx["ncb"] or 0) > 0
        if has != (ncb == "with"):
            return None
        score += 1
    for dim in ("gvw", "cc", "seating"):
        lo, hi = rule.get(f"{dim}_min"), rule.get(f"{dim}_max")
        if lo is not None or hi is not None:
            if not _in_range(ctx[dim], lo, hi):
                return None
            score += 1
    if rule.get("make"):
        if not make_matches(rule["make"], ctx["make"]):
            return None
        score += 1
    if rule.get("model"):
        if _lc(rule["model"]) not in _lc(ctx["model"]):
            return None
        score += 1
    start = ctx["start"]
    if rule.get("valid_from") and (not start or start < rule["valid_from"]):
        return None
    if rule.get("valid_to") and (not start or start > rule["valid_to"]):
        return None
    return score


def best_rule(rules: List[dict], ctx: dict) -> Optional[dict]:
    scored = [(s, r) for r in rules if (s := match_score(r, ctx)) is not None]
    if not scored:
        return None
    return max(scored, key=lambda sr: (sr[0], str(sr[1].get("updated_at") or "")))[1]


def amount(rule: dict, ctx: dict) -> float:
    pct = lambda k: (rule.get(k) or 0) / 100  # noqa: E731
    total = pct("od_percent") * ctx["od"] + pct("tp_percent") * ctx["tp"] + pct("net_percent") * ctx["net"]
    total += pct("odtp_percent") * (ctx["od"] + ctx["tp"]) + (rule.get("flat_amount") or 0)
    return round(total, 2)


def compute(doc: dict, rules: List[dict], agent: Optional[dict]) -> CommissionResult:
    ctx = policy_context(doc, agent)
    rec = best_rule([r for r in rules if r["kind"] == "receivable"], ctx)
    pay = best_rule([r for r in rules if r["kind"] == "payable"], ctx)
    res = CommissionResult()
    if rec:
        res.receivable, res.receivable_rule_id, res.receivable_rule_name = amount(rec, ctx), rec["id"], rec["name"]
    if pay:
        res.payable, res.payable_rule_id, res.payable_rule_name = amount(pay, ctx), pay["id"], pay["name"]
        limit = res.receivable or 0
        if res.payable > limit:  # payable to agent may never exceed what the broker pays us
            res.capped = True
            res.note = "Payable capped at receivable" if rec else "No receivable rule matches — payable held at ₹0"
            res.payable = limit
    if res.receivable is not None or res.payable is not None:
        res.margin = round((res.receivable or 0) - (res.payable or 0), 2)
    return res


async def load_context() -> tuple[List[dict], dict]:
    rules = await db.commission_rules.find({"active": True}, {"_id": 0}).to_list(5000)
    agents = await db.users.find({"role": "agent"}, {"_id": 0, "id": 1, "agent_group": 1}).to_list(5000)
    return rules, {a["id"]: a for a in agents}


async def commissions_for(docs: List[dict]) -> dict:
    rules, agents = await load_context()
    if not rules:
        return {}
    return {d["id"]: compute(d, rules, agents.get(d.get("agent_id"))) for d in docs}


# ---------- grid validation: payable must not exceed overlapping receivable ----------
def _overlap_text(a, b) -> bool:
    return not a or not b or _lc(a) in _lc(b) or _lc(b) in _lc(a)


def _overlap_list(a: list, b: list) -> bool:
    return not a or not b or bool(set(a) & set(b))


def _overlap_rto(a: list, b: list) -> bool:
    if not a or not b:
        return True
    return any(_norm_rto(x).startswith(_norm_rto(y)) or _norm_rto(y).startswith(_norm_rto(x)) for x in a for y in b)


def _overlap_range(lo1, hi1, lo2, hi2) -> bool:
    lo = max(v for v in (lo1, lo2, float("-inf")) if v is not None)
    hi = min(v for v in (hi1, hi2, float("inf")) if v is not None)
    return lo <= hi


def overlaps(p: dict, r: dict) -> bool:
    if not (_overlap_text(p.get("insurer"), r.get("insurer")) and _overlap_text(p.get("make"), r.get("make")) and _overlap_text(p.get("model"), r.get("model"))):
        return False
    if p.get("broker_id") and r.get("broker_id") and p["broker_id"] != r["broker_id"]:
        return False
    if not (_overlap_list(p.get("products") or [], r.get("products") or []) and _overlap_rto(p.get("rtos") or [], r.get("rtos") or [])):
        return False
    n1, n2 = p.get("ncb") or "any", r.get("ncb") or "any"
    if "any" not in (n1, n2) and n1 != n2:
        return False
    for dim in ("gvw", "cc", "seating"):
        if not _overlap_range(p.get(f"{dim}_min"), p.get(f"{dim}_max"), r.get(f"{dim}_min"), r.get(f"{dim}_max")):
            return False
    lo = max(v for v in (p.get("valid_from"), r.get("valid_from"), "0000") if v)
    hi = min(v for v in (p.get("valid_to"), r.get("valid_to"), "9999") if v)
    return lo <= hi


LABEL = {"od_percent": "OD %", "tp_percent": "TP %", "net_percent": "Net %", "odtp_percent": "OD+TP %", "flat_amount": "Flat ₹"}


def check_against(payable: dict, receivables: List[dict]) -> Optional[str]:
    """Error text if any commission component of the payable rule exceeds an overlapping receivable rule."""
    for r in receivables:
        if not r.get("active", True) or not overlaps(payable, r):
            continue
        for c in COMPONENTS:
            pv, rv = payable.get(c), r.get(c)
            if pv is not None and pv > (rv or 0) and (rv is not None or any(r.get(k) is not None for k in COMPONENTS)):
                return f"Payable {LABEL[c]} {pv:g} exceeds receivable {LABEL[c]} {rv or 0:g} in rule '{r['name']}'"
    return None
