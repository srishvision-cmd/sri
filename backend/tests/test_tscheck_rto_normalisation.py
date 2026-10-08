"""Criterion: RTO normalisation — TN office names (OCR'd on new-vehicle policies, e.g. MARTHANDAM)
map to their RTO code so commission rules (which match on RTO prefix like 'TN') apply.

1. Unit cases on models.rto.rto_code() straight from the acceptance matrix.
2. API-level: PATCH /policies/{id} with fields.rto set to an office name normalises it on save
   (models.policy._normalise_registration -> _normalise_rto), using a throwaway tscheck- policy
   (never the shared qa-rto-1 fixture).
3. routers.policies.fix_rto_names() is idempotent: fixes a throwaway row once, returns 0 on rerun.
"""
import asyncio

from models.rto import rto_code

from ._commission_helpers import admin_client, create_agent, delete_policy, delete_user, insert_policy


def test_rto_code_unit_cases():
    assert rto_code("MARTHANDAM") == "TN75"
    assert rto_code("RTO Coimbatore South") == "TN37"
    assert rto_code("KA01") == "KA01"
    assert rto_code("Bangalore") is None
    # from the acceptance matrix's own worked examples
    assert rto_code("Marthandam") == "TN75"
    assert rto_code("TN 9") == "TN09"


def test_patch_policy_normalises_rto_office_name_on_save():
    admin = admin_client()
    agent = create_agent(admin)
    pid = insert_policy(agent, insurer="ICICI Lombard", reg_no="NEW-0001")
    try:
        r = admin.get(f"/policies/{pid}")
        assert r.status_code == 200, r.text
        fields = r.json()["fields"]
        fields["rto"] = "Marthandam"
        r2 = admin.patch(f"/policies/{pid}", json={"fields": fields})
        assert r2.status_code == 200, r2.text
        assert r2.json()["fields"]["rto"] == "TN75", r2.json()["fields"]

        fields["rto"] = "TN 9"
        r3 = admin.patch(f"/policies/{pid}", json={"fields": fields})
        assert r3.status_code == 200, r3.text
        assert r3.json()["fields"]["rto"] == "TN09", r3.json()["fields"]

        fields["rto"] = "Bangalore"
        r4 = admin.patch(f"/policies/{pid}", json={"fields": fields})
        assert r4.status_code == 200, r4.text
        assert r4.json()["fields"]["rto"] == "Bangalore", r4.json()["fields"]
    finally:
        delete_policy(pid)
        delete_user(agent["username"])


def test_fix_rto_names_migration_idempotent():
    admin = admin_client()
    agent = create_agent(admin)
    pid = insert_policy(agent, insurer="ICICI Lombard", reg_no="NEW-0002")
    from ._commission_helpers import DB

    DB.policies.update_one({"id": pid}, {"$set": {"fields.rto": "MARTHANDAM"}})
    try:
        from routers.policies import fix_rto_names

        async def run_twice():
            first = await fix_rto_names()
            doc = await asyncio.get_event_loop().run_in_executor(None, lambda: DB.policies.find_one({"id": pid}, {"_id": 0, "fields.rto": 1}))
            second = await fix_rto_names()
            return first, doc, second

        first, doc, second = asyncio.run(run_twice())
        assert doc["fields"]["rto"] == "TN75", doc
        assert first >= 1
        assert second == 0
    finally:
        delete_policy(pid)
        delete_user(agent["username"])
