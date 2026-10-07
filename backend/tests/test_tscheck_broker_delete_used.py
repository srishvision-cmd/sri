"""Criterion: Broker manual update — delete an unused broker succeeds; deleting a broker that
is referenced by a policy returns 409."""
from ._commission_helpers import admin_client, create_broker, delete_broker, delete_policy, create_agent, delete_user, insert_policy


def test_delete_unused_broker_ok_used_broker_conflicts():
    admin = admin_client()
    unused = create_broker(admin)
    used = create_broker(admin)
    agent = create_agent(admin)
    policy_id = None
    try:
        r = admin.delete(f"/brokers/{unused['id']}")
        assert r.status_code == 200, r.text

        policy_id = insert_policy(agent, insurer="Generic Insurer", broker_id=used["id"])
        r2 = admin.delete(f"/brokers/{used['id']}")
        assert r2.status_code == 409, r2.text
        assert "used" in r2.json()["detail"].lower() or "policies" in r2.json()["detail"].lower()

        still = admin.get("/brokers").json()
        assert any(b["id"] == used["id"] for b in still), "used broker should still exist after failed delete"
    finally:
        if policy_id:
            delete_policy(policy_id)
        delete_broker(used["id"])
        delete_user(agent["username"])
