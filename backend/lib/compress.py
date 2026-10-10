"""Shrink uploaded policy documents for storage (target ≤ 100 KB). OCR always runs on the original."""

import io
import logging
import threading

import pymupdf as fitz
from PIL import Image

logger = logging.getLogger(__name__)

TARGET_BYTES = 100 * 1024
# (max image side px / render dpi, jpeg quality) tried in order until the file fits the target
IMAGE_STEPS = [(1800, 70), (1600, 55), (1400, 45), (1200, 38), (1000, 32), (850, 28), (700, 25)]
# 72 dpi greyscale is the readability floor — below it policy text becomes illegible, so long multi-page
# PDFs may stay above the 100 KB target (~40 KB per page)
PDF_STEPS = [(96, 50), (72, 35)]  # two raster attempts at most (CPU budget)


def _jpeg(img: Image.Image, max_side: int, quality: int) -> bytes:
    im = img.copy()
    im.thumbnail((max_side, max_side))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    return out.getvalue()


def _compress_image(data: bytes) -> bytes:
    img = Image.open(io.BytesIO(data))
    img = img.convert("L" if img.mode in ("L", "LA", "1") else "RGB")
    best = data
    for side, q in IMAGE_STEPS:
        out = _jpeg(img, side, q)
        if len(out) < len(best):
            best = out
        if len(out) <= TARGET_BYTES:
            break
    return best


def _raster_pdf(src: fitz.Document, dpi: int, quality: int) -> bytes:
    dst = fitz.open()
    for page in src:
        pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        img = pix.tobytes("jpeg", jpg_quality=quality)
        new = dst.new_page(width=page.rect.width, height=page.rect.height)
        new.insert_image(new.rect, stream=img)
    return dst.tobytes(garbage=4, deflate=True)


# production runs on a small CPU/memory budget: one compression at a time, bounded work per file
_ONE_AT_A_TIME = threading.Semaphore(1)
SUBSET_MAX_BYTES = 4 * 1024 * 1024
RASTER_MAX_PAGES = 12


def _compress_pdf(data: bytes) -> bytes:
    src = fitz.open(stream=data, filetype="pdf")
    if len(data) <= SUBSET_MAX_BYTES:
        try:  # embed only the glyphs actually used — big win on insurer-generated (text) PDFs, keeps text selectable
            src.subset_fonts()
        except Exception:
            logger.warning("Font subsetting skipped")
    best = src.tobytes(garbage=4, deflate=True, deflate_images=True, deflate_fonts=True, clean=True, use_objstms=1)
    best = best if len(best) < len(data) else data
    if len(best) <= TARGET_BYTES or src.page_count > RASTER_MAX_PAGES:
        return best
    for dpi, q in PDF_STEPS:  # rasterise to greyscale JPEG pages — keeps the policy readable, drops the bulk
        out = _raster_pdf(src, dpi, q)
        if len(out) < len(best):
            best = out
        if len(out) <= TARGET_BYTES:
            break
    return best


def compress_document(data: bytes, mime: str) -> tuple[bytes, str]:
    """Return (bytes, mime) of the smallest acceptable version; falls back to the original on any error."""
    with _ONE_AT_A_TIME:
        try:
            if mime == "application/pdf":
                return _compress_pdf(data), mime
            out = _compress_image(data)
            return (out, "image/jpeg") if out is not data else (data, mime)
        except Exception:
            logger.exception("Compression failed — storing original")
            return data, mime
