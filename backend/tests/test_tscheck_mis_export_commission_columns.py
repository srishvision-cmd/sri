"""Criterion: Policy MIS export shows commission columns for admin, not for backoffice.

GET /api/mis/export?format=csv as admin ends with the 5 commission headers; backoffice export
omits them.
"""
from ._commission_helpers import admin_client, create_agent, delete_policy, delete_user, insert_policy, uniq
from .test_tscheck_commission_admin_only import _login

COMMISSION_HEADERS = "Broker (Commission),Product Category,Commission Receivable,Commission Payable,Commission Margin"


def test_mis_export_csv_appends_commission_columns_for_admin_only():
    admin = admin_client()
    agent = create_agent(admin)
    bo_resp = admin.post("/users", json={"full_name": uniq("bo"), "branch": "Chennai", "role": "backoffice"})
    assert bo_resp.status_code == 200, bo_resp.text
    bo_body = bo_resp.json()
    pid = insert_policy(agent, insurer=uniq("insurer"))
    try:
        bo = _login(bo_body["username"], bo_body["temp_password"])

        r = admin.get("/mis/export", params={"format": "csv"})
        assert r.status_code == 200, r.text
        header_line = r.text.splitlines()[0]
        assert header_line.rstrip().endswith(COMMISSION_HEADERS), header_line

        r_bo = bo.get("/mis/export", params={"format": "csv"})
        assert r_bo.status_code == 200, r_bo.text
        bo_header = r_bo.text.splitlines()[0]
        assert "Commission Receivable" not in bo_header, bo_header
        assert "Broker (Commission)" not in bo_header, bo_header
    finally:
        delete_policy(pid)
        delete_user(agent["username"])
        delete_user(bo_body["username"])
