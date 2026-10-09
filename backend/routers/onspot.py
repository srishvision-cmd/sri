"""On-Spot (Net of Commission) cases: UTR / screenshot proof and admin bank confirmation."""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from lib.auth import require_roles
from lib.commission import commissions_for
from lib.db import db
from lib.storage import get_object
from models.common import now_utc
from models.policy import NET_OF_COMMISSION, OnSpotCheckIn, OnSpotRow, Policy
from models.user import User
from routers.policies import history, load_scoped, read_proof, reviewers, store_proof

logger = logging.getLogger(__name__)
router = APIRouter()
admin_only = require_roles("admin")


@router.get("/onspot", response_model=List[OnSpotRow])
async def list_onspot(status: Optional[str] = None, _: User = Depends(admin_only)):
    q: dict = {"payment_mode": NET_OF_COMMISSION, "is_deleted": {"$ne": True}}
    if status == "pending":
        q["onspot_status"] = {"$in": ["pending", None]}
    elif status:
        q["onspot_status"] = status
    docs = await db.policies.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    comm = await commissions_for(docs)
    rows = []
    for d in docs:
        p = Policy(**d)
        c = comm.get(p.id)
        pay = c.payable if c else None
        gross = p.fields.gross_premium
        rows.append(OnSpotRow(
            policy_id=p.id, policy_number=p.fields.policy_number, insured_name=p.fields.insured_name, reg_no=p.fields.vehicle_reg_no,
            insurer=p.fields.insurer, agent_name=p.agent_name, agent_code=p.agent_code, gross_premium=gross, commission=pay,
            expected_amount=round(gross - (pay or 0), 2) if gross is not None else None, reference=p.onspot_reference,
            has_proof=p.has_onspot_proof, status=p.onspot_status or "pending", checked_by_name=p.onspot_checked_by_name,
            checked_at=p.onspot_checked_at, note=p.onspot_note, uploaded_at=p.created_at,
        ))
    return rows


@router.put("/policies/{id}/onspot-check", response_model=Policy)
async def check_onspot(id: str, body: OnSpotCheckIn, user: User = Depends(admin_only)):
    doc = await load_scoped(id, user)
    if doc.get("payment_mode") != NET_OF_COMMISSION:
        raise HTTPException(status_code=400, detail="Only On-Spot (Net of Commission) policies are bank-checked here")
    label = {"confirmed": "Bank confirmed", "not_received": "Not received in bank", "pending": "Back to pending"}[body.status]
    await db.policies.update_one({"id": id}, {
        "$set": {"onspot_status": body.status, "onspot_note": (body.note or "").strip() or None, "onspot_checked_by_name": user.full_name,
                 "onspot_checked_at": now_utc(), "updated_at": now_utc()},
        "$push": {"history": history(user, "On-Spot bank check", label + (f" · {body.note}" if body.note else ""))},
    })
    return Policy(**await load_scoped(id, user))


@router.post("/policies/{id}/onspot-proof", response_model=Policy)
async def add_onspot_proof(id: str, reference: Optional[str] = Form(None), proof: Optional[UploadFile] = File(None), user: User = Depends(reviewers)):
    """Add / replace the UTR or screenshot later (e.g. mode switched to On-Spot after upload)."""
    doc = await load_scoped(id, user)
    if doc.get("payment_mode") != NET_OF_COMMISSION:
        raise HTTPException(status_code=400, detail="Set the payment mode to On-Spot (Net of Commission) first")
    data = await read_proof(proof)
    ref = (reference or "").strip().upper()
    if not ref and not data:
        raise HTTPException(status_code=400, detail="Give the UTR / receipt no. or a screenshot")
    upd: dict = {"updated_at": now_utc(), "onspot_status": "pending" if doc.get("onspot_status") == "not_received" else doc.get("onspot_status") or "pending"}
    if ref:
        upd["onspot_reference"] = ref
    if data:
        upd.update(onspot_proof_path=await store_proof(doc["agent_id"], id, data), has_onspot_proof=True)
    await db.policies.update_one({"id": id}, {"$set": upd, "$push": {"history": history(user, "On-Spot proof added", ref or "screenshot")}})
    return Policy(**await load_scoped(id, user))


@router.get("/policies/{id}/onspot-proof")
async def get_onspot_proof(id: str, user: User = Depends(reviewers)):
    doc = await load_scoped(id, user)
    if not doc.get("onspot_proof_path"):
        raise HTTPException(status_code=404, detail="No payment screenshot for this policy")
    try:
        data, mime = await get_object(doc["onspot_proof_path"])
    except Exception:
        logger.exception("On-spot proof download failed")
        raise HTTPException(status_code=502, detail="Could not load the screenshot from storage")
    return Response(content=data, media_type=mime or "application/octet-stream", headers={"Cache-Control": "private, max-age=300"})
