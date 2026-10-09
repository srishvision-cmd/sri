"""PUT /api/portals/{id} sanitises mailbox_host via clean_host for a non-gmail email.

Creates & deletes its own ZZ-prefixed test portal as admin; never touches real portals.
"""
import uuid

from .conftest import login


def test_update_portal_sanitises_mailbox_host():
    c = login("kumararaja", "Raja@1985")
    try:
        name = f"ZZ-tscheck-mailboxhost-{uuid.uuid4().hex[:8]}"
        r = c.post("/portals", json={"insurer": name, "url": "https://example.com", "username": "u1", "password": "p1"})
        assert r.status_code == 200, r.text
        portal_id = r.json()["id"]
        try:
            r2 = c.put(f"/portals/{portal_id}", json={
                "insurer": name, "url": "https://example.com", "username": "u1",
                "mailbox_host": "imap.gmail.com/https://glory.herosite.pro",
                "mailbox_email": "a@protech.in", "mailbox_password": "pw12345",
            })
            assert r2.status_code == 200, r2.text
            assert r2.json()["mailbox_host"] == "glory.herosite.pro", r2.json()
        finally:
            d = c.delete(f"/portals/{portal_id}")
            assert d.status_code == 200, d.text
    finally:
        c.close()
