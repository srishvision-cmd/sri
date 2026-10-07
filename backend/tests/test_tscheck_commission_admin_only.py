"""Criterion: commission is admin only.

/api/commission/rules and GET /api/policies/{id}/commission -> 403 for backoffice and agent;
GET /api/policies returns commission: null for non-admin.
"""
import httpx

from .conftest import API_URL
from ._commission_helpers import admin_client, create_agent, delete_policy, delete_user, insert_policy, rule_body, uniq


def _login(username: str, password: str) -> httpx.Client:
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_commission_endpoints_forbidden_for_backoffice_and_agent():
    admin = admin_client()
    bo_resp = admin.post("/users", json={"full_name": uniq("bo"), "branch": "Chennai", "role": "backoffice"})
    assert bo_resp.status_code == 200, bo_resp.text
    bo_body = bo_resp.json()
    agent = create_agent(admin)
    pid = None
    try:
        bo = _login(bo_body["username"], bo_body["temp_password"])
        ag = _login(agent["username"], agent["temp_password"])

        for client, label in ((bo, "backoffice"), (ag, "agent")):
            r = client.get("/commission/rules")
            assert r.status_code == 403, f"{label}: {r.text}"
            r = client.post("/commission/rules", json=rule_body("receivable", uniq("r"), od_percent=5))
            assert r.status_code == 403, f"{label}: {r.text}"

        pid = insert_policy(agent, insurer=uniq("insurer"))

        r = bo.get(f"/policies/{pid}/commission")
        assert r.status_code == 403, r.text
        r = ag.get(f"/policies/{pid}/commission")
        assert r.status_code == 403, r.text

        # GET /api/policies: commission must be null/absent for non-admin, present (object or null) for admin
        r_bo = bo.get("/policies")
        assert r_bo.status_code == 200, r_bo.text
        bo_hit = next((p for p in r_bo.json() if p["id"] == pid), None)
        if bo_hit is not None:
            assert bo_hit.get("commission") is None, bo_hit

        r_admin = admin.get("/policies")
        assert r_admin.status_code == 200, r_admin.text
        admin_hit = next((p for p in r_admin.json() if p["id"] == pid), None)
        assert admin_hit is not None
        # commission key exists for admin (value may be None if no rule matches, but the field is present)
        assert "commission" in admin_hit
    finally:
        if pid:
            delete_policy(pid)
        delete_user(bo_body["username"])
        delete_user(agent["username"])
