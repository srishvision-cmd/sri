"""Criterion: Agent grouping — PUT /api/agent-groups/{id}/members sets exact membership and
is reflected in GET /api/users agent_group field."""
from ._commission_helpers import admin_client, create_agent, create_group, delete_group, delete_user, uniq


def test_set_group_members_updates_membership():
    admin = admin_client()
    group = create_group(admin, uniq("grp")[:40])
    agent1 = create_agent(admin)
    agent2 = create_agent(admin)
    try:
        r = admin.put(f"/agent-groups/{group['id']}/members", json={"agent_ids": [agent1["id"], agent2["id"]]})
        assert r.status_code == 200, r.text
        assert r.json()["members"] == 2

        users = admin.get("/users").json()
        a1 = next(u for u in users if u["id"] == agent1["id"])
        a2 = next(u for u in users if u["id"] == agent2["id"])
        assert a1["agent_group"] == group["name"], a1
        assert a2["agent_group"] == group["name"], a2

        # now shrink membership to just agent1 -> agent2 should leave the group
        r2 = admin.put(f"/agent-groups/{group['id']}/members", json={"agent_ids": [agent1["id"]]})
        assert r2.status_code == 200, r2.text
        assert r2.json()["members"] == 1
        users2 = admin.get("/users").json()
        a2_after = next(u for u in users2 if u["id"] == agent2["id"])
        assert a2_after["agent_group"] is None, a2_after
    finally:
        delete_user(agent1["username"])
        delete_user(agent2["username"])
        delete_group(group["id"])
