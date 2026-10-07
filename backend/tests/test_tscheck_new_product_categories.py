"""Criterion: new products — masters expose the new product codes, and derive_fields() on a
Private Car Package policy with start 2026-10-01 / tp_end_date 2029-09-30 (3-year TP window)
derives product_category 'Private Car 1+3 (Bundle)'."""
from ._commission_helpers import admin_client


def test_masters_list_new_product_codes():
    admin = admin_client()
    r = admin.get("/commission/masters")
    assert r.status_code == 200, r.text
    types = r.json()["product_types"]
    assert "Private Car 1+3 (Bundle)" in types["Private Car"], types["Private Car"]
    assert "Private Car 1+5 (Long Term)" in types["Private Car"], types["Private Car"]
    assert "Two Wheeler 1+5 (Bundle)" in types["Two Wheeler"], types["Two Wheeler"]
    assert "Misc D - Tractor" in types["Misc D"], types["Misc D"]
    assert "Misc D - Others" in types["Misc D"], types["Misc D"]


def test_bundle_tp_window_derives_1plus3_bundle_category():
    admin = admin_client()
    from ._commission_helpers import create_agent, delete_policy, delete_user, insert_policy, uniq
    agent = create_agent(admin)
    pid = None
    try:
        pid = insert_policy(agent, insurer=uniq("insurer"), vehicle_class="Private Car", cover_type="Package",
                             product_category="TBD-derive", start_date="2026-10-01", tp_end_date="2029-09-30")
        got = admin.get(f"/policies/{pid}")
        assert got.status_code == 200, got.text
        assert got.json()["fields"]["product_category"] == "Private Car 1+3 (Bundle)", got.json()["fields"]
    finally:
        if pid:
            delete_policy(pid)
        delete_user(agent["username"])
