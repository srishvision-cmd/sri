"""Admin onboarding criterion: admin creates an agent user -> gets generated username/password
that the new user can log in with. Non-admin roles get 403 on GET/POST /users."""
import uuid

import httpx

from .conftest import API_URL


def _admin_client():
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": "admin", "password": "Admin@123"})
    assert r.status_code == 200, r.text
    return c


def test_admin_onboards_agent_and_new_user_can_login():
    c = _admin_client()
    unique = uuid.uuid4().hex[:6]
    full_name = f"tscheck-onboard-{unique}"
    resp = c.post(
        "/users",
        json={"full_name": full_name, "branch": "Mumbai", "role": "agent"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # credentials returned once
    username = body.get("username") or body.get("user", {}).get("username")
    password = body.get("password") or body.get("temp_password")
    assert username, body
    assert password, body
    assert username.lower().startswith("agt")

    # new user can log in with generated creds
    c2 = httpx.Client(base_url=API_URL, timeout=30.0)
    login = c2.post("/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    assert login.json()["role"] == "agent"
    c2.close()
    c.close()


def test_backoffice_role_forbidden_from_users_post():
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": "bo2001", "password": "Back@123"})
    assert r.status_code == 200
    resp = c.post("/users", json={"full_name": "tscheck-nope", "branch": "Mumbai", "role": "agent"})
    assert resp.status_code == 403, resp.text
    get_resp = c.get("/users")
    assert get_resp.status_code == 403, get_resp.text
    c.close()
