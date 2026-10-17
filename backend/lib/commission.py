"""Commission grid matching: pick the most specific active rule, compute ₹ amounts, enforce payable ≤ receivable."""

import re
from typing import List, Optional

from lib.dates import today_iso
from models.common import now_utc
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


# ---- rule conditions: one table drives both matching (match_score) and the "why not" text (explain) ----
# Each check returns None when the rule does not set that condition, else whether the policy meets it.
def _rto_ok(rule: dict, ctx: dict) -> bool:
    rto = _norm_rto(ctx["rto"])
    return bool(rto) and any(rto.startswith(_norm_rto(p)) for p in rule["rtos"])


def _list_cond(key: str, ck: str, label: str):
    check = lambda r, c: (_in_list(c[ck], r[key]) if r.get(key) else None)  # noqa: E731
    why = lambda r, c, _b: f"{label} is '{c[ck] or 'blank'}', rule needs {', '.join(r[key])}"  # noqa: E731
    return check, why, True


def _range_cond(dim: str, label: str):
    def check(r, c):
        lo, hi = r.get(f"{dim}_min"), r.get(f"{dim}_max")
        return None if lo is None and hi is None else _in_range(c[dim], lo, hi)

    def why(r, c, _b):
        lo, hi = r.get(f"{dim}_min"), r.get(f"{dim}_max")
        return f"{label} is {c[dim] if c[dim] is not None else 'blank'}, rule needs {lo if lo is not None else 0}–{hi if hi is not None else '∞'}"
    return check, why, True


def _dates_ok(r: dict, c: dict) -> Optional[bool]:
    if not (r.get("valid_from") or r.get("valid_to")):
        return None
    start = c["start"]
    return not ((r.get("valid_from") and (not start or start < r["valid_from"])) or (r.get("valid_to") and (not start or start > r["valid_to"])))


def _broker_why(r: dict, c: dict, brokers: dict) -> str:
    need = " / ".join(brokers.get(b, "another partner") for b in r["broker_ids"])
    return f"Policy broker is '{brokers.get(c.get('broker_id')) or 'not set'}', rule needs {need}"


_NCB = lambda r: r.get("ncb") or "any"  # noqa: E731
_COVER = lambda r: r.get("cover") or "any"  # noqa: E731

# (check, reason, counts toward the specificity score) — order = order of the reasons shown to the user
CONDITIONS = [
    (lambda r, c: insurer_matches(r["insurer"], c["insurer"]) if r.get("insurer") else None,
     lambda r, c, _b: f"Insurer is '{c['insurer'] or 'blank'}', rule needs {r['insurer']}", True),
    (lambda r, c: c.get("broker_id") in r["broker_ids"] if r.get("broker_ids") else None, _broker_why, True),
    (lambda r, c: r["agent_id"] == c.get("agent_id") if r.get("agent_id") else None,
     lambda r, c, _b: "Policy belongs to a different partner", True),
    (lambda r, c: r["agent_group"] == c.get("agent_group") if r.get("agent_group") else None,
     lambda r, c, _b: f"Partner group is '{c.get('agent_group') or 'none'}', rule needs Group {r['agent_group']}", True),
    (lambda r, c: c["product"] in r["products"] if r.get("products") else None,
     lambda r, c, _b: f"Common product is '{c['product'] or 'blank'}', rule needs {', '.join(r['products'])}", True),
    (lambda r, c: _rto_ok(r, c) if r.get("rtos") else None,
     lambda r, c, _b: f"RTO is '{_norm_rto(c['rto']) or 'blank'}', rule needs {', '.join(r['rtos'])}", True),
    _list_cond("vehicle_ages", "age_band", "Vehicle age"),
    _list_cond("fuel_types", "fuel", "Fuel"),
    _list_cond("business_types", "business_type", "Business type"),
    (lambda r, c: None if _NCB(r) == "any" else ((c["ncb"] or 0) > 0) == (_NCB(r) == "with"),
     lambda r, c, _b: f"NCB is {c['ncb'] or 0}%, rule needs {'with' if _NCB(r) == 'with' else 'without'} NCB", True),
    (lambda r, c: None if _COVER(r) == "any" else c["cover"] == _COVER(r),
     lambda r, c, _b: f"Cover is {c['cover'].upper()}, rule needs {_COVER(r).upper()} only", True),
    _range_cond("gvw", "GVW"),
    _range_cond("cc", "CC"),
    _range_cond("seating", "Seating"),
    (lambda r, c: any(make_matches(m, c["make"]) for m in r["makes"]) if r.get("makes") else None,
     lambda r, c, _b: f"Make is '{c['make'] or 'blank'}', rule needs {', '.join(r['makes'])}", True),
    (lambda r, c: _lc(r["model"]) in _lc(c["model"]) if r.get("model") else None,
     lambda r, c, _b: f"Model is '{c['model'] or 'blank'}', rule needs {r['model']}", True),
    (_dates_ok, lambda r, c, _b: f"Risk start {c['start'] or 'blank'} is outside the rule dates", False),
]


