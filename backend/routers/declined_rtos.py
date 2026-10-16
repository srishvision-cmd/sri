"""Declined / excluded RTOs: company-wide per product. Policies from these RTOs get no receivable and no payable and are
flagged "Declined RTO" — whatever zone (e.g. Metro) a rule bundles them in. Commission already saved on policies never changes."""
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_roles
from lib.db import db
from models.commission import DeclinedRto, DeclinedRtoIn
from models.masters import PRODUCT_TYPES
from models.user import User

router = APIRouter(tags=["declined-rtos"])
admin_only = require_roles("admin")
RTO_RX = re.compile(r"^[A-Z]{2}\d{0,3}$")


def _codes(raw: List[str]) -> List[str]:
    out = []
    for r in raw:
        for part in re.split(r"[,\s]+", r or ""):
            c = part.upper().replace("-", "")
            if not c:
                continue
            if not RTO_RX.match(c):
                raise HTTPException(status_code=400, detail=f"'{part}' is not an RTO code — use e.g. TN29 or TN-29")
            out.append(c)
    return sorted(set(out))


def _words(raw: List[str]) -> List[str]:
    return sorted({w.strip().upper() for r in raw for w in (r or "").split(",") if w.strip()})


@router.get("/commission/declined-rtos", response_model=List[DeclinedRto])
async def list_declined(_: User = Depends(admin_only)):
    docs = await db.declined_rtos.find({}, {"_id": 0}).sort([("insurer", 1), ("created_at", -1)]).to_list(1000)
    return [DeclinedRto(**d) for d in docs]


@router.post("/commission/declined-rtos", response_model=DeclinedRto)
async def create_declined(body: DeclinedRtoIn, user: User = Depends(admin_only)):
    body.insurer = body.insurer.strip()
    body.product_type = (body.product_type or "").strip() or None
    body.note = (body.note or "").strip() or None
    if body.product_type and body.product_type not in PRODUCT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown product type '{body.product_type}'")
    bad = [p for p in body.products if p not in PRODUCT_TYPES.get(body.product_type or "", [])]
    if bad:
        raise HTTPException(status_code=400, detail=f"'{bad[0]}' is not a {body.product_type or 'known'} product")
    body.rtos = _codes(body.rtos)
    body.makes, body.models = _words(body.makes), _words(body.models)
    if body.cc_min is not None and body.cc_max is not None and body.cc_min > body.cc_max:
        raise HTTPException(status_code=400, detail="CC from must not be more than CC to")
    if not (body.rtos or body.makes or body.models or body.cc_min is not None or body.cc_max is not None):
        raise HTTPException(status_code=400, detail="Enter at least one declined RTO, make, model or CC range")
    item = DeclinedRto(**body.model_dump(), created_by_name=user.full_name)
    await db.declined_rtos.insert_one(item.model_dump())
    return item


@router.delete("/commission/declined-rtos/{id}")
async def delete_declined(id: str, _: User = Depends(admin_only)):
    if not (await db.declined_rtos.delete_one({"id": id})).deleted_count:
        raise HTTPException(status_code=404, detail="Declined RTO list not found")
    return {"ok": True}
