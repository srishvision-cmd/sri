"""Manual correction & verification criterion: backoffice/admin can edit+verify (lock); agent can
edit/save before verification but has no permission to verify (PATCH after verify -> 403), and can
still flag a discrepancy after lock."""
import time

import httpx

from .conftest import API_URL

SAMPLE_IMAGE = "/tmp/sample_policy.png"


def _login(username, password):
    c = httpx.Client(base_url=API_URL, timeout=60.0)
    r = c.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def _upload_and_wait_extracted(client):
    with open(SAMPLE_IMAGE, "rb") as f:
        resp = client.post(
            "/policies/upload",
            files={"file": ("tscheck-verify-sample.png", f, "image/png")},
        )
    assert resp.status_code == 200, resp.text
    policy_id = resp.json()["id"]
    deadline = time.time() + 75
    while time.time() < deadline:
        r = client.get(f"/policies/{policy_id}")
        body = r.json()
        if body["status"] in ("extracted", "failed"):
            assert body["status"] == "extracted", body
            return policy_id
        time.sleep(2)
    raise AssertionError("OCR did not complete in time")


def test_agent_can_edit_but_not_verify_then_flag_after_lock():
    agent = _login("agt1001", "Agent@123")
    policy_id = _upload_and_wait_extracted(agent)

    # agent can save corrections before verification (frontend always sends the full fields object)
    current = agent.get(f"/policies/{policy_id}").json()["fields"]
    current["insured_name"] = "tscheck-edited-name"
    patch_resp = agent.patch(f"/policies/{policy_id}", json={"fields": current})
    assert patch_resp.status_code == 200, patch_resp.text
    assert patch_resp.json()["fields"]["insured_name"] == "tscheck-edited-name"
    assert patch_resp.json()["fields"]["policy_number"] == "3001/MOT/123456789/00/000"

    # agent cannot verify
    verify_resp = agent.post(f"/policies/{policy_id}/verify", json={})
    assert verify_resp.status_code == 403, verify_resp.text

    # admin/backoffice verifies & locks
    admin = _login("admin", "Admin@123")
    admin_verify = admin.post(f"/policies/{policy_id}/verify", json={})
    assert admin_verify.status_code == 200, admin_verify.text
    assert admin_verify.json()["status"] == "verified"

    # agent PATCH now forbidden (locked)
    locked_patch = agent.patch(f"/policies/{policy_id}", json={"fields": current})
    assert locked_patch.status_code == 403, locked_patch.text

    # agent can still flag a discrepancy
    flag_resp = agent.post(f"/policies/{policy_id}/flag", json={"reason": "tscheck discrepancy reason"})
    assert flag_resp.status_code == 200, flag_resp.text
    assert flag_resp.json()["status"] == "flagged"

    agent.close()
    admin.close()


def test_backoffice_can_edit_and_verify():
    bo = _login("bo2001", "Back@123")
    # bo2001 is team-mapped to agt1002; upload attributed to self is in its own scope
    policy_id = _upload_and_wait_extracted(bo)

    current = bo.get(f"/policies/{policy_id}").json()["fields"]
    current["insured_name"] = "tscheck-bo-edited"
    patch_resp = bo.patch(f"/policies/{policy_id}", json={"fields": current})
    assert patch_resp.status_code == 200, patch_resp.text

    verify_resp = bo.post(f"/policies/{policy_id}/verify", json={})
    assert verify_resp.status_code == 200, verify_resp.text
    assert verify_resp.json()["status"] == "verified"
    bo.close()
