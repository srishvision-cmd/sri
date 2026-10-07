from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from lib.auth import current_user, generate_password, hash_password, require_roles
from lib.db import db
from models.user import AgentOption, Credentials, User, UserCreate, UserUpdate

router = APIRouter(tags=["users"])
admin_only = require_roles("admin")

PREFIX = {"agent": ("agt", 1000), "backoffice": ("bo", 2000)}


async def _next_username(role: str) -> str:
    prefix, base = PREFIX[role]
    n = base + await db.users.count_documents({"role": role}) + 1
    while await db.users.find_one({"username": f"{prefix}{n}"}, {"_id": 1}):
        n += 1
    return f"{prefix}{n}"


async def _validate_agents(ids: List[str]) -> None:
    if not ids:
        return
    found = await db.users.count_documents({"id": {"$in": ids}, "role": "agent"})
    if found != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more mapped agents do not exist")


async def agent_options_for(user: User) -> List[AgentOption]:
    if user.role == "agent":
        return [AgentOption(id=user.id, full_name=user.full_name, username=user.username, branch=user.branch, broker_id=user.broker_id)]
    query: dict = {"role": "agent", "active": True}
    if user.role == "backoffice":
        query["$or"] = [{"branch": user.branch}, {"id": {"$in": user.assigned_agent_ids}}]
    docs = await db.users.find(query, {"_id": 0}).sort("full_name", 1).to_list(1000)
    return [AgentOption(**d) for d in docs]


@router.get("/agents", response_model=List[AgentOption])
async def list_agent_options(user: User = Depends(current_user)):
    return await agent_options_for(user)


@router.get("/users", response_model=List[User])
async def list_users(_: User = Depends(admin_only)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(2000)
    return [User(**d) for d in docs]


@router.post("/users", response_model=Credentials)
async def onboard_user(body: UserCreate, _: User = Depends(admin_only)):
    await _validate_agents(body.assigned_agent_ids)
    username = await _next_username(body.role)
    password = generate_password()
    user = User(
        username=username,
        full_name=body.full_name.strip(),
        role=body.role,
        branch=body.branch,
        email=body.email or None,
        mobile=body.mobile or None,
        assigned_agent_ids=body.assigned_agent_ids if body.role == "backoffice" else [],
        agent_group=(body.agent_group or None) if body.role == "agent" else None,
        broker_id=(body.broker_id or None) if body.role == "agent" else None,
        must_change_password=True,
    )
    for _ in range(5):  # parallel onboarding can race on the next sequential username
        try:
            await db.users.insert_one({**user.model_dump(), "password_hash": hash_password(password)})
            break
        except DuplicateKeyError:
            user.username = username = await _next_username(body.role)
    else:
        raise HTTPException(status_code=409, detail="Could not allocate a username — try again")
    return Credentials(user=user, username=username, temp_password=password)


@router.patch("/users/{id}", response_model=User)
async def update_user(id: str, body: UserUpdate, admin: User = Depends(admin_only)):
    updates = body.model_dump(exclude_none=True)
    for k in ("agent_group", "broker_id"):
        if updates.get(k) == "":
            updates[k] = None
    if "assigned_agent_ids" in updates:
        await _validate_agents(updates["assigned_agent_ids"])
    if id == admin.id and updates.get("active") is False:
        raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
    if updates:
        res = await db.users.update_one({"id": id}, {"$set": updates})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        if updates.get("broker_id"):  # default broker also fills existing policies of this agent that have none
            b = await db.brokers.find_one({"id": updates["broker_id"]}, {"_id": 0, "name": 1})
            if b:
                await db.policies.update_many(
                    {"agent_id": id, "$or": [{"broker_id": None}, {"broker_id": {"$exists": False}}]},
                    {"$set": {"broker_id": updates["broker_id"], "broker_name": b["name"]}},
                )
    doc = await db.users.find_one({"id": id}, {"_id": 0, "password_hash": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return User(**doc)


@router.post("/users/{id}/reset-password", response_model=Credentials)
async def reset_password(id: str, _: User = Depends(admin_only)):
    doc = await db.users.find_one({"id": id}, {"_id": 0, "password_hash": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    password = generate_password()
    await db.users.update_one({"id": id}, {"$set": {"password_hash": hash_password(password), "must_change_password": True}})
    return Credentials(user=User(**{**doc, "must_change_password": True}), username=doc["username"], temp_password=password)
