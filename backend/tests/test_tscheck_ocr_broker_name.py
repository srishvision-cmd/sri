"""OCR captures the Broker/Agent/POS name: field intermediary_name is populated from the
sample policy document and approximates 'Shield Insurance Brokers Pvt Ltd'."""
from .conftest import login, upload_and_wait


def test_ocr_extracts_intermediary_name():
    c = login("agt1001", "Agent@123")
    doc = upload_and_wait(c)
    assert doc["status"] == "extracted", doc
    name = doc["fields"].get("intermediary_name") or ""
    assert "shield" in name.lower() and "insurance" in name.lower() and "brokers" in name.lower(), name
    c.close()
