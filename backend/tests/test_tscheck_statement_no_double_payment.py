"""Criterion: No double payment.

Generating a second statement for an agent while one is unpaid -> 409. After marking the first
paid, a fresh statement for a new policy created later excludes the already-stated policy (it's
locked via commission_statement_id). DELETE on an unpaid statement releases its policies; DELETE
on a paid statement -> 409.
"""
from ._commission_helpers import admin_client, delete_policy, insert_policy
from ._statement_helpers import build_scenario, delete_statement, fix_created_at_type, set_payment_mode, teardown_scenario


def test_no_double_payment_and_delete_rules():
    admin = admin_client()
    scenario = build_scenario(admin)
    sid1 = sid2 = None
    extra_pid = None
    try:
        r1 = admin.post("/statements", json={"agent_id": scenario["agent"]["id"], "period_type": "daily"})
        assert r1.status_code == 200, r1.text
        s1 = r1.json()
        sid1 = s1["id"]

        # second generate while first is unpaid -> 409
        r2 = admin.post("/statements", json={"agent_id": scenario["agent"]["id"], "period_type": "daily"})
        assert r2.status_code == 409, r2.text

        # DELETE unpaid statement releases policies
        del_r = admin.delete(f"/statements/{sid1}")
        assert del_r.status_code == 200, del_r.text
        pol_r = admin.get(f"/policies/{scenario['pid_commission']}")
        assert pol_r.json().get("commission_statement_id") is None, pol_r.json()
        sid1 = None

        # regenerate, then pay it
        r3 = admin.post("/statements", json={"agent_id": scenario["agent"]["id"], "period_type": "daily"})
        assert r3.status_code == 200, r3.text
        s3 = r3.json()
        sid1 = s3["id"]
        pay_r = admin.post(f"/statements/{sid1}/paid", json={"paid_date": "2026-01-15", "utr": "NODBLPAY01"})
        assert pay_r.status_code == 200, pay_r.text

        # DELETE on a paid statement -> 409
        del_paid = admin.delete(f"/statements/{sid1}")
        assert del_paid.status_code == 409, del_paid.text

        # new policy for the same agent -> new statement excludes the already-stated policy
        extra_pid = insert_policy(scenario["agent"], insurer=scenario["insurer"], broker_id=scenario["broker"]["id"],
                                   od_premium=10000, tp_premium=3000, product_category="Private Car Package")
        fix_created_at_type(extra_pid)
        r4 = admin.post("/statements", json={"agent_id": scenario["agent"]["id"], "period_type": "daily"})
        assert r4.status_code == 200, r4.text
        s4 = r4.json()
        sid2 = s4["id"]
        line_ids = [l["policy_id"] for l in s4["lines"]]
        assert extra_pid in line_ids, s4
        assert scenario["pid_commission"] not in line_ids, s4
    finally:
        if sid1:
            delete_statement(sid1)
        if sid2:
            admin.delete(f"/statements/{sid2}")
            delete_statement(sid2)
        if extra_pid:
            delete_policy(extra_pid)
        teardown_scenario(scenario)
