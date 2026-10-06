import asyncio
import csv
import os
import io
import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response, StreamingResponse
import tempfile
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from lib.auth import current_user, require_roles
from lib.dates import today_iso
from lib.db import db
from lib.ocr import extract_policy
from lib.storage import get_object, object_path, put_object
from models.common import now_utc
from models.policy import (
    AGE_BUCKETS,
    BRANCHES,
    COVER_TYPES,
    GVW_NA_CLASSES,
    VEHICLE_CLASSES,
    DERIVED_FIELDS,
    derive_fields,
    LOBS,
    FlagIn,
    GroupStat,
    HistoryEntry,
    Meta,
    Policy,
    PolicyFields,
    PolicyUpdate,
    Stats,
    VerifyIn,
)
from models.user import User
from routers.users import agent_options_for

logger = logging.getLogger(__name__)
router = APIRouter(tags=["policies"])
reviewers = require_roles("admin", "backoffice")

MAX_BYTES = 15 * 1024 * 1024
ALLOWED = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
EXT_TO_MIME = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
_tasks: set = set()
# OCR jobs run concurrently on worker threads; cap them so a big batch can't exhaust the pod
OCR_CONCURRENCY = int(os.environ.get("OCR_CONCURRENCY") or 8)
_ocr_slots = asyncio.Semaphore(OCR_CONCURRENCY)


# ---------- scoping ----------
NOT_DELETED = {"is_deleted": {"$ne": True}}


def scope_filter(user: User) -> dict:
    if user.role == "admin":
        return {}
    if user.role == "agent":
        return {"agent_id": user.id}
    ors: list = [{"branch": user.branch}, {"uploaded_by_id": user.id}]
    if user.assigned_agent_ids:
        ors.append({"agent_id": {"$in": user.assigned_agent_ids}})
    return {"$or": ors}


