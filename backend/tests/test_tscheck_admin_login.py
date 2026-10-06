"""Admin login criterion: kumararaja/Raja@1985 logs in with 200 and must_change_password=true
(drives the forced 'Set your own password' dialog in the UI)."""
import httpx

from .conftest import API_URL


def test_admin_login_returns_must_change_password_true():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        r = c.post("/auth/login", json={"username": "kumararaja", "password": "Raja@1985"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["username"] == "kumararaja"
        assert body["role"] == "admin"
        assert body["must_change_password"] is True
        assert "mis_session" in r.cookies


def test_admin_login_wrong_password_rejected():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        r = c.post("/auth/login", json={"username": "kumararaja", "password": "WrongPass@999"})
        assert r.status_code in (400, 401), r.text
        assert "mis_session" not in r.cookies
