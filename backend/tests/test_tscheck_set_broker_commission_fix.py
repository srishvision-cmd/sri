"""Criterion: broker-scoped receivable rule not applied to policies with no broker_id.
GET /api/policies/{id}/commission must show receivable=null with a "Policy broker is 'not set'"
miss reason, and POST /api/policies/set-broker must make the rule apply (receivable computed).
"""
from ._commission_helpers import (
    admin_client, create_agent, create_broker, delete_broker, delete_policy, delete_rule, delete_user,
    insert_policy, rule_body, uniq,
)


def test_set_broker_makes_broker_scoped_rule_apply():
    admin = admin_client()
    broker = create_broker(admin)
    agent = create_agent(admin)
    pid, rule_id = None, None
    try:
        rule = admin.post("/commission/rules", json=rule_body(
            "receivable", uniq("rec"), insurer="National Insurance", broker_id=broker["id"],
            products=["GCV"], gvw_min=16500, gvw_max=34000, net_percent=15,
        ))
        assert rule.status_code == 200, rule.text
        rule_id = rule.json()["id"]

        pid = insert_policy(
            agent, insurer="National Insurance Company Limited", vehicle_class="Goods Carrying",
            cover_type="Package", gvw=18500,
        )
        from ._commission_helpers import DB
        DB.policies.update_one({"id": pid}, {"$set": {"fields.net_premium": 40000}})

        before = admin.get(f"/policies/{pid}/commission")
        assert before.status_code == 200, before.text
        b = before.json()
        assert b["receivable"] is None, b
        assert b["misses"], b
        assert any("Policy broker is 'not set'" in r for r in b["misses"][0]["reasons"]), b

        resp = admin.post("/policies/set-broker", json={"policy_ids": [pid], "broker_id": broker["id"]})
        assert resp.status_code == 200, resp.text
        assert resp.json()["updated"] == 1, resp.json()

        after = admin.get(f"/policies/{pid}/commission")
        assert after.status_code == 200, after.text
        a = after.json()
        assert a["receivable"] == 6000, a  # 15% of 40000 net premium
    finally:
        if pid:
            delete_policy(pid)
        if rule_id:
            delete_rule(rule_id)
        delete_user(agent["username"])
        delete_broker(broker["id"])
