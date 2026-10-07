"""Criterion: NCB 'All (with & without NCB)' option exists for every product type including Misc D
and Health — verified via the rule validation/compute path: a rule with ncb='any' (default) must
match policies regardless of their ncb_percent, for both a Misc D and a Health product."""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)


def test_ncb_any_matches_misc_d_and_health_regardless_of_ncb_percent():
    admin = admin_client()
    insurer = uniq("insurer")
    agent = create_agent(admin)
    rule_ids, pids = [], []
    try:
        rule_misc = admin.post("/commission/rules", json=rule_body(
            "receivable", uniq("rec-ncb-miscd"), insurer=insurer, products=["Misc D - Tractor"],
            ncb="any", od_percent=8,
        ))
        assert rule_misc.status_code == 200, rule_misc.text
        rule_ids.append(rule_misc.json()["id"])

        rule_health = admin.post("/commission/rules", json=rule_body(
            "receivable", uniq("rec-ncb-health"), insurer=insurer, products=["Health"],
            ncb="any", net_percent=5,
        ))
        assert rule_health.status_code == 200, rule_health.text
        rule_ids.append(rule_health.json()["id"])

        pid_misc = insert_policy(agent, insurer=insurer, vehicle_class="Miscellaneous",
                                  product_category="Misc D - Tractor", make="Mahindra")
        pids.append(pid_misc)
        pid_health = insert_policy(agent, insurer=insurer, product_category="Health")
        pids.append(pid_health)

        r_misc = admin.get(f"/policies/{pid_misc}/commission")
        r_health = admin.get(f"/policies/{pid_health}/commission")
        assert r_misc.status_code == 200 and r_health.status_code == 200

        assert r_misc.json()["receivable_rule_name"] == rule_misc.json()["name"], r_misc.json()
        assert r_health.json()["receivable_rule_name"] == rule_health.json()["name"], r_health.json()
    finally:
        for pid in pids:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])
