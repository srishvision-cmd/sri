"""MIS export reflects the motor rules using the exact business column set (A..AH + payment
columns): 'GVW (kg)' cell is the string 'NA' for GVW-not-applicable classes, and Liability Only
rows report IDV/Sum Insured and OD Premium (incl. Add-ons) as 0. Uses a self-uploaded fixture."""
import csv
import io

from .conftest import login, upload_and_wait


def test_mis_csv_gvw_na_and_liability_zeros_in_exact_format():
    c = login("agt1001", "Agent@123")
    doc = upload_and_wait(c)
    assert doc["status"] != "processing", f"OCR did not finish in time: {doc}"
    pid = doc["id"]

    body = {
        "fields": {
            "lob": "Motor",
            "cover_type": "Liability Only",
            "vehicle_class": "Private Car",
            "ncb_percent": 20,
            "idv": 400000,
            "od_premium": 9000,
            "addon_premium": 1500,
            "tp_premium": 2222.5,
            "gvw": 9999,
            "policy_number": "tscheck-mis-001",
            "gross_premium": 2222.5,
        },
        "note": "tscheck-mis-export",
    }
    r = c.patch(f"/policies/{pid}", json=body)
    assert r.status_code == 200, r.text
    # auto-zero rules (Liability Only / Private Car) apply server-side
    patched_fields = r.json()["fields"]
    assert patched_fields["idv"] == 0, patched_fields
    assert patched_fields["od_premium"] == 0, patched_fields
    assert patched_fields["addon_premium"] == 0, patched_fields
    assert patched_fields["gvw"] is None, patched_fields

    resp = c.get("/mis/export", params={"format": "csv", "limit": 500})
    assert resp.status_code == 200, resp.text
    text = resp.content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    headers = rows[0]
    for col in ("GVW (kg)", "IDV /Sum Insured", "OD Premium (incl. Add-ons)"):
        assert col in headers, f"missing column {col} in {headers}"

    idx = {h: i for i, h in enumerate(headers)}
    target = next((row for row in rows[1:] if row[idx["Policy No"]] == "tscheck-mis-001"), None)
    assert target is not None, f"fixture row not found in export, rows={rows[:3]}"
    assert target[idx["GVW (kg)"]] == "NA", target
    assert target[idx["IDV /Sum Insured"]] in ("0", "0.0", ""), target
    assert target[idx["OD Premium (incl. Add-ons)"]] in ("0", "0.0", ""), target
    c.close()
