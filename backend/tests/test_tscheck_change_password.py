"""Change-password criterion: wrong current -> 400; weak new (no digit) -> 400; valid -> 200
and must_change_password flips to false. Restores kumararaja's password + must_change_password
flag directly in Mongo afterwards so the seeded admin account is left exactly as found.
"""
import sys

import httpx
import pytest

from .conftest import API_URL

sys.path.insert(0, "/app/backend")
from lib.auth import hash_password  # noqa: E402

try:
    from pymongo import MongoClient

    _DB = MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=3000)["app"]
except Exception:  # pragma: no cover
    _DB = None


@pytest.fixture
def admin_client_and_restore():
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": "kumararaja", "password": "Raja@1985"})
    assert r.status_code == 200, r.text
    try:
        yield c
    finally:
        # always restore original credentials/flag regardless of test outcome
        _DB.users.update_one(
            {"username": "kumararaja"},
            {"$set": {"password_hash": hash_password("Raja@1985"), "must_change_password": True}},
        )
        c.close()


def test_change_password_wrong_current_rejected(admin_client_and_restore):
    c = admin_client_and_restore
    r = c.post("/auth/change-password", json={"current_password": "NotTheRealOne@1", "new_password": "Whatever@12"})
    assert r.status_code == 400, r.text


def test_change_password_weak_no_digit_rejected(admin_client_and_restore):
    c = admin_client_and_restore
    r = c.post("/auth/change-password", json={"current_password": "Raja@1985", "new_password": "NoDigitsHere"})
    assert r.status_code == 400, r.text


def test_change_password_valid_succeeds_and_clears_flag(admin_client_and_restore):
    c = admin_client_and_restore
    new_pw = "Tscheck@2026"
    r = c.post("/auth/change-password", json={"current_password": "Raja@1985", "new_password": new_pw})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["must_change_password"] is False

    # confirm the new password actually works for a fresh login
    with httpx.Client(base_url=API_URL, timeout=30.0) as c2:
        r2 = c2.post("/auth/login", json={"username": "kumararaja", "password": new_pw})
        assert r2.status_code == 200, r2.text
        assert r2.json()["must_change_password"] is False
