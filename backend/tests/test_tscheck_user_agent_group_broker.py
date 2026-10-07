"""Criterion: Users — agent group & default broker. PATCH /api/users/{id} with agent_group/broker_id
persists; "" clears them."""
from ._commission_helpers import admin_client, create_agent, create_broker, create_group, delete_broker, delete_group, delete_user


def test_patch_user_agent_group_and_broker_persist_and_clear():
    admin = admin_client()
    broker = create_broker(admin)
    group = create_group(admin)
    agent = create_agent(admin)
    try:
        r = admin.patch(f"/users/{agent['id']}", json={"agent_group": group["name"], "broker_id": broker["id"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["agent_group"] == group["name"], body
        assert body["broker_id"] == broker["id"], body

        # confirm it persisted by re-fetching
        lst = admin.get("/users")
        assert lst.status_code == 200, lst.text
        row = next(u for u in lst.json() if u["id"] == agent["id"])
        assert row["agent_group"] == group["name"]
        assert row["broker_id"] == broker["id"]

        # "" clears both
        r2 = admin.patch(f"/users/{agent['id']}", json={"agent_group": "", "broker_id": ""})
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2["agent_group"] is None, body2
        assert body2["broker_id"] is None, body2
    finally:
        delete_user(agent["username"])
        delete_group(group["id"])
        delete_broker(broker["id"])
