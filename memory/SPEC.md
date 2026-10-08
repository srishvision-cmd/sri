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
- Rule dates: UI shows only "Effective from" (valid_from). valid_to is system-managed. Matching date = policy risk start_date, else upload date (created_at, IST).
- PUT /api/commission/rules/{id}: if rule was created today (IST) or new effective date ≤ its own valid_from → in-place edit. Otherwise VERSIONED: new rule doc (version_of = root id, valid_from = effective date, default today) inserted; old doc gets valid_to = effective−1 and superseded_by = new id. Old versions remain active for past policies; editing a superseded version → 409.
- DELETE: created today → hard delete (+ re-opens the version it replaced); older → stopped (valid_to = yesterday, superseded_by "ended").
- Rules table hides superseded versions; badge "vN · earlier rates kept". Create dialog: optional Effective from (blank = all policies). Edit dialog: defaults to today.
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
