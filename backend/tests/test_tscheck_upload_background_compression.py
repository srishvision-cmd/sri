"""Criterion: upload stores the file immediately and returns fast; compression runs later in the
background (one file at a time). This verifies:
  1. POST /api/policies/upload with a real multi-page PDF (~1.5-3MB, embedded images) returns 200
     quickly (well under 5s) — i.e. compression is NOT happening inline.
  2. ~30s later, GET /api/policies/{id} shows file_size well below original_size (background
     compression shrank the stored copy).
  3. GET /api/policies/{id}/file still returns 200 with a PDF for the (now-compressed) policy.
  4. Cleanup: the created policy/agent/broker are deleted.
"""
import io
import os
import time

from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from ._commission_helpers import admin_client, create_agent, create_broker, delete_broker, delete_policy, delete_user

PDF_PATH = "/tmp/tscheck_bgcompress_sample.pdf"


def _make_multipage_pdf_with_images(path: str, pages: int = 2) -> int:
    c = canvas.Canvas(path, pagesize=A4)
    page_w, page_h = A4
    for p in range(pages):
        img = Image.new("RGB", (1000, 1300))
        img.frombytes(bytes((b * 37 + p * 11) % 256 for b in range(1000 * 1300 * 3)))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        buf.seek(0)
        c.drawImage(ImageReader(buf), 0, 0, width=page_w, height=page_h)
        c.drawString(40, 20, f"tscheck bg-compress page {p + 1}/{pages}")
        c.showPage()
    c.save()
    return os.path.getsize(path)


def test_background_compression_shrinks_stored_file_and_file_still_opens():
    admin = admin_client()
    broker = create_broker(admin)
    agent = create_agent(admin, broker_id=broker["id"])
    policy_id = None
    try:
        original_size = _make_multipage_pdf_with_images(PDF_PATH)
        assert 1.3 * 1024 * 1024 < original_size < 4 * 1024 * 1024, original_size

        with open(PDF_PATH, "rb") as fh:
            t0 = time.monotonic()
            resp = admin.post(
                "/policies/upload",
                files={"file": ("tscheck_bgcompress_sample.pdf", fh, "application/pdf")},
                data={
                    "agent_id": agent["id"],
                    "broker_id": broker["id"],
                    "payment_mode": "Cash",
                    "broker_payment_mode": "Cash",
                },
            )
            elapsed = time.monotonic() - t0
        assert resp.status_code == 200, resp.text
        assert elapsed < 5, f"upload took {elapsed:.2f}s — should return fast, compression must be backgrounded"
        body = resp.json()
        policy_id = body["id"]
        assert body["original_size"] == original_size, body
        # at response time, stored file_size == original (compression hasn't run inline)
        assert body["file_size"] == original_size, body

        # poll up to ~45s for the background compression to shrink file_size
        shrunk = False
        deadline = time.monotonic() + 45
        last_size = body["file_size"]
        while time.monotonic() < deadline:
            time.sleep(3)
            g = admin.get(f"/policies/{policy_id}")
            assert g.status_code == 200, g.text
            last_size = g.json()["file_size"]
            if last_size < original_size * 0.9:
                shrunk = True
                break
        assert shrunk, f"file_size ({last_size}) never shrank well below original_size ({original_size}) within 45s"

        # stored file still opens after compression swapped it in
        f = admin.get(f"/policies/{policy_id}/file")
        assert f.status_code == 200, f.text
        ctype = f.headers.get("content-type", "")
        assert "pdf" in ctype.lower() or f.content[:4] == b"%PDF", (ctype, f.content[:16])
    finally:
        if policy_id:
            delete_policy(policy_id)
        delete_user(agent["username"])
        delete_broker(broker["id"])
        if os.path.exists(PDF_PATH):
            os.remove(PDF_PATH)
