"""Password hashing, JWT session cookie, and role dependencies."""

import hashlib
import hmac
import os
import secrets
import string
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, Response

from lib.db import db
from models.user import User

COOKIE = "mis_session"
SECRET = os.environ["JWT_SECRET"]  # fail fast — never fall back to a public default
TTL_HOURS = 12
_ITER = 120_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITER)
    return f"{salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$")
    except (ValueError, AttributeError):
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), _ITER)
    return hmac.compare_digest(dk.hex(), dk_hex)


def generate_password(length: int = 10) -> str:
    alphabet = string.ascii_letters + string.digits
    core = "".join(secrets.choice(alphabet) for _ in range(length - 2))
    return core + secrets.choice("@#$%") + secrets.choice(string.digits)


def set_session(response: Response, user_id: str) -> None:
    token = jwt.encode(
        {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(hours=TTL_HOURS)},
        SECRET,
        algorithm="HS256",
    )
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", max_age=TTL_HOURS * 3600, path="/")


def clear_session(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


async def current_user(request: Request) -> User:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Session expired")
    doc = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0, "password_hash": 0})
    if not doc or not doc.get("active", True):
        raise HTTPException(status_code=401, detail="Account inactive")
    return User(**doc)


def require_roles(*roles: str):
    async def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Not permitted for your role")
        return user

    return dep
