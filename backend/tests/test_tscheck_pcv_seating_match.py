"""Criterion: Product-specific conditions — PCV rule with seating 10-40 matches a PCV policy
with seating_capacity 32 (and must not match one outside that range)."""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)


def test_pcv_seating_range_matches_policy_in_range_not_outside():
    admin = admin_client()
    agent = create_agent(admin)
    rule_name = uniq("PCV-seating-rule")
    rule_ids = []
    policy_ids = []
    try:
        r = admin.post(
            "/commission/rules",
            json=rule_body(
                "receivable", rule_name,
                products=["PCV - Taxi"], seating_min=10, seating_max=40, od_percent=12,
            ),
        )
        assert r.status_code == 200, r.text
        rule_ids.append(r.json()["id"])

        in_range_id = insert_policy(
            agent, insurer="Generic Insurer", vehicle_class="Passenger Carrying", cover_type="Package",
            product_category="PCV - Taxi", seating_capacity=32,
        )
        policy_ids.append(in_range_id)
        out_range_id = insert_policy(
            agent, insurer="Generic Insurer", vehicle_class="Passenger Carrying", cover_type="Package",
            product_category="PCV - Taxi", seating_capacity=5,
        )
        policy_ids.append(out_range_id)

        r_in = admin.get(f"/policies/{in_range_id}/commission")
        assert r_in.status_code == 200, r_in.text
        in_result = r_in.json()
        assert in_result["receivable_rule_name"] == rule_name, f"seating=32 should match rule, got {in_result}"

        r_out = admin.get(f"/policies/{out_range_id}/commission")
        assert r_out.status_code == 200, r_out.text
        out_result = r_out.json()
        assert out_result["receivable_rule_name"] != rule_name, f"seating=5 should NOT match rule, got {out_result}"
    finally:
        for pid in policy_ids:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])