def explain(rule: dict, ctx: dict, brokers: dict) -> List[str]:
    """Human-readable list of the conditions this policy fails for the rule (empty = matches)."""
    return [why(rule, ctx, brokers) for check, why, _ in CONDITIONS if check(rule, ctx) is False]


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
    for check, _, counts in CONDITIONS:
        ok = check(rule, ctx)
        if ok is False:
            return None
        score += int(bool(ok) and counts)
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


def hold_covers(h: dict, insurer: Optional[str], ptype: Optional[str], product: Optional[str], agent: Optional[dict],
                broker_ids: Optional[List[str]] = None) -> bool:
    """Company / product / broker / agent scope of a hold (dates checked by the caller).
    broker_ids = the policy's partner ([id]) or a rule's partners ([] = all partners)."""
    if h.get("broker_ids") and not (broker_ids and set(broker_ids) & set(h["broker_ids"])):
        return False
    if h.get("insurer") and not (insurer and (insurer_matches(h["insurer"], insurer) or insurer_matches(insurer, h["insurer"]))):
        return False
    if h.get("product_type") and h["product_type"] != ptype:
        return False
    if h.get("product") and h["product"] != product:
        return False
    if h.get("agent_ids") or h.get("agent_groups"):
        a = agent or {}
        return a.get("id") in (h.get("agent_ids") or []) or (bool(a.get("agent_group")) and a.get("agent_group") in (h.get("agent_groups") or []))
    return True


def hold_on(h: dict, on: str) -> bool:
    return h["hold_from"] <= on and (not h.get("released_on") or on < h["released_on"])


def _set_receivable(res: CommissionResult, rec: Optional[dict], ctx: dict) -> None:
    if rec:
        res.receivable, res.receivable_rule_id, res.receivable_rule_name = amount(rec, ctx), rec["id"], rec["name"]
        res.receivable_rate = rate_text(rec)


def _set_payable(res: CommissionResult, rec: Optional[dict], payables: List[dict], ctx: dict, agent: Optional[dict], ptype: Optional[str]) -> None:
    """Agent's own rule > group margin on the receivable (auto grid) > group / common payable rule; never above the receivable."""
    pay = best_rule([r for r in payables if r.get("agent_id")], ctx)  # the agent's personal rule always wins
    line = None
    if rec and not pay:
        line = group_margin_line((agent or {}).get("margins") or [], rec.get("insurer"), ctx["insurer"], ptype, ctx["start"] or None, ctx["product"], ctx["business_type"])
    if line is not None:  # auto grid: receivable minus the group's margin for this company
        derived = derive_payable(rec, line)
        res.payable, res.payable_rule_id, res.payable_rate = amount(derived, ctx), f"auto:{rec['id']}", rate_text(derived)
        res.payable_rule_name = f"Auto · {rec['name']} {margin_text(line)} (Group {agent.get('agent_group')})"
        return
    pay = pay or best_rule(payables, ctx)
    if not pay:
        return
    res.payable, res.payable_rule_id, res.payable_rule_name, res.payable_rate = amount(pay, ctx), pay["id"], pay["name"], rate_text(pay)
    limit = res.receivable or 0
    if res.payable > limit:  # payable to agent may never exceed what the broker pays us
        res.capped = True
        res.note = "Payable capped at receivable" if rec else "No receivable rule matches — payable held at ₹0"
        res.payable = limit


