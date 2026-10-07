"""Criterion: broker name regex is escaped — a broker named 'A.*' must not act as a regex
wildcard when checking duplicates. Creating 'A.*' then 'ABC' must both succeed (200); creating
'A.*' again must 409 (exact duplicate, case-insensitive). Fixture brokers are deleted from
Mongo `brokers` in a finally block.
"""
import httpx

from ._commission_helpers import DB, admin_client


def test_broker_name_regex_is_escaped_not_interpreted():
    admin = admin_client()
    created_ids = []
    try:
        r1 = admin.post("/brokers", json={"name": "A.*"})
        assert r1.status_code == 200, r1.text
        created_ids.append(r1.json()["id"])

        # 'ABC' would incorrectly match the literal regex /^A.*$/ if not escaped -> must succeed
        r2 = admin.post("/brokers", json={"name": "ABC"})
        assert r2.status_code == 200, r2.text
        created_ids.append(r2.json()["id"])

        # exact duplicate name must be rejected
        r3 = admin.post("/brokers", json={"name": "A.*"})
        assert r3.status_code == 409, r3.text
    finally:
        if DB is not None:
            for bid in created_ids:
                DB.brokers.delete_one({"id": bid})
