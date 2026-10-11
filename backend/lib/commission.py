"""Commission grid matching: pick the most specific active rule, compute ₹ amounts, enforce payable ≤ receivable."""

import re
from typing import List, Optional

from lib.db import db
from models.commission import COMPONENTS, CommissionResult, RuleMiss
from models.masters import CNG_LPG, INSURER_KEYWORDS, NON_DIESEL, masters
from models.policy import age_band, derive_fields

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
        "cover": "satp" if f.get("cover_type") == "Liability Only" else "saod" if f.get("cover_type") == "Standalone OD" else "package",
        "gvw": _kg(f.get("gvw")),
        "cc": f.get("cc"),
        "seating": f.get("seating_capacity"),
        "age_band": age_band(f.get("vehicle_age_years")),
        "fuel": _fuel(f.get("fuel_type")),
        "business_type": f.get("business_type"),
        "make": f.get("make"),
        "model": f.get("model"),
        "start": (f.get("start_date") or "")[:10] or _ist_date(doc.get("created_at")),
        "od": f.get("od_premium") or 0,
        "tp": f.get("tp_premium") or 0,
        "net": f.get("net_premium") or 0,
    }


def _ist_date(v) -> Optional[str]:
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo

    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).astimezone(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")
    return str(v)[:10] if v else None


def _in_list(v: Optional[str], allowed: list) -> bool:
    """'Other than Diesel' accepts any known fuel except Diesel; 'CNG/LPG' accepts either."""
    return v in allowed or (NON_DIESEL in allowed and v is not None and v != "Diesel") or (CNG_LPG in allowed and v in ("CNG", "LPG"))


def _kg(v) -> Optional[float]:
    """GVW is graded in kg; OCR sometimes returns tonnes (e.g. 16.2) — normalise."""
    if v is None:
        return None
    return v * 1000 if 0 < v < 100 else v


def explain(rule: dict, ctx: dict, brokers: dict) -> List[str]:
    """Human-readable list of the conditions this policy fails for the rule (empty = matches)."""
    out: List[str] = []
    if rule.get("insurer") and not insurer_matches(rule["insurer"], ctx["insurer"]):
        out.append(f"Insurer is '{ctx['insurer'] or 'blank'}', rule needs {rule['insurer']}")
    if rule.get("broker_id") and rule["broker_id"] != ctx.get("broker_id"):
        out.append(f"Policy broker is '{brokers.get(ctx.get('broker_id')) or 'not set'}', rule needs {brokers.get(rule['broker_id'], 'another broker')}")
    if rule.get("agent_id") and rule["agent_id"] != ctx.get("agent_id"):
        out.append("Policy belongs to a different agent")
    if rule.get("agent_group") and rule["agent_group"] != ctx.get("agent_group"):
        out.append(f"Agent group is '{ctx.get('agent_group') or 'none'}', rule needs Group {rule['agent_group']}")
    if rule.get("products") and ctx["product"] not in rule["products"]:
        out.append(f"Common product is '{ctx['product'] or 'blank'}', rule needs {', '.join(rule['products'])}")
    if rule.get("rtos"):
        rto = _norm_rto(ctx["rto"])
        if not rto or not any(rto.startswith(_norm_rto(p)) for p in rule["rtos"]):
            out.append(f"RTO is '{rto or 'blank'}', rule needs {', '.join(rule['rtos'])}")
    for key, ck, label in (("vehicle_ages", "age_band", "Vehicle age"), ("fuel_types", "fuel", "Fuel"), ("business_types", "business_type", "Business type")):
        if rule.get(key) and not _in_list(ctx[ck], rule[key]):
            out.append(f"{label} is '{ctx[ck] or 'blank'}', rule needs {', '.join(rule[key])}")
    ncb = rule.get("ncb") or "any"
    if ncb != "any" and ((ctx["ncb"] or 0) > 0) != (ncb == "with"):
        out.append(f"NCB is {ctx['ncb'] or 0}%, rule needs {'with' if ncb == 'with' else 'without'} NCB")
    cover = rule.get("cover") or "any"
    if cover != "any" and ctx["cover"] != cover:
        out.append(f"Cover is {ctx['cover'].upper()}, rule needs {cover.upper()} only")
    for dim, label in (("gvw", "GVW"), ("cc", "CC"), ("seating", "Seating")):
        lo, hi = rule.get(f"{dim}_min"), rule.get(f"{dim}_max")
        if (lo is not None or hi is not None) and not _in_range(ctx[dim], lo, hi):
            out.append(f"{label} is {ctx[dim] if ctx[dim] is not None else 'blank'}, rule needs {lo if lo is not None else 0}–{hi if hi is not None else '∞'}")
    if rule.get("makes") and not any(make_matches(m, ctx["make"]) for m in rule["makes"]):
        out.append(f"Make is '{ctx['make'] or 'blank'}', rule needs {', '.join(rule['makes'])}")
    if rule.get("model") and _lc(rule["model"]) not in _lc(ctx["model"]):
        out.append(f"Model is '{ctx['model'] or 'blank'}', rule needs {rule['model']}")
    start = ctx["start"]
    if (rule.get("valid_from") and (not start or start < rule["valid_from"])) or (rule.get("valid_to") and (not start or start > rule["valid_to"])):
        out.append(f"Risk start {start or 'blank'} is outside the rule dates")
    return out


async def explain_policy(doc: dict) -> List[RuleMiss]:
    rules, agents = await load_context()
    brokers = {b["id"]: b["name"] for b in await db.brokers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    ctx = policy_context(doc, agents.get(doc.get("agent_id")))
    misses = [RuleMiss(rule_id=r["id"], rule_name=r["name"], kind=r["kind"], reasons=why) for r in rules if (why := explain(r, ctx, brokers))]
    return sorted(misses, key=lambda m: len(m.reasons))[:8]  # closest misses first


def _fuel(v) -> Optional[str]:
    s = str(v or "").lower()
    for key, name in (("hybrid", "Hybrid"), ("electric", "Electric"), ("ev", "Electric"), ("cng", "CNG"), ("lpg", "LPG"), ("diesel", "Diesel"), ("petrol", "Petrol")):
        if re.search(rf"\b{key}\b", s):
            return name
    return None


def _words(s) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).split())


