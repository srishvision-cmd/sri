"""Payment mode is required on upload for admin/backoffice/agent: missing payment_mode -> 422;
Partial Payment without a positive amount_paid -> 400."""
from .conftest import login

SAMPLE_IMAGE = "/tmp/sample_policy.png"


def _upload(c, data: dict):
    with open(SAMPLE_IMAGE, "rb") as fh:
        return c.post("/policies/upload", files={"file": ("tscheck-payment-validation.png", fh, "image/png")}, data=data)


def test_missing_payment_mode_rejected_422():
    c = login("agt1001", "Agent@123")
    r = _upload(c, {})
    assert r.status_code == 422, r.text
    c.close()


def test_partial_payment_without_amount_rejected_400():
    c = login("agt1001", "Agent@123")
    r = _upload(c, {"payment_mode": "Partial Payment"})
    assert r.status_code == 400, r.text
    assert "amount" in r.json()["detail"].lower(), r.text
    c.close()


def test_partial_payment_with_zero_amount_rejected_400():
    c = login("agt1001", "Agent@123")
    r = _upload(c, {"payment_mode": "Partial Payment", "amount_paid": 0})
    assert r.status_code == 400, r.text
    c.close()


def test_invalid_payment_mode_rejected_400():
    c = login("agt1001", "Agent@123")
    r = _upload(c, {"payment_mode": "Barter"})
    assert r.status_code == 400, r.text
    c.close()
