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
Users: lib/live_reset.py ensure_bootstrap_admin() — on startup creates admin from BOOTSTRAP_ADMIN_* env ONLY if no admin exists; never deletes data. (The earlier one-time wipe already ran and was removed.)
Demo policies are NOT seeded any more (live mode). `python seed.py --demo` loads them for local testing. No startup code deletes data.

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

## Change password (latest)
- POST /api/auth/change-password {current_password, new_password (≥8, letter+digit, ≠ current)} → User; 400 on wrong current / weak password.
- User.must_change_password: true for admin-onboarded users, after admin reset-password, and for the bootstrap admin. Frontend AppShell shows a non-dismissable "Set your own password" dialog while true; sidebar "Change password" button (and mobile key icon) for voluntary changes.

## Change agent / reassign (latest)
- POST /api/policies/reassign-agent {policy_ids[1..500], agent_id} (admin/backoffice; agent must be within agent_options_for(user), each policy load_scoped) → ReassignResult {updated, agent_name, agent_code}. Updates agent_id/name/code/branch + history "Agent changed" "old (CODE) → new (CODE)". Works on verified policies too. Outstanding/MIS follow automatically (aggregated by agent_id).
- UI: Policy MIS list has row checkboxes + select-all (non-agents) → sticky selection bar with "Change agent to…" select + "Change agent" button. Policy detail header has the same control for one policy. Upload page shows "Uploading for <agent>" confirmation once an agent is picked.

## Commission grid (latest, admin only)
- Collections: brokers {id,name,code,aliases[],active}, agent_groups {id,name}, commission_rules (models/commission.py CommissionRule).
- Rule: kind receivable (broker → Srish Vision) | payable (Srish Vision → agent). Conditions (empty = all): insurer (case-insensitive contains), broker_id, agent_group/agent_id (payable only), products[] (PRODUCT_CATEGORIES common codes), rtos[] (prefix: TN or TN10), ncb any/with/without, gvw_min/max, cc_min/max, make/model (contains), valid_from/to vs risk start. Components (summed, optional): od_percent, tp_percent, net_percent, odtp_percent, flat_amount.
- Matching (lib/commission.py): most specific matching active rule wins (count of set conditions; tie → latest updated). Payable is capped at receivable (capped=true; no receivable → payable 0).
- Validation: saving a payable rule whose component exceeds an overlapping active receivable's same component → 400; lowering a receivable below an overlapping payable → 400.
- Policy: broker_id/broker_name (upload pick > agent default broker (User.broker_id) > OCR intermediary_name match vs broker name/aliases); PUT /api/policies/{id}/broker. fields.product_category auto-derived (vehicle_class+cover_type+hint) and editable.
- Users: agent_group, broker_id on agents (Users dialog).
- API: /api/brokers (GET reviewers, POST/PUT admin), /api/agent-groups (GET reviewers, POST/DELETE admin), /api/commission/rules CRUD (admin), /api/commission/insurers, GET /api/policies/{id}/commission (admin). GET /api/policies adds `commission` for admin only. MIS export appends Broker, Product Category, Commission Receivable/Payable/Margin columns for admin only.
- UI: /commission page (tabs Receivable, Payable, Brokers, Agent groups); Policy MIS admin columns; Policy detail "Broker & commission" panel; Upload optional broker select.

## Security hardening (latest)
- Login brute-force guard (routers/auth.py): 10 failed attempts per username+IP within 15 min → 429; in-memory, resets on restart.
- JWT_SECRET is mandatory (lib/auth.py fails fast if missing). Broker uniqueness regex uses re.escape.
- Preview DB currently holds DEMO commission data (brokers Probus Insurance Broker / Policy Boss, groups A/B/C, agents agt1001 Murugan / agt1002 Madhan, 5 rules, policies demo1-3 with `demo: true`) for the user's demo; production is unaffected.

## Commission grid v2 (latest)
- GET /api/commission/masters (reviewers) → CommissionMasters {insurers (34 Indian insurers, models/masters.py with match keywords), product_types {Private Car, Two Wheeler, PCV, GCV, Misc D, Health, Others → product codes}, makes per type, rto_states [{code,name,rtos[]}] VAHAN-pattern codes}.
- Rule dialog (components/RuleDialog.tsx): insurer dropdown, product type → product (single, or "All <type>"), type-specific conditions: Private Car/Two Wheeler = make dropdown, model, CC, RTO, NCB; PCV = make, RTO, seating_min/max, NCB; GCV = make, RTO, GVW range (capping), NCB. RTO picker by state + codes + whole state. Save → toast with rule name + values, list highlights + scrolls to "Just saved" row.
- Insurer match uses keywords (e.g. "ICICI Lombard" ↔ any insurer text containing "icici"); make match on first word ("Maruti Suzuki" ↔ "MARUTI").
- New: seating_min/max on rules; PUT /api/agent-groups/{id}/members {agent_ids} (admin) sets group membership; DELETE /api/brokers/{id} (409 if used). Groups tab shows cards + "Assign agents" dialog; Brokers tab has Edit/Delete.

