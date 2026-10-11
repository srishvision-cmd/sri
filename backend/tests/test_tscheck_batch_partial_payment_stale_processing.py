"""Bug fix: a batch payment (amount typed once for a multi-file upload) used to wait forever
for OCR if the policy's OCR job was lost in a server restart, leaving the full premium showing
as outstanding/pending in the agent's Commission Statement instead of (premium - batch amount).

allocate_stale_batches() now re-allocates a pending batch whenever every policy in it either has
a known premium or is no longer "processing":
  - extracted policy -> always allocate.
  - old ("stuck") processing policy with a known premium -> allocate (no longer blocks).
  - young processing policy, or one with premium still unknown -> keep waiting (batch stays pending).

Each criterion below uses its own throwaway agent + policy + upload_batch_payments doc (seeded
directly in Mongo, mirroring the real OCR-lost scenario) so the three scenarios cannot interfere
with one another's "one unpaid statement per agent" constraint.
"""
import uuid
from datetime import datetime, timedelta, timezone

from ._commission_helpers import DB, admin_client, create_agent, delete_policy, delete_user, insert_policy
from ._statement_helpers import delete_statement, set_payment_mode


def _seed_batch_policy(agent: dict, status: str, created_at: datetime, gross_premium) -> str:
    pid = insert_policy(agent, insurer="tscheck-insurer", od_premium=0, tp_premium=0)
    set_payment_mode(pid, "Partial Payment")
    DB.policies.update_one({"id": pid}, {"$set": {
        "status": status, "created_at": created_at, "payments": [],
        "fields.gross_premium": gross_premium,
    }})
    return pid


def _seed_batch(agent_id: str, policy_id: str, amount: float) -> str:
    bid = str(uuid.uuid4())
    DB.upload_batch_payments.insert_one({
        "id": bid, "kind": "agent", "party_id": agent_id, "policy_ids": [policy_id], "amount": amount,
        "reference": None, "paid_on": datetime.now(timezone.utc).date().isoformat(),
        "created_by_name": "tscheck", "status": "pending", "settlement_id": None,
        "created_at": datetime.now(timezone.utc),
    })
    return bid


def test_extracted_policy_batch_allocated_outstanding_reduced_in_statement():
    """Criterion 1: extracted (not stuck in OCR) policy -> statement generation allocates the
    batch payment, outstanding_lines shows premium - batch amount, not the full premium."""
    admin = admin_client()
    agent = create_agent(admin)
    pid = _seed_batch_policy(agent, "extracted", datetime.now(timezone.utc) - timedelta(hours=1), 51354)
    bid = _seed_batch(agent["id"], pid, 20000)
    sid = None
    try:
        r = admin.post("/statements", json={"agent_id": agent["id"], "period_type": "monthly",
                                             "ref_date": datetime.now(timezone.utc).date().isoformat()})
        assert r.status_code == 200, r.text
        s = r.json()
        sid = s["id"]
        out_lines = [o for o in s["outstanding_lines"] if o["policy_id"] == pid]
        assert len(out_lines) == 1, s["outstanding_lines"]
        assert out_lines[0]["outstanding"] == 31354, out_lines[0]  # 51354 - 20000, not the full 51354

        pol = admin.get(f"/policies/{pid}").json()
        assert sum(p["amount"] for p in pol["payments"]) == 20000, pol["payments"]

        batch = DB.upload_batch_payments.find_one({"id": bid}, {"_id": 0})
        assert batch["status"] == "allocated", batch
    finally:
        if sid:
            admin.delete(f"/statements/{sid}")
            delete_statement(sid)
        DB.upload_batch_payments.delete_one({"id": bid})
        delete_policy(pid)
        delete_user(agent["username"])


def test_stale_stuck_processing_policy_with_known_premium_unblocks_batch():
    """Criterion 2: policy stuck "processing" for an hour but its premium IS known -> the stale
    check no longer waits for it; the batch still gets allocated to it."""
    admin = admin_client()
    agent = create_agent(admin)
    pid = _seed_batch_policy(agent, "processing", datetime.now(timezone.utc) - timedelta(hours=1), 51354)
    bid = _seed_batch(agent["id"], pid, 20000)
    try:
        # Generating a statement runs allocate_stale_batches(agent_id) before anything else, even
        # if it then 400s for lack of lines/outstanding (a "processing" policy is excluded from
        # the statement's own outstanding view) -- the allocation side effect already happened.
        r = admin.post("/statements", json={"agent_id": agent["id"], "period_type": "monthly",
                                             "ref_date": datetime.now(timezone.utc).date().isoformat()})
        if r.status_code == 200:
            admin.delete(f"/statements/{r.json()['id']}")
            delete_statement(r.json()["id"])

        pol = admin.get(f"/policies/{pid}").json()
        assert sum(p["amount"] for p in pol["payments"]) == 20000, pol["payments"]

        batch = DB.upload_batch_payments.find_one({"id": bid}, {"_id": 0})
        assert batch["status"] == "allocated", batch
    finally:
        DB.upload_batch_payments.delete_one({"id": bid})
        delete_policy(pid)
        delete_user(agent["username"])


def test_young_processing_policy_unknown_premium_still_waits():
    """Criterion 3: policy just started "processing" (OCR likely still running) and its premium
    is not known yet -> allocate_stale_batches() must leave the batch pending with no payment."""
    admin = admin_client()
    agent = create_agent(admin)
    pid = _seed_batch_policy(agent, "processing", datetime.now(timezone.utc), None)
    bid = _seed_batch(agent["id"], pid, 20000)
    try:
        r = admin.post("/statements", json={"agent_id": agent["id"], "period_type": "monthly",
                                             "ref_date": datetime.now(timezone.utc).date().isoformat()})
        if r.status_code == 200:
            admin.delete(f"/statements/{r.json()['id']}")
            delete_statement(r.json()["id"])

        pol = admin.get(f"/policies/{pid}").json()
        assert pol["payments"] == [], pol["payments"]

        batch = DB.upload_batch_payments.find_one({"id": bid}, {"_id": 0})
        assert batch["status"] == "pending", batch
    finally:
        DB.upload_batch_payments.delete_one({"id": bid})
        delete_policy(pid)
        delete_user(agent["username"])
