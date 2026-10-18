"""Criterion: partner payment oldest-first.

POST /api/recon/partner-payment as admin for an agent with outstanding policies returns a
Settlement with allocations ordered oldest policy first, unallocated >= 0 and balance_after
set; reverse it afterward via POST /api/recon/settlements/{id}/reverse to leave data unchanged.
"""
from datetime import date, timedelta

from ._commission_helpers import admin_client, create_agent, delete_user
from ._recon_helpers import delete_policy, delete_settlements, insert_agent_cash_policy


def test_partner_payment_allocates_oldest_outstanding_first():
    admin = admin_client()
    agent = create_agent(admin)
    old_pid = insert_agent_cash_policy(agent, gross_premium=1000.0, days_ago=10)
    new_pid = insert_agent_cash_policy(agent, gross_premium=5000.0, days_ago=1)

    settlement_id = None
    try:
        r = admin.post("/recon/partner-payment", json={
            "agent_id": agent["id"], "amount": 3000.0, "mode": "Cash", "reference": "tscheck",
            "paid_on": date.today().isoformat(),
        })
        assert r.status_code == 200, r.text
        s = r.json()
        settlement_id = s["id"]
        assert s["unallocated"] >= 0
        assert s["balance_after"] is not None
        policy_order = [a["policy_id"] for a in s["allocations"]]
        assert policy_order[0] == old_pid, f"oldest policy must be allocated first, got {policy_order}"
        assert old_pid in policy_order and new_pid in policy_order
        assert s["allocations"][0]["amount"] == 1000.0  # fully clears the oldest (smaller) outstanding first
        assert s["allocations"][1]["amount"] == 2000.0  # remainder onto the next oldest
    finally:
        if settlement_id:
            r = admin.post(f"/recon/settlements/{settlement_id}/reverse")
            assert r.status_code == 200, r.text
        delete_settlements(agent["id"])
        delete_policy(old_pid)
        delete_policy(new_pid)
        delete_user(agent["username"])
