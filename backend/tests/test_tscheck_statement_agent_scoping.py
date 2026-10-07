"""Criterion: Agent sees own statements only.

Agent login -> GET /api/statements returns only that agent's statements; GET another agent's
statement by id -> 404; backoffice GET /api/statements -> 403.
"""
import httpx

from .conftest import API_URL
from ._commission_helpers import admin_client, delete_user, uniq
from ._statement_helpers import build_scenario, delete_statement, teardown_scenario


def _login(username: str, password: str) -> httpx.Client:
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_agent_statement_scoping_and_backoffice_forbidden():
    admin = admin_client()
    scenario_a = build_scenario(admin)
    scenario_b = build_scenario(admin)
    bo_resp = admin.post("/users", json={"full_name": uniq("bo"), "branch": "Chennai", "role": "backoffice"})
    assert bo_resp.status_code == 200, bo_resp.text
    bo_body = bo_resp.json()
    sid_a = sid_b = None
    try:
        ra = admin.post("/statements", json={"agent_id": scenario_a["agent"]["id"], "period_type": "daily"})
        assert ra.status_code == 200, ra.text
        sid_a = ra.json()["id"]
        rb = admin.post("/statements", json={"agent_id": scenario_b["agent"]["id"], "period_type": "daily"})
        assert rb.status_code == 200, rb.text
        sid_b = rb.json()["id"]

        agent_a = _login(scenario_a["agent"]["username"], scenario_a["agent"]["temp_password"])
        list_r = agent_a.get("/statements")
        assert list_r.status_code == 200, list_r.text
        rows = list_r.json()
        assert any(r["id"] == sid_a for r in rows), rows
        assert all(r["agent_id"] == scenario_a["agent"]["id"] for r in rows), rows
        assert not any(r["id"] == sid_b for r in rows), rows

        # agent A cannot fetch agent B's statement
        other_r = agent_a.get(f"/statements/{sid_b}")
        assert other_r.status_code == 404, other_r.text

        # agent A can download its own PDF
        pdf_r = agent_a.get(f"/statements/{sid_a}/pdf")
        assert pdf_r.status_code == 200, pdf_r.text
        assert pdf_r.headers["content-type"].startswith("application/pdf"), pdf_r.headers

        bo = _login(bo_body["username"], bo_body["temp_password"])
        bo_r = bo.get("/statements")
        assert bo_r.status_code == 403, bo_r.text
    finally:
        for sid in (sid_a, sid_b):
            if sid:
                admin.delete(f"/statements/{sid}")
                delete_statement(sid)
        teardown_scenario(scenario_a)
        teardown_scenario(scenario_b)
        delete_user(bo_body["username"])
