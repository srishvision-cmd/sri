"""Role-based login criterion: valid creds -> session cookie + /auth/me; wrong password rejected."""
import httpx

from .conftest import API_URL


def test_login_valid_admin_sets_cookie_and_me(client):
    resp = client.post("/auth/login", json={"username": "admin", "password": "Admin@123"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["username"] == "admin"
    assert body["role"] == "admin"
    assert "mis_session" in resp.cookies

    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["role"] == "admin"


def test_login_wrong_password_rejected():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        resp = c.post("/auth/login", json={"username": "admin", "password": "WrongPass@999"})
        assert resp.status_code in (401, 400), resp.text
        # no session cookie should be issued
        assert "mis_session" not in resp.cookies


def test_agent_role_forbidden_from_users_endpoint():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        login = c.post("/auth/login", json={"username": "agt1001", "password": "Agent@123"})
        assert login.status_code == 200
        resp = c.get("/users")
        assert resp.status_code == 403, resp.text
