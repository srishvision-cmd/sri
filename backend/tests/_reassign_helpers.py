"""Shared helpers for the reassign-agent test files: create throwaway agents via the
admin API and insert minimal Policy docs directly into Mongo (mirrors models/policy.py
Policy shape) so tests don't depend on a real OCR round-trip.
"""
import uuid
from datetime import datetime, timezone

import httpx

from .conftest import API_URL

try:
    from pymongo import MongoClient

    DB = MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=3000)["app"]
except Exception:  # pragma: no cover
    DB = None


def admin_client() -> httpx.Client:
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": "kumararaja", "password": "Raja@1985"})
    assert r.status_code == 200, r.text
    return c


def create_agent(admin: httpx.Client, branch: str = "Chennai") -> dict:
    """Create a throwaway agent via POST /users. Returns {id, username, full_name, agent_code, temp_password}."""
    full_name = f"tscheck-reassign-{uuid.uuid4().hex[:6]}"
    r = admin.post("/users", json={"full_name": full_name, "branch": branch, "role": "agent"})
    assert r.status_code == 200, r.text
    body = r.json()
    user = body.get("user", body)
    return {
        "id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "agent_code": user["username"].upper(),
        "branch": user.get("branch", branch),
        "temp_password": body.get("temp_password") or body.get("password"),
    }


def delete_user(username: str) -> None:
    if DB is not None:
        DB.users.delete_one({"username": username})


def insert_policy(agent: dict, gross_premium: float = 20655.0, payment_mode: str = "Cash", policy_number: str | None = None) -> str:
    """Insert a minimal, valid Policy doc directly into Mongo. Returns the policy id."""
    pid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    policy_number = policy_number or f"tscheck-pol-{uuid.uuid4().hex[:8]}"
    doc = {
        "id": pid,
        "file_name": None,
        "file_mime": None,
        "has_file": False,
        "status": "extracted",
        "agent_id": agent["id"],
        "agent_name": agent["full_name"],
        "agent_code": agent["agent_code"],
        "branch": agent.get("branch", "Chennai"),
        "uploaded_by_id": agent["id"],
        "uploaded_by_name": agent["full_name"],
        "fields": {
            "policy_number": policy_number,
            "gross_premium": gross_premium,
            "lob": "Motor",
        },
        "confidence": {},
        "ocr_error": None,
        "duplicate_reason": None,
        "duplicate_of_id": None,
        "flag_reason": None,
        "verified_by_name": None,
        "verified_at": None,
        "created_at": now,
        "updated_at": now,
        "history": [],
        "payment_mode": payment_mode,
        "payments": [],
        "file_size": None,
        "original_size": None,
        "is_deleted": False,
        "seeded": False,
    }
    DB.policies.insert_one(doc)
    return pid


def delete_policy(policy_id: str) -> None:
    if DB is not None:
        DB.policies.delete_one({"id": policy_id})