def _apply_hold(res: CommissionResult, holds: List[dict], ctx: dict, agent: Optional[dict], ptype: Optional[str]) -> None:
    """Company stopped its grid: no agent commission for policies starting in the hold period."""
    if not res.payable:
        return
    on = (ctx["start"] or today_iso())[:10]
    brokers = [ctx["broker_id"]] if ctx.get("broker_id") else []
    hold = next((h for h in holds if hold_on(h, on) and hold_covers(h, ctx["insurer"], ptype, ctx["product"], agent, brokers)), None)
    if hold:
        res.held, res.hold_reason, res.payable = True, hold.get("reason"), 0.0
        res.note = f"Partner Payout on hold from {hold['hold_from']}" + (f" — {hold['reason']}" if hold.get("reason") else "")


def _declined_rto(d: dict, ctx: dict) -> Optional[str]:
    rto = _norm_rto(ctx["rto"])
    return f"RTO {rto[:4]}" if rto and any(rto.startswith(c) for c in d["rtos"]) else None


def _declined_make(d: dict, ctx: dict) -> Optional[str]:
    return f"make {ctx['make']}" if any(make_matches(m, ctx["make"]) for m in d["makes"]) else None


def _declined_model(d: dict, ctx: dict) -> Optional[str]:
    model = f" {_words(ctx['model'])} "
    return f"model {ctx['model']}" if any(f" {_words(m)} " in model for m in d["models"]) else None


def _declined_range(d: dict, ctx: dict, dim: str, label: str) -> Optional[str]:
    v = ctx.get(dim)
    return label.format(v) if v is not None and _in_range(v, d.get(f"{dim}_min"), d.get(f"{dim}_max")) else None


_DECLINED_CHECKS = (
    (lambda d: bool(d.get("rtos")), _declined_rto),
    (lambda d: bool(d.get("makes")), _declined_make),
    (lambda d: bool(d.get("models")), _declined_model),
    (lambda d: d.get("cc_min") is not None or d.get("cc_max") is not None, lambda d, c: _declined_range(d, c, "cc", "{:g} cc")),
    (lambda d: d.get("gvw_min") is not None or d.get("gvw_max") is not None, lambda d, c: _declined_range(d, c, "gvw", "GVW {:g} kg")),
)


def _declined_parts(d: dict, ctx: dict) -> Optional[List[str]]:
    """What of this policy the declined entry covers (e.g. ["RTO TN29", "make TATA"]) — None when any set criterion misses."""
    parts = []
    for is_set, check in _DECLINED_CHECKS:
        if is_set(d):
            part = check(d, ctx)
            if part is None:
                return None
            parts.append(part)
    return parts or None


def declined_hit(declined: List[dict], ctx: dict, ptype: Optional[str]) -> Optional[tuple[dict, List[str]]]:
    """The company-wide declined entry that covers this policy's insurer + product + RTO / make / model / CC / GVW, if any."""
    if not ctx["insurer"]:
        return None
    for d in declined:
        if not insurer_matches(d["insurer"], ctx["insurer"]):
            continue
        if d.get("products") and ctx["product"] not in d["products"]:
            continue
        if not d.get("products") and d.get("product_type") and ptype != d["product_type"]:
            continue
        parts = _declined_parts(d, ctx)
        if parts:
            return d, parts
    return None


def _apply_declined(res: CommissionResult, declined: List[dict], ctx: dict, ptype: Optional[str]) -> None:
    hit = declined_hit(declined, ctx, ptype)
    if not hit:
        return
    d, parts = hit
    res.declined, res.declined_reason = True, d.get("note")
    res.receivable = res.payable = 0.0
    res.receivable_rule_id = res.receivable_rule_name = res.receivable_rate = None  # never snapshot a declined policy
    res.payable_rule_id = res.payable_rule_name = res.payable_rate = None
    res.note = f"Declined — {d['insurer']} declines {' + '.join(parts)} for {d.get('product_type') or 'this product'}" + (f" ({d['note']})" if d.get("note") else "") + ": no receivable, no payable"


