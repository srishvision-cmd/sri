"""Insurer portal logins for agents + OTP mails read from Srishvision's mailbox (IMAP), filtered to insurer OTPs only."""
import asyncio
import email
import imaplib
import re
import time
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime
from html import unescape
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import current_user, require_roles
from lib.db import db
from lib.secretbox import seal, unseal
from models.common import now_utc
from models.portal import MailboxIn, MailboxSettings, MailboxTest, OtpMessage, Portal, PortalIn, PortalSecret, PortalView
from models.user import User

router = APIRouter(tags=["portals"])
admin_only = require_roles("admin")
OTP_WINDOW_MIN = 15
MAILBOX_KEY = "otp_mailbox"


def _portal(d: dict) -> Portal:
    return Portal(**{**d, "has_password": bool(d.get("password_enc"))})


def _scope(user: User) -> dict:
    """Portals this user may see: admin all; backoffice active; agent active + (all agents or chosen)."""
    if user.role == "admin":
        return {}
    if user.role == "agent":
        return {"active": True, "$or": [{"all_agents": {"$ne": False}}, {"agent_ids": user.id}]}
    return {"active": True}


def _filters(raw: List[str]) -> List[str]:
    return [f.strip().lower() for f in raw if f and f.strip()][:20]


@router.get("/portals", response_model=List[Portal])
async def list_portals(user: User = Depends(current_user)):
    return [_portal(d) for d in await db.insurer_portals.find(_scope(user), {"_id": 0}).sort("insurer", 1).to_list(500)]


@router.post("/portals", response_model=Portal)
async def create_portal(body: PortalIn, _: User = Depends(admin_only)):
    import uuid

    doc = {**body.model_dump(exclude={"password"}), "id": str(uuid.uuid4()), "otp_filters": _filters(body.otp_filters), "agent_ids": list(dict.fromkeys(body.agent_ids)),
           "password_enc": seal(body.password) if body.password else None, "updated_at": now_utc()}
    await db.insurer_portals.insert_one(doc)
    return _portal(doc)


