"""Insurer portal logins for agents + OTP mails read from Srishvision's mailbox (IMAP), filtered to insurer OTPs only."""
import asyncio
import logging
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
from models.portal import MailboxIn, MailboxSettings, MailboxTest, OtpClaim, OtpError, OtpFeed, OtpMessage, OtpRequestIn, Portal, PortalIn, PortalSecret, PortalView
from models.user import User

router = APIRouter(tags=["portals"])
log = logging.getLogger("portals")
admin_only = require_roles("admin")
OTP_WINDOW_MIN = 6  # IMAP look-back
OTP_SHOW_SEC = 60  # an OTP is shown for 1 minute after it arrives
CLAIM_SEC = 180  # a "Get OTP" request waits 3 minutes
MAILBOX_KEY = "otp_mailbox"


def _portal(d: dict, admin: bool = True) -> Portal:
    p = Portal(**{**d, "has_password": bool(d.get("password_enc")), "has_mailbox_password": bool(d.get("mailbox_password_enc"))})
    if not admin:  # mailbox details are admin-only
        p.mailbox_host, p.mailbox_email, p.has_mailbox_password = None, None, False
    return p


def _mailbox_fields(body: PortalIn) -> dict:
    email_ = (body.mailbox_email or "").strip() or None
    out = {"mailbox_host": (clean_host(body.mailbox_host, email_) or None) if email_ else None, "mailbox_port": body.mailbox_port, "mailbox_email": email_}
    if not email_:
        out["mailbox_password_enc"] = None
    elif body.mailbox_password:
        out["mailbox_password_enc"] = seal(body.mailbox_password.strip())
    return out


def _scope(user: User) -> dict:
    """Portals this user may see: admin all; agent / backoffice: active + (everyone or chosen). Chosen = [] → nobody."""
    if user.role == "admin":
        return {}
    return {"active": True, "$or": [{"all_agents": {"$ne": False}}, {"agent_ids": user.id}]}  # agents + backoffice


def _filter_hit(flt: str, hay: str) -> bool:
    """A filter matches when every word of it appears in sender/subject: 'icici otp' matches 'Your OTP … ICICI Lombard'."""
    words = [w for w in re.split(r"[\s,;]+", flt.lower()) if w]
    return bool(words) and all(w in hay for w in words)


def _filters(raw: List[str]) -> List[str]:
    return [f.strip().lower() for f in raw if f and f.strip()][:20]


@router.get("/portals", response_model=List[Portal])
async def list_portals(user: User = Depends(current_user)):
    return [_portal(d, user.role == "admin") for d in await db.insurer_portals.find(_scope(user), {"_id": 0}).sort("insurer", 1).to_list(500)]


@router.post("/portals", response_model=Portal)
async def create_portal(body: PortalIn, _: User = Depends(admin_only)):
    import uuid

    doc = {**body.model_dump(exclude={"password", "mailbox_password"}), **_mailbox_fields(body), "id": str(uuid.uuid4()), "otp_filters": _filters(body.otp_filters), "agent_ids": list(dict.fromkeys(body.agent_ids)),
           "password_enc": seal(body.password) if body.password else None, "updated_at": now_utc()}
    await db.insurer_portals.insert_one(doc)
    return _portal(doc)


@router.put("/portals/{id}", response_model=Portal)
async def update_portal(id: str, body: PortalIn, _: User = Depends(admin_only)):
    upd = {**body.model_dump(exclude={"password", "mailbox_password"}), **_mailbox_fields(body), "otp_filters": _filters(body.otp_filters), "agent_ids": list(dict.fromkeys(body.agent_ids)), "updated_at": now_utc()}
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
    upd = {"key": MAILBOX_KEY, "host": clean_host(body.host, body.email) or body.host.strip(), "port": body.port, "email": body.email.strip(), "updated_at": now_utc()}
    if body.password:
        upd["password_enc"] = seal(body.password.strip())
    await db.app_state.update_one({"key": MAILBOX_KEY}, {"$set": upd}, upsert=True)
    _cache.clear()
    return await get_mailbox(user)


def _imap_login(host: str, port: int, user: str, pw: str) -> imaplib.IMAP4:
    conn = imaplib.IMAP4_SSL(host, port, timeout=12) if port == 993 else imaplib.IMAP4(host, port, timeout=12)
    if port != 993:
        try:
            conn.starttls()
        except Exception:
            pass
    if "gmail" in host.lower():  # Google shows app passwords as "abcd efgh ijkl mnop"
        pw = pw.replace(" ", "")
    conn.login(user, pw)
    return conn


def _creds_ok(d: dict) -> bool:
    return bool(d.get("host") and d.get("email") and d.get("password_enc"))


