# GI·MIS — General Insurance Policy MIS (living spec)

## What it does
Internal web portal for a general insurance distributor's MIS process:
1. Agents / backoffice / admin upload policy documents (PDF, JPG, PNG, WEBP ≤15 MB).
2. Files are stored in **Emergent Object Storage** (`lib/storage.py`, path `gi-mis/policies/{agent_id}/{policy_id}.{ext}`); Mongo keeps `storage_path`.
3. **AI OCR** (Gemini `gemini-3-flash-preview` via Emergent LLM key, `lib/ocr.py`) runs as a background task → status `processing` → `extracted` (or `failed`). Fields + per-field confidence saved.
4. Side-by-side verification screen (`/policies/:id`): document viewer + editable fields, audit trail. Actions: Save corrections, Verify & lock, Flag discrepancy, Re-run OCR, Delete (admin, soft-delete).
5. Policy MIS registry (`/policies`) with filters (search, status, LOB, agent, upload date range) and CSV / Excel (.xlsx) export of the filtered, role-scoped set.
6. Admin: onboard agents/backoffice (auto username `agtNNNN` / `boNNNN` + generated temp password shown once), edit branch/team mapping/active, reset password.

## Roles & scope
- **admin**: everything, all data.
- **agent**: own policies only (`agent_id == me`); can edit before verification; once verified locked (can still flag). Cannot verify. No user management.
- **backoffice**: policies where `branch == my branch` OR `agent_id in assigned_agent_ids` (team mapping) OR uploaded by me. Can edit, verify, flag. Export = assigned branch/team MIS.
- Admin/backoffice can attribute uploads to an agent in scope (`agent_id` form field).

## Statuses
processing → extracted (Pending review) → verified | flagged ; failed (OCR error, manual entry possible → becomes extracted on save).
Verify requires policy_number and gross_premium.

