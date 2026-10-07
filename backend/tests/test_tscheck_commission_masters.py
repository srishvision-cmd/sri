"""Criterion: Dropdown masters — GET /api/commission/masters returns Indian insurers, product
types (incl. PCV/GCV), makes per type, and VAHAN-pattern RTO state codes."""
from ._commission_helpers import admin_client


def test_commission_masters_shape():
    admin = admin_client()
    r = admin.get("/commission/masters")
    assert r.status_code == 200, r.text
    data = r.json()

    insurers = data["insurers"]
    assert len(insurers) >= 20, f"expected many Indian insurers, got {len(insurers)}"
    assert any("ICICI" in i for i in insurers), insurers
    assert any("HDFC" in i for i in insurers), insurers
    assert any("New India" in i for i in insurers), insurers

    types = data["product_types"]
    for t in ("Private Car", "Two Wheeler", "PCV", "GCV"):
        assert t in types, types
    assert "Private Car SAOD" in types["Private Car"]

    makes = data["makes"]
    assert "Maruti Suzuki" in makes["Private Car"]
    assert "Hyundai" in makes["Private Car"]

    states = data["rto_states"]
    tn = next((s for s in states if s["code"] == "TN"), None)
    assert tn is not None, states
    assert "TN01" in tn["rtos"] and "TN10" in tn["rtos"]
