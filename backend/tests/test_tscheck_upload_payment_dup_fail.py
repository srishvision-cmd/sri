"""Criterion: upload payment never applied to a duplicate/failed upload.

backend/routers/partner_payments.apply_upload_payment leaves policy.upload_payment.status
== 'waiting' and pushes no payments while policy.status is 'duplicate' or 'failed'; once
status becomes 'extracted' with fields.gross_premium >= amount, one PaymentEntry is pushed
and upload_payment is removed.

Triggered over real HTTP: POST /api/statements for the agent runs
routers.recon.allocate_stale_batches -> apply_upload_payment for every policy of that agent
whose upload_payment.status is 'waiting' (same code path production uses), so the test never
imports the app or calls the async function directly.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

from ._commission_helpers import DB, admin_client, create_agent, delete_policy, delete_user


def _base_doc(pid: str, agent: dict, status: str, gross_premium=None, amount: float = 500.0, days_ago: int = 0) -> dict:
    now = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    return {
        "id": pid, "file_name": None, "file_mime": None, "has_file": False, "status": status,
        "agent_id": agent["id"], "agent_name": agent["full_name"], "agent_code": agent["agent_code"],
        "branch": agent.get("branch", "Chennai"),
        "uploaded_by_id": agent["id"], "uploaded_by_name": agent["full_name"],
        "broker_id": None, "broker_name": None,
        "fields": {
            "policy_number": f"tscheck-{pid[:8]}", "insurer": "Some Insurer", "lob": "Motor",
            "vehicle_class": "Private Car", "cover_type": "Package", "vehicle_reg_no": "TN10AB1234",
            "product_category": "Private Car Package", "od_premium": None, "tp_premium": None,
            "gross_premium": gross_premium, "insured_name": "tscheck insured",
        },
        "confidence": {}, "ocr_error": None, "duplicate_reason": "dup" if status == "duplicate" else None,
        "duplicate_of_id": None, "flag_reason": None, "verified_by_name": None, "verified_at": None,
        "created_at": now, "updated_at": now, "history": [],
        "payment_mode": "Cash", "payments": [], "broker_payments": [],
        "file_size": None, "original_size": None, "is_deleted": False, "seeded": False,
        "upload_payment": {"status": "waiting", "amount": amount, "reference": None, "paid_on": "2026-01-01", "recorded_by_name": "tscheck"},
    }


def test_duplicate_and_failed_never_applied_then_extracted_applies():
    assert DB is not None, "mongo not reachable"
    admin = admin_client()
    agent = create_agent(admin)
    pid_dup = str(uuid.uuid4())
    pid_fail = str(uuid.uuid4())
    pid_ok = str(uuid.uuid4())
    statement_id = None
    try:
        DB.policies.insert_one(_base_doc(pid_dup, agent, "duplicate", gross_premium=None, amount=500.0))
        DB.policies.insert_one(_base_doc(pid_fail, agent, "failed", gross_premium=None, amount=500.0))
        DB.policies.insert_one(_base_doc(pid_ok, agent, "extracted", gross_premium=600.0, amount=500.0))

        r = admin.post("/statements", json={"agent_id": agent["id"], "period_type": "monthly", "ref_date": date.today().isoformat()})
        assert r.status_code == 200, r.text
        statement_id = r.json()["id"]

        dup = DB.policies.find_one({"id": pid_dup}, {"_id": 0})
        fail = DB.policies.find_one({"id": pid_fail}, {"_id": 0})
        ok = DB.policies.find_one({"id": pid_ok}, {"_id": 0})

        assert dup["upload_payment"]["status"] == "waiting"
        assert dup["payments"] == []
        assert fail["upload_payment"]["status"] == "waiting"
        assert fail["payments"] == []

        assert ok.get("upload_payment") is None
        assert len(ok["payments"]) == 1
        assert ok["payments"][0]["amount"] == 500.0
    finally:
        if statement_id:
            admin.delete(f"/statements/{statement_id}")
        delete_policy(pid_dup)
        delete_policy(pid_fail)
        delete_policy(pid_ok)
        delete_user(agent["username"])
