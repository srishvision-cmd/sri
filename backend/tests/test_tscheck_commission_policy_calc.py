"""Criterion: per-policy commission computed + capped.

Matrix scenario: receivable (ICICI, Private Car Package, od 20%, tp 2.5%) + payable (same scope,
group A agent, od 15%, tp 2%) -> for a policy with od 10000 / tp 3000: receivable 2075, payable
1560, margin 515. Separate sub-test: a payable rule with no matching/overlapping receivable rule
is capped to 0 (capped=True).
"""
from ._commission_helpers import (
    admin_client, create_agent, create_broker, create_group, delete_broker, delete_group,
    delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)


def test_policy_commission_receivable_payable_margin():
    admin = admin_client()
    insurer = uniq("insurer")
    broker = create_broker(admin)
    group = create_group(admin, uniq("grp")[:20])
    agent = create_agent(admin, agent_group=group["name"], broker_id=broker["id"])
    rule_ids, pid = [], None
    try:
        rec = admin.post("/commission/rules", json=rule_body(
            "receivable", uniq("rec"), insurer=insurer, broker_id=broker["id"],
            products=["Private Car Package"], od_percent=20, tp_percent=2.5,
        ))
        assert rec.status_code == 200, rec.text
        rule_ids.append(rec.json()["id"])

        pay = admin.post("/commission/rules", json=rule_body(
            "payable", uniq("pay"), insurer=insurer, broker_id=broker["id"],
            products=["Private Car Package"], agent_group=group["name"], od_percent=15, tp_percent=2,
        ))
        assert pay.status_code == 200, pay.text
        rule_ids.append(pay.json()["id"])

        pid = insert_policy(agent, insurer=insurer, broker_id=broker["id"], od_premium=10000, tp_premium=3000,
                             product_category="Private Car Package")

        r = admin.get(f"/policies/{pid}/commission")
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["receivable"] == 2075, c
        assert c["payable"] == 1560, c
        assert c["margin"] == 515, c
        assert c["capped"] is False, c
    finally:
        if pid:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])
        delete_group(group["id"])
        delete_broker(broker["id"])


def test_policy_commission_capped_when_no_receivable_matches():
    admin = admin_client()
    insurer = uniq("insurer")
    agent = create_agent(admin)
    rule_ids, pid = [], None
    try:
        # payable rule with no overlapping active receivable at all -> compute() caps payable to 0
        pay = admin.post("/commission/rules", json=rule_body(
            "payable", uniq("pay-orphan"), insurer=insurer, od_percent=10,
        ))
        assert pay.status_code == 200, pay.text
        rule_ids.append(pay.json()["id"])

        pid = insert_policy(agent, insurer=insurer, od_premium=10000, tp_premium=3000)
        r = admin.get(f"/policies/{pid}/commission")
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["receivable"] is None, c
        assert c["payable"] == 0, c
        assert c["capped"] is True, c
        assert "No receivable" in (c.get("note") or ""), c
    finally:
        if pid:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])
