"""Criterion: POST /api/policies/upload multipart with agent_id, broker_id, payment_mode Online and
a small PDF -> 200, response broker_id/broker_name set to the chosen broker. OCR may run in the
background; that's fine, we only assert on the upload response itself.
"""
from ._commission_helpers import admin_client, create_agent, create_broker, delete_broker, delete_policy, delete_user

PDF_PATH = "/tmp/tscheck_sample.pdf"


def _write_pdf():
    pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF"
    )
    with open(PDF_PATH, "wb") as fh:
        fh.write(pdf)


def test_upload_multipart_stores_chosen_broker():
    _write_pdf()
    admin = admin_client()
    broker = create_broker(admin)
    agent = create_agent(admin)
    policy_id = None
    try:
        with open(PDF_PATH, "rb") as fh:
            resp = admin.post(
                "/policies/upload",
                files={"file": ("tscheck_sample.pdf", fh, "application/pdf")},
                data={"agent_id": agent["id"], "broker_id": broker["id"], "payment_mode": "Online"},
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        policy_id = body["id"]
        assert body["broker_id"] == broker["id"], body
        assert body["broker_name"] == broker["name"], body
        assert body["agent_id"] == agent["id"], body
    finally:
        if policy_id:
            delete_policy(policy_id)
        delete_user(agent["username"])
        delete_broker(broker["id"])
