"""Criterion: Agent -> Srishvision receipt.

For a tscheck agent with Cash policies, POST /api/recon/settlements kind=agent allocates receipts;
each policy's outstanding drops, a payment entry with the mode/reference appears, and the agent
summary updates.
"""
from datetime import date

from ._commission_helpers import admin_client, create_agent, delete_user
from ._recon_helpers import delete_policy, delete_settlements, insert_agent_cash_policy

GROSS = 8000.0


def test_agent_receipt_allocates_and_updates_policy_and_summary():
    admin = admin_client()
    agent = create_agent(admin)
    p1 = p2 = None
    try:
        p1 = insert_agent_cash_policy(agent, gross_premium=GROSS, days_ago=2)
        p2 = insert_agent_cash_policy(agent, gross_premium=GROSS, days_ago=1)

        summary = admin.get("/recon/summary?kind=agent").json()
        row = next(p for p in summary if p["party_id"] == agent["id"])
        assert row["premium"] == GROSS * 2, row
        assert row["outstanding"] == GROSS * 2, row

        amt = GROSS + GROSS / 2  # pays p1 fully, p2 half
        r = admin.post("/recon/settlements", json={
            "kind": "agent", "party_id": agent["id"], "amount": amt, "mode": "Cash",
            "reference": "RCPT-1", "paid_on": date.today().isoformat(),
        })
        assert r.status_code == 200, r.text
        s = r.json()
        assert [a["policy_id"] for a in s["allocations"]] == [p1, p2], s

        d1 = admin.get(f"/policies/{p1}").json()
        assert d1["outstanding"] == 0, d1
        assert d1["amount_paid"] == GROSS, d1
        assert any("RCPT-1" in (p.get("reference") or "") for p in d1["payments"]), d1

        d2 = admin.get(f"/policies/{p2}").json()
        assert d2["outstanding"] == GROSS / 2, d2
        assert d2["amount_paid"] == GROSS / 2, d2
        assert any("RCPT-1" in (p.get("reference") or "") for p in d2["payments"]), d2

        summary2 = admin.get("/recon/summary?kind=agent").json()
        row2 = next(p for p in summary2 if p["party_id"] == agent["id"])
        assert row2["outstanding"] == GROSS * 2 - amt, row2
        assert row2["paid"] == amt, row2
    finally:
        delete_settlements(agent["id"])
        for pid in (p1, p2):
            if pid:
                delete_policy(pid)
        delete_user(agent["username"])
