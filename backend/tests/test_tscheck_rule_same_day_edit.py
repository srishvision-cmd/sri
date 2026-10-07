"""Criterion: Same-day correction edits in place. A rule created today and edited again today
(no backdating) must overwrite the same row — same id, new values, no extra version row created.
"""
from ._commission_helpers import admin_client, delete_rule, rule_body, uniq


def test_same_day_edit_overwrites_in_place():
    admin = admin_client()
    rule_name = uniq("same-day-rule")
    rule_ids = []
    try:
        r = admin.post("/commission/rules", json=rule_body("receivable", rule_name, insurer="Tscheck Insurer", net_percent=5))
        assert r.status_code == 200, r.text
        rule_id = r.json()["id"]
        rule_ids.append(rule_id)

        r2 = admin.put(
            f"/commission/rules/{rule_id}",
            json=rule_body("receivable", rule_name, insurer="Tscheck Insurer", net_percent=7),
        )
        assert r2.status_code == 200, r2.text
        updated = r2.json()
        assert updated["id"] == rule_id, "same-day edit must keep the same rule id"
        assert updated["net_percent"] == 7, updated
        assert updated["version_of"] is None, updated
        assert updated["superseded_by"] is None, updated

        rules = admin.get("/commission/rules").json()
        matches = [x for x in rules if x["name"] == rule_name]
        assert len(matches) == 1, f"same-day correction must not create an extra version row, got {matches}"
        assert matches[0]["net_percent"] == 7, matches[0]
    finally:
        for rid in rule_ids:
            delete_rule(rid)
