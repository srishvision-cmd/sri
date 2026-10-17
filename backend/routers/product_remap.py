"""Product Master mapping for policies: the commission product (fields.product_category) must be a Product Master name.
Preview + apply a one-time remap for policies whose product is missing / not in the master / the "Others" catch-all,
using the same import rules (derive_fields reads the product text, vehicle class, seats, GVW …)."""
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from lib.auth import require_roles
from lib.db import db
from lib.history import history
from lib.snapshot import refresh_after_correction
from models.common import now_utc
from models.masters import PRODUCT_TYPES
from models.policy import derive_fields
from models.user import User

router = APIRouter(tags=["policies"])
admin_only = require_roles("admin")
MASTER = {p for ps in PRODUCT_TYPES.values() for p in ps}
UNMATCHED = {None, "", "Others"}


def needs_mapping(product: Optional[str]) -> bool:
    return product in UNMATCHED or product not in MASTER


class ProductRemapRow(BaseModel):
    id: str
    policy_number: Optional[str] = None
    insurer: Optional[str] = None
    raw_product: Optional[str] = None  # product text as printed on the document
    current: Optional[str] = None
    suggested: Optional[str] = None  # None = no confident match → admin maps it by hand


class ProductRemapApply(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=5000)


class ProductRemapResult(BaseModel):
    updated: int


async def _rows() -> list[ProductRemapRow]:
    q = {"is_deleted": {"$ne": True}, "status": {"$nin": ["uploaded", "processing", "failed", "duplicate"]},
         "$or": [{"fields.product_category": {"$in": [None, "", "Others"]}}, {"fields.product_category": {"$nin": sorted(MASTER)}}]}
    out = []
    async for d in db.policies.find(q, {"_id": 0, "id": 1, "fields": 1}):
        f = d.get("fields") or {}
        guess = derive_fields({**f, "product_category": None}).get("product_category")
        out.append(ProductRemapRow(id=d["id"], policy_number=f.get("policy_number"), insurer=f.get("insurer"), raw_product=f.get("product_name"),
                                   current=f.get("product_category"), suggested=guess if guess in MASTER and guess != "Others" else None))
    return out


@router.get("/policies/product-remap", response_model=List[ProductRemapRow])
async def product_remap_preview(_: User = Depends(admin_only)):
    return await _rows()


@router.post("/policies/product-remap", response_model=ProductRemapResult)
async def product_remap_apply(body: ProductRemapApply, user: User = Depends(admin_only)):
    want = set(body.ids)
    done = []
    for r in await _rows():
        if r.id in want and r.suggested:
            note = f"Product mapped to Product Master: {r.current or '—'} → {r.suggested} (read as \"{r.raw_product or '—'}\")"
            await db.policies.update_one({"id": r.id}, {"$set": {"fields.product_category": r.suggested, "updated_at": now_utc()},
                                                        "$push": {"history": history(user, "Product mapped", note)}})
            done.append(r.id)
    if done:
        await refresh_after_correction(done, user, "product")
    return ProductRemapResult(updated=len(done))