## Commission grid v3 (latest)
- Products: added "Private Car 1+3 (Bundle)", "Private Car 1+5 (Long Term)", "Two Wheeler 1+5 (Bundle)"; Misc D split into "Misc D - Tractor" / "Misc D - Others". Derivation: Package + TP tenure (start_date→tp_end_date) ≥2.5y or product name "bundle/long term/1+3/1+5" → bundle codes (TW → 1+5; car ≥4.5y or "1+5" → Long Term else 1+3). Tractor detected from product/model/make text.
- New policy fields: fuel_type, tp_end_date (OCR prompt + verification form).
- Rule conditions: vehicle_ages[] (AGE_BANDS: New Vehicle, 1-5, 6-7, 8-10, 11-12, 13-15, Above 15 Years — from vehicle_age_years at risk start, completed years), fuel_types[] (Private Car only in UI). NCB select (All / with / without) shown for every product.
- Rule dialog: "Save & add next" keeps the dialog open with same conditions (name + values cleared) and counts rules added; "Save & close". Commission is computed live, so every saved rule applies immediately to all existing MIS policies.

## Commission diagnostics + broker backfill (latest)
- GET /api/policies/{id}/commission adds `misses` [{rule_id, rule_name, kind, reasons[]}] (closest 8 non-matching rules, fewest failed conditions first) when receivable or payable is missing; shown in policy detail "Why other rules did not apply".
- GVW in tonnes (<100) is normalised to kg for matching.
- POST /api/policies/set-broker {policy_ids, broker_id} (admin/backoffice, scoped) bulk-sets broker; Policy MIS selection bar has "Set broker to…".
- PATCH /api/users/{id} with broker_id on an agent also fills broker on that agent's existing policies that have no broker.

## Broker at upload (latest)
- Upload page: "Broker · required for commission" card for ALL roles whenever active brokers exist (upload blocked until chosen). Pre-filled from the selected agent's default broker (AgentOption.broker_id) or, for agents, their own broker_id. Agents can now send broker_id too. GET /api/brokers is open to any logged-in user (names only).
- If no brokers exist, broker stays optional (fallback: agent default → OCR intermediary match).

## Commission grid v4 (latest)
- New products: "PCV - 3W Auto" (PCV type) and "GCV - 3W Goods Carrying" (GCV type). Derived when product name/model text mentions three wheeler / 3W / rickshaw / auto / Ape / RE Compact / tempo.
- Fuel condition now also on PCV and GCV rules with options Diesel / "Other than Diesel" (masters.cv_fuel_types). "Other than Diesel" matches any known fuel except Diesel (unknown fuel does not match). Private Car keeps the full fuel list.
- RTO picker: new quick zones (masters.rto_zones) added alongside state/code selection: Chennai RTOs (TN01-14, 17, 18, 22, 85), Coimbatore RTOs (TN37, 38, 66, 99), ROTN = every other TN01-99 code. Zones are stored as plain RTO codes; the rules table shows the zone name when a whole zone is selected.

## Commission statements (latest)
- Collection commission_statements (models/statement.py CommissionStatement). Router routers/statements.py; PDF/Excel in lib/statement_docs.py (reportlab + openpyxl).
- POST /api/statements (admin) {agent_id, period_type daily|weekly(Mon–Sun)|monthly|custom, ref_date | from_date/to_date} — IST dates on policy created_at (upload date). Lines = agent's live policies (not duplicate/processing/failed) in period, not on an earlier statement, with payable > 0. Outstanding lines = ALL agent's Cash/Partial policies with outstanding > 0; deduction allocated oldest first up to total commission; net_payable = commission − deducted; balance carried. 409 if agent already has an unpaid statement. Policies get commission_statement_id/no (locked).
- GET /api/statements (admin all; agent own; backoffice 403), GET /{id}, /{id}/pdf, /{id}/excel. POST /{id}/paid {paid_date, utr} (admin) → status paid; line policies commission_paid/date/utr + history; deducted amounts recorded as PaymentEntry "Adjusted from commission CS-…" (reduces outstanding). DELETE /{id} unpaid only, releases policies.
- MIS: admin columns "Comm. paid" (Paid date · UTR / In CS-… / Unpaid); export appends Commission Statement, Commission Paid, Commission Paid Date, Commission UTR.
- UI /statements (nav "Commission Statements", admin + agent).

## Rule versioning by effective date (latest)
- Rule dates: UI shows optional "Applicable from" (valid_from) and "Applicable to" (valid_to, inclusive; validated from ≤ to). valid_to is also set by the system when superseded. Matching date = policy risk start_date, else upload date (created_at, IST).
- PUT /api/commission/rules/{id}: ONLY if the rule has a valid_from and the new effective date ≤ it → in-place edit (same-day overwrite removed — it used to wipe earlier-period rates). Otherwise VERSIONED: new rule doc (version_of = root id, valid_from = effective date, default today) inserted; old doc gets valid_to = effective−1 and superseded_by = new id. Old versions remain active for past policies; editing a superseded version → 409.
- DELETE: created today → hard delete (+ re-opens the version it replaced); older → stopped (valid_to = yesterday, superseded_by "ended").
- Rules table hides superseded versions; badge "vN · earlier rates kept" toggles an inline version history (date range + rate per version, data-testid rule-history-{id}). Create dialog: optional Effective from (blank = all policies). Edit dialog: defaults to today.
- RTO picker: whole-state code (e.g. TN) and individual codes/zones of that state are mutually exclusive (selecting one unselects the other).