CUSTOM_INSURERS: dict[str, list[str]] = {}  # admin-added companies → keywords (refreshed from db)


async def refresh_custom_insurers() -> None:
    docs = await db.insurers.find({}, {"_id": 0, "name": 1, "keywords": 1}).to_list(500)
    CUSTOM_INSURERS.clear()
    CUSTOM_INSURERS.update({d["name"]: d.get("keywords") or [] for d in docs})


def insurer_matches(rule_insurer: str, policy_insurer) -> bool:
    text = _words(policy_insurer)
    keys = INSURER_KEYWORDS.get(rule_insurer) or [_words(k) for k in CUSTOM_INSURERS.get(rule_insurer, [])] or [_words(rule_insurer)]
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
    for key, ck in (("vehicle_ages", "age_band"), ("fuel_types", "fuel"), ("business_types", "business_type")):
        if rule.get(key):
            if not _in_list(ctx[ck], rule[key]):
                return None
            score += 1
    ncb = rule.get("ncb") or "any"
    if ncb != "any":
        has = (ctx["ncb"] or 0) > 0
        if has != (ncb == "with"):
            return None
        score += 1
    cover = rule.get("cover") or "any"
    if cover != "any":
        if ctx["cover"] != cover:
            return None
        score += 1
    for dim in ("gvw", "cc", "seating"):
        lo, hi = rule.get(f"{dim}_min"), rule.get(f"{dim}_max")
        if lo is not None or hi is not None:
            if not _in_range(ctx[dim], lo, hi):
                return None
            score += 1
    if rule.get("makes"):
        if not any(make_matches(m, ctx["make"]) for m in rule["makes"]):
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


def rate_text(rule: dict) -> Optional[str]:
    """Commission % of a rule in words: 'OD 15% + TP 2%' (flat amounts as Rs)."""
    parts = [f"{LABEL[k].replace(' %', '')} {rule[k]:g}%" for k in ("od_percent", "tp_percent", "net_percent", "odtp_percent") if rule.get(k) is not None]
    if rule.get("flat_amount") is not None:
        parts.append(f"Flat Rs {rule['flat_amount']:g}")
    return " + ".join(parts) or None


def compute(doc: dict, rules: List[dict], agent: Optional[dict]) -> CommissionResult:
    ctx = policy_context(doc, agent)
    rec = best_rule([r for r in rules if r["kind"] == "receivable"], ctx)
    payables = [r for r in rules if r["kind"] == "payable"]
    res = CommissionResult()
    if rec:
        res.receivable, res.receivable_rule_id, res.receivable_rule_name = amount(rec, ctx), rec["id"], rec["name"]
    pay = best_rule([r for r in payables if r.get("agent_id")], ctx)  # the agent's personal rule always wins
    ptype = product_type_of([ctx["product"]] if ctx["product"] else []) or (product_type_of(rec.get("products") or []) if rec else None)
    m = group_margin((agent or {}).get("margins") or [], rec.get("insurer"), ctx["insurer"], ptype, ctx["start"] or None, ctx["product"]) if rec and not pay else None
    if m is not None:  # auto grid: receivable minus the group's margin for this company
        derived = derive_payable(rec, m)
        res.payable, res.payable_rule_id, res.payable_rate = amount(derived, ctx), f"auto:{rec['id']}", rate_text(derived)
        res.payable_rule_name = f"Auto · {rec['name']} − {m:g}% (Group {agent.get('agent_group')})"
    elif not pay:
        pay = best_rule(payables, ctx)
    if pay:
        res.payable, res.payable_rule_id, res.payable_rule_name, res.payable_rate = amount(pay, ctx), pay["id"], pay["name"], rate_text(pay)
        limit = res.receivable or 0
        if res.payable > limit:  # payable to agent may never exceed what the broker pays us
            res.capped = True
            res.note = "Payable capped at receivable" if rec else "No receivable rule matches — payable held at ₹0"
            res.payable = limit
    if res.receivable is not None or res.payable is not None:
        res.margin = round((res.receivable or 0) - (res.payable or 0), 2)
    return res