def compute(doc: dict, rules: List[dict], agent: Optional[dict], holds: List[dict] = (), declined: List[dict] = ()) -> CommissionResult:
    """Receivable (best matching receivable rule) → payable → hold → declined RTO → margin, for one policy."""
    ctx = policy_context(doc, agent)
    rec = best_rule([r for r in rules if r["kind"] == "receivable"], ctx)
    res = CommissionResult()
    _set_receivable(res, rec, ctx)
    ptype = product_type_of([ctx["product"]] if ctx["product"] else []) or (product_type_of(rec.get("products") or []) if rec else None)
    _set_payable(res, rec, [r for r in rules if r["kind"] == "payable"], ctx, agent, ptype)
    _apply_hold(res, holds, ctx, agent, ptype)
    _apply_declined(res, declined, ctx, ptype)
    if res.receivable is not None or res.payable is not None:
        res.margin = round((res.receivable or 0) - (res.payable or 0), 2)
    return res


async def load_holds() -> List[dict]:
    return await db.commission_holds.find({}, {"_id": 0}).to_list(1000)


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
                 product: Optional[str] = None, business_type: Optional[str] = None) -> Optional[float]:
    line = group_margin_line(margins, rule_insurer, policy_insurer, ptype, on, product, business_type)
    return line["margin"] if line else None


def margin_text(line: dict) -> str:
    """'−2 pts' or 'OD −2 · TP −1 · Flat −₹200' for labels."""
    od, tp, flat = line.get("od_margin"), line.get("tp_margin"), line.get("flat_margin")
    if od is None and tp is None and not flat:
        return f"−{line['margin']:g} pts"
    parts = [f"Net −{line['margin']:g}", f"OD −{(od if od is not None else line['margin']):g}", f"TP −{(tp if tp is not None else line['margin']):g}"]
    if flat:
        parts.append(f"Flat −Rs {flat:g}")
    return " · ".join(parts)


def group_margin_line(margins: List[dict], rule_insurer: Optional[str], policy_insurer=None, ptype: Optional[str] = None, on: Optional[str] = None,
                      product: Optional[str] = None, business_type: Optional[str] = None) -> Optional[dict]:
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
        if m.get("business_type") and m["business_type"] != business_type:
            continue
        if m.get("insurer"):
            hit = (rule_insurer and m["insurer"] == rule_insurer) or (not rule_insurer and policy_insurer and insurer_matches(m["insurer"], policy_insurer))
            if not hit:
                continue
        score = (8 if m.get("insurer") else 0) + (4 if m.get("product") else 0) + (2 if m.get("product_type") else 0) + (1 if m.get("business_type") else 0)
        if score > best_score:
            best, best_score = m, score
    return best


PCT_KEYS = ("od_percent", "tp_percent", "net_percent", "odtp_percent")


def derive_payable(rec: dict, margin, tp_margin: Optional[float] = None, flat_margin: Optional[float] = None, od_margin: Optional[float] = None) -> dict:
    """Receivable rule → payable for a group: each % component minus its own points, deducted once (OD from OD, TP from
    TP, Net / OD+TP from `margin`; blank OD / TP = `margin`), flat ₹ minus the retained amount; never below 0.
    `margin` may also be a group margin line (dict)."""
    if isinstance(margin, dict):
        margin, tp_margin, flat_margin, od_margin = margin["margin"], margin.get("tp_margin"), margin.get("flat_margin"), margin.get("od_margin")
    own = {"od_percent": od_margin, "tp_percent": tp_margin}
    d = dict(rec)
    for k in PCT_KEYS:
        if d.get(k) is not None:
            m = own.get(k) if own.get(k) is not None else margin
            d[k] = round(max(0.0, d[k] - m), 4)
    if d.get("flat_amount") is not None and flat_margin:
        d["flat_amount"] = round(max(0.0, d["flat_amount"] - flat_margin), 2)
    return d