## Premium recon (latest, admin only)
- Two ledgers: agent → Srishvision (policies with payment_mode Cash/Partial; uses Policy.payments) and Srishvision → broker (policies with broker_id; new Policy.broker_payments, computed broker_paid / broker_outstanding = gross − Σ broker_payments).
- Collection premium_settlements (models/recon.py Settlement: kind, party_id/name, amount, mode Cash/Online/Cheque/NEFT/RTGS/UPI/Adjustment, reference (cheque/UTR), paid_on, allocations[{policy_id, policy_number, reg_no, amount}]).
- Router routers/recon.py (prefix /api/recon): GET /summary?kind → per party totals (premium, paid, outstanding, open cases); GET /policies?kind&party_id[&only_outstanding]; GET /settlements?kind[&party_id]; POST /settlements (amount allocated to ticked policy_ids in order, else oldest outstanding first; 400 if amount > outstanding); GET /export?kind&party_id → Recon Excel (policies + settlements).
- Each allocation pushes a PaymentEntry ("<mode> · <ref> · batch <id8>") on the policy (agent: payments → reduces agent outstanding; broker: broker_payments) + history entry.
- UI /recon "Premium Recon" (admin nav): tabs Srishvision → Broker / Agent → Srishvision, totals, party table, party detail with settle form, policy ticks, settlement history, Recon Excel.

## Recon v2 — case-wise allocation, on-account, reversal (latest)
- POST /api/recon/settlements body now `allocations: [{policy_id, amount}]` (replaces policy_ids). Party with ONE open case → amount applied automatically; MORE than one open case → allocations required (400 otherwise), each ≤ case outstanding, Σ ≤ amount.
- Amount not applied to cases → Settlement.unallocated (party on-account balance; ReconParty.on_account = Σ unallocated − Σ "On-account" batches, reversed excluded). Mode "On-account" spends that balance (must be fully allocated, ≤ balance).
- POST /api/recon/settlements/{id}/reverse (admin): removes the batch's PaymentEntries (PaymentEntry.settlement_id, legacy match "batch <id8>" in reference) from every case → outstanding restored; marks reversed. 409 if already reversed or its on-account credit was already used.
- UI: per-case "Pay now ₹" input when ticked, blocker hint, On-account column/balance, batch id + Reverse button in history. Excel shows On-account + Status.
- Recon UI: typing the payment amount (or ticking cases after typing it) auto-splits it oldest-first across ticked cases (each ≤ outstanding, still editable); "Split ₹X across ticked cases" button when case amounts exceed the payment; zero-amount ticks are ignored.
- MIS export (all roles) now ends with: Agent Payment Details, Premium Paid to Broker, Broker Outstanding Premium, Broker Payment Details (date · amount · mode/ref/batch per entry), before admin commission columns.

## Broker payment at upload (latest)
- Policy.broker_payment_mode: Cash | Online | Cheque | Partial Payment | Pay Later (None on older policies = Pay Later). broker_paid = full gross for Cash/Online/Cheque (no recon), else Σ broker_payments (models/policy.py broker_totals).
- Upload form fields broker_payment_mode (REQUIRED when broker_id sent → 400), broker_amount_paid (required >0 for Partial → first broker PaymentEntry), broker_payment_reference. Upload page: "Premium paid to broker · required" buttons inside the Broker card.
- PUT /api/policies/{id}/broker-payment-mode, POST /api/policies/{id}/broker-payments (single case, ≤ broker outstanding) — reviewers. Policy detail "Premium paid to broker" panel (non-agents).
- Agent side unchanged: Cash = agent still owes the full premium; Online/Cheque = paid; Partial = balance. Single cases settle on the policy page; multi-case lump sums use Premium Recon.
- MIS export adds "Premium Paid to Broker By" column.
- Legacy default (effective_broker_mode): policy with no broker_payment_mode AND no broker_payments → follows agent payment_mode: Online/Cheque = paid to broker in full; Cash/Partial = Pay Later. Once a broker payment is recorded (or a mode set explicitly), the ledger/mode is used.

## Simplified payment rules (latest — supersedes earlier broker-mode notes)
- Agent → Srishvision (payment_mode): Cash = agent owes full premium (Agent Outstanding + MIS + Recon agent tab); Partial Payment = amount now OPTIONAL at upload, balance in Recon agent tab; Online/Cheque = paid.
- Srishvision → broker/insurer (broker_payment_mode, offered: Cash | Online | Cheque | Partial Payment): Online/Cheque = Srishvision already paid (card/netbanking/cheque) → nothing pending; Cash/Partial = pending → Recon broker tab + MIS until paid. Partial amount at upload optional. "Pay Later" retired (startup migration → Cash; upload rejects it).
- Legacy policies (no broker mode, no broker payments) follow agent mode (Online/Cheque → paid, else Cash/pending).
- Recon settlement: broker side has paid_to (Broker | Insurance Company); select-all checkbox; amount auto-splits oldest-first across ticked cases.
- GET /api/recon/broker-statement?broker_id[&date_from&date_to] (admin; IST upload dates) → BrokerStatement rows (commission = grid receivable, commission_percent = receivable/net, paid_by, premium_paid, pending_premium) + totals; net = commission − pending premium (≥0 broker pays Srishvision, <0 Srishvision pays broker). /broker-statement/excel → Excel for the broker. UI: "Broker statement" box in Recon broker party detail.

