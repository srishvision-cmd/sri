"""Recording further payments (admin/backoffice only): backoffice records 3000 against the
10642.08 outstanding -> outstanding 7642.08 and a ledger entry appears. Agent gets 403 on
POST /api/policies/{id}/payments. Amount above outstanding -> 400. Payment before total premium
known -> 400."""
from .conftest import login, upload_and_wait


def test_backoffice_records_payment_reduces_outstanding_and_agent_forbidden():
    agent = login("agt1001", "Agent@123")
    doc = upload_and_wait(agent, payment_mode="Partial Payment", amount_paid=5000)
    assert doc["status"] == "extracted", doc
    pid = doc["id"]
    assert abs(doc["outstanding"] - 10642.08) < 0.5, doc

    # agent cannot record payments
    agent_attempt = agent.post(f"/policies/{pid}/payments", json={"amount": 100})
    assert agent_attempt.status_code == 403, agent_attempt.text

    backoffice = login("bo2001", "Back@123")
    # amount above outstanding balance -> 400
    over_resp = backoffice.post(f"/policies/{pid}/payments", json={"amount": 99999})
    assert over_resp.status_code == 400, over_resp.text

    rec_resp = backoffice.post(f"/policies/{pid}/payments", json={"amount": 3000, "reference": "tscheck-ledger"})
    assert rec_resp.status_code == 200, rec_resp.text
    body = rec_resp.json()
    assert abs(body["outstanding"] - 7642.08) < 0.5, body
    assert abs(body["amount_paid"] - 8000) < 0.5, body
    assert any(p["reference"] == "tscheck-ledger" and abs(p["amount"] - 3000) < 0.01 for p in body["payments"]), body["payments"]
    agent.close()
    backoffice.close()


def test_payment_before_total_premium_known_rejected_400():
    agent = login("agt1001", "Agent@123")
    with open("/tmp/sample_policy.png", "rb") as fh:
        r = agent.post(
            "/policies/upload",
            files={"file": ("tscheck-no-premium.png", fh, "image/png")},
            data={"payment_mode": "Partial Payment", "amount_paid": 1},
        )
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    # status is still "processing" right after upload (OCR hasn't filled gross_premium yet) ->
    # policy.outstanding is None until premium is known
    backoffice = login("bo2001", "Back@123")
    resp = backoffice.post(f"/policies/{pid}/payments", json={"amount": 1})
    assert resp.status_code == 400, resp.text
    agent.close()
    backoffice.close()
