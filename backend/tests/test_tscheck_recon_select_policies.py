"""Criterion: allocate a settlement to selected policies only.

POST /api/recon/settlements with policy_ids=[p3, p1] allocates to p3 first then p1 only (p2 left
untouched); amount larger than the selected policies' outstanding -> 400.
"""
from datetime import date

from ._commission_helpers import admin_client, create_agent, create_broker, delete_broker, delete_user
from ._recon_helpers import delete_policy, delete_settlements, insert_broker_policy

GROSS = 5000.0


def test_settlement_allocates_only_to_selected_policy_ids_in_order():
    admin = admin_client()
    broker = create_broker(admin)
    agent = create_agent(admin)
    p1 = p2 = p3 = None
    try:
        p1 = insert_broker_policy(agent, broker, gross_premium=GROSS, days_ago=3)
        p2 = insert_broker_policy(agent, broker, gross_premium=GROSS, days_ago=2)
        p3 = insert_broker_policy(agent, broker, gross_premium=GROSS, days_ago=1)

        # amount bigger than selected (p3+p1 = 10000) outstanding -> 400, p2 must stay untouched
        r = admin.post("/recon/settlements", json={
            "kind": "broker", "party_id": broker["id"], "amount": GROSS * 2 + 1, "mode": "Online",
            "reference": None, "paid_on": date.today().isoformat(), "policy_ids": [p3, p1],
        })
        assert r.status_code == 400, r.text

        # smaller amount settles p3 fully, partially pays p1, leaves p2 fully outstanding
        amt = GROSS + GROSS / 2
        r = admin.post("/recon/settlements", json={
            "kind": "broker", "party_id": broker["id"], "amount": amt, "mode": "Online",
            "reference": None, "paid_on": date.today().isoformat(), "policy_ids": [p3, p1],
        })
        assert r.status_code == 200, r.text
        s = r.json()
        assert [a["policy_id"] for a in s["allocations"]] == [p3, p1], s

        d3 = admin.get(f"/policies/{p3}").json()
        assert d3["broker_paid"] == GROSS, d3
        assert d3["broker_outstanding"] == 0, d3

        d1 = admin.get(f"/policies/{p1}").json()
        assert d1["broker_paid"] == GROSS / 2, d1
        assert d1["broker_outstanding"] == GROSS / 2, d1

        d2 = admin.get(f"/policies/{p2}").json()
        assert d2["broker_paid"] == 0, d2
        assert d2["broker_outstanding"] == GROSS, d2
    finally:
        delete_settlements(broker["id"])
        for pid in (p1, p2, p3):
            if pid:
                delete_policy(pid)
        delete_broker(broker["id"])
        delete_user(agent["username"])
