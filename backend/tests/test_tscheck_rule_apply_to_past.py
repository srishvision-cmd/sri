"""Criterion: editing a commission rule with apply_to_past=True fixes commission for policies
whose risk start is before the rule's effective date (not just same-day corrections), and it
collapses the version chain (old version is deleted, superseded_by/version_of history gone) —
unlike a normal edit (apply_to_past=False) which still versions by effective date.
"""
from datetime import datetime, timedelta, timezone

from ._commission_helpers import DB, admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq


def test_apply_to_past_overwrites_and_collapses_version_chain():
    admin = admin_client()
    agent = create_agent(admin)
    rule_name = uniq("reliance-net10")
    rule_ids = []
    policy_ids = []
    try:
        r = admin.post(
            "/commission/rules",
            json=rule_body("receivable", rule_name, insurer="Reliance QA", products=["GCV"], net_percent=10),
        )
        assert r.status_code == 200, r.text
        old_id = r.json()["id"]
        rule_ids.append(old_id)
        # backdate so the next edit isn't treated as a same-day in-place correction
        DB.commission_rules.update_one({"id": old_id}, {"$set": {"created_at": datetime(2026, 9, 1, tzinfo=timezone.utc)}})

        tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%d")
        r = admin.put(
            f"/commission/rules/{old_id}",
            json=rule_body("receivable", rule_name, insurer="Reliance QA", products=["GCV"], net_percent=12, valid_from=tomorrow),
        )
        assert r.status_code == 200, r.text
        current = r.json()
        current_id = current["id"]
        assert current_id != old_id
        rule_ids.append(current_id)
        assert current["valid_from"] == tomorrow

        # policy whose risk start is BEFORE the effective date -> falls in the gap, no rule matches
        policy = insert_policy(agent, insurer="Reliance QA", product_category="GCV", start_date="2026-10-05")
        policy_ids.append(policy)
        DB.policies.update_one({"id": policy}, {"$set": {"fields.net_premium": 10000}})

        comm_before = admin.get(f"/policies/{policy}/commission").json()
        assert comm_before.get("receivable") == 1000, comm_before  # still the OLD rate (10%) — new version only applies from "tomorrow"
        assert comm_before.get("receivable_rule_id") == old_id, comm_before

        # now edit the CURRENT rule with apply_to_past=True, clearing valid_from (as the UI does on tick)
        r = admin.put(
            f"/commission/rules/{current_id}",
            json=rule_body("receivable", rule_name, insurer="Reliance QA", products=["GCV"], net_percent=15, valid_from=None, apply_to_past=True),
        )
        assert r.status_code == 200, r.text
        fixed = r.json()
        assert fixed["id"] == current_id, fixed
        assert fixed["valid_from"] is None, fixed
        assert fixed["net_percent"] == 15, fixed

        # old version is gone from the rules list entirely
        all_rules = admin.get("/commission/rules").json()
        assert not any(x["id"] == old_id for x in all_rules), "old version must be deleted when apply_to_past is used"
        assert any(x["id"] == current_id for x in all_rules)

        comm_after = admin.get(f"/policies/{policy}/commission").json()
        assert comm_after["receivable"] == 1500, comm_after  # 15% of 10000 now applies retroactively
        assert comm_after["receivable_rule_id"] == current_id, comm_after
    finally:
        for pid in policy_ids:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])


def test_without_tick_versioning_still_applies_only_from_effective_date():
    """Sanity check for the non-apply_to_past path (criterion 2): editing a rule created before
    today, without apply_to_past and with a future valid_from, must still create a NEW version
    (old row gets valid_to = day before, superseded_by = new id) rather than overwriting in place."""
    admin = admin_client()
    rule_name = uniq("hdfc-net8")
    rule_ids = []
    try:
        r = admin.post("/commission/rules", json=rule_body("receivable", rule_name, insurer="HDFC QA", products=["GCV"], net_percent=8))
        assert r.status_code == 200, r.text
        old_id = r.json()["id"]
        rule_ids.append(old_id)
        DB.commission_rules.update_one({"id": old_id}, {"$set": {"created_at": datetime(2026, 9, 1, tzinfo=timezone.utc)}})

        tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%d")
        r = admin.put(
            f"/commission/rules/{old_id}",
            json=rule_body("receivable", rule_name, insurer="HDFC QA", products=["GCV"], net_percent=9, valid_from=tomorrow, apply_to_past=False),
        )
        assert r.status_code == 200, r.text
        new_rule = r.json()
        new_id = new_rule["id"]
        assert new_id != old_id, "must version (new id) when apply_to_past is false"
        rule_ids.append(new_id)
        assert new_rule["valid_from"] == tomorrow

        old_doc = DB.commission_rules.find_one({"id": old_id}, {"_id": 0})
        assert old_doc["superseded_by"] == new_id, old_doc
        assert old_doc["valid_to"] is not None and old_doc["valid_to"] < tomorrow, old_doc

        all_rules = admin.get("/commission/rules").json()
        assert any(x["id"] == old_id for x in all_rules), "old version must still exist (not deleted) without apply_to_past"
    finally:
        for rid in rule_ids:
            delete_rule(rid)
