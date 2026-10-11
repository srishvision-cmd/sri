"""Criterion: single-file partial upload still correct (not affected by the batch/stale-OCR
fix). Admin uploads one small PDF for agent qaagent with payment_mode 'Partial Payment' and
amount_paid 20000 -> POST /api/policies/upload returns 200 and the policy's payments already
hold 20000 (recorded at upload time, independent of OCR finishing). Cleans up the policy after.
"""
from ._commission_helpers import admin_client

QAAGENT_ID = "f626bcc2-f4f0-4a0f-ac88-a099430c1a2f"


def _small_pdf() -> bytes:
    return (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF"
    )


def test_single_file_partial_upload_records_amount_paid():
    admin = admin_client()
    pid = None
    try:
        resp = admin.post(
            "/policies/upload",
            files={"file": ("tscheck_single_partial.pdf", _small_pdf(), "application/pdf")},
            data={"agent_id": QAAGENT_ID, "payment_mode": "Partial Payment", "amount_paid": 20000},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        pid = body["id"]
        assert body["agent_id"] == QAAGENT_ID, body
        assert body["payment_mode"] == "Partial Payment", body
        assert sum(p["amount"] for p in body["payments"]) == 20000, body["payments"]

        fetched = admin.get(f"/policies/{pid}").json()
        assert sum(p["amount"] for p in fetched["payments"]) == 20000, fetched["payments"]
    finally:
        if pid:
            r = admin.delete(f"/policies/{pid}")
            assert r.status_code in (200, 204), r.text