async def _test(d: dict) -> MailboxTest:
    if not _creds_ok(d):
        return MailboxTest(ok=False, message="Save host, email and password first")

    def run() -> str:
        conn = _imap_login(d["host"], d.get("port", 993), d["email"], unseal(d["password_enc"]))
        try:
            typ, data = conn.select("INBOX", readonly=True)
            return f"Connected to {d['email']} — INBOX has {int(data[0] or 0)} mails"
        finally:
            conn.logout()

    try:
        return MailboxTest(ok=True, message=await asyncio.wait_for(asyncio.to_thread(run), timeout=25))
    except Exception as exc:
        log.warning("OTP mailbox test failed for %s@%s: %r", d.get("email"), d.get("host"), exc)
        hint = ""
        if isinstance(exc, imaplib.IMAP4.error):
            hint = (" — Gmail needs the 16-letter App Password (not your Gmail password) and IMAP enabled" if "gmail" in d["host"].lower()
                    else " — check the mailbox email / password")
        return MailboxTest(ok=False, message=f"Could not connect: {str(exc)[:160]}{hint}")


@router.post("/otp/mailbox/test", response_model=MailboxTest)
async def test_mailbox(_: User = Depends(admin_only)):
    return await _test(await _mailbox_doc())


def clean_host(host: Optional[str], email_: Optional[str]) -> str:
    """'imap.gmail.com/https://glory.herosite.pro' or 'https://x.com/' → one bare hostname that fits the email."""
    cands = re.findall(r"(?:[a-z0-9-]+\.)+[a-z]{2,}", re.sub(r"(?i)https?://", " ", str(host or "")).lower())
    if str(email_ or "").lower().endswith(("@gmail.com", "@googlemail.com")):
        return "imap.gmail.com"
    others = [c for c in cands if c != "imap.gmail.com"]
    return (others or cands or [""])[0]


def _portal_creds(p: dict) -> dict:
    return {"host": clean_host(p.get("mailbox_host"), p.get("mailbox_email")), "port": p.get("mailbox_port") or 993, "email": p.get("mailbox_email") or "", "password_enc": p.get("mailbox_password_enc")}


