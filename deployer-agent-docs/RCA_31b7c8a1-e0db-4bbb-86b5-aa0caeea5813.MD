# RCA — /portals "Live OTP" box shows "Something went wrong"

**Deployment:** insurance-mis-portal (`insurance-mis-portal.emergent.host`)
**Active run:** 31b7c8a1-e0db-4bbb-86b5-aa0caeea5813 (success, tier_0, farm_ts_react_mongo, cluster-03)
**Symptom:** frontend polls `GET /api/otp/messages` every 5s → shows error.

## 1. Exact HTTP status + error
- `GET /api/otp/messages` returns **502 Bad Gateway**, and **uvicorn's own access log records the 502** — so the *application* returns it, not nginx/ingress. (Confirmed in app logs: a wall of `"GET /api/otp/messages HTTP/1.1" 502 Bad Gateway`, while `/health` stays 200 and `/api/portals`, `/api/otp/mailbox` return 200 — the worker is alive.)
- This is **not** a 500 and **not** an ingress 502/504. The farm `nginx.conf` sets `proxy_read_timeout 86400` on `/api`, so nginx will not 504; and an ingress 502 would not appear in uvicorn access logs.
- **Source root (`backend/routers/portals.py:211-222`):**
  ```python
  async with _lock:  # one IMAP read per 4 s
      if time.monotonic() - _cache["at"] > 4:
          try:
              _cache["items"] = await asyncio.to_thread(_fetch_recent, d)
          except Exception as exc:
              raise HTTPException(status_code=502, detail=f"Mailbox not reachable: {str(exc)[:150]}")
  ```
  Any failure inside `_fetch_recent` (connect / **login** / INBOX select / **per-message fetch**) is collapsed into a single 502. The real error text goes into the response body (`{"detail":"Mailbox not reachable: …"}`) **but is never logged server-side** — which is exactly why there is no traceback in prod logs. The `…` reaches only the authenticated caller.
- The earlier `409 Conflict` entries are a *different, expected* state: before the mailbox was configured, the handler raises `409 "OTP mailbox is not set up yet"` (line ~217). After the admin saved the mailbox (`PUT /api/otp/mailbox` 200 at ~05:43) the responses switched from 409 → 502.

## 2. DB state (read-only, prod DB `insurance-mis-portal-app`)
- `app_state` **`otp_mailbox` EXISTS**: `host=glory.herosite.pro`, `port=993`, `email=rajaerode1@gmail.com`, `password_enc` present (valid Fernet token), `updated_at=2026-10-08T05:43:14Z`.
- `insurer_portals` has a **TATA AIG** doc (`id=83271a36-…`, active, username `rajaerode1@gmail.com`, `updated_at=05:43:52Z`) — **BUT `otp_filters: []` is EMPTY.**
- **Second, independent bug:** even if IMAP worked, `otp_messages` (lines 226-231) keeps only portals **with a non-empty `otp_filters`** and matches each mail's sender/subject against those filter strings. With `otp_filters=[]`, the TATA AIG portal is dropped and `/otp/messages` returns `[]` → **no OTP would ever display even on a 200.** OTP filters must be set for this portal.

## 3. Outbound TCP to glory.herosite.pro:993 — WORKS
Tested from an ephemeral pod in **aws-deployment-cluster-03** (the same cluster as the production deployment, so egress is representative):
```
DNS glory.herosite.pro -> 103.191.208.87 (0.32s)
TCP connect :993 OK (0.25s)
TLS handshake OK
IMAP banner: * OK [CAPABILITY IMAP4rev1 ... AUTH=PLAIN] Dovecot DA ready.
```
Network egress, DNS, TLS and the IMAP server itself are all healthy → **network is NOT the cause.** (Caveat: this is a sibling eph pod in the same cluster, not the exact prod pod; it carries no app secrets so login could not be exercised.)

## 4. JWT_SECRET / unseal — RULED OUT as the active cause
- `JWT_SECRET` is present and **non-empty** (`list_secrets`).
- `lib/secretbox.py`: key = `sha256("secretbox:"+JWT_SECRET)`; `unseal()` catches `InvalidToken/ValueError` and **returns `""`**. So a JWT_SECRET that differs from seal-time would silently yield an empty password → IMAP `login(user, "")` fails → 502. This is the mechanism the report worried about.
- **But it does not apply here:** `password_enc` was (re)sealed at **05:43:14** by the *live* backend process, which uses the *current* JWT_SECRET. No deploy has occurred since (deploy completed 04:57; secrets persist across redeploys and are never overwritten), so `unseal()` returns the real password now, not `""`. Moreover, re-saving the mailbox at 05:43 would itself have *fixed* any prior JWT/unseal mismatch — yet 502s continue **after** 05:43. An empty-unseal/JWT mismatch is therefore excluded.

## Conclusion
With **network egress** and **unseal/JWT** both eliminated, the 502 is produced inside `_fetch_recent` by one of:
- **(A) IMAP LOGIN rejected by the mail server** — the saved mailbox username/password for `rajaerode1@gmail.com` on `glory.herosite.pro` is wrong/expired (note: a gmail-style address authenticating against a third-party Dovecot host — the account must exist there with that exact password), **or**
- **(B) a per-message FETCH timeout** — `_fetch_recent` fetches up to **40 full message bodies** (`conn.uid("fetch", uid, "(BODY.PEEK[])")`) with a **12s socket timeout**; on a busy/large mailbox a single fetch can exceed 12s → `socket.timeout` → 502.

These two cannot be separated from outside: the distinguishing `detail` string is never logged, and the authenticated IMAP login/fetch cannot be reproduced in the sandbox (no app secrets). Both are resolvable by the steps below.

## Fixes
1. **User — run the built-in "Test mailbox"** (`POST /api/otp/mailbox/test`, available from the Portals/OTP admin screen). It performs the exact same login and returns the real error string ("Could not connect: …"). If it says `AUTHENTICATIONFAILED`/`LOGIN failed` → re-enter the correct IMAP username+password for the mailbox on glory.herosite.pro (cause A). If it says `timed out` → cause B (see fix 3).
2. **User — set `otp_filters` on the TATA AIG portal** (currently `[]`). Edit the portal in the app and add matching strings (e.g. a sender domain/substring or subject keyword such as `tataaig` / `TATA AIG`). Until this is non-empty, `/api/otp/messages` returns `[]` even when IMAP succeeds, so no OTP will show.
3. **Code (E1) — two source changes in `backend/routers/portals.py`:**
   - **Observability:** log the swallowed exception before raising the 502 (e.g. `logger.warning("otp fetch failed: %r", exc)` at line ~222), and log a warning when `secretbox.unseal()` hits `InvalidToken` (it currently returns `""` silently). Without this, this class of failure is undiagnosable from logs.
   - **Robustness for cause B:** `_fetch_recent` pulls up to 40 **full** bodies under a 12s per-op socket timeout. Consider fetching headers first (`BODY.PEEK[HEADER]`) and only pulling full bodies for likely-OTP candidates, lowering the message cap, and/or raising the socket timeout, so a large mailbox does not routinely time out into a 502.

_Verified in this investigation:_ status=502 (app-returned), otp_mailbox present, TATA AIG otp_filters empty, egress+TLS+IMAP-banner healthy from same cluster, JWT_SECRET present & re-seal timeline. _Not reproduced (needs live credential, unavailable in sandbox):_ the login vs fetch-timeout split.
