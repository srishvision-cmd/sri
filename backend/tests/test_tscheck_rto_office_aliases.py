"""Criterion: RTO office-name aliases for Thenkasi / Kanniyakumari / Marthandam resolve to the
correct TN codes (TN76 / TN74 / TN75 respectively) via models.rto.rto_code()."""
from models.rto import rto_code


def test_rto_office_name_aliases():
    assert rto_code("Thenkasi") == "TN76"
    assert rto_code("THENKASI") == "TN76"
    assert rto_code("Kanniyakumari") == "TN74"
    assert rto_code("Kanyakumari") == "TN74"
    assert rto_code("MARTHANDAM") == "TN75"
    assert rto_code("Marthandam") == "TN75"
