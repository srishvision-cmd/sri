"""One-time, targeted clean-up of duplicate payable rules for ONE agent + ONE company. Receivable rules, other agents
and other companies are never read for deletion. Report first (delete=false), then delete with delete=true."""
import logging
import re

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_roles
from lib.commission import rate_text
from lib.db import db
from lib.payable_dedup import ident, sync_keys
from models.payable_dups import PayableDupGroup, PayableDupIn, PayableDupReport, PayableDupRule
from models.user import User
from routers.commission_grid import agent_label

router = APIRouter(tags=["commission"])
admin_only = require_roles("admin")
log = logging.getLogger("payable_dups")


def _first_word(v: str) -> str:
    return ((v or "").strip().split() or [""])[0].lower()


def _stamp(d: dict) -> str:
    return str(d.get("updated_at") or d.get("created_at") or "")


async def _agent(value: str) -> dict:
    v = value.strip()
    code = v.split("·")[0].strip()
    q = {"role": "agent", "$or": [{"id": v}, {"username": {"$regex": f"^{re.escape(code)}$", "$options": "i"}},
                                  {"full_name": {"$regex": f"^{re.escape(v)}$", "$options": "i"}}]}
    found = await db.users.find({**q}, {"_id": 0, "id": 1, "username": 1, "full_name": 1}).to_list(5)
    if len(found) != 1:
        raise HTTPException(status_code=404 if not found else 400, detail="Agent not found" if not found else "More than one agent matches — use the agent code")
    return found[0]


@router.post("/commission/payable-duplicates", response_model=PayableDupReport)
async def payable_duplicates(body: PayableDupIn, _: User = Depends(admin_only)):
    agent = await _agent(body.agent)
    co = _first_word(body.insurer)
    docs = [d for d in await db.commission_rules.find({"kind": "payable", "agent_id": agent["id"], "superseded_by": None}, {"_id": 0}).to_list(5000)
            if _first_word(d.get("insurer") or "") == co]
    groups: dict[tuple, list[dict]] = {}
    for d in docs:
        groups.setdefault((*ident(d), d.get("valid_to") or ""), []).append(d)
    report = PayableDupReport(agent_label=agent_label(agent), insurer=body.insurer, total=len(docs), rule_ids=[d["id"] for d in docs],
                              unique_rules=len(groups), groups=[], to_delete=0)
    extras: list[dict] = []
    for g in groups.values():
        if len(g) < 2:
            continue
        g.sort(key=_stamp, reverse=True)  # keep the most recently saved copy
        extras += g[1:]
        report.groups.append(PayableDupGroup(rules=[PayableDupRule(
            id=d["id"], name=d["name"], insurer=d.get("insurer"), products=d.get("products") or [], valid_from=d.get("valid_from"),
            valid_to=d.get("valid_to"), rate=rate_text(d), updated_at=_stamp(d)[:19] or None, keep=i == 0) for i, d in enumerate(g)]))
    report.to_delete = len(extras)
    log.info("Payable duplicates %s / %s: %s documents, %s unique, ids=%s", report.agent_label, body.insurer, len(docs), len(groups), report.rule_ids)
    if body.delete and extras:
        for d in extras:
            log.warning("Deleting duplicate payable rule %s '%s' (%s, %s, from %s)", d["id"], d["name"], d.get("insurer"), d.get("products"), d.get("valid_from"))
        ids = [d["id"] for d in extras]
        res = await db.commission_rules.delete_many({"id": {"$in": ids}, "kind": "payable", "agent_id": agent["id"]})
        report.deleted = res.deleted_count
        await sync_keys({"agent_id": agent["id"]})
        log.warning("Deleted %s duplicate payable rules for %s / %s", res.deleted_count, report.agent_label, body.insurer)
    return report
