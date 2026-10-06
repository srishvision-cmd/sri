from fastapi import APIRouter, Depends, HTTPException, Response

import re

from lib.auth import clear_session, current_user, hash_password, set_session, verify_password
from lib.db import db
from models.user import ChangePasswordIn, LoginIn, User

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


@router.post("/change-password", response_model=User)
async def change_password(body: ChangePasswordIn, user: User = Depends(current_user)):
    doc = await db.users.find_one({"id": user.id}, {"_id": 0, "password_hash": 1})
    if not doc or not verify_password(body.current_password, doc.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current one")
    if not (re.search(r"[A-Za-z]", body.new_password) and re.search(r"\d", body.new_password)):
        raise HTTPException(status_code=400, detail="Password must contain at least one letter and one number")
    await db.users.update_one({"id": user.id}, {"$set": {"password_hash": hash_password(body.new_password), "must_change_password": False}})
    return User(**{**user.model_dump(), "must_change_password": False})
