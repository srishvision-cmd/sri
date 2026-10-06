"""POST /api/policies/reassign-agent validation + happy path (bulk agent correction).
Creates 2 throwaway agents + 2 policies under agent A via direct Mongo insert (mirrors
models/policy.py Policy), then exercises: bulk reassign moves both policies to agent B with
an 'Agent changed' history note; unknown agent_id -> 403; agent role -> 403; empty
policy_ids -> 422; unknown policy id -> 404. Cleans up fixtures afterwards.
"""
import httpx
import pytest

from .conftest import API_URL
from ._reassign_helpers import admin_client, create_agent, delete_policy, delete_user, insert_policy


@pytest.fixture
def two_agents_two_policies():
    admin = admin_client()
    agent_a = create_agent(admin)
    agent_b = create_agent(admin)
    pid1 = insert_policy(agent_a, policy_number="tscheck-bulk-1")
    pid2 = insert_policy(agent_a, policy_number="tscheck-bulk-2")
    try:
        yield admin, agent_a, agent_b, [pid1, pid2]
    finally:
        delete_policy(pid1)
        delete_policy(pid2)
        delete_user(agent_a["username"])
        delete_user(agent_b["username"])
        admin.close()


def test_bulk_reassign_moves_policies_and_logs_history(two_agents_two_policies):
    admin, agent_a, agent_b, pids = two_agents_two_policies
    r = admin.post("/policies/reassign-agent", json={"policy_ids": pids, "agent_id": agent_b["id"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["updated"] == 2, body
    assert body["agent_code"] == agent_b["agent_code"]

    for pid in pids:
        doc = admin.get(f"/policies/{pid}").json()
        assert doc["agent_id"] == agent_b["id"], doc
        assert doc["agent_code"] == agent_b["agent_code"], doc
        last_history = doc["history"][-1]
        assert last_history["action"] == "Agent changed", doc["history"]
        assert agent_a["agent_code"] in last_history["note"]
        assert agent_b["agent_code"] in last_history["note"]


def test_unknown_agent_id_rejected_403(two_agents_two_policies):
    admin, agent_a, agent_b, pids = two_agents_two_policies
    r = admin.post("/policies/reassign-agent", json={"policy_ids": [pids[0]], "agent_id": "no-such-agent-id"})
    assert r.status_code == 403, r.text


def test_agent_role_forbidden_403(two_agents_two_policies):
    admin, agent_a, agent_b, pids = two_agents_two_policies
    with httpx.Client(base_url=API_URL, timeout=30.0) as agent_c:
        r = agent_c.post("/auth/login", json={"username": agent_a["username"], "password": agent_a["temp_password"]})
        assert r.status_code == 200, r.text
        r2 = agent_c.post("/policies/reassign-agent", json={"policy_ids": [pids[0]], "agent_id": agent_b["id"]})
        assert r2.status_code == 403, r2.text


def test_empty_policy_ids_rejected_422(two_agents_two_policies):
    admin, agent_a, agent_b, pids = two_agents_two_policies
    r = admin.post("/policies/reassign-agent", json={"policy_ids": [], "agent_id": agent_b["id"]})
    assert r.status_code == 422, r.text


def test_unknown_policy_id_rejected_404(two_agents_two_policies):
    admin, agent_a, agent_b, pids = two_agents_two_policies
    r = admin.post("/policies/reassign-agent", json={"policy_ids": ["no-such-policy-id"], "agent_id": agent_b["id"]})
    assert r.status_code == 404, r.text
