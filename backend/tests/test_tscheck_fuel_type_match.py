"""Criterion: Private Car fuel type — a rule with fuel_types=['Diesel'] matches a policy whose
fields.fuel_type is 'Diesel' and must not match a 'Petrol' policy."""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)


def test_diesel_fuel_rule_matches_diesel_not_petrol():
    admin = admin_client()
    insurer = uniq("insurer")
    agent = create_agent(admin)
    rule_id, pid_diesel, pid_petrol = None, None, None
    try:
        rule = admin.post("/commission/rules", json=rule_body(
            "receivable", uniq("rec-fuel"), insurer=insurer, products=["Private Car Package"],
            fuel_types=["Diesel"], od_percent=9,
        ))
        assert rule.status_code == 200, rule.text
        rule_id = rule.json()["id"]
        rule_name = rule.json()["name"]

        pid_diesel = insert_policy(agent, insurer=insurer, product_category="Private Car Package", fuel_type="Diesel")
        pid_petrol = insert_policy(agent, insurer=insurer, product_category="Private Car Package", fuel_type="Petrol")

        r_diesel = admin.get(f"/policies/{pid_diesel}/commission")
        r_petrol = admin.get(f"/policies/{pid_petrol}/commission")
        assert r_diesel.status_code == 200 and r_petrol.status_code == 200

        assert r_diesel.json()["receivable_rule_name"] == rule_name, r_diesel.json()
        assert r_petrol.json()["receivable_rule_name"] != rule_name, r_petrol.json()
    finally:
        if pid_diesel:
            delete_policy(pid_diesel)
        if pid_petrol:
            delete_policy(pid_petrol)
        if rule_id:
            delete_rule(rule_id)
        delete_user(agent["username"])
