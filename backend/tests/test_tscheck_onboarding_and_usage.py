"""Admin onboards a user criterion: POST /users creates an agent with a generated temp
password and must_change_password=true; the new user can log in with it. GET /usage is
admin-only (200 for admin, 403 for the freshly onboarded agent). Cleans up the fixture user
from Mongo afterwards so only the seeded kumararaja admin remains.
"""
import uuid

import httpx
import pytest

from .conftest import API_URL

try:
    from pymongo import MongoClient

    _DB = MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=3000)["app"]
except Exception:  # pragma: no cover
    _DB = None


def _admin_client() -> httpx.Client:
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": "kumararaja", "password": "Raja@1985"})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture
def onboarded_agent():
    admin = _admin_client()
    full_name = f"tscheck-onboard-{uuid.uuid4().hex[:6]}"
    r = admin.post("/users", json={"full_name": full_name, "branch": "Chennai", "role": "agent"})
    assert r.status_code == 200, r.text
    body = r.json()
    try:
        yield admin, body
    finally:
        username = body["user"]["username"] if "user" in body else body.get("username")
        _DB.users.delete_one({"username": username})
        admin.close()


def test_onboard_creates_agent_with_temp_password_and_forced_change(onboarded_agent):
    admin, body = onboarded_agent
    username = body["user"]["username"] if "user" in body else body.get("username")
    temp_password = body.get("temp_password") or body.get("password")
    assert username and username.lower().startswith("agt"), body
    assert temp_password, body
    assert body["user"]["must_change_password"] is True

    with httpx.Client(base_url=API_URL, timeout=30.0) as agent_c:
        r = agent_c.post("/auth/login", json={"username": username, "password": temp_password})
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "agent"
        assert r.json()["must_change_password"] is True

        # usage endpoint is admin-only: 403 for the agent
        usage_r = agent_c.get("/usage")
        assert usage_r.status_code == 403, usage_r.text


def test_usage_endpoint_accessible_to_admin(onboarded_agent):
    admin, _ = onboarded_agent
    r = admin.get("/usage")
    assert r.status_code == 200, r.text
