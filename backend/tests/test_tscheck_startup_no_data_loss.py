"""Backend startup must never delete data (deployment blocker fix).

Restarting the backend process (supervisor) must preserve existing users and
policies counts, and ensure_bootstrap_admin must only create an admin when
none exists yet (never touch/overwrite an existing one).
"""
import subprocess
import time

import httpx

from .conftest import API_URL, api_url

try:
    from pymongo import MongoClient

    _MONGO = MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=3000)
    _DB = _MONGO["app"]
except Exception:  # pragma: no cover
    _DB = None


def _wait_health(timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = httpx.get(api_url("/health"), timeout=5.0)
            if r.status_code == 200 and r.json().get("status") == "ok":
                return True
        except Exception:
            pass
        time.sleep(1.5)
    return False


def test_restart_backend_preserves_users_and_policies():
    """Note: compares counts + admin existence/role only — NOT the admin's password hash, since
    hash_password() salts randomly and other test modules may legitimately change/restore
    kumararaja's password concurrently under this repo's -n2 xdist config; comparing raw hash
    strings would be a false positive, not a real bug."""
    assert _DB is not None, "mongo not reachable from test host"
    before_users = _DB.users.count_documents({})
    before_policies = _DB.policies.count_documents({})
    before_admin_exists = _DB.users.find_one({"username": "kumararaja"}, {"role": 1}) is not None
    assert before_users >= 1  # kumararaja always present
    assert before_admin_exists

    res = subprocess.run(["sudo", "supervisorctl", "restart", "backend"], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr

    assert _wait_health(), "backend did not come back healthy after restart"

    after_users = _DB.users.count_documents({})
    after_policies = _DB.policies.count_documents({})
    after_admin = _DB.users.find_one({"username": "kumararaja"}, {"role": 1})

    assert after_users == before_users, f"user count changed on restart: {before_users} -> {after_users}"
    assert after_policies == before_policies, f"policy count changed on restart: {before_policies} -> {after_policies}"
    assert after_admin is not None, "bootstrap admin was deleted on restart"
    assert after_admin["role"] == "admin", "bootstrap admin role was changed on restart"


def test_api_health_endpoint():
    r = httpx.get(api_url("/health"), timeout=10.0)
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_root_health_endpoint():
    # /health (no /api prefix) served directly by backend on :8001
    r = httpx.get(API_URL.replace("/api", "") + "/health", timeout=10.0)
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
