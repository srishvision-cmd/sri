"""Criterion: vehicle age bands for all products — a rule with vehicle_ages=['New Vehicle'] matches
a policy whose registration_date == start_date (age 0) and must NOT match a policy ~9 years old
(band '8-10 Years')."""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)


def test_new_vehicle_age_band_matches_zero_age_not_old_vehicle():
    admin = admin_client()
    insurer = uniq("insurer")
    agent = create_agent(admin)
    rule_id, pid_new, pid_old = None, None, None
    try:
        rule = admin.post("/commission/rules", json=rule_body(
            "receivable", uniq("rec-age"), insurer=insurer, products=["Private Car Package"],
            vehicle_ages=["New Vehicle"], od_percent=12,
        ))
        assert rule.status_code == 200, rule.text
        rule_id = rule.json()["id"]
        rule_name = rule.json()["name"]

        pid_new = insert_policy(agent, insurer=insurer, product_category="Private Car Package",
                                 start_date="2026-01-10", registration_date="2026-01-10")
        pid_old = insert_policy(agent, insurer=insurer, product_category="Private Car Package",
                                 start_date="2026-01-10", registration_date="2017-01-10")

        r_new = admin.get(f"/policies/{pid_new}/commission")
        r_old = admin.get(f"/policies/{pid_old}/commission")
        assert r_new.status_code == 200 and r_old.status_code == 200

        assert r_new.json()["receivable_rule_name"] == rule_name, r_new.json()
        assert r_old.json()["receivable_rule_name"] != rule_name, r_old.json()
    finally:
        if pid_new:
            delete_policy(pid_new)
        if pid_old:
            delete_policy(pid_old)
        if rule_id:
            delete_rule(rule_id)
        delete_user(agent["username"])