## Batch partial payment at upload (latest)
- Upload page: when MORE than one file is dropped, the Partial amounts (agent and/or broker) are the TOTAL for the batch — not sent per file. After uploads the page calls POST /api/recon/upload-batch {policy_ids, agent_amount, agent_reference, broker_amount, broker_reference} (any logged-in user; non-admin only for policies they uploaded; all policies must share agent / broker).
- Collection upload_batch_payments (UploadBatchPayment: kind, party_id, policy_ids, amount, status pending→allocating→allocated, settlement_id). Allocated once no policy in the batch is still `processing` (checked on create and after every OCR job via routers.recon.allocate_pending_batches): oldest first, each ≤ its outstanding, extra → on-account; creates a Settlement with mode "Paid at upload" (reversible in Recon).
- Single-file upload keeps the per-policy amount_paid / broker_amount_paid behaviour.

## Partial highlight + Agent/Broker statements (latest)
- Policy.upload_batch_id set by POST /api/recon/upload-batch. models.policy.is_partial / partial_label: Partial Payment on agent or broker side.
- Highlight: Policy MIS table rows (amber inset bar + "Partial" badge in Paid-by col), MIS Excel rows filled FFF3C4 + new last base column "Partial Payment Batch"; statement Excels + agent commission statement PDF/Excel outstanding lines.
- GET /api/recon/statement?kind=agent|broker&party_id[&date_from&date_to] (replaces /recon/broker-statement) → PartyStatement {rows (partial flag/label), total_commission (broker: receivable, agent: payable), cash_pending, partial_pending, net = commission − cash_pending − partial_pending, net_label}. /recon/statement/excel → Excel with SUMMARY block. UI StatementBox in both Recon tabs (4 tiles + partial case list).
- Agent Commission Statements (PDF/Excel) summary now also shows Total commission − premium pending (Cash) − partial payment pending = receivable/payable, above the existing deduction/net payable lines.

## Agent restrictions + Insurer Portals & OTP (latest)
- Agents never see broker data: lib/auth.VIEWER_ROLE contextvar set in current_user; Policy model_serializer (JSON mode only) blanks broker_id/name/payment mode/payments/paid/outstanding + fields.intermediary_name for agents. MIS export drops AGENT_HIDDEN_COLS for agents. UI hides broker select (upload), intermediary column/field.
- Agents may upload payment_mode=Online only (400 otherwise); broker fields from agents ignored (agent default broker still auto-applies silently). Verify requires a broker when active brokers exist.
- /portals page "Insurer Portals & OTP" (all roles). insurer_portals {insurer,url,username,password_enc (Fernet, key from JWT_SECRET via lib/secretbox), otp_filters[], notes, active}. GET /api/portals (agents: active only, never password), POST/PUT/DELETE admin, POST /api/portals/{id}/reveal (logs portal_views), GET /api/portals/views admin.
- OTP mailbox: app_state key otp_mailbox {host (default glory.herosite.pro), port 993, email, password_enc}; GET/PUT /api/otp/mailbox, POST /api/otp/mailbox/test (admin). GET /api/otp/messages: IMAP read (cached 4s, shared), mails of last 15 min matching an active portal's otp_filters (sender/domain/subject, lowercase substring) only, with extracted OTP. 409 when mailbox not configured.
- Portal visibility: Portal.all_agents (default true) / agent_ids. Agents see (list, reveal, OTP mails) only active portals with all_agents or their id in agent_ids; backoffice sees all active; admin all. Dialog: "All agents / Selected agents only" + searchable agent checklist.
- OTP: portals with empty otp_filters match the insurer name (lower, with/without spaces). IMAP errors logged (logger 'portals'); secretbox logs decrypt failures.
- Per-portal OTP mailbox: insurer_portals.mailbox_host/port/email/mailbox_password_enc (blank email → default app_state otp_mailbox). Admin-only fields (blanked for others). POST /api/portals/{id}/mailbox-test. GET /api/otp/messages now returns OtpFeed {messages, errors[{insurers, message}]}: portals grouped by mailbox, each mailbox read in parallel (per-mailbox 4 s cache + lock), one failing mailbox doesn't hide others. Gmail: spaces stripped from app password; error hint mentions App Password.

