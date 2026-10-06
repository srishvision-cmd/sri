"""Agent Outstanding scoping: agt1001 sees only own row; bo2001 (Mumbai, team-mapped to
agt1002) sees Mumbai + AGT1002 policies but not AGT1003 (Chennai, unrelated agent)."""
from .conftest import login, upload_and_wait


def test_agent_sees_only_own_outstanding_row():
    c = login("agt1001", "Agent@123")
    upload_and_wait(c, payment_mode="Partial Payment", amount_paid=1234)
    rows = c.get("/outstanding").json()
    assert len(rows) >= 1, rows
    assert all(r["agent_code"].upper() == "AGT1001" for r in rows), rows
    c.close()


def test_backoffice_outstanding_excludes_unrelated_agent():
    agt1003 = login("agt1003", "Agent@123")
    upload_and_wait(agt1003, payment_mode="Partial Payment", amount_paid=500)

    bo = login("bo2001", "Back@123")
    rows = bo.get("/outstanding").json()
    codes = {r["agent_code"].upper() for r in rows}
    assert "AGT1003" not in codes, codes
    # bo2001 is Mumbai-branch + team-mapped to agt1002, so if any rows exist they must be
    # one of those (never the unrelated Chennai agent)
    for r in rows:
        assert r["branch"] == "Mumbai" or r["agent_code"].upper() == "AGT1002", r
    agt1003.close()
    bo.close()
