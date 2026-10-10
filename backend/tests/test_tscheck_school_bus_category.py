"""Criterion: policy 6304380637 00 00 (TATA AIG Auto Secure PCV, insured 'Cuddles Play School',
model WINGER .../BUS, 22 seats) must be 'PCV - School Bus' (was wrongly 'PCV - 3W Auto'), with a
'Product corrected' history entry; and system-wide no bus / heavy PCV 'Auto Secure' policy is still
tagged 'PCV - 3W Auto'. These are seeded/pre-existing rows from the user's bug report — read-only
checks (GET only), never mutated, per fixture-isolation rules.
"""
from ._commission_helpers import admin_client


def test_school_bus_policy_corrected():
    admin = admin_client()
    r = admin.get("/policies", params={"q": "6304380637"})
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) == 1, f"expected policy 6304380637 00 00 to exist in preview, got {items}"
    policy = items[0]
    fields = policy["fields"]
    assert fields["policy_number"] == "6304380637 00 00"
    assert fields["insured_name"] == "Cuddles Play School"
    assert fields["product_category"] == "PCV - School Bus", f"expected PCV - School Bus, got {fields['product_category']}"

    detail = admin.get(f"/policies/{policy['id']}")
    assert detail.status_code == 200, detail.text
    history = detail.json().get("history", [])
    corrected = [h for h in history if h.get("action") == "Product corrected"]
    assert corrected, f"expected a 'Product corrected' history entry, got actions {[h.get('action') for h in history]}"
    assert "School Bus" in corrected[-1].get("note", ""), corrected[-1]


def test_no_bus_or_heavy_pcv_tagged_as_3w_auto():
    admin = admin_client()
    r = admin.get("/policies")
    assert r.status_code == 200, r.text
    policies = r.json()
    offenders = []
    for p in policies:
        f = p["fields"]
        if f.get("product_category") != "PCV - 3W Auto":
            continue
        model = str(f.get("model") or "").lower()
        seats = f.get("seating_capacity")
        if "bus" in model or (seats is not None and seats > 7):
            offenders.append((f.get("policy_number"), model, seats))
    assert not offenders, f"bus/heavy vehicles still tagged PCV - 3W Auto: {offenders}"

    # specific example from the briefing: a 30-seat bus must now be 'PCV - Others'
    r2 = admin.get("/policies", params={"q": "6303431148"})
    assert r2.status_code == 200, r2.text
    items = r2.json()
    assert len(items) == 1, f"expected policy 6303431148 00 00 to exist in preview, got {items}"
    assert items[0]["fields"]["product_category"] == "PCV - Others", items[0]["fields"]["product_category"]
