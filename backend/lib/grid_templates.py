"""Saved AI grid layouts: what the admin approved for a company's grid is remembered and fed back to the AI next time."""
import uuid
from collections import Counter
from typing import Optional

from lib.commission import _words, insurer_matches
from lib.db import db
from models.commission import AiGridRow, GridCorrection, GridTemplate, GridUploadStat
from models.common import now_utc
from models.user import User

MAX_EXAMPLES, MAX_CORRECTIONS = 12, 40
# fields whose AI-vs-approved differences are worth teaching (rates are file-specific, so they are not "corrections")
LEARN_FIELDS = ("ptype", "products", "vehicle_ages", "makes", "model", "fuel_types", "business_types", "rtos",
                "gvw_min", "gvw_max", "cc_min", "cc_max", "seating_min", "seating_max", "ncb", "cover", "insurer")
RATE_FIELDS = ("od_percent", "tp_percent", "net_percent", "odtp_percent", "flat_amount")


def _txt(v) -> str:
    return "" if v is None else str(v).strip()


async def find_template(kind: str, insurer: Optional[str], file_name: str) -> Optional[dict]:
    """Picked company first; else a company whose name / keywords appear in the file name (e.g. 'national_cv_oct.pdf')."""
    docs = await db.grid_templates.find({"kind": kind}, {"_id": 0}).to_list(500)
    if insurer:
        return next((d for d in docs if d["insurer"] == insurer), None)
    name = _words(file_name)
    return next((d for d in docs if insurer_matches(d["insurer"], name) or _first_word(d["insurer"]) in name.split()), None)


GENERIC = {"india", "general", "insurance", "company", "limited", "health", "the", "new", "life"}


def _first_word(insurer: str) -> str:
    """'National Insurance' → 'national' (so 'National_CV_Grid.pdf' finds it); generic first words never match."""
    w = (_words(insurer).split() or [""])[0]
    return w if len(w) >= 4 and w not in GENERIC else "\0"


def prompt_block(t: dict) -> str:
    """Extra prompt text: admin notes, learned corrections, approved example rows."""
    parts = [f"SAVED LAYOUT for {t['insurer']} grids (learned from {t.get('uses', 0)} approved upload(s)) — follow it:"]
    if t.get("notes"):
        parts.append(f"Admin notes: {t['notes']}")
    fixes = sorted(t.get("corrections") or [], key=lambda c: -c.get("count", 1))[:25]
    if fixes:
        parts.append("Past corrections (you read → admin approved; apply the same mapping):")
        parts += [f"- {c['field']}: '{c['ai_value'] or 'blank'}' → '{c['approved_value'] or 'blank'}'" for c in fixes]
    if t.get("examples"):
        parts.append("Approved rows from a previous grid of this company (format / labels to copy, NOT the rates):")
        for e in t["examples"][:MAX_EXAMPLES]:
            row = {k: v for k, v in e.items() if v not in (None, "", False) and k not in ("needs_review", "review_note", *RATE_FIELDS)}
            parts.append(str(row))
    return "\n".join(parts)


def _corrections(original: list[AiGridRow], approved: list[AiGridRow]) -> list[tuple[str, str, str]]:
    out = []
    for o, a in zip(original, approved):
        for f in LEARN_FIELDS:
            ov, av = _txt(getattr(o, f)), _txt(getattr(a, f))
            if ov != av and ov:  # only real mis-reads; values the admin added on a blank cell are file-specific
                out.append((f, ov[:120], av[:120]))
    return out


CHECK_FIELDS = (*LEARN_FIELDS, *RATE_FIELDS, "valid_from", "valid_to")


def upload_stat(original: list[AiGridRow], approved: list[AiGridRow], file_name: Optional[str], used_layout: bool) -> GridUploadStat:
    """Every cell of every approved row is compared with what the AI read (blank → value counts as a correction too)."""
    corrected, rows_fixed = 0, 0
    pairs = list(zip(original, approved))
    for o, a in pairs:
        n = sum(1 for f in CHECK_FIELDS if _txt(getattr(o, f)) != _txt(getattr(a, f)))
        corrected += n
        rows_fixed += int(n > 0)
    checked = len(pairs) * len(CHECK_FIELDS)
    return GridUploadStat(at=now_utc(), file=file_name, rows=len(pairs), cells_checked=checked, cells_corrected=corrected, rows_corrected=rows_fixed,
                          accuracy=round(100 * (checked - corrected) / checked, 1) if checked else 100.0, used_layout=used_layout)


def _examples(approved: list[AiGridRow], old: list[dict]) -> list[dict]:
    """Keep a varied sample: one row per (product type, products, age) shape, newest first."""
    seen, out = set(), []
    for r in [*(x.model_dump() for x in approved), *old]:
        sig = (r.get("ptype"), r.get("products"), r.get("vehicle_ages"), r.get("cover"), r.get("gvw_max"))
        if sig not in seen:
            seen.add(sig)
            out.append({k: v for k, v in r.items() if k not in ("needs_review", "review_note")})
        if len(out) >= MAX_EXAMPLES:
            break
    return out


async def learn(kind: str, insurer: Optional[str], approved: list[AiGridRow], original: list[AiGridRow], file_name: Optional[str], user: User,
                used_layout: bool = False) -> tuple[Optional[str], Optional[float]]:
    """After Approve & save: merge the admin's corrections + approved rows into the company's layout and log the upload's
    accuracy. Returns (company, accuracy %)."""
    insurer = insurer or (Counter(r.insurer for r in approved if r.insurer).most_common(1) or [(None, 0)])[0][0]
    if not insurer or not approved:
        return None, None
    t = await db.grid_templates.find_one({"kind": kind, "insurer": insurer}, {"_id": 0}) or {}
    stat = upload_stat(original, approved, file_name, used_layout) if original else None
    fixes = {(c["field"], c["ai_value"], c["approved_value"]): c for c in t.get("corrections") or []}
    for key in _corrections(original, approved):
        fixes.setdefault(key, {"field": key[0], "ai_value": key[1], "approved_value": key[2], "count": 0})["count"] += 1
    for (f, ai, ok), c in list(fixes.items()):  # the opposite correction wins over an older one
        if (f, ok, ai) in fixes and fixes[(f, ok, ai)]["count"] >= c["count"] and c is not fixes[(f, ok, ai)]:
            fixes.pop((f, ai, ok), None)
    corrections = sorted(fixes.values(), key=lambda c: -c["count"])[:MAX_CORRECTIONS]
    doc = GridTemplate(id=t.get("id") or str(uuid.uuid4()), insurer=insurer, kind=kind, notes=t.get("notes", ""),
                       corrections=[GridCorrection(**c) for c in corrections], examples=_examples(approved, t.get("examples") or []),
                       uploads=[*(t.get("uploads") or []), *([stat.model_dump()] if stat else [])][-30:],
                       uses=t.get("uses", 0) + 1, last_file=file_name, updated_at=now_utc(), updated_by=user.full_name)
    await db.grid_templates.update_one({"kind": kind, "insurer": insurer}, {"$set": doc.model_dump()}, upsert=True)
    return insurer, stat.accuracy if stat else None
