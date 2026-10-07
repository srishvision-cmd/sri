"""Criteria:
  - "Agent can choose broker": GET /api/brokers returns 200 for an agent user; upload as agent with
    broker_id stores that broker.
  - "Agent options include default broker": GET /api/agents returns broker_id for each agent.
"""
import httpx

from .conftest import API_URL
from ._commission_helpers import admin_client, create_agent, create_broker, delete_broker, delete_policy, delete_user

PDF_PATH = "/tmp/tscheck_sample.pdf"


def _write_pdf():
    pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF"
    )
    with open(PDF_PATH, "wb") as fh:
        fh.write(pdf)


def test_agent_can_list_brokers_and_upload_with_broker():
    _write_pdf()
    admin = admin_client()
    broker = create_broker(admin)
    agent = create_agent(admin, broker_id=broker["id"])
    policy_id = None
    try:
        agent_client = httpx.Client(base_url=API_URL, timeout=30.0)
        login_resp = agent_client.post(
            "/auth/login", json={"username": agent["username"], "password": agent["temp_password"]}
        )
        assert login_resp.status_code == 200, login_resp.text

        brokers_resp = agent_client.get("/brokers")
        assert brokers_resp.status_code == 200, brokers_resp.text
        assert any(b["id"] == broker["id"] for b in brokers_resp.json()), brokers_resp.json()

        with open(PDF_PATH, "rb") as fh:
            upload_resp = agent_client.post(
                "/policies/upload",
                files={"file": ("tscheck_sample.pdf", fh, "application/pdf")},
                data={"broker_id": broker["id"], "payment_mode": "Online"},
            )
        assert upload_resp.status_code == 200, upload_resp.text
        body = upload_resp.json()
        policy_id = body["id"]
        assert body["broker_id"] == broker["id"], body
        assert body["broker_name"] == broker["name"], body
        assert body["agent_id"] == agent["id"], body
        agent_client.close()
    finally:
        if policy_id:
            delete_policy(policy_id)
        delete_user(agent["username"])
        delete_broker(broker["id"])


def test_agents_endpoint_returns_broker_id_for_each_agent():
    admin = admin_client()
    broker = create_broker(admin)
    agent = create_agent(admin, broker_id=broker["id"])
    try:
        resp = admin.get("/agents")
        assert resp.status_code == 200, resp.text
        agents = resp.json()
        assert all("broker_id" in a for a in agents), agents
        mine = next((a for a in agents if a["id"] == agent["id"]), None)
        assert mine is not None, agents
        assert mine["broker_id"] == broker["id"], mine
    finally:
        delete_user(agent["username"])
        delete_broker(broker["id"])
