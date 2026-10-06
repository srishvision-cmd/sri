"""Partial payment balance becomes the agent's outstanding premium: uploading
sample_policy.png (total premium 15642.08 after OCR) with Partial Payment amount 5000 ->
amount_paid=5000, outstanding=10642.08. Cash -> outstanding 0, amount_paid = total premium."""
from .conftest import login, upload_and_wait


def test_partial_payment_outstanding_equals_premium_minus_paid():
    c = login("agt1001", "Agent@123")
    doc = upload_and_wait(c, payment_mode="Partial Payment", amount_paid=5000)
    assert doc["status"] == "extracted", doc
    assert doc["payment_mode"] == "Partial Payment"
    assert abs(doc["fields"]["gross_premium"] - 15642.08) < 0.5, doc["fields"]
    assert abs(doc["amount_paid"] - 5000) < 0.01, doc
    assert abs(doc["outstanding"] - 10642.08) < 0.5, doc
    c.close()


def test_cash_payment_mode_outstanding_zero_amount_paid_equals_premium():
    c = login("agt1001", "Agent@123")
    doc = upload_and_wait(c, payment_mode="Cash")
    assert doc["status"] == "extracted", doc
    assert abs(doc["fields"]["gross_premium"] - 15642.08) < 0.5, doc["fields"]
    assert abs(doc["amount_paid"] - doc["fields"]["gross_premium"]) < 0.01, doc
    assert doc["outstanding"] == 0, doc
    c.close()
