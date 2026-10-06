from fastapi import APIRouter, Depends, HTTPException, Response

from lib.auth import clear_session, current_user, set_session, verify_password
from lib.db import db
from models.user import LoginIn, User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=User)
async def login(body: LoginIn, response: Response):
    doc = await db.users.find_one({"username": body.username.strip().lower()}, {"_id": 0})
    if not doc or not verify_password(body.password, doc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not doc.get("active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated. Contact your admin.")
    set_session(response, doc["id"])
    return User(**doc)


@router.post("/logout")
async def logout(response: Response):
    clear_session(response)
    return {"ok": True}


@router.get("/me", response_model=User)
async def me(user: User = Depends(current_user)):
    return user
