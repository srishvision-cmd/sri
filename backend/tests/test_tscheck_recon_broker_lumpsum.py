"""Criterion: Srishvision -> Broker lump-sum part payment across 10 policies, tracked per policy.

Create a tscheck broker + 10 tscheck policies (gross_premium 20000 each, broker_id set).
GET /api/recon/summary?kind=broker shows premium=sum, outstanding=sum. POST /api/recon/settlements
(kind broker, amount = half of total, mode Cheque, reference CHQ001) allocates to the oldest
policies first; GET /api/policies/{id} shows broker_paid/broker_outstanding accordingly; summary
outstanding = total - amount; open cases count correct.
"""
from datetime import date

from ._commission_helpers import admin_client, create_agent, create_broker, delete_broker, delete_user
from ._recon_helpers import delete_policy, delete_settlements, insert_broker_policy

N = 10
GROSS = 20000.0


def test_broker_lumpsum_part_payment_allocates_oldest_first():
    admin = admin_client()
    broker = create_broker(admin)
    agent = create_agent(admin)
    pids = []
    try:
        # oldest (days_ago=N..1) created first so sort("created_at", 1) orders them 0..9 oldest->newest
        for i in range(N):
            pids.append(insert_broker_policy(agent, broker, gross_premium=GROSS, days_ago=N - i))

        total = GROSS * N
        summary = admin.get(f"/recon/summary?kind=broker").json()
        row = next(p for p in summary if p["party_id"] == broker["id"])
        assert row["premium"] == total, row
        assert row["outstanding"] == total, row
        assert row["paid"] == 0, row
        assert row["policies"] == N, row
        assert row["outstanding_policies"] == N, row

        half = round(total / 2, 2)  # settles exactly the 5 oldest policies
        r = admin.post("/recon/settlements", json={
            "kind": "broker", "party_id": broker["id"], "amount": half, "mode": "Cheque",
            "reference": "CHQ001", "paid_on": date.today().isoformat(),
        })
        assert r.status_code == 200, r.text
        settlement = r.json()
        assert settlement["amount"] == half
        assert settlement["mode"] == "Cheque"
        assert settlement["reference"] == "CHQ001"
        assert len(settlement["allocations"]) == 5, settlement
        paid_ids = {a["policy_id"] for a in settlement["allocations"]}
        assert paid_ids == set(pids[:5]), (paid_ids, pids[:5])

        for pid in pids[:5]:
            d = admin.get(f"/policies/{pid}").json()
            assert d["broker_paid"] == GROSS, d
            assert d["broker_outstanding"] == 0, d
        for pid in pids[5:]:
            d = admin.get(f"/policies/{pid}").json()
            assert d["broker_paid"] == 0, d
            assert d["broker_outstanding"] == GROSS, d

        summary2 = admin.get("/recon/summary?kind=broker").json()
        row2 = next(p for p in summary2 if p["party_id"] == broker["id"])
        assert row2["outstanding"] == total - half, row2
        assert row2["paid"] == half, row2
        assert row2["outstanding_policies"] == 5, row2

        hist = admin.get(f"/recon/settlements?kind=broker&party_id={broker['id']}").json()
        assert any(s["reference"] == "CHQ001" for s in hist), hist
    finally:
        delete_settlements(broker["id"])
        for pid in pids:
            delete_policy(pid)
        delete_broker(broker["id"])
        delete_user(agent["username"])
