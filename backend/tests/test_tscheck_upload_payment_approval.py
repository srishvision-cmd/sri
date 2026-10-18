"""Criterion: upload payment above premium needs approval.

With gross 902 and amount 1902, apply_upload_payment sets upload_payment.status ==
'needs_approval'; POST /api/policies/{id}/upload-payment {action:'approve'} as admin creates
one premium_settlements doc (mode 'Paid at upload') whose allocations start with this policy
and whose note mentions 'Excess'; anonymous call returns 401.

Uses the seeded agent AGT1002 Madhan and policy e474c26f (gross 902, oldest outstanding) named
in the test briefing — upload_payment / payments / settlement are fully cleaned up afterwards
so preview data is left unchanged.

The 'waiting' -> 'needs_approval' transition is triggered over real HTTP via POST
/api/statements (which runs routers.recon.allocate_stale_batches -> apply_upload_payment for
every policy of the agent with upload_payment.status 'waiting' — the same code path
production uses), so the test never imports the app or calls the async function directly.
"""
import httpx
import pytest

from ._commission_helpers import DB, admin_client
from .conftest import API_URL

AGENT_ID = "b8dceaa9-4832-4c6f-a2aa-94e01c4ee832"
POLICY_ID = "e474c26f-1022-40c1-8677-ec9c35b95b6c"
OTHER_POLICY_ID = "bf7a248d-2da7-46c7-af72-ed692bd926f7"
AMOUNT = 1902.0


@pytest.fixture
def admin():
    return admin_client()


def test_needs_approval_then_approve_creates_settlement_with_excess_note(admin):
    assert DB is not None, "mongo not reachable"
    before = DB.policies.find_one({"id": POLICY_ID}, {"_id": 0})
    before_other = DB.policies.find_one({"id": OTHER_POLICY_ID}, {"_id": 0})
    assert before["fields"]["gross_premium"] == 902.0
    assert before["payments"] == [] and before_other["payments"] == []

    settlement_id = None
    statement_id = None
    try:
        DB.policies.update_one({"id": POLICY_ID}, {"$set": {
            "upload_payment": {"status": "waiting", "amount": AMOUNT, "reference": "tscheck-up",
                                "paid_on": "2026-01-02", "recorded_by_name": "QA Admin"}}})

        from datetime import date
        r_stmt = admin.post("/statements", json={"agent_id": AGENT_ID, "period_type": "monthly", "ref_date": date.today().isoformat()})
        if r_stmt.status_code == 200:
            statement_id = r_stmt.json()["id"]
        # side effect (apply_upload_payment) runs before any later failure in that endpoint, so
        # proceed regardless of the generate call's own outcome (e.g. a pending statement conflict)
        doc = DB.policies.find_one({"id": POLICY_ID}, {"_id": 0})
        assert doc["upload_payment"]["status"] == "needs_approval"
        assert doc["upload_payment"]["gross"] == 902.0

        # anonymous call is rejected before any resource check
        anon = httpx.Client(base_url=API_URL, timeout=30.0)
        r_anon = anon.post(f"/policies/{POLICY_ID}/upload-payment", json={"action": "approve"})
        assert r_anon.status_code == 401, r_anon.text

        r = admin.post(f"/policies/{POLICY_ID}/upload-payment", json={"action": "approve"})
        assert r.status_code == 200, r.text
        pol = r.json()
        assert pol.get("upload_payment") is None

        sets = list(DB.premium_settlements.find({"party_id": AGENT_ID, "mode": "Paid at upload"}, {"_id": 0}).sort("created_at", -1).limit(1))
        assert sets, "expected a premium_settlements doc"
        s = sets[0]
        settlement_id = s["id"]
        assert s["allocations"][0]["policy_id"] == POLICY_ID
        assert s["amount"] == AMOUNT
        assert "Excess" in (s.get("note") or "")
    finally:
        if settlement_id:
            r = admin.post(f"/recon/settlements/{settlement_id}/reverse")
            assert r.status_code == 200, r.text
        if statement_id:
            admin.delete(f"/statements/{statement_id}")
        DB.policies.update_one({"id": POLICY_ID}, {"$unset": {"upload_payment": ""}})
        after = DB.policies.find_one({"id": POLICY_ID}, {"_id": 0})
        after_other = DB.policies.find_one({"id": OTHER_POLICY_ID}, {"_id": 0})
        assert after["payments"] == [], "payments must be reverted on the seeded policy"
        assert after_other["payments"] == [], "payments must be reverted on the other seeded policy"
        assert not after.get("commission_statement_id"), "statement link must be cleared on the seeded policy"
        assert not after_other.get("commission_statement_id"), "statement link must be cleared on the other seeded policy"