@router.post("/portals/{id}/mailbox-test", response_model=MailboxTest)
async def test_portal_mailbox(id: str, _: User = Depends(admin_only)):
    p = await db.insurer_portals.find_one({"id": id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Portal not found")
    if not p.get("mailbox_email"):
        return MailboxTest(ok=False, message="This portal uses the default mailbox — test it in the Default OTP mailbox box")
    return await _test(_portal_creds(p))


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


_NUM = r"(?<![\w/-])(\d{4,8})(?![\w/-])"  # stand-alone number — not part of IDs like IM-2372208-006
OTP_NEAR = re.compile(r"(?i)(?:otp|one[\s-]*time[\s-]*(?:password|pin|code)|verification\s*code|security\s*code|passcode|code)\W{0,40}?" + _NUM)
OTP_IS = re.compile(r"(?i)(?:otp|one[\s-]*time[\s-]*password|verification\s*code|security\s*code|passcode)[^.\n]{0,90}?\b(?:is|:)\s*" + _NUM)
OTP_BEFORE = re.compile(r"(?i)" + _NUM + r"\s*(?:is|as)\s+(?:your|the)\s+(?:otp|one[\s-]*time|verification|security|code)")
OTP_ANY = re.compile(r"(?<![\w/-])(\d{6})(?![\w/-])|(?<![\w/-])(\d{4})(?![\w/-])")


def _find_otp(subject: str, body: str) -> Optional[str]:
    """Body first (subjects often carry account / user IDs), then subject."""
    for t in (body, subject):
        for rx in (OTP_IS, OTP_BEFORE, OTP_NEAR):
            m = rx.search(t)
            if m:
                return m.group(1)
    m = OTP_ANY.search(body[:600]) or OTP_ANY.search(subject)
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


_cache: dict = {}  # mailbox key → (monotonic time, items)
_locks: dict = {}


async def _read_mailbox(d: dict) -> List[dict]:
    """One IMAP read per mailbox per 4 s, shared by everyone polling."""
    key = f"{d['host'].lower()}|{d.get('port', 993)}|{d['email'].lower()}"
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] <= 4:
            return hit[1]
        try:
            items = await asyncio.wait_for(asyncio.to_thread(_fetch_recent, d), timeout=25)
        except asyncio.TimeoutError:
            log.warning("OTP mailbox fetch timed out (%s)", d["email"])
            raise RuntimeError("mailbox is slow to respond — retrying")
        except imaplib.IMAP4.error as exc:
            log.warning("OTP mailbox login/IMAP error for %s@%s: %r", d["email"], d["host"], exc)
            raise RuntimeError("mailbox login failed — admin please re-check the mailbox email / password")
        except Exception as exc:
            log.warning("OTP mailbox fetch failed for %s: %r", d["email"], exc)
            raise RuntimeError(f"mailbox not reachable ({type(exc).__name__})")
        _cache[key] = (time.monotonic(), items)
        return items


@router.post("/otp/request", response_model=OtpClaim)
async def request_otp(body: OtpRequestIn, user: User = Depends(current_user)):
    """Press before triggering the OTP on the insurer site — the next OTP of this portal goes only to you."""
    p = await db.insurer_portals.find_one({"id": body.portal_id, **_scope(user)}, {"_id": 0, "id": 1, "insurer": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Portal not found")
    now = now_utc()
    await db.otp_claims.delete_many({"user_id": user.id, "portal_id": p["id"]})
    c = OtpClaim(portal_id=p["id"], insurer=p["insurer"], user_id=user.id, user_name=user.full_name, at=now, expires_at=now + timedelta(seconds=CLAIM_SEC))
    await db.otp_claims.insert_one(c.model_dump())
    return c


@router.delete("/otp/request/{portal_id}")
async def cancel_otp(portal_id: str, user: User = Depends(current_user)):
    await db.otp_claims.delete_many({"user_id": user.id, "portal_id": portal_id})
    return {"ok": True}


@router.get("/otp/messages", response_model=OtpFeed)
async def otp_messages(user: User = Depends(current_user)):
    """Only the logged-in user who pressed "Get OTP" sees that portal's OTP, for 1 minute. Nothing is read without a request."""
    now = now_utc()
    claims = await db.otp_claims.find({"expires_at": {"$gt": now - timedelta(seconds=OTP_SHOW_SEC)}}, {"_id": 0}).to_list(500)
    mine = [OtpClaim(**c) for c in claims if c["user_id"] == user.id]
    if not mine:
        return OtpFeed(messages=[])
    default = await _mailbox_doc()
    portals = {p["id"]: p for p in await db.insurer_portals.find({"id": {"$in": [c.portal_id for c in mine]}, **_scope(user)}, {"_id": 0}).to_list(100)}
    groups: dict = {}
    for p in portals.values():
        if not p.get("otp_filters"):  # no filter typed → match the insurer name ("tata aig" / "tataaig")
            n = p["insurer"].lower().strip()
            p["otp_filters"] = [x for x in {n, n.replace(" ", "")} if len(x) >= 3]
        creds = _portal_creds(p) if p.get("mailbox_email") else default
        if not _creds_ok(creds):
            continue
        k = f"{creds['host'].lower()}|{creds.get('port', 993)}|{creds['email'].lower()}"
        groups.setdefault(k, (creds, []))[1].append(p)
    if not groups:
        raise HTTPException(status_code=409, detail="No OTP mailbox is set up for this portal — ask admin")
    results = await asyncio.gather(*(_read_mailbox(c) for c, _ in groups.values()), return_exceptions=True)
    skew = timedelta(seconds=180)  # mail clocks drift, and users sometimes press Get OTP just after the mail arrives
    out: List[OtpMessage] = []
    errors: List[OtpError] = []
    for (creds, ps), res in zip(groups.values(), results):
        if isinstance(res, BaseException):
            errors.append(OtpError(insurers=[p["insurer"] for p in ps], message=str(res)))
            continue
        for m in res:
            sender_addr = parseaddr(m["sender"])[1].lower()
            # sender + subject + start of the body (ICICI subjects don't always say "OTP")
            hay = f"{m['sender']} {sender_addr} {m['subject']} {m['body'][:1500]}".lower()
            hit = next((p for p in ps if any(_filter_hit(f, hay) for f in p["otp_filters"])), None)
            if not hit:
                continue
            got = m["received_at"]
            # the OTP belongs to the latest request (any user) made before it arrived
            owners = [c for c in claims if c["portal_id"] == hit["id"] and c["at"].replace(tzinfo=timezone.utc) - skew <= got]
            owner = max(owners, key=lambda c: c["at"], default=None)
            if not owner or owner["user_id"] != user.id:
                continue
            shown_from = max(got, owner["at"].replace(tzinfo=timezone.utc))  # 1 minute from arrival (or from my request if it came first)
            if now - shown_from > timedelta(seconds=OTP_SHOW_SEC):
                continue
            out.append(OtpMessage(uid=f"{hit['id'][:8]}-{m['uid']}", portal_id=hit["id"], insurer=hit["insurer"], sender=m["sender"], subject=m["subject"],
                                  received_at=got, otp=_find_otp(m["subject"], m["body"]), snippet=m["body"][:220], expires_at=shown_from + timedelta(seconds=OTP_SHOW_SEC)))
    out.sort(key=lambda m: m.received_at, reverse=True)
    got_for = {m.portal_id for m in out}
    waiting = [c for c in mine if c.expires_at.replace(tzinfo=timezone.utc) > now and c.portal_id not in got_for]
    others = sorted({f"{c['user_name']} · {c['insurer']}" for c in claims if c["user_id"] != user.id and c["portal_id"] in portals
                     and c["expires_at"].replace(tzinfo=timezone.utc) > now})
    return OtpFeed(messages=out, errors=errors, waiting=waiting, others_waiting=others)
