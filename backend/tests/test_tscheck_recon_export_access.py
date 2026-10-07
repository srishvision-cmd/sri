"""Criterion: Recon Excel export + role access.

GET /api/recon/export?kind=broker&party_id=... -> 200 xlsx listing the party's policies and
settlements. agent and backoffice -> 403 on /api/recon/* (summary, policies, settlements, export).
"""
from datetime import date

import httpx

from .conftest import API_URL
from ._commission_helpers import admin_client, create_agent, create_broker, delete_broker, delete_user, uniq
from ._recon_helpers import delete_policy, delete_settlements, insert_broker_policy

GROSS = 12000.0


def _login(username: str, password: str) -> httpx.Client:
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_recon_export_xlsx_and_role_access():
    admin = admin_client()
    broker = create_broker(admin)
    agent = create_agent(admin)
    pid = None
    try:
        pid = insert_broker_policy(agent, broker, gross_premium=GROSS, days_ago=1)
        admin.post("/recon/settlements", json={
            "kind": "broker", "party_id": broker["id"], "amount": GROSS, "mode": "NEFT/RTGS",
            "reference": "UTR123", "paid_on": date.today().isoformat(),
        })

        r = admin.get(f"/recon/export?kind=broker&party_id={broker['id']}")
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        assert r.content[:2] == b"PK"  # valid xlsx (zip) magic bytes
        assert len(r.content) > 500

        bo_resp = admin.post("/users", json={"full_name": uniq("bo"), "branch": "Chennai", "role": "backoffice"})
        assert bo_resp.status_code == 200, bo_resp.text
        bo_body = bo_resp.json()
        bo = _login(bo_body["username"], bo_body["temp_password"])
        ag = _login(agent["username"], agent["temp_password"])
        try:
            for client, label in ((bo, "backoffice"), (ag, "agent")):
                assert client.get("/recon/summary?kind=broker").status_code == 403, label
                assert client.get(f"/recon/policies?kind=broker&party_id={broker['id']}").status_code == 403, label
                assert client.get("/recon/settlements?kind=broker").status_code == 403, label
                assert client.get(f"/recon/export?kind=broker&party_id={broker['id']}").status_code == 403, label
        finally:
            delete_user(bo_body["username"])
    finally:
        delete_settlements(broker["id"])
        if pid:
            delete_policy(pid)
        delete_broker(broker["id"])
        delete_user(agent["username"])
