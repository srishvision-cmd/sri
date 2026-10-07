"""Criterion: PATCH /api/users/{agent_id} {broker_id} backfills broker_id/broker_name onto that
agent's existing policies which had no broker, but must NOT overwrite policies that already had a
different broker set.
"""
from ._commission_helpers import (
    admin_client, create_agent, create_broker, delete_broker, delete_policy, delete_user, insert_policy,
)


def test_patch_agent_default_broker_backfills_only_brokerless_policies():
    admin = admin_client()
    broker_a = create_broker(admin)
    broker_b = create_broker(admin)
    agent = create_agent(admin)
    pid_no_broker, pid_with_broker = None, None
    try:
        pid_no_broker = insert_policy(agent, insurer="Some Insurer")
        pid_with_broker = insert_policy(agent, insurer="Some Insurer", broker_id=broker_b["id"])

        resp = admin.patch(f"/users/{agent['id']}", json={"broker_id": broker_a["id"]})
        assert resp.status_code == 200, resp.text
        assert resp.json()["broker_id"] == broker_a["id"], resp.json()

        backfilled = admin.get(f"/policies/{pid_no_broker}")
        assert backfilled.status_code == 200, backfilled.text
        bf = backfilled.json()
        assert bf["broker_id"] == broker_a["id"], bf
        assert bf["broker_name"] == broker_a["name"], bf

        kept = admin.get(f"/policies/{pid_with_broker}")
        assert kept.status_code == 200, kept.text
        kf = kept.json()
        assert kf["broker_id"] == broker_b["id"], kf  # untouched — already had a broker
    finally:
        if pid_no_broker:
            delete_policy(pid_no_broker)
        if pid_with_broker:
            delete_policy(pid_with_broker)
        delete_user(agent["username"])
        delete_broker(broker_a["id"])
        delete_broker(broker_b["id"])
