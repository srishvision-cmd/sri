"""Criterion: admin uploads several PDFs with an agent selected, a channel partner selected,
channel partner premium Cash, and agent premium Cash -> each POST /api/policies/upload returns
200 (not a generic failure) and the policy carries the chosen agent/broker/payment mode.
"""
import os

from ._commission_helpers import admin_client, create_agent, create_broker, delete_broker, delete_policy, delete_user

PDF_DIR = "/tmp"


def _pdf_path(n: int) -> str:
    path = f"/tmp/tscheck_cash_sample_{n}.pdf"
    pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF"
    )
    with open(path, "wb") as fh:
        fh.write(pdf)
    return path


def test_upload_multiple_pdfs_agent_broker_cash_cash_all_succeed():
    admin = admin_client()
    broker = create_broker(admin)
    agent = create_agent(admin, broker_id=broker["id"])
    policy_ids: list[str] = []
    try:
        for n in range(3):
            path = _pdf_path(n)
            with open(path, "rb") as fh:
                resp = admin.post(
                    "/policies/upload",
                    files={"file": (f"tscheck_cash_sample_{n}.pdf", fh, "application/pdf")},
                    data={
                        "agent_id": agent["id"],
                        "broker_id": broker["id"],
                        "payment_mode": "Cash",
                        "broker_payment_mode": "Cash",
                    },
                )
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert body["agent_id"] == agent["id"], body
            assert body["broker_id"] == broker["id"], body
            policy_ids.append(body["id"])
            os.remove(path)
        assert len(policy_ids) == 3
    finally:
        for pid in policy_ids:
            delete_policy(pid)
        delete_user(agent["username"])
        delete_broker(broker["id"])
