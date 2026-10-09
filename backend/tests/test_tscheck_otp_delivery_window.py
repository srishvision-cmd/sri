"""OTP delivery: routers.portals._read_mailbox is monkeypatched (real IMAP boxes are unreachable from
tests — sanctioned deviation) so this file drives the app in-process via TestClient instead of the live
:8001 server, which is the only way to patch the function that actually serves /otp/messages.

Seeding/cleanup use a plain synchronous pymongo client (not the app's async motor client) so nothing here
competes with the event loop TestClient spins up internally for ASGI calls.

Covers:
  - a body-only OTP match (ICICI subject carries no "OTP" word) is delivered to the claimer, and a
    different user with no claim sees nothing.
  - the 3-minute pre-claim skew window: mail 150s before the claim is delivered, mail 240s before is not.

All fixtures (portal + otp_claims) are created by this file under a ZZ-tscheck id and removed after.
"""
import os
import uuid
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")  # lib.secretbox needs JWT_SECRET at import time

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

import lib.db as db_mod
from models.common import now_utc
from lib.secretbox import seal
import routers.portals as portals_mod
from server import app

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "app")

ICICI_SUBJECT = "Email Verification"
ICICI_BODY = ("Dear RAJA, Your OTP to verify your Email id for your IM-2372208-006 "
              "ICICI Lombard login is 442109. Please note this OTP is valid for 2 hrs.")


def _sync_db():
    return MongoClient(MONGO_URL)[DB_NAME]


def _fake_mail(received_at):
    return [{"uid": "1", "sender": "support@icicilombard.com", "subject": ICICI_SUBJECT, "body": ICICI_BODY, "received_at": received_at}]


def _mailbox_patch(received_at):
    async def _fake(d):
        return _fake_mail(received_at)
    return _fake


@pytest.fixture(autouse=True)
def _keep_shared_motor_client_alive(monkeypatch):
    """TestClient only keeps one event loop alive across requests inside a `with` block, but exiting
    that block runs FastAPI's shutdown lifespan, which calls lib.db.client.close() — the process-wide
    motor client every other test file in this suite also uses. No-op it just for this file's scope."""
    monkeypatch.setattr(type(db_mod.client), "close", lambda self: None)


def _new_test_client() -> TestClient:
    """Motor caches the event loop it first saw on db_mod.client (core.py AgnosticBaseProperties.io_loop);
    each TestClient `with` block runs its own loop, so the cached one must be dropped before reuse."""
    db_mod.client._io_loop = None
    return TestClient(app)


@pytest.fixture
def ctx():
    """ZZ test portal + a sync pymongo handle; cleans up its own portal/claims after the test."""
    sdb = _sync_db()
    pid = f"zz-tscheck-otp-{uuid.uuid4().hex[:8]}"
    insurer = f"ZZ-tscheck-{pid}"
    doc = {
        "id": pid, "insurer": insurer, "url": "https://example.com", "username": "u1",
        "password_enc": None, "otp_filters": ["icici otp"], "notes": None, "active": True,
        "all_agents": True, "agent_ids": [], "mailbox_host": "imap.gmail.com", "mailbox_port": 993,
        "mailbox_email": f"{pid}@gmail.com", "mailbox_password_enc": seal("app-password-x"),
        "updated_at": now_utc(),
    }
    sdb.insurer_portals.insert_one(dict(doc))
    qaagent = sdb.users.find_one({"username": "qaagent"}, {"_id": 0})
    assert qaagent, "seed user qaagent must exist (see test_credentials.md)"
    try:
        yield sdb, pid, insurer, qaagent
    finally:
        sdb.insurer_portals.delete_one({"id": pid})
        sdb.otp_claims.delete_many({"portal_id": pid})


def _insert_claim(sdb, portal_id, insurer, user, at):
    sdb.otp_claims.insert_one({"id": str(uuid.uuid4()), "portal_id": portal_id, "insurer": insurer,
                               "user_id": user["id"], "user_name": user["full_name"], "at": at,
                               "expires_at": at + timedelta(seconds=180)})


def test_body_only_otp_delivered_only_to_claimer(ctx, monkeypatch):
    sdb, pid, insurer, qaagent = ctx
    now = now_utc()
    _insert_claim(sdb, pid, insurer, qaagent, now - timedelta(seconds=30))
    monkeypatch.setattr(portals_mod, "_read_mailbox", _mailbox_patch(now - timedelta(seconds=10)))

    # `with` keeps one event loop alive across the whole block; _keep_shared_motor_client_alive
    # above no-ops the shutdown hook this triggers so it doesn't kill the shared motor client.
    with _new_test_client() as client:
        r = client.post("/api/auth/login", json={"username": "qaagent", "password": "QaAgent@123"})
        assert r.status_code == 200, r.text
        feed = client.get("/api/otp/messages").json()
        msgs = [m for m in feed["messages"] if m["portal_id"] == pid]
        assert len(msgs) == 1, feed
        assert msgs[0]["otp"] == "442109", msgs[0]
        client.post("/api/auth/logout")

        r2 = client.post("/api/auth/login", json={"username": "kumararaja", "password": "Raja@1985"})
        assert r2.status_code == 200, r2.text
        feed2 = client.get("/api/otp/messages").json()
        assert not [m for m in feed2["messages"] if m["portal_id"] == pid], feed2


def test_pre_claim_skew_window(ctx, monkeypatch):
    sdb, pid, insurer, qaagent = ctx
    claim_at = now_utc()
    _insert_claim(sdb, pid, insurer, qaagent, claim_at)

    # mail 150s BEFORE the claim -> within the 180s skew, should be delivered
    monkeypatch.setattr(portals_mod, "_read_mailbox", _mailbox_patch(claim_at - timedelta(seconds=150)))
    with _new_test_client() as client:
        r = client.post("/api/auth/login", json={"username": "qaagent", "password": "QaAgent@123"})
        assert r.status_code == 200, r.text
        feed = client.get("/api/otp/messages").json()
        msgs = [m for m in feed["messages"] if m["portal_id"] == pid]
        assert len(msgs) == 1, feed
        assert msgs[0]["otp"] == "442109"

    # mail 240s BEFORE a fresh claim -> outside the 180s skew, should NOT be delivered
    sdb.otp_claims.delete_many({"portal_id": pid})
    claim_at2 = now_utc()
    _insert_claim(sdb, pid, insurer, qaagent, claim_at2)
    monkeypatch.setattr(portals_mod, "_read_mailbox", _mailbox_patch(claim_at2 - timedelta(seconds=240)))
    with _new_test_client() as client2:
        r = client2.post("/api/auth/login", json={"username": "qaagent", "password": "QaAgent@123"})
        assert r.status_code == 200, r.text
        feed = client2.get("/api/otp/messages").json()
        msgs = [m for m in feed["messages"] if m["portal_id"] == pid]
        assert len(msgs) == 0, feed
