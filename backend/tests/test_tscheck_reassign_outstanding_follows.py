"""'Outstanding follows the agent' criterion: a Cash policy (gross_premium set) moved from
agent A to agent B must show its outstanding under agent B and no longer under A, via
GET /api/outstanding. Fixtures (2 agents + 1 Cash policy under A) are created directly and
cleaned up afterwards.
"""
import pytest

from ._reassign_helpers import admin_client, create_agent, delete_policy, delete_user, insert_policy

GROSS = 20655.0


@pytest.fixture
def cash_policy_under_agent_a():
    admin = admin_client()
    agent_a = create_agent(admin)
    agent_b = create_agent(admin)
    pid = insert_policy(agent_a, gross_premium=GROSS, payment_mode="Cash", policy_number="tscheck-outstanding-1")
    try:
        yield admin, agent_a, agent_b, pid
    finally:
        delete_policy(pid)
        delete_user(agent_a["username"])
        delete_user(agent_b["username"])
        admin.close()


def _outstanding_for(admin, agent_id):
    r = admin.get("/outstanding")
    assert r.status_code == 200, r.text
    rows = {row["agent_id"]: row for row in r.json()}
    return rows.get(agent_id)


def test_outstanding_moves_with_agent_on_reassign(cash_policy_under_agent_a):
    admin, agent_a, agent_b, pid = cash_policy_under_agent_a

    before_a = _outstanding_for(admin, agent_a["id"])
    assert before_a is not None and before_a["outstanding"] >= GROSS - 0.5, before_a
    assert _outstanding_for(admin, agent_b["id"]) is None

    r = admin.post("/policies/reassign-agent", json={"policy_ids": [pid], "agent_id": agent_b["id"]})
    assert r.status_code == 200, r.text

    after_a = _outstanding_for(admin, agent_a["id"])
    assert after_a is None, after_a  # agent A no longer has this (or any) outstanding

    after_b = _outstanding_for(admin, agent_b["id"])
    assert after_b is not None and after_b["outstanding"] >= GROSS - 0.5, after_b
