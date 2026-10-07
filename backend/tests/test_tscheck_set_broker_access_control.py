"""Criterion: access control — POST /api/policies/set-broker and GET /api/policies/{id}/commission
must reject the agent role (403), not silently succeed or 401.
"""
from .conftest import login
from ._commission_helpers import admin_client, create_agent, delete_policy, delete_user, insert_policy


def test_set_broker_and_commission_endpoints_reject_agent_role():
    admin = admin_client()
    agent = create_agent(admin)
    pid = None
    try:
        pid = insert_policy(agent, insurer="Some Insurer")
        agent_client = login(agent["username"], agent["temp_password"])

        r1 = agent_client.post("/policies/set-broker", json={"policy_ids": [pid], "broker_id": None})
        assert r1.status_code == 403, r1.text

        r2 = agent_client.get(f"/policies/{pid}/commission")
        assert r2.status_code == 403, r2.text
    finally:
        if pid:
            delete_policy(pid)
        delete_user(agent["username"])
