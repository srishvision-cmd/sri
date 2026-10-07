"""Criterion: login brute-force guard — 10 failed attempts (401) then 11th -> 429, per
username+IP, in-memory. Uses a throwaway nonexistent username so the real admin is never
locked out. Also confirms the real admin can still log in afterwards.
"""
import time

import httpx

from .conftest import API_URL


def test_bruteforce_guard_locks_after_ten_failures():
    username = f"nosuchuser-{int(time.time())}"
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        statuses = []
        for _ in range(10):
            r = c.post("/auth/login", json={"username": username, "password": "wrong-pass-1"})
            statuses.append(r.status_code)
        assert statuses == [401] * 10, statuses

        r11 = c.post("/auth/login", json={"username": username, "password": "wrong-pass-1"})
        assert r11.status_code == 429, r11.text
        assert "too many" in r11.json()["detail"].lower()


def test_admin_login_still_works_after_other_lockout():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        r = c.post("/auth/login", json={"username": "kumararaja", "password": "Raja@1985"})
        assert r.status_code == 200, r.text
        assert r.json()["username"] == "kumararaja"
