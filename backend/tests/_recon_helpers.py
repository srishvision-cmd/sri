"""Shared helpers for premium-recon (routers/recon.py) tests: insert tscheck policies with a
broker (Srishvision -> broker ledger) or with payment_mode Cash/Partial (agent -> Srishvision
ledger) directly in Mongo, mirroring models/policy.py Policy shape (same pattern as
_commission_helpers.py / _reassign_helpers.py)."""
import uuid
from datetime import datetime, timedelta, timezone

from ._commission_helpers import DB, admin_client, create_agent, create_broker, uniq  # noqa: F401


def insert_broker_policy(agent: dict, broker: dict, gross_premium: float = 20000.0, days_ago: int = 0,
                          broker_payments: list | None = None) -> str:
    """Policy with a broker_id/broker_name set — feeds the Srishvision -> Broker recon ledger."""
    pid = str(uuid.uuid4())
    created = datetime.now(timezone.utc) - timedelta(days=days_ago)
    doc = {
        "id": pid, "file_name": None, "file_mime": None, "has_file": False, "status": "extracted",
        "agent_id": agent["id"], "agent_name": agent["full_name"], "agent_code": agent["agent_code"],
        "branch": agent.get("branch", "Chennai"),
        "uploaded_by_id": agent["id"], "uploaded_by_name": agent["full_name"],
        "broker_id": broker["id"], "broker_name": broker["name"],
        "fields": {
            "policy_number": uniq("pol"), "insurer": "Some Insurer", "lob": "Motor",
            "vehicle_class": "Private Car", "cover_type": "Package", "vehicle_reg_no": "TN10AB1234",
            "product_category": "Private Car Package", "od_premium": gross_premium * 0.7,
            "tp_premium": gross_premium * 0.3, "gross_premium": gross_premium,
            "insured_name": uniq("insured"),
        },
        "confidence": {}, "ocr_error": None, "duplicate_reason": None, "duplicate_of_id": None,
        "flag_reason": None, "verified_by_name": None, "verified_at": None,
        "created_at": created.isoformat(), "updated_at": created.isoformat(), "history": [],
        "payment_mode": "Online", "payments": [], "broker_payments": broker_payments or [],
        "file_size": None, "original_size": None, "is_deleted": False, "seeded": False,
    }
    DB.policies.insert_one(doc)
    return pid


def insert_agent_cash_policy(agent: dict, gross_premium: float = 20000.0, days_ago: int = 0,
                              payment_mode: str = "Cash") -> str:
    """Cash/Partial-mode policy — feeds the Agent -> Srishvision recon ledger."""
    pid = str(uuid.uuid4())
    created = datetime.now(timezone.utc) - timedelta(days=days_ago)
    doc = {
        "id": pid, "file_name": None, "file_mime": None, "has_file": False, "status": "extracted",
        "agent_id": agent["id"], "agent_name": agent["full_name"], "agent_code": agent["agent_code"],
        "branch": agent.get("branch", "Chennai"),
        "uploaded_by_id": agent["id"], "uploaded_by_name": agent["full_name"],
        "broker_id": None, "broker_name": None,
        "fields": {
            "policy_number": uniq("pol"), "insurer": "Some Insurer", "lob": "Motor",
            "vehicle_class": "Private Car", "cover_type": "Package", "vehicle_reg_no": "TN10AB1234",
            "product_category": "Private Car Package", "od_premium": gross_premium * 0.7,
            "tp_premium": gross_premium * 0.3, "gross_premium": gross_premium,
            "insured_name": uniq("insured"),
        },
        "confidence": {}, "ocr_error": None, "duplicate_reason": None, "duplicate_of_id": None,
        "flag_reason": None, "verified_by_name": None, "verified_at": None,
        "created_at": created.isoformat(), "updated_at": created.isoformat(), "history": [],
        "payment_mode": payment_mode, "payments": [], "broker_payments": [],
        "file_size": None, "original_size": None, "is_deleted": False, "seeded": False,
    }
    DB.policies.insert_one(doc)
    return pid


def delete_policy(policy_id: str) -> None:
    if DB is not None:
        DB.policies.delete_one({"id": policy_id})


def delete_settlements(party_id: str) -> None:
    if DB is not None:
        DB.premium_settlements.delete_many({"party_id": party_id})
