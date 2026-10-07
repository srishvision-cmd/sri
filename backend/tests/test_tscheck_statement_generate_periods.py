"""Criterion: Generate daily / weekly / monthly statement (admin).

POST /api/statements with period_type daily/weekly/monthly computes from_date/to_date:
weekly = Mon-Sun containing ref_date, monthly = calendar month containing ref_date, daily = ref_date
itself. Verified against a tscheck agent's commission-earning policy created "now".
"""
from datetime import date

from ._commission_helpers import admin_client
from ._statement_helpers import build_scenario, delete_statement, teardown_scenario


def test_daily_weekly_monthly_period_ranges():
    admin = admin_client()
    scenario = build_scenario(admin)
    statement_ids = []
    try:
        today = date.today()

        r = admin.post("/statements", json={"agent_id": scenario["agent"]["id"], "period_type": "daily", "ref_date": today.isoformat()})
        assert r.status_code == 200, r.text
        s = r.json()
        statement_ids.append(s["id"])
        assert s["from_date"] == s["to_date"] == today.isoformat(), s
        assert s["number"].startswith("CS-"), s
        admin.delete(f"/statements/{s['id']}")
        statement_ids.remove(s["id"])

        r = admin.post("/statements", json={"agent_id": scenario["agent"]["id"], "period_type": "weekly", "ref_date": today.isoformat()})
        assert r.status_code == 200, r.text
        s = r.json()
        statement_ids.append(s["id"])
        mon = today.fromordinal(today.toordinal() - today.weekday())
        sun = mon.fromordinal(mon.toordinal() + 6)
        assert s["from_date"] == mon.isoformat(), s
        assert s["to_date"] == sun.isoformat(), s
        assert s["from_date"] <= today.isoformat() <= s["to_date"]
        admin.delete(f"/statements/{s['id']}")
        statement_ids.remove(s["id"])

        r = admin.post("/statements", json={"agent_id": scenario["agent"]["id"], "period_type": "monthly", "ref_date": today.isoformat()})
        assert r.status_code == 200, r.text
        s = r.json()
        statement_ids.append(s["id"])
        first = today.replace(day=1)
        assert s["from_date"] == first.isoformat(), s
        assert s["to_date"][:7] == today.isoformat()[:7], s
        assert s["from_date"] <= today.isoformat() <= s["to_date"]
    finally:
        for sid in statement_ids:
            admin.delete(f"/statements/{sid}")
            delete_statement(sid)
        teardown_scenario(scenario)