class PolicyFilters:
    def __init__(
        self,
        status: Optional[str] = None,
        lob: Optional[str] = None,
        agent_id: Optional[str] = None,
        branch: Optional[str] = None,
        q: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        age_bucket: Optional[str] = None,
    ):
        self.status, self.lob, self.agent_id, self.branch = status, lob, agent_id, branch
        self.age_bucket = age_bucket
        self.q, self.date_from, self.date_to = q, date_from, date_to

    def query(self, user: User) -> dict:
        clauses = [NOT_DELETED, scope_filter(user)]
        if self.status:
            clauses.append({"status": self.status})
        if self.lob:
            clauses.append({"fields.lob": self.lob})
        if self.agent_id:
            clauses.append({"agent_id": self.agent_id})
        if self.age_bucket:
            clauses.append({"fields.vehicle_age_bucket": self.age_bucket})
        if self.branch:
            clauses.append({"branch": self.branch})
        if self.q:
            rx = {"$regex": re.escape(self.q.strip()), "$options": "i"}
            clauses.append({"$or": [{"fields.policy_number": rx}, {"fields.insured_name": rx}, {"fields.vehicle_reg_no": rx}, {"file_name": rx}]})
        rng: dict = {}
        try:
            if self.date_from:
                rng["$gte"] = datetime.fromisoformat(self.date_from).replace(tzinfo=timezone.utc)
            if self.date_to:
                rng["$lt"] = datetime.fromisoformat(self.date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")
        if rng:
            clauses.append({"created_at": rng})
        clauses = [c for c in clauses if c]
        return {"$and": clauses} if clauses else {}


async def load_scoped(policy_id: str, user: User) -> dict:
    query = {"$and": [{"id": policy_id}, NOT_DELETED, scope_filter(user)]}
    doc = await db.policies.find_one(query, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Policy not found")
    return doc


def history(user: User | None, action: str, note: Optional[str] = None) -> dict:
    if user is None:
        return HistoryEntry(by_name="AI OCR Engine", by_role="system", action=action, note=note).model_dump()
    return HistoryEntry(by_name=user.full_name, by_role=user.role, action=action, note=note).model_dump()


# ---------- OCR ----------
async def _run_ocr(policy_id: str, storage_path: str, mime: str) -> None:
    async with _ocr_slots:
        await _run_ocr_job(policy_id, storage_path, mime)


async def _run_ocr_job(policy_id: str, storage_path: str, mime: str) -> None:
    update: dict = {"updated_at": now_utc()}
    try:
        data, _ = await get_object(storage_path)
        suffix = ALLOWED.get(mime, ".bin")
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:  # OCR SDK reads from a local path
            tmp.write(data)
            tmp.flush()
            fields, confidence = await extract_policy(tmp.name, mime, f"ocr-{policy_id}")
        filled = sum(1 for v in fields.values() if v is not None)
        update.update(status="extracted", fields=fields, confidence=confidence, ocr_error=None, updated_at=now_utc())
        entry = history(None, "OCR extracted", f"{filled} fields captured")
    except Exception as exc:  # surface any engine failure as a failed record for manual entry
        logger.exception("OCR failed for %s", policy_id)
        update.update(status="failed", ocr_error=str(exc)[:300] or "OCR failed")
        entry = history(None, "OCR failed", update["ocr_error"])
    await db.policies.update_one({"id": policy_id, "status": "processing"}, {"$set": update, "$push": {"history": entry}})


async def requeue_stuck_ocr() -> None:
    """On boot, restart OCR for records left in 'processing' by a previous process (reload/crash)."""
    docs = await db.policies.find(
        {"status": "processing", "is_deleted": {"$ne": True}, "storage_path": {"$exists": True}},
        {"_id": 0, "id": 1, "storage_path": 1, "file_mime": 1},
    ).to_list(500)
    for d in docs:
        _spawn_ocr(d["id"], d["storage_path"], d["file_mime"])
    if docs:
        logger.info("Re-queued OCR for %d policies", len(docs))


def _spawn_ocr(policy_id: str, storage_path: str, mime: str) -> None:
    task = asyncio.create_task(_run_ocr(policy_id, storage_path, mime))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


# ---------- routes ----------
@router.get("/meta", response_model=Meta)
async def meta():
    return Meta(branches=BRANCHES, lobs=LOBS, age_buckets=AGE_BUCKETS, cover_types=COVER_TYPES, vehicle_classes=VEHICLE_CLASSES)


@router.post("/policies/upload", response_model=Policy)
async def upload_policy(
    file: UploadFile = File(...),
    agent_id: Optional[str] = Form(None),
    user: User = Depends(current_user),
):
    ext = Path(file.filename or "").suffix.lower()
    mime = file.content_type if file.content_type in ALLOWED else EXT_TO_MIME.get(ext)
    if mime not in ALLOWED:
        raise HTTPException(status_code=415, detail="Only PDF, JPG, PNG or WEBP files are supported")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 15 MB")

    if user.role == "agent" or not agent_id:
        owner = {"id": user.id, "full_name": user.full_name, "username": user.username, "branch": user.branch}
    else:
        allowed = {a.id: a for a in await agent_options_for(user)}
        if agent_id not in allowed:
            raise HTTPException(status_code=403, detail="Agent is outside your assigned scope")
        a = allowed[agent_id]
        owner = {"id": a.id, "full_name": a.full_name, "username": a.username, "branch": a.branch}

    policy = Policy(
        file_name=file.filename or f"document{ALLOWED[mime]}",
        file_mime=mime,
        has_file=True,
        agent_id=owner["id"],
        agent_name=owner["full_name"],
        agent_code=owner["username"].upper(),
        branch=owner["branch"],
        uploaded_by_id=user.id,
        uploaded_by_name=user.full_name,
        history=[HistoryEntry(**history(user, "Uploaded", file.filename))],
    )
    try:
        stored = await put_object(object_path(owner["id"], policy.id, ALLOWED[mime]), data, mime)
    except Exception:
        logger.exception("Object storage upload failed")
        raise HTTPException(status_code=502, detail="Could not store the document. Please retry.")
    await db.policies.insert_one(
        {**policy.model_dump(), "storage_path": stored["path"], "file_size": stored.get("size", len(data)), "is_deleted": False}
    )
    _spawn_ocr(policy.id, stored["path"], mime)
    return policy


@router.get("/policies", response_model=List[Policy])
async def list_policies(filters: PolicyFilters = Depends(), user: User = Depends(current_user)):
    docs = await db.policies.find(filters.query(user), {"_id": 0, "history": 0}).sort("created_at", -1).to_list(1000)
    return [Policy(**d) for d in docs]


@router.get("/policies/{id}", response_model=Policy)
async def get_policy(id: str, user: User = Depends(current_user)):
    return Policy(**await load_scoped(id, user))


@router.get("/policies/{id}/file")
async def get_policy_file(id: str, user: User = Depends(current_user)):
    doc = await load_scoped(id, user)
    path = doc.get("storage_path")
    if not path:
        raise HTTPException(status_code=404, detail="No source document for this policy")
    try:
        data, content_type = await get_object(path)
    except Exception:
        logger.exception("Object storage download failed")
        raise HTTPException(status_code=502, detail="Could not load the document from storage")
    return Response(
        content=data,
        media_type=doc.get("file_mime") or content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.get("file_name", "document")}"', "Cache-Control": "private, max-age=300"},
    )


@router.patch("/policies/{id}", response_model=Policy)
async def update_policy(id: str, body: PolicyUpdate, user: User = Depends(current_user)):
    doc = await load_scoped(id, user)
    if doc["status"] == "processing":
        raise HTTPException(status_code=409, detail="OCR is still running for this document")
    if user.role == "agent" and doc["status"] == "verified":
        raise HTTPException(status_code=403, detail="Verified policies are locked. Raise a flag to request a correction.")
    old = PolicyFields(**doc.get("fields", {})).model_dump()
    new = derive_fields(body.fields.model_dump())
    changed = [k for k in new if k not in DERIVED_FIELDS and new[k] != old.get(k)]
    status = "extracted" if doc["status"] == "failed" else doc["status"]
    note = (body.note + " · " if body.note else "") + (f"Changed: {', '.join(changed)}" if changed else "No field changes")
    await db.policies.update_one(
        {"id": id},
        {"$set": {"fields": new, "status": status, "updated_at": now_utc()}, "$push": {"history": history(user, "Corrected", note)}},
    )
    return Policy(**await load_scoped(id, user))


@router.post("/policies/{id}/verify", response_model=Policy)
async def verify_policy(id: str, body: VerifyIn, user: User = Depends(reviewers)):
    doc = await load_scoped(id, user)
    if doc["status"] == "processing":
        raise HTTPException(status_code=409, detail="OCR is still running for this document")
    f = doc.get("fields", {})
    if not f.get("policy_number") or not f.get("gross_premium"):
        raise HTTPException(status_code=400, detail="Policy number and gross premium are required before verification")
    now = now_utc()
    await db.policies.update_one(
        {"id": id},
        {
            "$set": {"status": "verified", "verified_by_name": user.full_name, "verified_at": now, "flag_reason": None, "updated_at": now},
            "$push": {"history": history(user, "Verified", body.note)},
        },
    )
    return Policy(**await load_scoped(id, user))


@router.post("/policies/{id}/flag", response_model=Policy)
async def flag_policy(id: str, body: FlagIn, user: User = Depends(current_user)):
    doc = await load_scoped(id, user)
    if doc["status"] == "processing":
        raise HTTPException(status_code=409, detail="OCR is still running for this document")
    await db.policies.update_one(
        {"id": id},
        {"$set": {"status": "flagged", "flag_reason": body.reason, "updated_at": now_utc()}, "$push": {"history": history(user, "Flagged", body.reason)}},
    )
    return Policy(**await load_scoped(id, user))


@router.post("/policies/{id}/reextract", response_model=Policy)
async def reextract_policy(id: str, user: User = Depends(current_user)):
    doc = await load_scoped(id, user)
    if user.role == "agent" and doc["status"] == "verified":
        raise HTTPException(status_code=403, detail="Verified policies are locked")
    path = doc.get("storage_path")
    if not path:
        raise HTTPException(status_code=400, detail="No source document to re-extract")
    await db.policies.update_one(
        {"id": id},
        {"$set": {"status": "processing", "ocr_error": None, "updated_at": now_utc()}, "$push": {"history": history(user, "Re-extraction requested")}},
    )
    _spawn_ocr(id, path, doc["file_mime"])
    return Policy(**await load_scoped(id, user))


@router.delete("/policies/{id}")
async def delete_policy(id: str, user: User = Depends(require_roles("admin"))):
    await load_scoped(id, user)
    # storage has no delete API — soft-delete the record; the object stays orphaned but unreachable
    await db.policies.update_one(
        {"id": id}, {"$set": {"is_deleted": True, "updated_at": now_utc()}, "$push": {"history": history(user, "Deleted")}}
    )
    return {"ok": True}


@router.get("/stats", response_model=Stats)
async def stats(filters: PolicyFilters = Depends(), user: User = Depends(current_user)):
    docs = await db.policies.find(filters.query(user), {"_id": 0, "status": 1, "fields": 1, "agent_name": 1}).to_list(20000)
    counts: dict = defaultdict(int)
    groups: dict = {k: defaultdict(lambda: [0, 0.0]) for k in ("lob", "insurer", "agent", "age")}
    gross = net = 0.0
    for d in docs:
        counts[d["status"]] += 1
        f = d.get("fields") or {}
        g = float(f.get("gross_premium") or 0)
        gross += g
        net += float(f.get("net_premium") or 0)
        for key, label in (("lob", f.get("lob")), ("insurer", f.get("insurer")), ("agent", d.get("agent_name"))):
            bucket = groups[key][label or "Unclassified"]
            bucket[0] += 1
            bucket[1] += g
        if f.get("vehicle_age_bucket"):
            groups["age"][f["vehicle_age_bucket"]][0] += 1
            groups["age"][f["vehicle_age_bucket"]][1] += g

    def top(key: str, n: int) -> List[GroupStat]:
        items = sorted(groups[key].items(), key=lambda kv: kv[1][1], reverse=True)[:n]
        return [GroupStat(label=k, count=v[0], premium=round(v[1], 2)) for k, v in items]

    return Stats(
        total=len(docs),
        processing=counts["processing"],
        extracted=counts["extracted"],
        flagged=counts["flagged"],
        verified=counts["verified"],
        failed=counts["failed"],
        gross_premium=round(gross, 2),
        net_premium=round(net, 2),
        by_lob=top("lob", 8),
        by_insurer=top("insurer", 6),
        by_agent=top("agent", 6),
        by_age=[GroupStat(label=b, count=groups["age"][b][0], premium=round(groups["age"][b][1], 2)) for b in AGE_BUCKETS],
    )


# ---------- MIS export ----------
MIS_COLUMNS = [
    # primary motor MIS layout (business-requested order)
    ("Customer Name", "f.insured_name"), ("Policy No", "f.policy_number"), ("Registration No", "f.vehicle_reg_no"),
    ("IDV", "f.idv"), ("Total Premium", "f.gross_premium"), ("OD Premium (incl. Add-ons)", "f.od_premium"),
    ("TP Premium (Liability)", "f.tp_premium"), ("Net Premium", "f.net_premium"), ("Risk Start Date", "f.start_date"),
    ("Make", "f.make"), ("Model", "f.model"), ("GVW (kg)", "f.gvw"), ("CC", "f.cc"), ("Seating Capacity", "f.seating_capacity"),
    ("Year of Mfg", "f.mfg_year"), ("RTO", "f.rto"), ("Vehicle Age (Yrs)", "f.vehicle_age_years"), ("Vehicle Age Band", "f.vehicle_age_bucket"),
    ("Cover Type", "f.cover_type"), ("Vehicle Class", "f.vehicle_class"), ("Add-on Premium", "f.addon_premium"),
    # supporting columns
    ("GST", "f.gst"), ("Risk End Date", "f.end_date"), ("Registration Date", "f.registration_date"), ("Insurer", "f.insurer"),
    ("LOB", "f.lob"), ("Product", "f.product_name"), ("Sum Insured", "f.sum_insured"), ("NCB %", "f.ncb_percent"),
    ("Chassis No", "f.chassis_no"), ("Engine No", "f.engine_no"), ("Mobile", "f.mobile"), ("Email", "f.email"),
    ("Health Plan", "f.plan_name"), ("Members Covered", "f.members_covered"), ("Deductible", "f.deductible"),
    ("Agent Code", "agent_code"), ("Agent Name", "agent_name"), ("Branch", "branch"),
    ("Status", "status"), ("Flag Reason", "flag_reason"), ("Verified By", "verified_by_name"), ("Verified At", "verified_at"),
    ("Uploaded By", "uploaded_by_name"), ("Uploaded At", "created_at"), ("Source File", "file_name"),
]
MONEY_COLS = {"Add-on Premium", "Sum Insured", "Net Premium", "GST", "Total Premium", "IDV", "OD Premium (incl. Add-ons)", "TP Premium (Liability)", "Deductible"}



def _cell(doc: dict, fields: dict, key: str):
    if key == "f.gvw" and fields.get("vehicle_class") in GVW_NA_CLASSES:
        return "NA"
    if key.startswith("f."):
        return fields.get(key[2:])
    v = doc.get(key)
    if isinstance(v, datetime):
        return v.replace(tzinfo=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return v


@router.get("/mis/export")
async def export_mis(
    format: Literal["csv", "xlsx"] = Query("xlsx"),
    filters: PolicyFilters = Depends(),
    user: User = Depends(current_user),
):
    docs = await db.policies.find(filters.query(user), {"_id": 0, "history": 0}).sort("created_at", -1).to_list(50000)
    derived = [derive_fields(d.get("fields") or {}) for d in docs]
    rows = [[_cell(d, f, key) for _, key in MIS_COLUMNS] for d, f in zip(docs, derived)]
    headers = [h for h, _ in MIS_COLUMNS]
    scope = user.username.upper() if user.role != "admin" else (filters.agent_id and "AGENT") or "ALL"
    fname = f"MIS_{scope}_{today_iso()}.{format}"

    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(headers)
        w.writerows([["" if v is None else v for v in r] for r in rows])
        return StreamingResponse(
            iter([buf.getvalue().encode("utf-8-sig")]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    wb = Workbook()
    ws = wb.active
    ws.title = "Policy MIS"
    ws.append(headers)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1E293B")
        c.alignment = Alignment(vertical="center")
    for r in rows:
        ws.append(r)
    for idx, h in enumerate(headers, start=1):
        col = ws.cell(row=1, column=idx).column_letter
        ws.column_dimensions[col].width = max(12, min(32, len(h) + 6))
        if h in MONEY_COLS:
            for cell in ws[col][1:]:
                cell.number_format = "#,##0.00"
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions

    summary = wb.create_sheet("Vehicle Age Summary")
    summary.append(["Vehicle Age Band", "Policies", "Total Premium", "OD Premium", "TP Premium"])
    for c in summary[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1E293B")
    agg = {b: [0, 0.0, 0.0, 0.0] for b in AGE_BUCKETS}
    for f in derived:
        if f.get("vehicle_age_bucket"):
            a = agg[f["vehicle_age_bucket"]]
            a[0] += 1
            a[1] += f.get("gross_premium") or 0
            a[2] += f.get("od_premium") or 0
            a[3] += f.get("tp_premium") or 0
    for b in AGE_BUCKETS:
        summary.append([b, *agg[b]])
    for col, width in zip("ABCDE", (22, 12, 18, 16, 16)):
        summary.column_dimensions[col].width = width
        if col in "CDE":
            for cell in summary[col][1:]:
                cell.number_format = "#,##0.00"
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