## Session + OTP privacy (latest)
- Session: JWT cookie 15 min (lib/auth.SESSION_MINUTES) with sliding renewal via server middleware (renew_session, ≤1/min, skipped for /api/otp/messages and /api/auth/me polling). Frontend startIdleLogout (lib/session.ts, mounted in AppShell): 15 min without mouse/keys/touch → logout → /login?reason=idle (message shown); activity pings POST /api/auth/ping every ≥2 min.
- OTP is claim-based: POST /api/otp/request {portal_id} (3-min claim in otp_claims), DELETE /api/otp/request/{portal_id}. GET /api/otp/messages reads mailboxes ONLY for portals the caller has claimed; each OTP mail goes to the latest claim (any user) made before it arrived (30 s skew) and is shown for 60 s (expires_at). Feed: {messages, errors, waiting (my claims), others_waiting}. UI: "Get OTP" button per portal card; waiting row with countdown; OTP card "disappears in Ns".
- Portal visibility: All agents & backoffice / Selected users (agents + backoffice) / No one (all_agents=false, agent_ids=[]). Backoffice now scoped like agents.

## New-vehicle registration codes (latest)
- models.policy: placeholder regs (NEW, NEW-0001, NA, NIL, TBA, Applied for, 0000…) → auto code "NEW" + last 6 of chassis (else engine, else policy no) inside _normalise_registration (every PolicyFields build: OCR, corrections). Same chassis → same code → genuine duplicates still caught; different chassis → no false duplicate.
- Startup migration routers.policies.fix_new_vehicle_regs(): re-codes stored placeholder regs and releases policies rejected as duplicate only because of the placeholder (re-checks duplicates). Idempotent.
- RTO office names → codes: models/rto.py TN_RTO map + rto_code(); PolicyFields derive (_normalise_rto) and commission policy_context (via derive_fields) convert e.g. MARTHANDAM → TN75, "TN 9" → TN09. Startup migration fix_rto_names() rewrites stored names (idempotent).
- Commission rule edit: CommissionRuleIn.apply_to_past (UI checkbox "Apply to past policies too", data-testid rule-apply-to-past) → overwrite the current rule in place (valid_from as chosen, blank = all dates) and DELETE its older versions, so policies already in MIS use the corrected rate. Unticked = normal versioning from the effective date.
- RTO aliases added: thenkasi, sankari, kanniyakumari, kuzhithurai, thoothukkudi, thirunelveli, virudunagar.
- OTP matching: each otp_filter matches when ALL its words appear in sender/subject (e.g. "icici otp"); claim skew 120 s (Get OTP pressed just after triggering still works). OTP extraction: body first, stand-alone numbers only (ignores IDs like IM-2372208-006), patterns "<code> is your OTP" and "OTP … <code>".
- OTP v3: pattern "OTP … is <code>" (OTP_IS) first; claim skew 180 s (mail up to 3 min BEFORE pressing Get OTP still goes to you); shown 60 s from max(arrival, request); IMAP look-back 6 min.
- OTP v4: filters match sender + subject + first 1500 chars of body (ICICI subjects may lack "OTP"). Mailbox host sanitised by routers.portals.clean_host (strips https://, paths, picks one host; Gmail emails → imap.gmail.com) at save and at read.

## Agent rate card (latest)
- GET /api/commission/my-rates[?agent_id=] → AgentRateCard {agent_name, agent_code, agent_group, as_of, rates: AgentRate[]}. Agent: always own rates (agent_id ignored). Admin: preview any agent; no agent_id = common rates only. Backoffice 403.
- Includes active payable rules with valid_to null or ≥ today where agent_id ∈ {null, me} and agent_group ∈ {null, my group}. Flags: personal, group_rate, upcoming (valid_from > today). No receivable/margin data exposed.
- Page /my-rates (nav "My Commission Rates" for agents, "Agent Rate Card" for admin): guided picker — step 1 product type tiles (Private Car/Two Wheeler/PCV/GCV…), then sub-product, then only the cappings the admin actually used on the remaining rules (GVW / CC / seating slabs, vehicle age, fuel, NCB, RTO zone, make, insurer) as chip choices with "Not sure / show all". Result = simple grid table (company, for, commission in words) — no premium inputs or ₹ amounts. Sorted highest first (ranked internally on a hidden ₹10k OD + ₹5k TP reference so mixed OD/TP/Net rates compare); top row bold amber highlight + "Highest grid" badge. /api/commission/masters is now readable by any logged-in user (labels).

## Stored file re-compression
- lib/compress.py: PDFs now font-subset + object streams before the raster fallback (text PDFs ~35-40% smaller, text stays selectable).
- POST /api/usage/recompress?limit=5 (admin) → RecompressResult {checked, compressed, saved_bytes, remaining}; re-encodes stored files > 100 KB, replaces only if ≥5% smaller, marks policy.recompressed=true so each file is tried once. Usage page button "Compress existing files" loops batches.
- Reality: 1–2 page policies reach ≤100 KB; multi-page policies floor at ~25–40 KB/page while staying readable.
- Rate card isolation: agent role always gets only own rates (agent_id param ignored; /commission/rules is admin-only 403). Other agents' personal rules and other groups' rules are never returned. A common/group rule whose non-agent conditions (signature) equal a personal/group rule for this agent (already in effect) is hidden — the more specific one is what the payout engine uses, so the agent never sees an overridden higher common rate.
- Rule condition `cover`: "any" (Both) | "package" | "satp" — shown in RuleDialog only for PCV / GCV / Misc D (forced "any" otherwise). Policy context cover from fields.cover_type (Liability Only → satp, Standalone OD → saod, else package). Adds +1 match score when set; included in overlap check, agent signature and agent rate-card wizard ("Package or Third party?").

## Auto payable grid (group margins)
- agent_groups.margins: [{insurer|null, product_type|null, margin}] — null insurer = "All other companies", null product_type = "All products". Most specific wins: company+product type (3) > company (2) > all companies+product type (1) > all (0). Product type = masters product_types key (Private Car, PCV, GCV, Misc D…) from the policy product, else the receivable rule products. Duplicate (company, product) → 400. PUT /api/agent-groups/{id}/margins (admin; GroupMarginsIn; duplicate company → 400). UI: Commission → Agent groups → "Auto grid from receivable · Set".
- Payout engine (lib/commission.compute): 1) agent's personal payable rule (agent_id) wins; 2) else if the agent's group has a margin for the matched receivable rule's company (exact company, else all-other) → payable = receivable rule with every OD/TP/Net/OD+TP % minus margin points (floor 0; flat amount unchanged), name "Auto · <rec> − m% (Group X)", id "auto:<recId>"; 3) else manual payable rules as before. Follows every receivable change/version automatically.
- Rate card: for grouped agents, receivable rules → derived "auto-<id>" rates; manual group/common payable rules for covered companies hidden; any non-personal rate fully covered by a personal rule (_covers) hidden.

