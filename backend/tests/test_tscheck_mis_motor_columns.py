"""MIS export reflects the motor rules: headers include 'Cover Type', 'Vehicle Class',
'Add-on Premium' and 'GVW (kg)'; GVW cell is the string 'NA' for GVW-not-applicable classes
and Liability Only rows report IDV/OD/NCB/Add-on as 0. Uses a self-uploaded fixture policy."""
import csv
import io

from .conftest import login, upload_and_wait


def test_mis_csv_has_motor_columns_and_na_gvw_and_liability_zeros():
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

    resp = c.get("/mis/export", params={"format": "csv", "limit": 500})
    assert resp.status_code == 200, resp.text
    text = resp.content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    headers = rows[0]
    for col in ("Cover Type", "Vehicle Class", "Add-on Premium", "GVW (kg)"):
        assert col in headers, f"missing column {col} in {headers}"

    idx = {h: i for i, h in enumerate(headers)}
    target = next((row for row in rows[1:] if row[idx["Policy No"]] == "tscheck-mis-001"), None)
    assert target is not None, f"fixture row not found in export, rows={rows[:3]}"
    assert target[idx["GVW (kg)"]] == "NA"
    assert target[idx["Add-on Premium"]] in ("0", "0.0")
    assert target[idx["IDV"]] in ("0", "0.0")
    assert target[idx["NCB %"]] in ("0", "0.0")
    c.close()
