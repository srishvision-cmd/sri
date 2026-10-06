"""GVW (gross vehicle weight) is not applicable for Private Car / Two Wheeler / Passenger Carrying
vehicle classes: server forces gvw=null on PATCH regardless of what the client sends. For Goods
Carrying, GVW stays editable and the submitted value persists. Fixture policy is self-uploaded."""
from .conftest import login, upload_and_wait


def _patch(c, policy_id, vehicle_class, gvw):
    body = {
        "fields": {
            "lob": "Motor",
            "cover_type": "Package",
            "vehicle_class": vehicle_class,
            "gvw": gvw,
            "policy_number": "tscheck-gvw-001",
            "gross_premium": 1234.0,
        },
        "note": "tscheck-gvw-na",
    }
    r = c.patch(f"/policies/{policy_id}", json=body)
    assert r.status_code == 200, r.text
    return r.json()["fields"]


def test_gvw_not_applicable_for_private_car_two_wheeler_passenger_carrying():
    c = login("agt1001", "Agent@123")
    doc = upload_and_wait(c)
    assert doc["status"] != "processing", f"OCR did not finish in time: {doc}"
    pid = doc["id"]

    for vclass in ("Private Car", "Two Wheeler", "Passenger Carrying"):
        fields = _patch(c, pid, vclass, 7500)
        assert fields["gvw"] is None, f"{vclass} should null out gvw, got {fields['gvw']}"
        refetched = c.get(f"/policies/{pid}").json()["fields"]
        assert refetched["gvw"] is None, f"{vclass} gvw not null after refetch: {refetched}"
    c.close()


def test_gvw_stays_editable_for_goods_carrying():
    c = login("agt1001", "Agent@123")
    doc = upload_and_wait(c)
    assert doc["status"] != "processing", f"OCR did not finish in time: {doc}"
    pid = doc["id"]

    fields = _patch(c, pid, "Goods Carrying", 7500)
    assert fields["gvw"] == 7500
    refetched = c.get(f"/policies/{pid}").json()["fields"]
    assert refetched["gvw"] == 7500
    c.close()
