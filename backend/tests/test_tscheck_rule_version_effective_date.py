"""Criterion: Rate change applies only from its effective date; earlier policies keep old rate.

A receivable rule (net_percent 10) created on 2026-09-01 is edited today to net_percent 12 with
valid_from 2026-10-15. This must version the rule: a NEW rule row is created for the new rate
(valid_from 2026-10-15, version_of = old id), the OLD row gets valid_to 2026-10-14 +
superseded_by = new id. A policy with risk start before 2026-10-15 keeps the 10% rate; a policy
with risk start on/after 2026-10-15 gets the new 12% rate. Editing the now-superseded (old) id
must be rejected with 409.
"""
from datetime import datetime, timezone

from ._commission_helpers import DB, admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq


def test_rate_change_versions_by_effective_date():
    admin = admin_client()
    agent = create_agent(admin)
    rule_name = uniq("godigit-net10")
    rule_ids = []
    policy_ids = []
    try:
        r = admin.post(
            "/commission/rules",
            json=rule_body("receivable", rule_name, insurer="Go Digit", products=["GCV"], net_percent=10),
        )
        assert r.status_code == 200, r.text
        old_id = r.json()["id"]
        rule_ids.append(old_id)

        # backdate created_at so the edit below is NOT treated as a same-day correction
        DB.commission_rules.update_one(
            {"id": old_id}, {"$set": {"created_at": datetime(2026, 9, 1, tzinfo=timezone.utc)}}
        )

        policy_a = insert_policy(
            agent, insurer="Go Digit General", vehicle_class="Goods Carrying Vehicle", cover_type="Package",
            product_category="GCV", start_date="2026-10-01",
        )
        policy_ids.append(policy_a)
        DB.policies.update_one({"id": policy_a}, {"$set": {"fields.net_premium": 10000}})

        policy_b = insert_policy(
            agent, insurer="Go Digit General", vehicle_class="Goods Carrying Vehicle", cover_type="Package",
            product_category="GCV", start_date="2026-10-20",
        )
        policy_ids.append(policy_b)
        DB.policies.update_one({"id": policy_b}, {"$set": {"fields.net_premium": 10000}})

        r = admin.put(
            f"/commission/rules/{old_id}",
            json=rule_body("receivable", rule_name, insurer="Go Digit", products=["GCV"], net_percent=12, valid_from="2026-10-15"),
        )
        assert r.status_code == 200, r.text
        new_rule = r.json()
        new_id = new_rule["id"]
        assert new_id != old_id, "editing with a future effective date must create a NEW rule id"
        rule_ids.append(new_id)
        assert new_rule["valid_from"] == "2026-10-15", new_rule
        assert new_rule["version_of"] == old_id, new_rule

        old_doc = DB.commission_rules.find_one({"id": old_id}, {"_id": 0})
        assert old_doc["valid_to"] == "2026-10-14", old_doc
        assert old_doc["superseded_by"] == new_id, old_doc

        comm_a = admin.get(f"/policies/{policy_a}/commission").json()
        assert comm_a["receivable"] == 1000, comm_a  # 10% of 10000 — old rate, before effective date
        assert comm_a["receivable_rule_id"] == old_id, comm_a

        comm_b = admin.get(f"/policies/{policy_b}/commission").json()
        assert comm_b["receivable"] == 1200, comm_b  # 12% of 10000 — new rate, on/after effective date
        assert comm_b["receivable_rule_id"] == new_id, comm_b

        r_conflict = admin.put(
            f"/commission/rules/{old_id}",
            json=rule_body("receivable", rule_name, insurer="Go Digit", products=["GCV"], net_percent=15),
        )
        assert r_conflict.status_code == 409, r_conflict.text
    finally:
        for pid in policy_ids:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])
