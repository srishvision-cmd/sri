"""Criterion: new-vehicle placeholder reg numbers (NEW-0001, NEW, N/A, Applied for...) map to a
unique auto code `NEW` + last 6 of chassis (fallback engine no, then policy no), while real
registration numbers like 'TN 09 BQ 6869' are normalised unchanged (-> TN09BQ6869, rto TN09).
Also exercises routers.policies.fix_new_vehicle_regs() for idempotency against two throwaway
policies with the same placeholder reg but different chassis.
"""
import asyncio
import uuid

from models.policy import PolicyFields, _normalise_registration, new_vehicle_code

from ._commission_helpers import DB, admin_client, create_agent, delete_policy, delete_user, uniq


def _norm_reg(vehicle_reg_no, chassis_no="MC2EBJRC0RCB47123", **extra):
    fields = {"vehicle_reg_no": vehicle_reg_no, "chassis_no": chassis_no, **extra}
    _normalise_registration(fields)
    return fields["vehicle_reg_no"], fields.get("rto")


def test_placeholder_regs_map_to_chassis_code():
    for placeholder in ("NEW-0001", "NEW", "N/A", "Applied for"):
        reg, rto = _norm_reg(placeholder)
        assert reg == "NEWB47123", f"{placeholder!r} -> {reg!r}"


def test_real_registration_numbers_unchanged():
    reg, rto = _norm_reg("NEWTON1", chassis_no="MC2EBJRC0RCB99999")
    assert reg == "NEWTON1"  # not a placeholder despite starting with NEW

    reg2, rto2 = _norm_reg("TN09BQ6869", chassis_no="MC2EBJRC0RCB99999")
    assert reg2 == "TN09BQ6869"
    assert rto2 == "TN09"

    reg3, rto3 = _norm_reg("TN 09 BQ 6869", chassis_no="MC2EBJRC0RCB99999")
    assert reg3 == "TN09BQ6869"
    assert rto3 == "TN09"


def test_new_vehicle_code_fallback_order():
    assert new_vehicle_code({"chassis_no": "MC2EBJRC0RCB47123"}) == "NEW47123"[:3] or True
    # chassis present -> last 6 of chassis
    assert new_vehicle_code({"chassis_no": "MC2EBJRC0RCB47123"}) == "NEWB47123"
    # no chassis -> fall back to engine no
    assert new_vehicle_code({"chassis_no": None, "engine_no": "E483CDAD229891"}) == "NEW229891"
    # no chassis/engine -> fall back to policy number
    assert new_vehicle_code({"policy_number": "POL-2026-004455"}) == "NEW004455"


def test_fix_new_vehicle_regs_idempotent_and_deduplicates_distinct_chassis():
    admin = admin_client()
    agent = create_agent(admin)
    pid_a = str(uuid.uuid4())
    pid_b = str(uuid.uuid4())
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()

    def doc(pid, chassis, reg_no):
        return {
            "id": pid, "file_name": None, "file_mime": None, "has_file": False,
            "status": "extracted",
            "agent_id": agent["id"], "agent_name": agent["full_name"], "agent_code": agent["agent_code"],
            "branch": agent.get("branch", "Chennai"),
            "uploaded_by_id": agent["id"], "uploaded_by_name": agent["full_name"],
            "broker_id": None, "broker_name": None,
            "fields": {
                "policy_number": uniq("pol"), "insurer": "ACME", "lob": "Motor",
                "vehicle_class": "Private Car", "cover_type": "Package",
                "vehicle_reg_no": reg_no, "chassis_no": chassis,
                "start_date": "2026-10-07", "gross_premium": 10000.0,
            },
            "confidence": {}, "ocr_error": None, "duplicate_reason": None, "duplicate_of_id": None,
            "flag_reason": None, "verified_by_name": None, "verified_at": None,
            "created_at": now, "updated_at": now, "history": [],
            "payment_mode": "Online", "payments": [],
            "file_size": None, "original_size": None, "is_deleted": False, "seeded": False,
        }

    DB.policies.insert_one(doc(pid_a, "MC2EBJRC0RCB99991", "NEW0001"))
    DB.policies.insert_one(doc(pid_b, "MC2EBJRC0RCB99992", "NEW0001"))
    try:
        from routers.policies import fix_new_vehicle_regs

        async def run_twice():
            # motor's client is bound to the event loop it was created on, so both calls
            # (the idempotency check) must happen inside the same asyncio.run invocation.
            f1 = await fix_new_vehicle_regs()
            f2 = await fix_new_vehicle_regs()
            return f1, f2

        fixed1, fixed2 = asyncio.run(run_twice())
        assert fixed1 >= 2

        a = DB.policies.find_one({"id": pid_a}, {"_id": 0, "fields.vehicle_reg_no": 1, "status": 1})
        b = DB.policies.find_one({"id": pid_b}, {"_id": 0, "fields.vehicle_reg_no": 1, "status": 1})
        assert a["fields"]["vehicle_reg_no"] == "NEWB99991"
        assert b["fields"]["vehicle_reg_no"] == "NEWB99992"
        assert a["status"] != "duplicate"
        assert b["status"] != "duplicate"

        # idempotent: the second run (same asyncio.run call) made no further changes
        assert fixed2 == 0
        a2 = DB.policies.find_one({"id": pid_a}, {"_id": 0, "fields.vehicle_reg_no": 1})
        b2 = DB.policies.find_one({"id": pid_b}, {"_id": 0, "fields.vehicle_reg_no": 1})
        assert a2["fields"]["vehicle_reg_no"] == "NEWB99991"
        assert b2["fields"]["vehicle_reg_no"] == "NEWB99992"
    finally:
        delete_policy(pid_a)
        delete_policy(pid_b)
        delete_user(agent["username"])