_REC_KEYS = ("receivable", "receivable_rule_id", "receivable_rule_name", "receivable_rate")
_PAY_KEYS = ("payable", "payable_rule_id", "payable_rule_name", "payable_rate", "capped", "note")


def apply_lock(res: CommissionResult, lock: dict) -> CommissionResult:
    """Frozen receivable / payable of a verified policy override today's rules (a payable on hold is never frozen)."""
    if lock.get("receivable"):
        for k in _REC_KEYS:
            setattr(res, k, lock["receivable"].get(k))
    if lock.get("payable") and not res.held:
        for k in _PAY_KEYS:
            setattr(res, k, lock["payable"].get(k, False if k == "capped" else None))
    if lock:
        res.locked_at = lock.get("locked_at")
    if res.receivable is not None or res.payable is not None:
        res.margin = round((res.receivable or 0) - (res.payable or 0), 2)
    return res


SNAPSHOT_STATUSES = ("extracted", "verified", "flagged")  # a policy is "in Policy MIS" once OCR has read it


async def commissions_for(docs: List[dict], lock: bool = True) -> dict:
    """Commission per policy. Every policy in MIS freezes each side (receivable / payable) as a permanent snapshot the
    first time a rule matches, so later grid / payout changes never change it; only admin 'Recalculate' clears it.
    The payable side is frozen only once the receivable is known (a payable without receivable is held at ₹0)."""
    from pymongo import UpdateOne
    rules, agents = await load_context()
    if not rules and not any(d.get("commission_lock") for d in docs):
        return {}
    holds = await load_holds()
    declined = await db.declined_rtos.find({}, {"_id": 0}).to_list(1000)
    out, writes, now = {}, [], now_utc().isoformat()
    for d in docs:
        res = compute(d, rules, agents.get(d.get("agent_id")), holds, declined) if rules else CommissionResult()
        held_lock = d.get("commission_lock") or {}
        new: dict = {}
        if lock and d.get("status") in SNAPSHOT_STATUSES and not d.get("is_deleted"):
            if not held_lock.get("receivable") and res.receivable_rule_id:
                new["receivable"] = {k: getattr(res, k) for k in _REC_KEYS}
            has_rec = held_lock.get("receivable") or new.get("receivable")
            if not held_lock.get("payable") and res.payable_rule_id and not res.held and has_rec:
                new["payable"] = {k: getattr(res, k) for k in _PAY_KEYS}
        if new:
            sets = {f"commission_lock.{k}": v for k, v in new.items()}
            sets["commission_lock.locked_at"] = held_lock.get("locked_at") or now
            writes.append(UpdateOne({"id": d["id"]}, {"$set": sets}))
            held_lock = {**held_lock, **new, "locked_at": sets["commission_lock.locked_at"]}
        # a declined RTO / make / model / CC / GVW always wins — even over a snapshot frozen before the entry was added
        # (the frozen snapshot is kept untouched and comes back if the declined entry is removed)
        out[d["id"]] = res if res.declined else apply_lock(res, held_lock)
    if writes:
        await db.policies.bulk_write(writes, ordered=False)
    return out


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


def _overlap_choice(a: Optional[str], b: Optional[str]) -> bool:
    a, b = a or "any", b or "any"
    return "any" in (a, b) or a == b


def _overlap_dates(p: dict, r: dict) -> bool:
    lo = max(v for v in (p.get("valid_from"), r.get("valid_from"), "0000") if v)
    hi = min(v for v in (p.get("valid_to"), r.get("valid_to"), "9999") if v)
    return lo <= hi


def _list_overlap(key: str):
    """Factory (binds `key` now — no late-binding closure in the list below)."""
    def check(p: dict, r: dict) -> bool:
        return _overlap_list(p.get(key) or [], r.get(key) or [])
    return check


def _range_overlap(dim: str):
    def check(p: dict, r: dict) -> bool:
        return _overlap_range(p.get(f"{dim}_min"), p.get(f"{dim}_max"), r.get(f"{dim}_min"), r.get(f"{dim}_max"))
    return check


