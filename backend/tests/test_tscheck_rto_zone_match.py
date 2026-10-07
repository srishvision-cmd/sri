"""Criterion: Zone rules match by RTO. A rule saved with Coimbatore RTOs (TN37, TN38, TN66, TN99)
matches a policy with vehicle_reg_no 'TN 37 AB 1234' (normalises to TN37) and does NOT match
'TN10AB1234'.
"""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)

COIMBATORE_RTOS = ["TN37", "TN38", "TN66", "TN99"]


def test_coimbatore_zone_rule_matches_by_rto():
    admin = admin_client()
    agent = create_agent(admin)
    rule_name = uniq("Coimbatore-zone-rule")
    rule_ids = []
    policy_ids = []
    try:
        r = admin.post(
            "/commission/rules",
            json=rule_body("receivable", rule_name, rtos=COIMBATORE_RTOS, od_percent=90),
        )
        assert r.status_code == 200, r.text
        rule_ids.append(r.json()["id"])

        in_zone_id = insert_policy(
            agent, insurer="Generic Insurer", vehicle_class="Private Car", cover_type="Package",
            reg_no="TN 37 AB 1234",
        )
        policy_ids.append(in_zone_id)
        out_zone_id = insert_policy(
            agent, insurer="Generic Insurer", vehicle_class="Private Car", cover_type="Package",
            reg_no="TN10AB1234",
        )
        policy_ids.append(out_zone_id)

        r_in = admin.get(f"/policies/{in_zone_id}/commission")
        assert r_in.status_code == 200, r_in.text
        in_result = r_in.json()
        assert in_result["receivable_rule_name"] == rule_name, f"TN 37 AB 1234 should match Coimbatore zone rule, got {in_result}"

        r_out = admin.get(f"/policies/{out_zone_id}/commission")
        assert r_out.status_code == 200, r_out.text
        out_result = r_out.json()
        assert out_result["receivable_rule_name"] != rule_name, f"TN10AB1234 should NOT match Coimbatore zone rule, got {out_result}"
    finally:
        for pid in policy_ids:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])
