"""Criterion: Delete keeps history.

- DELETE on a rule row created TODAY removes it outright and re-opens the version it replaced
  (clears that version's superseded_by / restores its valid_to).
- DELETE on an OLDER rule (created on a previous day) does not remove it: it sets
  valid_to = yesterday and superseded_by = "ended", so a policy dated before today still
  resolves to that rule's commission.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ._commission_helpers import DB, admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq

IST = ZoneInfo("Asia/Kolkata")


def _today() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def _yesterday() -> str:
    return (datetime.now(IST) - timedelta(days=1)).strftime("%Y-%m-%d")


def test_delete_today_version_reopens_previous():
    admin = admin_client()
    rule_name = uniq("delete-today-rule")
    rule_ids = []
    try:
        r = admin.post("/commission/rules", json=rule_body("receivable", rule_name, insurer="Tscheck DelA", net_percent=10))
        assert r.status_code == 200, r.text
        r1_id = r.json()["id"]
        rule_ids.append(r1_id)
        DB.commission_rules.update_one({"id": r1_id}, {"$set": {"created_at": datetime(2020, 1, 1, tzinfo=timezone.utc)}})

        r2 = admin.put(
            f"/commission/rules/{r1_id}",
            json=rule_body("receivable", rule_name, insurer="Tscheck DelA", net_percent=20, valid_from=_today()),
        )
        assert r2.status_code == 200, r2.text
        v2_id = r2.json()["id"]
        assert v2_id != r1_id
        rule_ids.append(v2_id)

        r1_doc = DB.commission_rules.find_one({"id": r1_id}, {"_id": 0})
        assert r1_doc["superseded_by"] == v2_id, r1_doc

        del_resp = admin.delete(f"/commission/rules/{v2_id}")
        assert del_resp.status_code == 200, del_resp.text
        assert del_resp.json()["ended"] is False, del_resp.json()

        assert DB.commission_rules.find_one({"id": v2_id}) is None, "today's version row should be gone"
        r1_reopened = DB.commission_rules.find_one({"id": r1_id}, {"_id": 0})
        assert r1_reopened["superseded_by"] is None, r1_reopened
    finally:
        for rid in rule_ids:
            delete_rule(rid)


def test_delete_older_rule_keeps_history_for_past_policy():
    admin = admin_client()
    agent = create_agent(admin)
    rule_name = uniq("delete-older-rule")
    rule_ids = []
    policy_ids = []
    try:
        r = admin.post("/commission/rules", json=rule_body("receivable", rule_name, insurer="Tscheck DelB", net_percent=15))
        assert r.status_code == 200, r.text
        rule_id = r.json()["id"]
        rule_ids.append(rule_id)
        DB.commission_rules.update_one({"id": rule_id}, {"$set": {"created_at": datetime(2020, 1, 1, tzinfo=timezone.utc)}})

        del_resp = admin.delete(f"/commission/rules/{rule_id}")
        assert del_resp.status_code == 200, del_resp.text
        assert del_resp.json()["ended"] is True, del_resp.json()

        doc = DB.commission_rules.find_one({"id": rule_id}, {"_id": 0})
        assert doc["valid_to"] == _yesterday(), doc
        assert doc["superseded_by"] == "ended", doc

        past_policy = insert_policy(
            agent, insurer="Tscheck DelB", vehicle_class="Private Car", cover_type="Package",
            start_date=_yesterday(),
        )
        policy_ids.append(past_policy)
        comm = admin.get(f"/policies/{past_policy}/commission").json()
        assert comm["receivable_rule_id"] == rule_id, f"a policy dated before today must still get the ended rule's commission: {comm}"
    finally:
        for pid in policy_ids:
            delete_policy(pid)
        for rid in rule_ids:
            delete_rule(rid)
        delete_user(agent["username"])
