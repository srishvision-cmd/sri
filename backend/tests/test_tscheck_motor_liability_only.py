"""Liability Only motor cover: NCB, IDV, OD premium and Add-on premium must be auto-zeroed
server-side on every PATCH, even when the client tries to send non-zero values; tp_premium
is left untouched. Verified against a fixture policy this test uploads itself (tscheck-)."""
from .conftest import login, upload_and_wait


def test_liability_only_zeroes_fields_server_side():
    c = login("agt1001", "Agent@123")
    doc = upload_and_wait(c)
    assert doc["status"] != "processing", f"OCR did not finish in time: {doc}"

    body = {
        "fields": {
            "lob": "Motor",
            "cover_type": "Liability Only",
            "vehicle_class": "Private Car",
            "ncb_percent": 50,
            "idv": 500000,
            "od_premium": 10000,
            "addon_premium": 2000,
            "tp_premium": 3456.78,
            "policy_number": "tscheck-liab-001",
            "gross_premium": 3456.78,
        },
        "note": "tscheck-liability-only",
    }
    r = c.patch(f"/policies/{doc['id']}", json=body)
    assert r.status_code == 200, r.text
    patched = r.json()["fields"]
    assert patched["ncb_percent"] == 0
    assert patched["idv"] == 0
    assert patched["od_premium"] == 0
    assert patched["addon_premium"] == 0
    assert patched["tp_premium"] == 3456.78

    # re-fetch independently to confirm persisted, not just echoed
    refetched = c.get(f"/policies/{doc['id']}").json()["fields"]
    assert refetched["ncb_percent"] == 0
    assert refetched["idv"] == 0
    assert refetched["od_premium"] == 0
    assert refetched["addon_premium"] == 0
    assert refetched["tp_premium"] == 3456.78
    c.close()
