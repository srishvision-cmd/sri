"""Criterion: duplicate finder endpoint works.

GET /api/insurers/duplicates as admin returns 200 list; as anonymous 401.
"""
import httpx

from ._commission_helpers import admin_client
from .conftest import API_URL


def test_duplicates_admin_ok_anonymous_401():
    admin = admin_client()
    r = admin.get("/insurers/duplicates")
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)

    anon = httpx.Client(base_url=API_URL, timeout=30.0)
    r_anon = anon.get("/insurers/duplicates")
    assert r_anon.status_code == 401, r_anon.text
