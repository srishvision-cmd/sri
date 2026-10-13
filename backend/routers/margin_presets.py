"""Named margins ("Standard −4%") for the Agent-wise payables margin fill — optionally tied to an agent group."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import require_roles
from lib.db import db
from models.common import UtcDatetime, now_utc
from models.user import User

router = APIRouter()
admin_only = require_roles("admin")


class MarginPresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    minus_percent: Optional[float] = Field(default=None, ge=0, le=100)  # taken off every % component of the receivable
    minus_flat: Optional[float] = Field(default=None, ge=0)  # taken off the flat ₹ amount
    agent_group: Optional[str] = None  # suggested first for agents of this group (None = any agent)


class MarginPreset(MarginPresetIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_by_name: str
    created_at: UtcDatetime = Field(default_factory=now_utc)


@router.get("/commission/margin-presets", response_model=List[MarginPreset])
async def list_presets(_: User = Depends(admin_only)):
    return await db.margin_presets.find({}, {"_id": 0}).sort([("agent_group", 1), ("name", 1)]).to_list(500)


@router.post("/commission/margin-presets", response_model=MarginPreset)
async def create_preset(body: MarginPresetIn, user: User = Depends(admin_only)):
    if body.minus_percent is None and body.minus_flat is None:
        raise HTTPException(status_code=422, detail="Enter a % or ₹ margin")
    if await db.margin_presets.find_one({"name": body.name.strip(), "agent_group": body.agent_group}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="A preset with this name already exists for this group")
    p = MarginPreset(**{**body.model_dump(), "name": body.name.strip()}, created_by_name=user.full_name)
    await db.margin_presets.insert_one(p.model_dump())
    return p


@router.delete("/commission/margin-presets/{id}")
async def delete_preset(id: str, _: User = Depends(admin_only)):
    if not (await db.margin_presets.delete_one({"id": id})).deleted_count:
        raise HTTPException(status_code=404, detail="Preset not found")
    return {"ok": True}
