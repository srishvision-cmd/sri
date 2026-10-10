"""Criterion: GCV 'Auto Secure' policies are not 3-wheelers; pure unit coverage of
models.policy.product_category() for the Auto Secure Goods / Passenger Carrying cases
from the user's bug report, plus derive_fields() full pipeline for a new upload.

(models.policy is a pure data-model module with no app/DB wiring — importing the
function under test here is the intended way to unit-test it; the live-data criteria
are covered separately via the real API in test_tscheck_school_bus_category.py.)
"""
from models.policy import derive_fields, product_category


def test_gcv_auto_secure_production_only_is_gcv():
    f = {"vehicle_class": "Goods Carrying", "model": "ACE GOLD", "gvw": 1615}
    hint = "Auto Secure - Commercial Vehicle Package Policy - Goods Carrying Vehicle"
    assert product_category(f, hint, True) == "GCV"


def test_gcv_three_wheeler_goods_carrying():
    f = {"vehicle_class": "Goods Carrying", "model": "APE XTRA", "gvw": 975}
    hint = "Goods carrying three wheeler"
    assert product_category(f, hint, True) == "GCV - 3W Goods Carrying"


def test_gcv_other_than_three_wheelers_hint_is_gcv():
    f = {"vehicle_class": "Goods Carrying", "model": "LPT 1613", "gvw": 16200}
    hint = "Auto Secure - Commercial Vehicle Package Policy - Goods Carrying Vehicle, other than three wheelers"
    assert product_category(f, hint, True) == "GCV"


def test_pcv_three_wheeler_auto():
    f = {"vehicle_class": "Passenger Carrying", "model": "APE CITY", "seating_capacity": 3}
    hint = "Auto Secure - Commercial Vehicle Package Policy - Passenger Carrying Vehicle"
    assert product_category(f, hint, True) == "PCV - 3W Auto"


def test_new_upload_bus_derives_school_bus():
    f = {
        "lob": "Motor",
        "vehicle_class": "Passenger Carrying",
        "product_name": "Auto Secure - Commercial Vehicle Package Policy - Passenger Carrying Vehicle",
        "model": "X/Closed/BUS",
        "seating_capacity": 40,
        "insured_name": "ABC Matric Hr Sec School",
    }
    derived = derive_fields(f)
    assert derived["product_category"] == "PCV - School Bus", derived["product_category"]
