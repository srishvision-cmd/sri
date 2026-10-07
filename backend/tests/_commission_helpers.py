"""Shared helpers for the commission-grid test files: create throwaway brokers / agent groups /
agents / commission rules / policies via the real API + a direct Mongo insert for the policy doc
(mirrors models/policy.py Policy shape — same pattern as _reassign_helpers.py)."""
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


def uniq(prefix: str) -> str:
    return f"tscheck-{prefix}-{uuid.uuid4().hex[:8]}"


def create_broker(admin: httpx.Client, name: str | None = None) -> dict:
    name = name or uniq("broker")
    r = admin.post("/brokers", json={"name": name, "code": None, "aliases": [], "active": True})
    assert r.status_code == 200, r.text
    return r.json()


def create_group(admin: httpx.Client, name: str | None = None) -> dict:
    name = name or uniq("grp")[:40]
    r = admin.post("/agent-groups", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()


def create_agent(admin: httpx.Client, branch: str = "Chennai", agent_group: str | None = None, broker_id: str | None = None) -> dict:
    full_name = uniq("agent")
    body = {"full_name": full_name, "branch": branch, "role": "agent"}
    if agent_group:
        body["agent_group"] = agent_group
    if broker_id:
        body["broker_id"] = broker_id
    r = admin.post("/users", json=body)
    assert r.status_code == 200, r.text
    body_resp = r.json()
    user = body_resp.get("user", body_resp)
    return {
        "id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "agent_code": user["username"].upper(),
        "branch": user.get("branch", branch),
        "temp_password": body_resp.get("temp_password") or body_resp.get("password"),
    }


BASE_RULE = {
    "active": True, "insurer": None, "broker_id": None, "agent_group": None, "agent_id": None,
    "products": [], "rtos": [], "ncb": "any", "gvw_min": None, "gvw_max": None, "cc_min": None, "cc_max": None,
    "make": None, "model": None, "valid_from": None, "valid_to": None,
    "od_percent": None, "tp_percent": None, "net_percent": None, "odtp_percent": None, "flat_amount": None,
}


def rule_body(kind: str, name: str, **kw) -> dict:
    body = {**BASE_RULE, "kind": kind, "name": name}
    body.update(kw)
    return body


def delete_user(username: str) -> None:
    if DB is not None:
        DB.users.delete_one({"username": username})


def delete_broker(broker_id: str) -> None:
    if DB is not None:
        DB.brokers.delete_one({"id": broker_id})


def delete_group(group_id: str) -> None:
    if DB is not None:
        DB.agent_groups.delete_one({"id": group_id})


def delete_rule(rule_id: str) -> None:
    if DB is not None:
        DB.commission_rules.delete_one({"id": rule_id})


def insert_policy(agent: dict, insurer: str, vehicle_class: str = "Private Car", cover_type: str = "Package",
                   reg_no: str = "TN10AB1234", od_premium: float = 10000.0, tp_premium: float = 3000.0,
                   broker_id: str | None = None, product_category: str | None = None,
                   seating_capacity: int | None = None, gvw: float | None = None, cc: float | None = None,
                   make: str | None = None, start_date: str | None = None, registration_date: str | None = None,
                   mfg_year: str | None = None, fuel_type: str | None = None, tp_end_date: str | None = None,
                   model: str | None = None, product_name: str | None = None) -> str:
    pid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": pid,
        "file_name": None, "file_mime": None, "has_file": False,
        "status": "extracted",
        "agent_id": agent["id"], "agent_name": agent["full_name"], "agent_code": agent["agent_code"],
        "branch": agent.get("branch", "Chennai"),
        "uploaded_by_id": agent["id"], "uploaded_by_name": agent["full_name"],
        "broker_id": broker_id, "broker_name": None,
        "fields": {
            "policy_number": uniq("pol"),
            "insurer": insurer,
            "lob": "Motor",
            "vehicle_class": vehicle_class,
            "cover_type": cover_type,
            "vehicle_reg_no": reg_no,
            "product_category": product_category or f"{vehicle_class} {cover_type}",
            "od_premium": od_premium,
            "tp_premium": tp_premium,
            "gross_premium": od_premium + tp_premium,
            "seating_capacity": seating_capacity,
            "gvw": gvw,
            "cc": cc,
            "make": make,
            "start_date": start_date,
            "registration_date": registration_date,
            "mfg_year": mfg_year,
            "fuel_type": fuel_type,
            "tp_end_date": tp_end_date,
            "model": model,
            "product_name": product_name,
        },
        "confidence": {}, "ocr_error": None, "duplicate_reason": None, "duplicate_of_id": None,
        "flag_reason": None, "verified_by_name": None, "verified_at": None,
        "created_at": now, "updated_at": now, "history": [],
        "payment_mode": "Online", "payments": [],
        "file_size": None, "original_size": None, "is_deleted": False, "seeded": False,
    }
    DB.policies.insert_one(doc)
    return pid


def delete_policy(policy_id: str) -> None:
    if DB is not None:
        DB.policies.delete_one({"id": policy_id})
