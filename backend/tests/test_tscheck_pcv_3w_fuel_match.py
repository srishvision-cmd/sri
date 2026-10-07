"""Criterion: PCV 3W Auto product + Diesel / Other than Diesel fuel conditions.

A receivable rule with products=['PCV - 3W Auto'] and fuel_types=['Other than Diesel'] must match
a Passenger Carrying policy (model 'APE CITY 3 WHEELER') with fuel_type 'CNG', and must NOT match
the same policy with fuel_type 'Diesel'.
"""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)


def test_pcv_3w_other_than_diesel_matches_cng_not_diesel():
    admin = admin_client()
    agent = create_agent(admin)
    rule_name = uniq("PCV-3W-rule")
    rule_ids = []
    policy_ids = []
    try:
        r = admin.post(
            "/commission/rules",
            json=rule_body(
                "receivable", rule_name,
                products=["PCV - 3W Auto"], fuel_types=["Other than Diesel"], od_percent=15,
            ),
        )
        assert r.status_code == 200, r.text
        rule_ids.append(r.json()["id"])

        cng_id = insert_policy(
            agent, insurer="Generic Insurer", vehicle_class="Passenger Carrying", cover_type="Package",
            product_category="PCV - 3W Auto", model="APE CITY 3 WHEELER", fuel_type="CNG",
        )
        policy_ids.append(cng_id)
        diesel_id = insert_policy(
            agent, insurer="Generic Insurer", vehicle_class="Passenger Carrying", cover_type="Package",
            product_category="PCV - 3W Auto", model="APE CITY 3 WHEELER", fuel_type="Diesel",
        )
        policy_ids.append(diesel_id)

        r_cng = admin.get(f"/policies/{cng_id}/commission")
        assert r_cng.status_code == 200, r_cng.text
        cng_result = r_cng.json()
        assert cng_result["receivable_rule_name"] == rule_name, f"CNG fuel should match 'Other than Diesel' rule, got {cng_result}"

        r_diesel = admin.get(f"/policies/{diesel_id}/commission")
        assert r_diesel.status_code == 200, r_diesel.text
        diesel_result = r_diesel.json()
        assert diesel_result["receivable_rule_name"] != rule_name, f"Diesel fuel should NOT match 'Other than Diesel' rule, got {diesel_result}"
    finally:
        for pid in policy_ids:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])
