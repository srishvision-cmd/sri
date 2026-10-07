"""Criterion: SAOD rule must not apply to Package policies (user bug fix check).

A receivable rule insurer='ICICI Lombard', products=['Private Car SAOD'] must NOT match a
Private Car Package ICICI policy, but MUST match a Standalone OD (SAOD) ICICI policy.
"""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)


def test_saod_rule_does_not_match_package_but_matches_saod():
    admin = admin_client()
    agent = create_agent(admin)
    rule_name = uniq("ICICI-SAOD-rule")
    rule_ids = []
    policy_ids = []
    try:
        r = admin.post(
            "/commission/rules",
            json=rule_body(
                "receivable", rule_name,
                insurer="ICICI Lombard", products=["Private Car SAOD"], od_percent=20, tp_percent=2.5,
            ),
        )
        assert r.status_code == 200, r.text
        rule = r.json()
        rule_ids.append(rule["id"])

        package_id = insert_policy(
            agent, insurer="ICICI Lombard General Insurance", vehicle_class="Private Car", cover_type="Package",
            product_category="Private Car Package",
        )
        policy_ids.append(package_id)
        saod_id = insert_policy(
            agent, insurer="ICICI Lombard General Insurance", vehicle_class="Private Car", cover_type="Standalone OD",
            product_category="Private Car SAOD",
        )
        policy_ids.append(saod_id)

        r_pkg = admin.get(f"/policies/{package_id}/commission")
        assert r_pkg.status_code == 200, r_pkg.text
        pkg_result = r_pkg.json()
        assert pkg_result["receivable_rule_name"] != rule_name, (
            f"SAOD rule '{rule_name}' wrongly matched a Package policy: {pkg_result}"
        )

        r_saod = admin.get(f"/policies/{saod_id}/commission")
        assert r_saod.status_code == 200, r_saod.text
        saod_result = r_saod.json()
        assert saod_result["receivable_rule_name"] == rule_name, (
            f"SAOD rule '{rule_name}' should match SAOD policy, got: {saod_result}"
        )
        assert saod_result["receivable"] is not None and saod_result["receivable"] > 0
    finally:
        for pid in policy_ids:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])
