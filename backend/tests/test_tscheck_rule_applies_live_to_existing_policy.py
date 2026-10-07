"""Criterion: saved rules apply to existing MIS policies immediately (commission computed on read,
not stored) -> creating a new receivable rule after a policy already exists must change that
policy's GET /api/policies/{id}/commission response without any re-upload / re-save of the policy.
"""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)


def test_new_rule_applies_to_preexisting_policy_without_reupload():
    admin = admin_client()
    insurer = uniq("insurer")
    agent = create_agent(admin)
    pid, rule_id = None, None
    try:
        # policy exists BEFORE any matching rule
        pid = insert_policy(agent, insurer=insurer, od_premium=10000, tp_premium=4000,
                             product_category="Private Car Package")

        before = admin.get(f"/policies/{pid}/commission")
        assert before.status_code == 200, before.text
        assert before.json()["receivable"] is None, before.json()

        # now create a matching receivable rule
        rec = admin.post("/commission/rules", json=rule_body(
            "receivable", uniq("rec"), insurer=insurer, products=["Private Car Package"], od_percent=10,
        ))
        assert rec.status_code == 200, rec.text
        rule_id = rec.json()["id"]

        after = admin.get(f"/policies/{pid}/commission")
        assert after.status_code == 200, after.text
        c = after.json()
        assert c["receivable"] == 1000, c  # 10% of 10000 OD, no re-upload of the policy happened
        assert c["receivable_rule_name"] == rec.json()["name"], c

        # also reflected in the admin policies list (MIS)
        lst = admin.get("/policies", params={"page_size": 500})
        assert lst.status_code == 200, lst.text
        body = lst.json()
        items = body if isinstance(body, list) else body.get("items", [])
        match = next((p for p in items if p["id"] == pid), None)
        assert match is not None, "policy not found in /api/policies listing"
    finally:
        if pid:
            delete_policy(pid)
        if rule_id:
            delete_rule(rule_id)
        delete_user(agent["username"])