## Insurance company master
- Built-in list in models/masters.py INSURERS (now includes "IndusInd General" ["indusind"]) + admin-added `insurers` collection {id, name, keywords[], active, builtin=false}. GET /api/insurers (any user; custom + builtin rows), POST/PUT/DELETE admin (409 duplicate name vs builtin/custom; delete blocked when used in rules; rename cascades to commission_rules.insurer and group margins).
- /api/commission/masters.insurers = builtin + active custom. lib/commission.insurer_matches uses CUSTOM_INSURERS keywords (refreshed in load_context and on every change).
- UI: Commission → "Insurance companies" tab (search, add/edit/delete custom).
- SimpleSelect auto-switches to a searchable popover (type-to-filter, Enter picks first) when > 8 options, or with `searchable` (forced on all agent pickers).
- Margin dates: each margin line has valid_from (policy risk-start; blank = always) and system-set valid_to. Several lines with the same company + product = versions; on save each ends the day before the next one starts (unique key company+product+valid_from, else 400). compute() picks margins covering ctx.start; rate card uses today (or the receivable rule's future start).
- Rate card view: card list per rate with labelled conditions (Vehicle weight / Vehicle age (continuous bands collapsed to "6 years & above") / RTO / Make…) in bold text, big rate on the right; highest grid amber. Auto-grid rows are split per future dated margin change (id auto-<rec>-<date>, upcoming=true, previous row valid_to = day before).
- Rate change alerts (components/RateAlerts.tsx): computed client-side from the rate card — upcoming row with same conditions as a current row → "Your rate changes from <date>: old → new" (green up / red down); upcoming with no current → "New rate from"; current row with valid_to within 30 days and no successor → "Rate ends on". Shown on agent Dashboard (max 4, link to /my-rates) and top of /my-rates.
- Admin Commission Grid (receivable/payable tabs): rules grouped into collapsible company sections (company = masters insurer sharing the first word, so "ICICI"/"ICICI Lombard" merge), then product-type sub-sections; each row shows name + validity, labelled conditions grid, big rate, edit/delete. Search box; "Add rule for <company>" and "+ Add <type> rule" open RuleDialog with `preset` (insurer / products).

## Agent payment mode "Net of Commission" (On-Spot)
- Agent paid premium minus their commission on the spot before issue. payment_mode "Net of Commission" (admin/backoffice only; agents still Online only): not an OUTSTANDING_MODE → amount_paid = gross, outstanding 0, no Premium Recon. Commission still computed from the grid; statement generation skips these policies (commission kept by agent); MIS Excel commission status = "Deducted on spot". UI label "On-Spot (Net of Commission)" on Upload + PaymentPanel (shows agent paid = gross − payable).

## Backoffice restrictions (admin → Users & Access → Edit backoffice)
- users.allowed_broker_ids (empty = all): GET /api/brokers returns only these; policy scope_filter adds broker_id ∈ allowed (no-broker policies only when uploaded by that user); upload / set-broker / bulk set-broker with another broker → 403.
- users.portal_access (default true): false → portals _scope matches nothing (list, view, OTP request/messages) and the "Insurer Portals & OTP" nav item is hidden.

## On-Spot bank proof + admin bank check
- Upload with payment_mode "Net of Commission" requires payment_reference (UTR / receipt) OR multipart `onspot_proof` file (else 400). Stored: policy.onspot_reference, onspot_proof_path (internal) / has_onspot_proof, onspot_status pending|confirmed|not_received, onspot_checked_by_name/at, onspot_note. Switching mode to Net of Commission sets status pending.
- routers/onspot.py: GET /api/onspot?status= (admin; rows with expected_amount = gross − payable), PUT /api/policies/{id}/onspot-check (admin), POST /api/policies/{id}/onspot-proof (admin/backoffice, form reference/proof), GET /api/policies/{id}/onspot-proof (image/pdf).
- UI: Upload shows UTR input + screenshot attach for On-Spot; PaymentPanel shows status/UTR/screenshot + add proof; admin page /onspot "On-Spot Bank Check" (tabs pending / not received / confirmed / all, Received / Not received buttons with note).
- Upload: backoffice with exactly one allowed broker → broker fixed (read-only "Fixed for your login"); multiple → select from allowed only.
- MIS columns: "Broker \/ Agent \/ POS (on policy)" = OCR intermediary text; "Assigned broker" (broker_name) shown to admin + backoffice.
- UI wording: the internal broker master is shown as "Channel Partner" everywhere (data fields/APIs still broker_*). Restriction uses only the assigned channel partner (broker_id), never the OCR "Broker / Agent / POS (on policy)" text. Admin changes a policy's channel partner in Policy detail → Commission panel (policy-broker-select) during review.
- Unassigned channel partner list: GET /api/policies?broker_id=none (or =<id>) filter. Policy MIS has a "Channel partner" filter (All / Not assigned yet / each partner); admin sees an amber banner "N policies have no channel partner" → "Show & fix them" (filter) → "Select all → set channel partner" → bulk set via BulkBroker.
- Header: top-right user menu (header-user-menu: initials avatar + name) with profile info, Change password, Sign out (header-logout-button); sidebar bottom keeps Change password + Sign out (logout-button); sidebar nav scrolls, footer pinned.
- Header: sign out lives ONLY in the top-right user menu (sidebar footer removed per user request).
- MIS Excel order: A–J policy details, K "Policy Type" (Package / Liability / SAOD derived from product name/cover_type, motor only), L–Z vehicle/premium, AA–AI payment block, AJ–AP review/audit (Status … Source File), then admin commission columns. Duplicate "Risk Start Date" (old col S) removed.
- Upload performance (prod tier is 250m CPU / 512Mi): upload stores the original immediately and returns; compression runs in a background task (_compress_later) one-at-a-time (threading.Semaphore in lib/compress.py), font subsetting only ≤ 4 MB, raster fallback only ≤ 12 pages and max 2 steps; failures keep the original.
- Product category 3W detection (models/policy.product_category): ignores "Auto Secure" (TATA AIG product name) and "other than three wheelers"; never 3W when seats > 7, GVW > 1500 kg or model contains "bus". School bus also detected from insured name / model (school, college, academy, vidyalaya, matric). One-time startup migration lib/migrations.py "fix_3w_categories_v1" re-derived all 3W-tagged policies (history note "Product corrected").
- Partial payment at multi-file upload (upload_batch_payments) is allocated after OCR reads premiums. Robustness: startup _recover() re-runs OCR for policies stuck 'processing' > 10 min (recover_stuck_ocr) and allocates pending batches (allocate_stale_batches); statement generation calls allocate_stale_batches(agent) first; _allocate_batch loads the batch policies directly (incl. processing) and only waits while a processing policy has no premium yet or is < 10 min old.
- Vehicle age capping (models/policy.py `capped_age`): age at risk start = completed years from registration date, +1 if even one day past the last anniversary (5y 1d → 6; exact anniversary stays 5). Year-of-mfg fallback stays start.year − mfg_year. Applies to all policies; migration `vehicle_age_capping_v1` re-derived existing records' vehicle_age_years/bucket.
- Commission grid v2 (Oct 2026):
  - Rule `makes: List[str]` (multi-select, any-of match) replaces single `make` (migration `rule_makes_long_term_v1`). Model = optional searchable dropdown per make from `vehicle_models` {make, model}; admin can add a model inline (POST /api/commission/models). Masters expose `models` + `fuel_by_type`.
  - Fuel: Two Wheeler Petrol/Electric; PCV/GCV Diesel / Other than Diesel / CNG/LPG (matches CNG or LPG) / Electric.
  - "Private Car 1+5 (Long Term)" renamed "Private Car 3+3 (Long Term)" (OCR: OD term ≥2.5y or "3+3"/"long term"); rules + policies migrated.
  - GCV rules require GVW from/to (frontend + backend 400). PCV rules require product(s) picked (multi-select, blank by default).
  - Rule name = combobox: auto-suggested name from conditions + earlier names + type a new one.
  - Company-wise RTO zones `company_zones` {id, insurer, name, rtos}: GET/POST/DELETE /api/commission/zones; shown as quick buttons when that insurer is chosen; "Save zone" saves current RTO selection. Quick zones only show for the state being viewed (fixes TN zones showing under Assam).
  - Excel grid: GET /api/commission/grid/template?kind=&prefill=true|false (Grid + Lists + Instructions sheets, dropdown validation); POST /api/commission/grid/upload → {created, updated, unchanged, errors[{row,error}]}. Row matched by Rule ID (old IDs follow to current version) or identical conditions → rate update versioned from Applicable From (rate-only change → from today); else new rule. Receivable rows run before payable rows.
  - Upload preview: POST /api/commission/grid/upload?preview=true checks every row (incl. payable ≤ receivable against the simulated grid) and returns rows[{row, action create|update|unchanged|error, changes, effective_from, error}] without saving; UI shows the check screen, then "Confirm & save" re-posts the same file.
  - Compare & margin tab: GET /api/commission/compare → every live receivable rule with overlapping payable rules + agent-group-margin payables, margin = receivable − payable per component.
  - Compare tab: "Set payable" on rows without a payable (and "Add payable for another agent / group" on others) opens the payable RuleDialog pre-filled with the receivable's conditions (keepProducts). GET /api/commission/compare/export?insurer= → Excel, one sheet per company (or the filtered one), margin cell coloured green/amber/red, "NO PAYABLE SET" rows.
  - Low margin alerts: `app_settings` {key:"commission", value:{min_margin}} via GET/PUT /api/commission/settings (default 2 pts). Compare payables carry `low_margin` (any % component margin < min); UI badge count + "only low" filter + per-line flag; Excel export marks "LOW ·".
  - Bulk payable: POST /api/commission/compare/bulk-payable {agent_group, margin, insurer?, rule_ids?, preview} → for every live receivable with no payable, payable rule for that group = receivable % − margin pts (flat amounts not copied; flat-only receivables skipped), same conditions/dates, name "<receivable name> · Group X". UI: preview table then "Create N payables".
- Payable margins (groups) tab — the simple payable editor (routers/margin_grid.py):
  - GroupMargin lines gained `product` (specific product inside product_type, e.g. "PCV - Taxi") and `ended` (stopped after valid_to). group_margin() specificity: company(4) + product(2) + product_type(1); compute passes the policy product. chain_margins() in lib/commission.py sets valid_to per company+product+item.
  - GET /api/commission/margin-grid → {groups, rows[{insurer, product_type, product, margins{group: pts|null}, since{group: date}}]} (latest line per key). GET …/suggest → company × product-type rows from live receivables. PUT …/margin-grid {rows, valid_from (default today IST), apply_to_past} → changed cells only: new version from valid_from (lines starting on/after it replaced; cleared cell = stop old line day before) or, with apply_to_past, the whole history for that key replaced. −2 and 2 both mean 2 pts. Rows removed from the grid = cleared for all groups.
  - Excel: GET …/margin-grid/excel (rows + receivable suggestions, columns Group X as −N, dropdown lists); POST …/margin-grid/excel reads it back into rows (not saved — screen highlights changes, user presses Save).
- Group rate preview: Payable margins tab shows "Receivable today" (range of live receivable %s for that company/product, client-side from /commission/rules) and under each margin cell "OD 61% − 2 = 59%".
- Commission %: CommissionResult.payable_rate ("OD 15% + TP 2%", lib/commission.rate_text; auto group payables use the derived rates). StatementLine.commission_rate stored at generation (+ "(capped at receivable)"); older statements fill it on read. Shown in statement screen, PDF and Excel ("Commission %" column) and in the policy commission panel.
- Code structure: policy audit `history()` lives in lib/history.py (re-exported from routers.policies); recon/statements import it from lib, so routers.recon no longer imports routers.policies (cycle removed).
- Grid upload check screen options: POST /api/commission/grid/upload also takes valid_from, valid_to, apply_to_past (query). From/To override the row dates, but only for rows that change (unchanged rows stay unchanged). apply_to_past → updates via apply_rule_update(..., True) (older versions replaced), new rules valid_from=None; preview shows "All policies". Changing these on the screen re-runs the preview. Condition changes are itemised ("RTOs: all → TN99"); _signature normalises numbers (500 == 500.0) so an untouched round-trip is all "unchanged".
- Business type (New / Renewal / Rollover / Used):
  - PolicyFields: previous_insurer, previous_policy_number, business_type (OCR reads them; editable on review screen; normalise_business_type maps "Roll Over" etc.).
  - lib/business_type.infer_business_type at OCR time: printed value wins; else new vehicle (NEW… reg or registered ≤60 days before risk start) → New; previous insurer same company → Renewal, different → Rollover; motor with no previous insurer → Used. Migration business_type_backfill_v1 for old policies sets only New/Renewal/Rollover (never Used), rest blank.
  - Rule condition `business_types: List[str]` (empty = all) on receivable + payable rules, all companies/products; matched in match_score/explain/overlaps/_covers/_signature; validated in _clean. Excel grid column "Business Type (...)"; Compare conditions; rate card chips.
  - Policy MIS filter `business_type`, MIS Excel column "Business Type" after Policy Type; /api/meta business_types.
- Rule dialog chip groups (Business type, Vehicle age, Fuel) start with an explicit "All" chip: on when nothing picked; picking every option collapses to All (stored as []).
- Commission hold (routers/holds.py, "Hold" tab): `commission_holds` {id, insurer|null, product_type|null, product|null, agent_ids[], agent_groups[] (both empty = all agents), hold_from, reason, released_on|null, created_by_name, released_by_name}. GET/POST /api/commission/holds, POST /{id}/release {released_on (default today, ≥ hold_from)}, DELETE /{id}.
  - compute(): policies with risk start in [hold_from, released_on) for a covered company/product/agent → payable 0, held=true, note "Agent commission on hold from …" (receivable unchanged). Earlier policies paid normally; statements skip 0 payables.
  - my_rates: rates covered by an active hold are hidden once hold_from ≤ today; before that they carry hold_from ("Stops <date>" badge). Admin preview without agent only applies all-agent holds.
