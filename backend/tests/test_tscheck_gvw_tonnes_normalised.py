"""Criterion: GVW is graded in kg, but OCR sometimes reports it in tonnes (e.g. 18.5) -> commission
matching must normalise tonnes to kg so a 16500-34000 kg rule still matches a fields.gvw of 18.5.
"""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_rule, delete_user, insert_policy, rule_body, uniq,
)


def test_gvw_in_tonnes_matches_kg_range_rule():
    admin = admin_client()
    agent = create_agent(admin)
    insurer = uniq("insurer")
    pid, rule_id = None, None
    try:
        rule = admin.post("/commission/rules", json=rule_body(
            "receivable", uniq("rec"), insurer=insurer, products=["GCV"],
            gvw_min=16500, gvw_max=34000, net_percent=10,
        ))
        assert rule.status_code == 200, rule.text
        rule_id = rule.json()["id"]

        # gvw=18.5 (tonnes form) must be normalised to 18500 kg and fall inside 16500-34000
        pid = insert_policy(
            agent, insurer=insurer, vehicle_class="Goods Carrying", cover_type="Package", gvw=18.5,
        )
        from ._commission_helpers import DB
        DB.policies.update_one({"id": pid}, {"$set": {"fields.net_premium": 20000}})

        resp = admin.get(f"/policies/{pid}/commission")
        assert resp.status_code == 200, resp.text
        c = resp.json()
        assert c["receivable"] == 2000, c  # 10% of 20000 net premium -> rule matched despite tonnes input
        assert c["receivable_rule_name"] == rule.json()["name"], c
    finally:
        if pid:
            delete_policy(pid)
        if rule_id:
            delete_rule(rule_id)
        delete_user(agent["username"])
