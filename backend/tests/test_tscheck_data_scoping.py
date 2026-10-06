"""Data scoping criterion: agt1001 sees only own policies; bo2001 (team-mapped to agt1002) sees
AGT1001+AGT1002 but not AGT1003; agt1003 gets 404 fetching another agent's policy; admin sees all."""
import httpx

from .conftest import API_URL


def _login(username, password):
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_agent_sees_only_own_policies():
    c = _login("agt1001", "Agent@123")
    resp = c.get("/policies", params={"limit": 100})
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) > 0
    for p in items:
        assert p["agent_code"] == "AGT1001", p
    c.close()


def test_backoffice_sees_mapped_agents_not_others():
    c = _login("bo2001", "Back@123")
    resp = c.get("/policies", params={"limit": 200})
    assert resp.status_code == 200, resp.text
    items = resp.json()
    agent_codes = {p["agent_code"] for p in items}
    assert "AGT1001" in agent_codes
    assert "AGT1002" in agent_codes
    assert "AGT1003" not in agent_codes
    c.close()


def test_agent_gets_404_on_other_agents_policy():
    c3 = _login("agt1003", "Agent@123")
    other_resp = c3.get("/policies", params={"limit": 1})
    assert other_resp.status_code == 200
    other_items = other_resp.json()
    assert len(other_items) > 0
    other_policy_id = other_items[0]["id"]
    c3.close()

    c1 = _login("agt1001", "Agent@123")
    resp = c1.get(f"/policies/{other_policy_id}")
    assert resp.status_code == 404, resp.text
    c1.close()


def test_admin_sees_all_agents():
    c = _login("admin", "Admin@123")
    resp = c.get("/policies", params={"limit": 200})
    assert resp.status_code == 200, resp.text
    items = resp.json()
    agent_codes = {p["agent_code"] for p in items}
    assert {"AGT1001", "AGT1002", "AGT1003"}.issubset(agent_codes)
    c.close()