## Data model (Mongo)
- `users`: id, username (lowercase), full_name, role, branch, email, mobile, assigned_agent_ids[], active, created_at, password_hash (pbkdf2).
- PolicyFields motor block: vehicle_reg_no (normalised), rto (derived from reg no if empty), registration_date, make, model, mfg_year, cc, seating_capacity, gvw, idv, od_premium (incl. add-ons), tp_premium (liability), ncb_percent, chassis_no, engine_no; DERIVED server-side on every PolicyFields construction: vehicle_age_years (risk start_date − registration_date, else start year − mfg_year) and vehicle_age_bucket (Below 5 Years / 5-7 Years / 7-10 Years / Above 10 Years).
- Motor applicability rules (derive_fields, also mirrored client-side in lib/fields.ts applyMotorRules): cover_type ∈ Package / Liability Only / Standalone OD, vehicle_class ∈ Private Car / Two Wheeler / Passenger Carrying / Goods Carrying / Miscellaneous (OCR'd, else inferred from product name). Liability Only → ncb_percent, idv, od_premium, addon_premium forced to 0 (read-only in UI). vehicle_class in Private Car/Two Wheeler/Passenger Carrying → gvw = null, shown/exported as "NA".
- Payments: upload REQUIRES payment_mode (Cash / Online / Cheque / Partial Payment; form field). Partial requires amount_paid (>0) → first PaymentEntry. Admin/backoffice MUST pass agent_id (400 otherwise); agent uploads always go to the agent. Cash = agent collected cash → outstanding = full total premium until settled via payments; Online/Cheque = fully paid (outstanding 0). Policy.payments[] ledger; computed (not stored) amount_paid / outstanding: Online/Cheque → paid = gross, outstanding 0; Cash & Partial → paid = Σ payments, outstanding = max(gross − paid, 0) (null until gross known). Admin/backoffice: PUT /policies/{id}/payment-mode, POST /policies/{id}/payments (≤ outstanding); admin DELETE /policies/{id}/payments/{entry_id}. GET /outstanding → per-agent totals (scoped). /policies?outstanding_only=true&payment_mode=. Stats.outstanding. Page /outstanding.
- MIS export format = business "MIS order.xlsx" A..AH exactly (Agent Name, Broker /Agent/POS Name [fields.intermediary_name], Insurer, LOB, Risk Start Date, Customer Name, Policy No, Registration No, Year of Mfg, Product, Make, Model, IDV /Sum Insured, OD, TP, Net, GST, Total Premium, Risk Start Date (dup), GVW, CC, Seating, Year of Mfg (dup), RTO, Vehicle Age (Yrs), Vehicle Age Band, Status, Flag Reason, Verified By, Verified At, Uploaded By, Uploaded At, Source File, Agent Premium Paid By Cash /Online/Cheque/Partial Payment) + Amount Paid, Agent Outstanding Premium. Policy No/Reg No/Year/RTO are text cells in xlsx; long numeric ids written as ="..." in CSV.
- (superseded) Earlier MIS column order (table + CSV/XLSX): Customer Name, Policy No, Registration No, IDV, Total Premium, OD Premium (incl. Add-ons), TP Premium, Net Premium, Risk Start Date, Make, Model, GVW, CC, Seating Capacity, Year of Mfg, RTO, Vehicle Age (Yrs), Vehicle Age Band, Cover Type, Vehicle Class, Add-on Premium, then supporting columns. XLSX has a 2nd sheet "Vehicle Age Summary". Filter `age_bucket` on /policies, /stats, /mis/export.
- `policies`: id, file_name, file_mime, has_file, storage_path, is_deleted, status, agent_id/agent_name/agent_code, branch, uploaded_by_id/name, fields{PolicyFields}, confidence{}, ocr_error, flag_reason, verified_by_name, verified_at, created_at, updated_at, history[], seeded (bool on seed rows).

## Auth
JWT in httpOnly cookie `mis_session` (12h). `/api/auth/login|logout|me`. Frontend `lib/session.ts` begin/endSession.

## API (all under /api)
auth/login, auth/logout, auth/me, meta, agents, users (GET/POST), users/{id} (PATCH), users/{id}/reset-password,
policies/upload (multipart file, agent_id?), policies (GET filters: status, lob, agent_id, branch, q, date_from, date_to),
policies/{id} (GET/PATCH/DELETE), policies/{id}/file, /verify, /flag, /reextract, stats, mis/export?format=csv|xlsx + filters.

## Seed (`cd /app/backend && python seed.py`, idempotent)
Users: admin (Mumbai), agt1001 Priya Sharma (Mumbai), agt1002 Rohit Verma (Delhi), agt1003 Sneha Iyer (Chennai), bo2001 Kunal Desai (Mumbai, team-mapped to agt1002).
Demo policies are NOT seeded any more (live mode). `python seed.py --demo` loads them for local testing; backend startup deletes every `seeded: true` policy.

## Storage compression, usage metrics, search & download (latest)
- Upload compresses the document before storage (`lib/compress.py`, PyMuPDF + Pillow, target ≤100 KB): images → JPEG resized; PDFs → deflate, else greyscale JPEG rasterised pages at decreasing dpi. OCR runs on the ORIGINAL bytes (passed in-memory to the OCR task); requeued OCR after restart uses the stored copy. Policy has `file_size` (stored) and `original_size`. Existing (pre-feature) files are not re-compressed.
- GET /api/usage (admin only, 403 otherwise) → Usage: storage totals, compression saving, OCR runs (counted from system "OCR extracted/failed" history entries, seeded rows excluded), est. LLM cost = runs × OCR_COST_PER_POLICY_INR (env, default ₹0.85), by_month, by_branch, by_agent. Page /usage ("Storage & OCR Usage", admin nav).
- Search: header global search → /policies?q=…; q matches policy no, customer, reg no, chassis, engine, insurer, agent name/code, file name.
- Download: GET /api/policies/{id}/file?download=true → attachment named by policy number. "Download" column in MIS table + button on detail page.

## Duplicate prevention (latest)
- New status `duplicate` ("Duplicate – rejected"). After OCR, `find_duplicate` (routers/policies.py) checks all live, non-duplicate policies system-wide: same policy_number → duplicate; same vehicle_reg_no → duplicate unless risk start dates are ≥ RENEWAL_GAP_MONTHS (10) apart (e.g. 25-10-2025 vs 25-08-2026 accepted). Missing start date on either side = duplicate.
- Duplicate records store duplicate_reason + duplicate_of_id, are hidden from /policies, /stats, /outstanding and MIS export unless status=duplicate is filtered explicitly; cannot be verified (409). PATCH that would create a duplicate on a normal policy → 409; correcting a duplicate record so it no longer clashes moves it back to `extracted`.
- Upload page shows a toast + reason + "Duplicates rejected" counter. Pre-existing duplicates (before this feature) are not auto-cleaned.
- PDF compression floor is 72 dpi greyscale (readability); single-page docs land under 100 KB, long multi-page PDFs may be above.