async def load_context() -> tuple[List[dict], dict]:
    await refresh_custom_insurers()
    rules = await db.commission_rules.find({"active": True}, {"_id": 0}).to_list(5000)
    agents = await db.users.find({"role": "agent"}, {"_id": 0, "id": 1, "agent_group": 1}).to_list(5000)
    groups = {g["name"]: g.get("margins") or [] for g in await db.agent_groups.find({}, {"_id": 0, "name": 1, "margins": 1}).to_list(200)}
    for a in agents:
        a["margins"] = groups.get(a.get("agent_group") or "", [])
    return rules, {a["id"]: a for a in agents}


def product_type_of(products: List[str]) -> Optional[str]:
    """'Private Car' / 'PCV' / 'GCV'… when every product belongs to one type, else None."""
    if not products:
        return None
    types = {t for t, items in masters().product_types.items() for p in products if p in items}
    return types.pop() if len(types) == 1 else None


def group_margin(margins: List[dict], rule_insurer: Optional[str], policy_insurer=None, ptype: Optional[str] = None, on: Optional[str] = None,
                 product: Optional[str] = None) -> Optional[float]:
    """Most specific margin wins: company > all companies, then specific product > product type > all products.
    `on` = policy risk-start date (YYYY-MM-DD); only lines whose dates cover it count."""
    best, best_score = None, -1
    for m in margins:
        if on and ((m.get("valid_from") and on < m["valid_from"]) or (m.get("valid_to") and on > m["valid_to"])):
            continue
        if m.get("product_type") and m["product_type"] != ptype:
            continue
        if m.get("product") and m["product"] != product:
            continue
        if m.get("insurer"):
            hit = (rule_insurer and m["insurer"] == rule_insurer) or (not rule_insurer and policy_insurer and insurer_matches(m["insurer"], policy_insurer))
            if not hit:
                continue
        score = (4 if m.get("insurer") else 0) + (2 if m.get("product") else 0) + (1 if m.get("product_type") else 0)
        if score > best_score:
            best, best_score = m["margin"], score
    return best


PCT_KEYS = ("od_percent", "tp_percent", "net_percent", "odtp_percent")


def derive_payable(rec: dict, margin: float) -> dict:
    """Receivable rule → payable rates for a group (percentage points less, never below 0)."""
    d = dict(rec)
    for k in PCT_KEYS:
        if d.get(k) is not None:
            d[k] = round(max(0.0, d[k] - margin), 4)
    return d


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


def _overlap_makes(a: list, b: list) -> bool:
    return not a or not b or any(_overlap_text(x, y) for x in a for y in b)


def _overlap_rto(a: list, b: list) -> bool:
    if not a or not b:
        return True
    return any(_norm_rto(x).startswith(_norm_rto(y)) or _norm_rto(y).startswith(_norm_rto(x)) for x in a for y in b)


def _overlap_range(lo1, hi1, lo2, hi2) -> bool:
    lo = max(v for v in (lo1, lo2, float("-inf")) if v is not None)
    hi = min(v for v in (hi1, hi2, float("inf")) if v is not None)
    return lo <= hi


def overlaps(p: dict, r: dict) -> bool:
    if not (_overlap_text(p.get("insurer"), r.get("insurer")) and _overlap_makes(p.get("makes") or [], r.get("makes") or []) and _overlap_text(p.get("model"), r.get("model"))):
        return False
    if p.get("broker_id") and r.get("broker_id") and p["broker_id"] != r["broker_id"]:
        return False
    for key in ("vehicle_ages", "fuel_types", "business_types"):
        if not _overlap_list(p.get(key) or [], r.get(key) or []):
            return False
    if not (_overlap_list(p.get("products") or [], r.get("products") or []) and _overlap_rto(p.get("rtos") or [], r.get("rtos") or [])):
        return False
    n1, n2 = p.get("ncb") or "any", r.get("ncb") or "any"
    if "any" not in (n1, n2) and n1 != n2:
        return False
    c1, c2 = p.get("cover") or "any", r.get("cover") or "any"
    if "any" not in (c1, c2) and c1 != c2:
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


def single_product(products: List[str]) -> Optional[str]:
    return products[0] if len(products or []) == 1 else None


def chain_margins(margins: List[dict]) -> List[dict]:
    """Sort lines; for the same company + product each line ends the day before the next one starts (ended lines keep their stop date)."""
    from datetime import date, timedelta
    key = lambda m: (m.get("insurer") or "", m.get("product_type") or "", m.get("product") or "")  # noqa: E731
    margins = sorted(margins, key=lambda m: (*key(m), m.get("valid_from") or ""))
    for cur, nxt in zip(margins, margins[1:] + [None]):
        if nxt and key(nxt) == key(cur):
            nxt_end = (date.fromisoformat(nxt["valid_from"]) - timedelta(days=1)).isoformat()
            cur["valid_to"] = min(cur["valid_to"], nxt_end) if cur.get("ended") and cur.get("valid_to") else nxt_end
        elif not cur.get("ended"):
            cur["valid_to"] = None
    return margins
