"""Health endpoint for production probes: both /health (root) and /api/health respond 200
{"status": "ok"} quickly, independent of OCR load."""
import time

import httpx

from .conftest import BACKEND_URL, api_url


def test_api_health_ok_and_fast():
    with httpx.Client(timeout=10.0) as c:
        t0 = time.time()
        r = c.get(api_url("/health"))
        elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok"}
    assert elapsed < 5.0, f"api/health took {elapsed}s"


def test_root_health_ok_and_fast():
    with httpx.Client(timeout=10.0) as c:
        t0 = time.time()
        r = c.get(f"{BACKEND_URL}/health")
        elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok"}
    assert elapsed < 5.0, f"/health took {elapsed}s"
