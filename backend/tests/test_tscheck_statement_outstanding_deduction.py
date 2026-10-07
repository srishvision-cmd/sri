"""Criterion: Outstanding deducted with Policy no & Reg no.

A commission-earning policy (payable 1560) + a Cash policy (gross_premium 1500, no payments) for
the same agent -> statement.total_payable == 1560, outstanding_lines has one entry for the Cash
policy with policy_number + reg_no populated, outstanding_deducted == min(1560, 1500) == 1500,
net_payable == 1560 - 1500 == 60.
"""
from ._commission_helpers import admin_client
from ._statement_helpers import build_scenario, delete_statement, teardown_scenario


def test_outstanding_deducted_with_policy_and_reg_no():
    admin = admin_client()
    scenario = build_scenario(admin)
    sid = None
    try:
        r = admin.post("/statements", json={"agent_id": scenario["agent"]["id"], "period_type": "daily"})
        assert r.status_code == 200, r.text
        s = r.json()
        sid = s["id"]

        assert s["total_payable"] == scenario["expected_payable"], s
        assert len(s["lines"]) == 1 and s["lines"][0]["policy_id"] == scenario["pid_commission"], s

        out_lines = s["outstanding_lines"]
        assert len(out_lines) == 1, out_lines
        out = out_lines[0]
        assert out["policy_id"] == scenario["pid_cash"], out
        assert out["policy_number"], out  # Policy no present
        assert out["reg_no"], out  # Reg no present
        assert out["outstanding"] == scenario["expected_cash_outstanding"], out

        assert s["total_outstanding"] == scenario["expected_cash_outstanding"], s
        assert s["outstanding_deducted"] == min(scenario["expected_payable"], scenario["expected_cash_outstanding"]), s
        assert s["net_payable"] == round(scenario["expected_payable"] - s["outstanding_deducted"], 2), s
    finally:
        if sid:
            admin.delete(f"/statements/{sid}")
            delete_statement(sid)
        teardown_scenario(scenario)