@router.put("/portals/{id}", response_model=Portal)
async def update_portal(id: str, body: PortalIn, _: User = Depends(admin_only)):
    upd = {**body.model_dump(exclude={"password"}), "otp_filters": _filters(body.otp_filters), "agent_ids": list(dict.fromkeys(body.agent_ids)), "updated_at": now_utc()}
    if body.password:
        upd["password_enc"] = seal(body.password)
    res = await db.insurer_portals.find_one_and_update({"id": id}, {"$set": upd}, projection={"_id": 0}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Portal not found")
    return _portal(res)


@router.delete("/portals/{id}")
async def delete_portal(id: str, _: User = Depends(admin_only)):
    if not (await db.insurer_portals.delete_one({"id": id})).deleted_count:
        raise HTTPException(status_code=404, detail="Portal not found")
    return {"ok": True}


@router.post("/portals/{id}/reveal", response_model=PortalSecret)
async def reveal_password(id: str, user: User = Depends(current_user)):
    d = await db.insurer_portals.find_one({"id": id, **_scope(user)}, {"_id": 0})
    if not d or not d.get("password_enc"):
        raise HTTPException(status_code=404, detail="No password saved for this portal")
    await db.portal_views.insert_one(PortalView(portal_id=id, insurer=d["insurer"], user_name=user.full_name, user_role=user.role).model_dump())
    return PortalSecret(password=unseal(d["password_enc"]))


@router.get("/portals/views", response_model=List[PortalView])
async def portal_views(_: User = Depends(admin_only)):
    return [PortalView(**d) for d in await db.portal_views.find({}, {"_id": 0}).sort("at", -1).to_list(200)]


# ---------- OTP mailbox ----------
async def _mailbox_doc() -> dict:
    return (await db.app_state.find_one({"key": MAILBOX_KEY}, {"_id": 0})) or {}


@router.get("/otp/mailbox", response_model=MailboxSettings)
async def get_mailbox(_: User = Depends(admin_only)):
    d = await _mailbox_doc()
    return MailboxSettings(host=d.get("host", ""), port=d.get("port", 993), email=d.get("email", ""), has_password=bool(d.get("password_enc")),
                           configured=bool(d.get("host") and d.get("email") and d.get("password_enc")))


@router.put("/otp/mailbox", response_model=MailboxSettings)
async def set_mailbox(body: MailboxIn, user: User = Depends(admin_only)):
    upd = {"key": MAILBOX_KEY, "host": body.host.strip(), "port": body.port, "email": body.email.strip(), "updated_at": now_utc()}
    if body.password:
        upd["password_enc"] = seal(body.password)
    await db.app_state.update_one({"key": MAILBOX_KEY}, {"$set": upd}, upsert=True)
    _cache.update(at=0.0, items=[])
    return await get_mailbox(user)


def _imap_login(host: str, port: int, user: str, pw: str) -> imaplib.IMAP4:
    conn = imaplib.IMAP4_SSL(host, port, timeout=12) if port == 993 else imaplib.IMAP4(host, port, timeout=12)
    if port != 993:
        try:
            conn.starttls()
        except Exception:
            pass
    conn.login(user, pw)
    return conn


@router.post("/otp/mailbox/test", response_model=MailboxTest)
async def test_mailbox(_: User = Depends(admin_only)):
    d = await _mailbox_doc()
    if not (d.get("host") and d.get("email") and d.get("password_enc")):
        return MailboxTest(ok=False, message="Save host, email and password first")

    def run() -> str:
        conn = _imap_login(d["host"], d.get("port", 993), d["email"], unseal(d["password_enc"]))
        try:
            typ, data = conn.select("INBOX", readonly=True)
            return f"Connected — INBOX has {int(data[0] or 0)} mails"
        finally:
            conn.logout()

    try:
        return MailboxTest(ok=True, message=await asyncio.wait_for(asyncio.to_thread(run), timeout=25))
    except Exception as exc:
        return MailboxTest(ok=False, message=f"Could not connect: {str(exc)[:200]}")


def _text(msg: email.message.Message) -> str:
    parts = msg.walk() if msg.is_multipart() else [msg]
    plain, html = "", ""
    for p in parts:
        ct = p.get_content_type()
        if ct not in ("text/plain", "text/html") or p.get("Content-Disposition", "").startswith("attachment"):
            continue
        try:
            body = p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", "replace")
        except Exception:
            continue
        if ct == "text/plain" and not plain:
            plain = body
        elif ct == "text/html" and not html:
            html = body
    txt = plain or re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(style|script)[^>]*>.*?</\1>", " ", html))
    return re.sub(r"\s+", " ", unescape(txt)).strip()


OTP_NEAR = re.compile(r"(?i)(?:otp|one[\s-]*time[\s-]*(?:password|pin|code)|verification\s*code|security\s*code|passcode|code)\D{0,40}?(\d{4,8})\b")
OTP_ANY = re.compile(r"\b(\d{6})\b|\b(\d{4})\b")


def _find_otp(subject: str, body: str) -> Optional[str]:
    for t in (subject, body):
        m = OTP_NEAR.search(t)
        if m:
            return m.group(1)
    m = OTP_ANY.search(subject) or OTP_ANY.search(body[:400])
    return (m.group(1) or m.group(2)) if m else None


def _fetch_recent(d: dict) -> List[dict]:
    """Mails from the last OTP window. Headers of the newest 40 first (one cheap call), bodies only for the few in the window."""
    conn = _imap_login(d["host"], d.get("port", 993), d["email"], unseal(d["password_enc"]))
    out: List[dict] = []
    try:
        conn.select("INBOX", readonly=True)
        since = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%d-%b-%Y")
        typ, data = conn.uid("search", None, f"(SINCE {since})")
        uids = (data[0] or b"").split()[-40:]
        if not uids:
            return out
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=OTP_WINDOW_MIN)
        typ, hdrs = conn.uid("fetch", b",".join(uids), "(UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
        recent: List[tuple] = []
        for part in hdrs:
            if not isinstance(part, tuple):
                continue
            m = re.search(rb"UID (\d+)", part[0])
            h = email.message_from_bytes(part[1])
            try:
                when = parsedate_to_datetime(h.get("Date"))
                when = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
            except Exception:
                continue
            if m and when >= cutoff:
                recent.append((m.group(1), when, str(make_header(decode_header(h.get("From", "")))), str(make_header(decode_header(h.get("Subject", ""))))))
        for uid, when, sender, subject in sorted(recent, key=lambda x: x[1], reverse=True)[:15]:
            typ, msg_data = conn.uid("fetch", uid, "(BODY.PEEK[])")
            raw = next((x[1] for x in msg_data if isinstance(x, tuple)), None)
            body = _text(email.message_from_bytes(raw))[:3000] if raw else ""
            out.append({"uid": uid.decode(), "sender": sender, "subject": subject, "received_at": when, "body": body})
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return out


_cache: dict = {"at": 0.0, "items": []}
_lock = asyncio.Lock()


@router.get("/otp/messages", response_model=List[OtpMessage])
async def otp_messages(portal_id: Optional[str] = None, user: User = Depends(current_user)):
    """Only mails matching an active portal's OTP filters are returned — agents never see the rest of the mailbox."""
    d = await _mailbox_doc()
    if not (d.get("host") and d.get("email") and d.get("password_enc")):
        raise HTTPException(status_code=409, detail="OTP mailbox is not set up yet — ask admin")
    async with _lock:  # one IMAP read per 4 s shared by everyone polling
        if time.monotonic() - _cache["at"] > 4:
            try:
                _cache["items"] = await asyncio.wait_for(asyncio.to_thread(_fetch_recent, d), timeout=25)
            except asyncio.TimeoutError:
                raise HTTPException(status_code=504, detail="Mailbox is slow to respond — retrying…")
            except imaplib.IMAP4.error as exc:
                raise HTTPException(status_code=502, detail=f"Mailbox login failed — admin please re-save the mailbox password ({str(exc)[:80]})")
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Mailbox not reachable: {type(exc).__name__} {str(exc)[:150]}")
            _cache["at"] = time.monotonic()
        items = list(_cache["items"])
    q: dict = {**_scope(user), "active": True, **({"id": portal_id} if portal_id else {})}
    portals = [p for p in await db.insurer_portals.find(q, {"_id": 0, "id": 1, "insurer": 1, "otp_filters": 1}).to_list(500) if p.get("otp_filters")]
    out: List[OtpMessage] = []
    for m in items:
        sender_addr = parseaddr(m["sender"])[1].lower()
        hay = f"{m['sender']} {sender_addr} {m['subject']}".lower()
        hit = next((p for p in portals if any(f in hay for f in p["otp_filters"])), None)
        if not hit:
            continue
        out.append(OtpMessage(uid=m["uid"], portal_id=hit["id"], insurer=hit["insurer"], sender=m["sender"], subject=m["subject"],
                              received_at=m["received_at"], otp=_find_otp(m["subject"], m["body"]), snippet=m["body"][:220]))
    return out