_OVERLAP_CHECKS = [
    lambda p, r: _overlap_text(p.get("insurer"), r.get("insurer")),
    lambda p, r: _overlap_makes(p.get("makes") or [], r.get("makes") or []),
    lambda p, r: _overlap_text(p.get("model"), r.get("model")),
    lambda p, r: not (p.get("broker_ids") and r.get("broker_ids")) or bool(set(p["broker_ids"]) & set(r["broker_ids"])),
    *[_list_overlap(k) for k in ("vehicle_ages", "fuel_types", "business_types", "products")],
    lambda p, r: _overlap_rto(p.get("rtos") or [], r.get("rtos") or []),
    lambda p, r: _overlap_choice(p.get("ncb"), r.get("ncb")),
    lambda p, r: _overlap_choice(p.get("cover"), r.get("cover")),
    *[_range_overlap(d) for d in ("gvw", "cc", "seating")],
    _overlap_dates,
]


def overlaps(p: dict, r: dict) -> bool:
    """Could one policy match both rules? (every condition pair must be compatible)"""
    return all(check(p, r) for check in _OVERLAP_CHECKS)


LABEL = {"od_percent": "OD %", "tp_percent": "TP %", "net_percent": "Net %", "odtp_percent": "OD+TP %", "flat_amount": "Flat ₹"}


_SIG_KEYS = ("insurer", "ncb", "cover", "gvw_min", "gvw_max", "cc_min", "cc_max", "seating_min", "seating_max", "model")


def signature(r: dict) -> tuple:
    """All matching conditions except the agent/group ones (two rules with the same signature match the same policies)."""
    lists = tuple(tuple(sorted(r.get(k) or [])) for k in ("products", "rtos", "vehicle_ages", "fuel_types", "makes", "business_types", "broker_ids"))
    norm = lambda v: f"{float(v):g}" if isinstance(v, (int, float)) and not isinstance(v, bool) else str(v or "").lower()  # 500 == 500.0  # noqa: E731
    return tuple(norm(r.get(k)) for k in _SIG_KEYS) + lists


def receivables_in_scope(payable: dict, receivables: List[dict]) -> List[dict]:
    """Receivables a payable is capped by: the receivable with exactly the same conditions when one exists (e.g. an agent
    rate typed against that receivable row); else every overlapping one, preferring company- / partner-specific ones."""
    ov = [r for r in receivables if r.get("active", True) and overlaps(payable, r)]
    sig = signature(payable)
    exact = [r for r in ov if signature(r) == sig]
    if exact:
        return exact
    for key in ("insurer", "broker_ids"):
        if payable.get(key):
            specific = [r for r in ov if r.get(key)]
            if specific:
                ov = specific
    return ov


def check_against(payable: dict, receivables: List[dict]) -> Optional[str]:
    """Error text if a commission component of the payable rule exceeds the same component of a receivable in scope
    (see receivables_in_scope); components the receivable does not define are not compared."""
    for r in receivables_in_scope(payable, receivables):
        for c in COMPONENTS:
            pv, rv = payable.get(c), r.get(c)
            if pv is not None and rv is not None and pv > rv:
                return f"Payable {LABEL[c]} {pv:g} exceeds receivable {LABEL[c]} {rv:g} in rule '{r['name']}'"
    return None


def single_product(products: List[str]) -> Optional[str]:
    return products[0] if len(products or []) == 1 else None


def chain_margins(margins: List[dict]) -> List[dict]:
    """Sort lines; for the same company + product each line ends the day before the next one starts (ended lines keep their stop date)."""
    from datetime import date, timedelta
    key = lambda m: (m.get("insurer") or "", m.get("product_type") or "", m.get("product") or "", m.get("business_type") or "")  # noqa: E731
    margins = sorted(margins, key=lambda m: (*key(m), m.get("valid_from") or ""))
    for cur, nxt in zip(margins, margins[1:] + [None]):
        if nxt and key(nxt) == key(cur):
            nxt_end = (date.fromisoformat(nxt["valid_from"]) - timedelta(days=1)).isoformat()
            cur["valid_to"] = min(cur["valid_to"], nxt_end) if cur.get("ended") and cur.get("valid_to") else nxt_end
        elif not cur.get("ended"):
            cur["valid_to"] = None
    return margins
