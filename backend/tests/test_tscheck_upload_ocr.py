"""Upload policy document criterion: upload sample_policy.png -> queue item moves from
processing/extracted to Pending review within ~40s with expected OCR fields. Unsupported file
type is rejected with 415."""
import time

import httpx

from .conftest import API_URL

SAMPLE_IMAGE = "/tmp/sample_policy.png"


def _login(username, password):
    c = httpx.Client(base_url=API_URL, timeout=60.0)
    r = c.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_upload_png_runs_ocr_and_extracts_expected_fields():
    c = _login("agt1001", "Agent@123")
    with open(SAMPLE_IMAGE, "rb") as f:
        resp = c.post(
            "/policies/upload",
            files={"file": ("sample_policy.png", f, "image/png")},
            data={"payment_mode": "Cash"},
        )
    assert resp.status_code == 200, resp.text
    policy = resp.json()
    policy_id = policy["id"]
    assert policy["status"] in ("processing", "extracted")

    # poll for OCR completion (real Gemini OCR ~10-15s)
    final = None
    deadline = time.time() + 45
    while time.time() < deadline:
        r = c.get(f"/policies/{policy_id}")
        assert r.status_code == 200
        body = r.json()
        if body["status"] in ("extracted", "failed"):
            final = body
            break
        time.sleep(2)

    assert final is not None, "OCR did not complete within 45s"
    assert final["status"] == "extracted", final
    fields = final["fields"]
    assert fields["policy_number"] == "300112345678901234", fields
    assert abs(fields["gross_premium"] - 15642.08) < 0.5, fields
    assert fields["lob"] == "Motor", fields
    c.close()


def test_upload_unsupported_file_type_rejected():
    c = _login("agt1001", "Agent@123")
    resp = c.post(
        "/policies/upload",
        files={"file": ("tscheck-notes.txt", b"not a policy document", "text/plain")},
        data={"payment_mode": "Cash"},
    )
    assert resp.status_code == 415, resp.text
    c.close()
