"""Criterion: Mark paid with date + UTR, reflected in MIS.

POST /api/statements/{id}/paid {paid_date, utr} -> status paid, paid_date/utr stored; the
statement's commission policy gets commission_paid=true + commission_utr + commission_paid_date
(via GET /api/policies/{id}); the Cash policy's outstanding drops by the deducted amount with a
payment entry referencing "Adjusted from commission <number>".
"""
from ._commission_helpers import admin_client
from ._statement_helpers import build_scenario, delete_statement, teardown_scenario


def test_mark_paid_reflects_on_policies_and_outstanding():
    admin = admin_client()
    scenario = build_scenario(admin)
    sid = None
    try:
        r = admin.post("/statements", json={"agent_id": scenario["agent"]["id"], "period_type": "daily"})
        assert r.status_code == 200, r.text
        s = r.json()
        sid = s["id"]
        deducted = s["outstanding_deducted"]

        pay_r = admin.post(f"/statements/{sid}/paid", json={"paid_date": "2026-01-15", "utr": "TESTUTR1234"})
        assert pay_r.status_code == 200, pay_r.text
        paid = pay_r.json()
        assert paid["status"] == "paid", paid
        assert paid["paid_date"] == "2026-01-15", paid
        assert paid["utr"] == "TESTUTR1234", paid

        comm_r = admin.get(f"/policies/{scenario['pid_commission']}")
        assert comm_r.status_code == 200, comm_r.text
        comm = comm_r.json()
        assert comm["commission_paid"] is True, comm
        assert comm["commission_paid_date"] == "2026-01-15", comm
        assert comm["commission_utr"] == "TESTUTR1234", comm
        assert any("Commission paid" in (h.get("action") or "") for h in comm.get("history", [])), comm["history"]

        cash_r = admin.get(f"/policies/{scenario['pid_cash']}")
        assert cash_r.status_code == 200, cash_r.text
        cash = cash_r.json()
        assert cash["outstanding"] == round(scenario["expected_cash_outstanding"] - deducted, 2), cash
        refs = [p.get("reference", "") for p in cash.get("payments", [])]
        assert any("Adjusted from commission" in ref and paid["number"] in ref for ref in refs), refs

        # double mark-paid rejected
        again = admin.post(f"/statements/{sid}/paid", json={"paid_date": "2026-01-16", "utr": "TESTUTR9999"})
        assert again.status_code == 409, again.text
    finally:
        if sid:
            delete_statement(sid)
        teardown_scenario(scenario)
