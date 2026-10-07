"""Criterion: user rule — payable commission %/amount must NOT exceed receivable %/amount.

Flow (matches the acceptance matrix exactly): save a receivable rule (ICICI, Private Car Package,
od 20%, tp 2.5%); a payable rule with od 25% on the same insurer/product -> 400; od 15% -> 200;
then lowering the receivable to od 10% while that payable (od 15%) still stands -> 400.
"""
from ._commission_helpers import admin_client, create_broker, delete_broker, delete_rule, rule_body, uniq


def test_payable_cannot_exceed_receivable_and_receivable_cannot_be_lowered_below_payable():
    admin = admin_client()
    insurer = uniq("insurer")
    broker = create_broker(admin)
    rule_ids = []
    try:
        rec = admin.post("/commission/rules", json=rule_body(
            "receivable", uniq("rule-rec"), insurer=insurer, broker_id=broker["id"],
            products=["Private Car Package"], od_percent=20, tp_percent=2.5,
        ))
        assert rec.status_code == 200, rec.text
        rec_id = rec.json()["id"]
        rule_ids.append(rec_id)

        # payable OD 25% > receivable OD 20% -> rejected
        bad = admin.post("/commission/rules", json=rule_body(
            "payable", uniq("rule-pay-bad"), insurer=insurer, broker_id=broker["id"],
            products=["Private Car Package"], od_percent=25,
        ))
        assert bad.status_code == 400, bad.text
        assert "Payable OD %" in bad.json()["detail"] and "exceeds receivable OD %" in bad.json()["detail"]

        # payable OD 15% <= receivable OD 20% -> accepted
        good = admin.post("/commission/rules", json=rule_body(
            "payable", uniq("rule-pay-good"), insurer=insurer, broker_id=broker["id"],
            products=["Private Car Package"], od_percent=15,
        ))
        assert good.status_code == 200, good.text
        pay_id = good.json()["id"]
        rule_ids.append(pay_id)

        # now lowering the receivable to OD 10% (below the standing payable's 15%) -> rejected
        lower = admin.put(f"/commission/rules/{rec_id}", json=rule_body(
            "receivable", uniq("rule-rec-v2"), insurer=insurer, broker_id=broker["id"],
            products=["Private Car Package"], od_percent=10, tp_percent=2.5,
        ))
        assert lower.status_code == 400, lower.text
        assert "lower the payable rule first" in lower.json()["detail"]
    finally:
        for rid in rule_ids:
            delete_rule(rid)
        delete_broker(broker["id"])

