"""Admin view / edit of the saved AI grid layouts (one per company and grid type)."""
from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_roles
from lib.db import db
from models.commission import GridTemplate, GridTemplateIn
from models.common import now_utc
from models.user import User

router = APIRouter()
admin_only = require_roles("admin")


@router.get("/commission/grid/templates", response_model=list[GridTemplate])
async def list_templates(_: User = Depends(admin_only)):
    return await db.grid_templates.find({}, {"_id": 0}).sort([("insurer", 1), ("kind", 1)]).to_list(500)


@router.put("/commission/grid/templates/{id}", response_model=GridTemplate)
async def update_template(id: str, body: GridTemplateIn, user: User = Depends(admin_only)):
    """Admin instructions for this company's grid, e.g. 'Rates are in the Total Payout column; GVW slabs are in tonnes'."""
    doc = await db.grid_templates.find_one_and_update(
        {"id": id}, {"$set": {"notes": body.notes.strip(), "updated_at": now_utc(), "updated_by": user.full_name}}, projection={"_id": 0}, return_document=True)
    if not doc:
        raise HTTPException(status_code=404, detail="Saved layout not found")
    return doc


@router.delete("/commission/grid/templates/{id}/corrections/{index}", response_model=GridTemplate)
async def delete_correction(id: str, index: int, _: User = Depends(admin_only)):
    doc = await db.grid_templates.find_one({"id": id}, {"_id": 0})
    if not doc or not 0 <= index < len(doc.get("corrections") or []):
        raise HTTPException(status_code=404, detail="Correction not found")
    doc["corrections"].pop(index)
    await db.grid_templates.update_one({"id": id}, {"$set": {"corrections": doc["corrections"]}})
    return doc


@router.delete("/commission/grid/templates/{id}")
async def delete_template(id: str, _: User = Depends(admin_only)):
    res = await db.grid_templates.delete_one({"id": id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Saved layout not found")
    return {"ok": True}
