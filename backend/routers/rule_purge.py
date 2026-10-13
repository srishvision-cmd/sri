"""Admin: delete the commission grid rules created / edited in a date range (fresh re-upload), with preview + Excel backup.
Policies keep their saved commission snapshot, so no policy, statement or payment amount changes."""
import io
import os
from datetime import datetime, timedelta
from typing import List, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font
from pydantic import BaseModel, Field

from lib.auth import require_roles
from lib.db import db
from lib.excel_safe import neutralise_formulas
from models.common import UtcDatetime, now_utc
from models.user import User

router = APIRouter()
admin_only = require_roles("admin")
Kind = Literal["receivable", "payable"]


class PurgeIn(BaseModel):
    date_from: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    date_to: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    kinds: List[Kind] = Field(default=["receivable", "payable"], min_length=1)


class PurgeApplyIn(PurgeIn):
    confirm_count: int  # must equal the preview count, so nothing changed in between


class PurgeRuleRow(BaseModel):
    id: str
    kind: str
    name: str
    insurer: str | None = None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class PurgePreview(BaseModel):
    count: int
    receivable: int
    payable: int
    policies_snapshotted: int  # policies whose saved commission came from these rules (kept unchanged)
    rules: List[PurgeRuleRow] = []


class PurgeResult(BaseModel):
    deleted: int
    receivable: int
    payable: int


def _query(body: PurgeIn) -> dict:
    tz = ZoneInfo(os.environ.get("APP_TZ") or "Asia/Kolkata")
    try:
        start = datetime.fromisoformat(body.date_from).replace(tzinfo=tz)
        end = datetime.fromisoformat(body.date_to).replace(tzinfo=tz) + timedelta(days=1)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date")
    if end <= start:
        raise HTTPException(status_code=422, detail="'To' date must be on or after 'From' date")
    rng = {"$gte": start, "$lt": end}
    return {"kind": {"$in": body.kinds}, "$or": [{"created_at": rng}, {"updated_at": rng}]}


async def _preview(body: PurgeIn) -> PurgePreview:
    rules = await db.commission_rules.find(_query(body), {"_id": 0}).sort([("kind", -1), ("insurer", 1), ("name", 1)]).to_list(20000)
    ids = [r["id"] for r in rules]
    snap = await db.policies.count_documents({"$or": [{"commission_lock.receivable.receivable_rule_id": {"$in": ids}},
                                                      {"commission_lock.payable.payable_rule_id": {"$in": ids}}]}) if ids else 0
    return PurgePreview(count=len(rules), receivable=sum(r["kind"] == "receivable" for r in rules), payable=sum(r["kind"] == "payable" for r in rules),
                        policies_snapshotted=snap, rules=[PurgeRuleRow(**r) for r in rules])


@router.post("/commission/rules/purge/preview", response_model=PurgePreview)
async def purge_preview(body: PurgeIn, _: User = Depends(admin_only)):
    return await _preview(body)


@router.get("/commission/rules/purge/backup")
async def purge_backup(date_from: str, date_to: str, kinds: List[Kind] = Query(default=["receivable", "payable"]), _: User = Depends(admin_only)):
    """Excel of every rule that would be deleted (all fields), to keep before deleting."""
    rules = await db.commission_rules.find(_query(PurgeIn(date_from=date_from, date_to=date_to, kinds=kinds)), {"_id": 0}).to_list(20000)
    keys = sorted({k for r in rules for k in r}, key=lambda k: (k not in ("kind", "name", "insurer"), k))
    wb = Workbook()
    ws = wb.active
    ws.title = "Deleted rules backup"
    ws.append(keys)
    for c in ws[1]:
        c.font = Font(bold=True)
    for r in rules:
        ws.append([", ".join(map(str, v)) if isinstance(v, list) else (v.isoformat() if isinstance(v, datetime) else v) for v in (r.get(k) for k in keys)])
    neutralise_formulas(wb)
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    name = f"commission_rules_backup_{date_from}_to_{date_to}.xlsx"
    return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/commission/rules/purge", response_model=PurgeResult)
async def purge_apply(body: PurgeApplyIn, user: User = Depends(admin_only)):
    pre = await _preview(body)
    if pre.count != body.confirm_count:
        raise HTTPException(status_code=409, detail=f"The rules changed since the preview ({pre.count} now match) — preview again")
    ids = [r.id for r in pre.rules]
    if ids:
        await db.commission_rules.delete_many({"id": {"$in": ids}})
        await db.payable_alerts.delete_many({"rule_id": {"$in": ids}})
        await db.rule_purge_log.insert_one({"by_id": user.id, "by_name": user.full_name, "at": now_utc(), "date_from": body.date_from,
                                            "date_to": body.date_to, "kinds": body.kinds, "deleted_ids": ids, "count": len(ids)})
    return PurgeResult(deleted=len(ids), receivable=pre.receivable, payable=pre.payable)
