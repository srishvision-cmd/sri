"""Pre-scaffolded pytest fixtures for the FastAPI backend.

Tests hit the live uvicorn process managed by supervisor (not an in-process ASGI app), so
the app under test is the same one the frontend and Playwright see. Do NOT re-create this
file — add app-specific fixtures below the marker at the bottom.
"""

import os

import httpx
import pytest
import pytest_asyncio

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
API_URL = f"{BACKEND_URL}/api"


def api_url(path: str = "") -> str:
    """Absolute URL for an /api route: api_url("/status") -> http://localhost:8001/api/status."""
    return f"{API_URL}{path}"


@pytest.fixture(scope="session")
def backend_url() -> str:
    return BACKEND_URL


@pytest.fixture
def client():
    """Sync httpx client rooted at /api — the default for endpoint tests.

    Example:
        def test_status(client):
            assert client.get("/status").status_code == 200
    """
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        yield c


@pytest_asyncio.fixture
async def aclient():
    """Async variant, for tests that also await motor/backend helpers directly."""
    async with httpx.AsyncClient(base_url=API_URL, timeout=30.0) as c:
        yield c


# --- app-specific fixtures below this line ---

import time


def login(username: str, password: str) -> httpx.Client:
    c = httpx.Client(base_url=API_URL, timeout=30.0)
    r = c.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def upload_and_wait(
    c: httpx.Client,
    path: str = "/tmp/sample_policy.png",
    timeout: float = 110.0,
    payment_mode: str = "Cash",
    amount_paid: float | None = None,
) -> dict:
    """Upload a sample doc and poll until OCR leaves 'processing'. Returns the policy dict."""
    data = {"payment_mode": payment_mode}
    if amount_paid is not None:
        data["amount_paid"] = amount_paid
    with open(path, "rb") as fh:
        r = c.post("/policies/upload", files={"file": ("sample.png", fh, "image/png")}, data=data)
    assert r.status_code == 200, r.text
    policy_id = r.json()["id"]
    deadline = time.time() + timeout
    doc = r.json()
    while time.time() < deadline:
        doc = c.get(f"/policies/{policy_id}").json()
        if doc["status"] != "processing":
            return doc
        time.sleep(3)
    return doc
