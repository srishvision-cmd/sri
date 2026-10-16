// Hand-written mirrors of backend Pydantic models (models/user.py, models/policy.py). Keep in sync.

export type Role = "admin" | "agent" | "backoffice";

export interface User {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  branch: string | null;
  email: string | null;
  mobile: string | null;
  assigned_agent_ids: string[];
  agent_group: string | null;
  broker_id: string | null;
  allowed_broker_ids: string[]; // backoffice: empty = all brokers
  portal_access: boolean; // backoffice: Insurer Portals & OTP
  active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export interface ChangePasswordIn {
  current_password: string;
  new_password: string;
}

export interface UserCreate {
  full_name: string;
  role: "agent" | "backoffice";
  branch: string;
  email?: string | null;
  mobile?: string | null;
  assigned_agent_ids: string[];
  agent_group?: string | null;
  broker_id?: string | null;
  allowed_broker_ids?: string[];
  portal_access?: boolean;
}

export interface UserUpdate {
  full_name?: string;
  branch?: string;
  email?: string | null;
  mobile?: string | null;
  assigned_agent_ids?: string[];
  agent_group?: string | null;
  broker_id?: string | null;
  allowed_broker_ids?: string[];
  portal_access?: boolean;
  active?: boolean;
}

export interface Credentials {
  user: User;
  username: string;
  temp_password: string;
}

export interface AgentOption {
  id: string;
  full_name: string;
  username: string;
  branch: string | null;
  broker_id: string | null;
}

export type PolicyStatus = "uploaded" | "processing" | "extracted" | "failed" | "flagged" | "verified" | "duplicate";

export interface PolicyFields {
  policy_number: string | null;
  insurer: string | null;
  intermediary_name: string | null;
  lob: string | null;
  product_name: string | null;
  product_category: string | null;
  insured_name: string | null;
  mobile: string | null;
  email: string | null;
  start_date: string | null;
  end_date: string | null;
  tp_end_date: string | null;
  sum_insured: number | null;
  net_premium: number | null;
  gst: number | null;
  gross_premium: number | null;
  cover_type: string | null;
  vehicle_class: string | null;
  vehicle_reg_no: string | null;
  rto: string | null;
  registration_date: string | null;
  make: string | null;
  model: string | null;
  mfg_year: string | null;
  fuel_type: string | null;
  cc: number | null;
  seating_capacity: number | null;
  gvw: number | null;
  chassis_no: string | null;
  engine_no: string | null;
  idv: number | null;
  od_premium: number | null;
  addon_premium: number | null;
  tp_premium: number | null;
  ncb_percent: number | null;
  previous_insurer: string | null;
  previous_policy_number: string | null;
  business_type: string | null;
  vehicle_age_years: number | null;
  vehicle_age_bucket: string | null;
  plan_name: string | null;
  members_covered: string | null;
  deductible: number | null;
}

export interface HistoryEntry {
  at: string;
  by_name: string;
  by_role: string;
  action: string;
  note: string | null;
}

export type PaymentMode = "Cash" | "Online" | "Cheque" | "Partial Payment" | "Net of Commission";
export type BrokerPayMode = "Cash" | "Online" | "Cheque" | "Partial Payment" | "Pay Later";

export interface PaymentEntry {
  id: string;
  amount: number;
  reference: string | null;
  paid_on: string | null;
  recorded_by_name: string;
  settlement_id?: string | null;
  at: string;
}

export interface PaymentIn {
  amount: number;
  reference?: string | null;
  paid_on?: string | null;
}

export interface AgentOutstanding {
  agent_id: string;
  agent_name: string;
  agent_code: string;
  branch: string | null;
  policies: number;
  total_premium: number;
  paid: number;
  outstanding: number;
}

export interface Policy {
  id: string;
  file_name: string | null;
  file_mime: string | null;
  has_file: boolean;
  status: PolicyStatus;
  client_upload_id: string | null; // browser per-file id (retry-safe uploads)
  ocr_attempts: number;
  agent_id: string;
  agent_name: string;
  agent_code: string;
  branch: string | null;
  uploaded_by_id: string;
  uploaded_by_name: string;
  fields: PolicyFields;
  confidence: Record<string, number>;
  ocr_error: string | null;
  duplicate_reason: string | null;
  duplicate_of_id: string | null;
  flag_reason: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  history: HistoryEntry[];
  payment_mode: PaymentMode | null;
  payments: PaymentEntry[];
  broker_id: string | null;
  broker_name: string | null;
  commission: CommissionResult | null; // admin only
  broker_payments: PaymentEntry[];
  broker_payment_mode: BrokerPayMode | null;
  upload_batch_id: string | null;
  broker_paid: number;
  broker_outstanding: number | null;
  commission_statement_no: string | null;
  commission_paid: boolean;
  commission_paid_date: string | null;
  commission_utr: string | null;
  onspot_reference: string | null;
  has_onspot_proof: boolean;
  onspot_status: OnSpotStatus | null;
  onspot_checked_by_name: string | null;
  onspot_checked_at: string | null;
  onspot_note: string | null;
  file_size: number | null;
  original_size: number | null;
  amount_paid: number | null; // computed by backend
  outstanding: number | null; // computed by backend
}

export interface PolicyUpdate {
  fields: PolicyFields;
  note?: string | null;
}

export interface GroupStat {
  label: string;
  count: number;
  premium: number;
}

export interface Stats {
  total: number;
  processing: number;
  extracted: number;
  flagged: number;
  verified: number;
  failed: number;
  gross_premium: number;
  net_premium: number;
  by_lob: GroupStat[];
  by_insurer: GroupStat[];
  by_product: GroupStat[];
  by_agent: GroupStat[];
  by_age: GroupStat[];
  outstanding: number;
}

export interface Meta {
  branches: string[];
  lobs: string[];
  age_buckets: string[];
  cover_types: string[];
  vehicle_classes: string[];
  payment_modes: string[];
  product_categories: string[];
  business_types: string[];
  insurers: string[]; // companies present in the MIS
}

export interface PolicyFilterState {
  status: string;
  lob: string;
  agent_id: string;
  q: string;
  date_from: string;
  date_to: string;
  age_bucket: string;
  business_type: string;
  payment_mode: string;
  broker_id: string; // channel partner id, "none" = not assigned
  insurer: string; // insurance company (exact)
}

export interface UsageGroup {
  label: string;
  files: number;
  stored_bytes: number;
  original_bytes: number;
  ocr_runs: number;
  est_cost_inr: number;
}

export interface UsageMonth {
  month: string;
  ocr_runs: number;
  files: number;
  est_cost_inr: number;
}

export interface Usage {
  total_files: number;
  stored_bytes: number;
  original_bytes: number;
  avg_file_bytes: number;
  under_target_files: number;
  target_bytes: number;
  ocr_runs: number;
  ocr_success: number;
  ocr_failed: number;
  ocr_runs_this_month: number;
  est_cost_per_policy_inr: number;
  est_cost_total_inr: number;
  est_cost_this_month_inr: number;
  model_name: string;
  by_month: UsageMonth[];
  by_branch: UsageGroup[];
  by_agent: UsageGroup[];
}

export interface ReassignAgentIn {
  policy_ids: string[];
  agent_id: string;
}

export interface ReassignResult {
  updated: number;
  agent_name: string;
  agent_code: string;
}

export interface BulkBrokerIn {
  policy_ids: string[];
  broker_id: string | null;
}

export interface BrokerSetIn {
  broker_id: string | null;
}

export interface Broker {
  id: string;
  name: string;
  code: string | null;
  aliases: string[];
  active: boolean;
  created_at: string;
}

export interface BrokerIn {
  name: string;
  code?: string | null;
  aliases: string[];
  active: boolean;
}

export interface GroupMargin {
  insurer: string | null; // null = all other companies
  product_type: string | null; // null = all products
  product: string | null; // specific product inside the type, e.g. "PCV - Taxi"
  business_type: string | null; // New / Renewal / Rollover / Used; null = all
  valid_from: string | null; // policy risk-start date the margin applies from
  valid_to: string | null; // system-set when a newer line for the same company + product starts
  margin: number; // "On Net": points kept on Net / OD+TP % (and OD / TP when those are null)
  od_margin: number | null; // points kept on OD % (null = same as margin)
  tp_margin: number | null; // points kept on TP % (null = same as margin)
  flat_margin: number | null; // ₹ kept from a flat-amount receivable (null = flat passed through)
  ended: boolean; // stopped after valid_to
}

export interface MarginGridRow {
  insurer: string | null;
  product_type: string | null;
  product: string | null;
  business_type: string | null;
  margins: Record<string, number | null>;
  since: Record<string, string | null>;
}

export interface MarginGrid {
  groups: string[];
  rows: MarginGridRow[];
}

export interface MarginGridIn {
  rows: MarginGridRow[];
  valid_from: string | null;
  apply_to_past: boolean;
}

export interface MarginGridSaveResult {
  changed: number;
}

export interface GroupMarginsIn {
  margins: GroupMargin[];
}

export interface AgentGroup {
  id: string;
  name: string;
  margins: GroupMargin[];
  created_at: string;
}

export interface AgentGroupIn {
  name: string;
}

export type RuleKind = "receivable" | "payable";
export type NcbFilter = "any" | "with" | "without";
export type CoverFilter = "any" | "package" | "satp";

export interface CommissionRuleIn {
  kind: RuleKind;
  name: string;
  active: boolean;
  insurer: string | null;
  broker_ids: string[]; // channel partners (any of these; empty = all partners)
  agent_group: string | null;
  agent_id: string | null;
  products: string[];
  rtos: string[];
  ncb: NcbFilter;
  cover: CoverFilter;
  gvw_min: number | null;
  gvw_max: number | null;
  cc_min: number | null;
  cc_max: number | null;
  vehicle_ages: string[];
  fuel_types: string[];
  business_types: string[];
  seating_min: number | null;
  seating_max: number | null;
  makes: string[];
  model: string | null;
  valid_from: string | null;
  valid_to: string | null;
  apply_to_past?: boolean;
  od_percent: number | null;
  tp_percent: number | null;
  net_percent: number | null;
  odtp_percent: number | null;
  flat_amount: number | null;
}

export interface CommissionRule extends CommissionRuleIn {
  id: string;
  version_of: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommissionResult {
  receivable: number | null;
  payable: number | null;
  margin: number | null;
  receivable_rule_id: string | null;
  receivable_rule_name: string | null;
  receivable_rate: string | null; // company % saved with the policy's snapshot
  payable_rule_id: string | null;
  payable_rule_name: string | null;
  payable_rate: string | null;
  held: boolean;
  hold_reason: string | null;
  declined: boolean; // insurer declines this RTO for the product → receivable & payable 0
  declined_reason: string | null;
  capped: boolean;
  note: string | null;
  locked_at: string | null; // commission frozen at verification (rule edits no longer change it)
  misses: RuleMiss[];
}

export interface RuleMiss {
  rule_id: string;
  rule_name: string;
  kind: RuleKind;
  reasons: string[];
}

export interface RtoState {
  code: string;
  name: string;
  rtos: string[];
}

export interface CommissionMasters {
  insurers: string[];
  product_types: Record<string, string[]>;
  makes: Record<string, string[]>;
  rto_states: RtoState[];
  age_bands: string[];
  fuel_types: string[];
  cv_fuel_types: string[];
  rto_zones: RtoZone[];
  fuel_by_type: Record<string, string[]>;
  business_types: string[];
  models: Record<string, string[]>;
}

export interface CompanyZoneIn {
  insurer: string | null; // null = RTO group for all companies
  name: string;
  rtos: string[];
}

export interface CompanyZone extends CompanyZoneIn {
  id: string;
  created_at: string;
}

export interface VehicleModelIn {
  make: string;
  model: string;
}

export interface GridRowError {
  row: number;
  sheet: string | null;
  error: string;
}

export interface GridRowPreview {
  row: number;
  sheet: string | null; // product sheet of the Excel
  action: "create" | "update" | "unchanged" | "error";
  kind: string | null;
  name: string | null;
  insurer: string | null;
  changes: string[];
  effective_from: string | null;
  error: string | null;
}

export interface GridUploadResult {
  preview: boolean;
  created: number;
  updated: number;
  unchanged: number;
  errors: GridRowError[];
  rows: GridRowPreview[];
  learned_insurer?: string | null; // AI upload only: company whose saved layout was updated
  learned_accuracy?: number | null; // AI upload only: % of cells not corrected
}

export interface CompareRates {
  od_percent: number | null;
  tp_percent: number | null;
  net_percent: number | null;
  odtp_percent: number | null;
  flat_amount: number | null;
}

export interface ComparePayable {
  label: string;
  source: "rule" | "group_margin";
  rule_name: string | null;
  rates: CompareRates;
  margin: CompareRates;
  low_margin: boolean;
}

export interface CommissionSettings {
  min_margin: number;
}

export interface BulkPayableIn {
  agent_group: string;
  margin: number;
  insurer: string | null;
  rule_ids: string[] | null;
  preview: boolean;
}

export interface BulkPayableRow {
  rule_id: string;
  insurer: string | null;
  product: string;
  receivable_name: string;
  receivable: CompareRates;
  payable: CompareRates;
  status: "ready" | "created" | "skipped" | "error";
  note: string | null;
}

export interface BulkPayableResult {
  preview: boolean;
  created: number;
  rows: BulkPayableRow[];
}

export interface CompareRow {
  rule_id: string;
  insurer: string | null;
  product: string;
  broker: string | null;
  rule_name: string;
  conditions: string[];
  valid_from: string | null;
  rates: CompareRates;
  payables: ComparePayable[];
}

export interface RtoZone {
  name: string;
  rtos: string[];
}

export interface GroupMembersIn {
  agent_ids: string[];
}

export type PeriodType = "daily" | "weekly" | "monthly" | "custom";

export interface StatementLine {
  policy_id: string;
  policy_number: string | null;
  reg_no: string | null;
  insured_name: string | null;
  insurer: string | null;
  product: string | null;
  start_date: string | null;
  net_premium: number | null;
  payable: number;
  rule_name: string | null;
  commission_rate: string | null;
}

export interface OutstandingLine {
  policy_id: string;
  policy_number: string | null;
  reg_no: string | null;
  insured_name: string | null;
  payment_mode: string | null;
  gross_premium: number | null;
  outstanding: number;
  deducted: number;
}

export interface CommissionStatement {
  id: string;
  number: string;
  agent_id: string;
  agent_name: string;
  agent_code: string;
  branch: string | null;
  period_type: PeriodType;
  from_date: string;
  to_date: string;
  lines: StatementLine[];
  outstanding_lines: OutstandingLine[];
  total_payable: number;
  total_outstanding: number;
  outstanding_deducted: number;
  outstanding_balance: number;
  net_payable: number;
  status: StatementStatus;
  approval_log: StatementAudit[];
  approved_by_name: string | null;
  approved_at: string | null;
  paid_date: string | null;
  utr: string | null;
  paid_by_name: string | null;
  created_by_name: string;
  created_at: string;
}

export interface StatementGenerateIn {
  agent_id: string;
  period_type: PeriodType;
  ref_date?: string | null;
  from_date?: string | null;
  to_date?: string | null;
}

export interface StatementPaidIn {
  paid_date: string;
  utr: string;
}

export type ReconKind = "agent" | "broker";
export type SettleMode = "Cash" | "Online" | "Cheque" | "NEFT/RTGS" | "UPI" | "Adjustment" | "On-account" | "Paid at upload";

export type PaidTo = "Broker" | "Insurance Company";

export interface Allocation {
  policy_id: string;
  policy_number: string | null;
  reg_no: string | null;
  amount: number;
}

export interface AllocationIn {
  policy_id: string;
  amount: number;
}

export interface Settlement {
  id: string;
  kind: ReconKind;
  party_id: string;
  party_name: string;
  amount: number;
  mode: SettleMode;
  reference: string | null;
  paid_to: PaidTo | null;
  paid_on: string;
  allocations: Allocation[];
  unallocated: number;
  reversed: boolean;
  reversed_by_name: string | null;
  reversed_at: string | null;
  created_by_name: string;
  created_at: string;
}

export interface SettlementIn {
  kind: ReconKind;
  party_id: string;
  amount: number;
  mode: SettleMode;
  reference: string | null;
  paid_to: PaidTo | null;
  paid_on: string;
  allocations: AllocationIn[];
}

export interface ReconParty {
  party_id: string;
  party_name: string;
  policies: number;
  premium: number;
  paid: number;
  outstanding: number;
  outstanding_policies: number;
  on_account: number;
}

export interface ReconPolicy {
  policy_id: string;
  policy_number: string | null;
  reg_no: string | null;
  insured_name: string | null;
  insurer: string | null;
  uploaded_on: string | null;
  premium: number;
  paid: number;
  outstanding: number;
}

export interface PartyStatementRow {
  policy_id: string;
  customer_name: string | null;
  policy_number: string | null;
  reg_no: string | null;
  rto: string | null;
  insurer: string | null;
  product: string | null;
  uploaded_on: string;
  gross_premium: number;
  od_premium: number | null;
  tp_premium: number | null;
  net_premium: number | null;
  commission_percent: number | null;
  commission: number;
  paid_by: string;
  premium_paid: number;
  pending_premium: number;
  partial: boolean;
  partial_label: string | null;
  payment_details: string | null;
}

export interface PartyStatement {
  kind: ReconKind;
  party_id: string;
  party_name: string;
  date_from: string | null;
  date_to: string | null;
  rows: PartyStatementRow[];
  total_premium: number;
  total_commission: number;
  cash_pending: number;
  partial_pending: number;
  net: number;
  net_label: string;
}

export interface UploadBatchIn {
  policy_ids: string[];
  agent_amount: number | null;
  agent_reference: string | null;
  broker_amount: number | null;
  broker_reference: string | null;
}

export interface UploadBatchPayment {
  id: string;
  kind: ReconKind;
  party_id: string;
  policy_ids: string[];
  amount: number;
  reference: string | null;
  paid_on: string;
  created_by_name: string;
  status: "pending" | "allocating" | "allocated";
  settlement_id: string | null;
  created_at: string;
}

export interface Portal {
  id: string;
  insurer: string;
  url: string;
  username: string;
  has_password: boolean;
  otp_filters: string[];
  notes: string | null;
  active: boolean;
  all_agents: boolean;
  agent_ids: string[];
  mailbox_host: string | null;
  mailbox_port: number;
  mailbox_email: string | null;
  has_mailbox_password: boolean;
  updated_at: string;
}

export interface PortalIn {
  insurer: string;
  url: string;
  username: string;
  password: string | null;
  otp_filters: string[];
  notes: string | null;
  active: boolean;
  all_agents: boolean;
  agent_ids: string[];
  mailbox_host: string | null;
  mailbox_port: number;
  mailbox_email: string | null;
  mailbox_password: string | null;
}

export interface PortalSecret {
  password: string;
}

export interface PortalView {
  id: string;
  portal_id: string;
  insurer: string;
  user_name: string;
  user_role: string;
  at: string;
}

export interface MailboxSettings {
  host: string;
  port: number;
  email: string;
  has_password: boolean;
  configured: boolean;
}

export interface MailboxIn {
  host: string;
  port: number;
  email: string;
  password: string | null;
}

export interface MailboxTest {
  ok: boolean;
  message: string;
}

export interface OtpMessage {
  uid: string;
  portal_id: string | null;
  insurer: string | null;
  sender: string;
  subject: string;
  received_at: string;
  otp: string | null;
  snippet: string;
  expires_at: string | null;
}

export interface OtpClaim {
  id: string;
  portal_id: string;
  insurer: string;
  user_id: string;
  user_name: string;
  at: string;
  expires_at: string;
}

export interface OtpRequestIn {
  portal_id: string;
}

export interface OtpError {
  insurers: string[];
  message: string;
}

export interface OtpFeed {
  messages: OtpMessage[];
  errors: OtpError[];
  waiting: OtpClaim[];
  others_waiting: string[];
}

export interface AgentRate {
  hold_from: string | null; // rate stops on this date (commission hold)
  id: string;
  name: string;
  insurer: string | null;
  products: string[];
  rtos: string[];
  ncb: NcbFilter;
  cover: CoverFilter;
  gvw_min: number | null;
  gvw_max: number | null;
  cc_min: number | null;
  cc_max: number | null;
  vehicle_ages: string[];
  fuel_types: string[];
  business_types: string[];
  seating_min: number | null;
  seating_max: number | null;
  makes: string[];
  model: string | null;
  valid_from: string | null;
  valid_to: string | null;
  od_percent: number | null;
  tp_percent: number | null;
  net_percent: number | null;
  odtp_percent: number | null;
  flat_amount: number | null;
  personal: boolean;
  group_rate: boolean;
  upcoming: boolean;
}

export interface AgentRateCard {
  agent_name: string | null;
  agent_code: string | null;
  agent_group: string | null;
  as_of: string;
  rates: AgentRate[];
}

export interface RecompressResult {
  checked: number;
  compressed: number;
  saved_bytes: number;
  remaining: number;
}

export interface InsurerIn {
  name: string;
  keywords: string[];
  active: boolean;
}

export interface Insurer extends InsurerIn {
  id: string;
  builtin: boolean;
  created_at: string;
}

export interface DeclinedRtoIn {
  insurer: string;
  product_type: string | null; // null = every product
  products: string[]; // empty = every product of the type
  rtos: string[]; // e.g. TN29
  note: string | null;
}

export interface DeclinedRto extends DeclinedRtoIn {
  id: string;
  created_by_name: string;
  created_at: string;
}

export interface InsurerDupEntry {
  id: string;
  name: string;
  builtin: boolean;
  keywords: string[];
  policies: number;
  rules: number;
}

export interface InsurerDupGroup {
  key: string;
  canonical_id: string; // suggested entry to keep
  entries: InsurerDupEntry[];
  policy_names: string[]; // every spelling on policies — all relinked to the kept name
}

export interface InsurerMergeIn {
  groups: { canonical_id: string; merge_ids: string[] }[];
}

export interface InsurerMergeResult {
  merged: number;
  policies_relinked: number;
  rules_relinked: number;
}

export type OnSpotStatus = "pending" | "confirmed" | "not_received";

export interface OnSpotCheckIn {
  status: OnSpotStatus;
  note?: string | null;
}

export interface OnSpotRow {
  policy_id: string;
  policy_number: string | null;
  insured_name: string | null;
  reg_no: string | null;
  insurer: string | null;
  agent_name: string;
  agent_code: string;
  gross_premium: number | null;
  commission: number | null;
  expected_amount: number | null;
  reference: string | null;
  has_proof: boolean;
  status: OnSpotStatus;
  checked_by_name: string | null;
  checked_at: string | null;
  note: string | null;
  uploaded_at: string;
}

export interface CommissionHoldIn {
  insurer: string | null;
  product_type: string | null;
  product: string | null;
  agent_ids: string[];
  agent_groups: string[];
  broker_ids: string[]; // channel partners (empty = all partners)
  hold_from: string;
  reason: string | null;
}

export interface CommissionHold extends CommissionHoldIn {
  id: string;
  released_on: string | null;
  created_by_name: string | null;
  released_by_name: string | null;
  created_at: string;
}

export interface HoldReleaseIn {
  released_on: string | null;
}

export interface AgentHoldNotice {
  id: string;
  insurer: string | null;
  product: string;
  hold_from: string;
  released_on: string | null;
  reason: string | null;
  upcoming: boolean;
}

// ---------- rule tools: copy rules · rate matrix (mirror models/commission.py) ----------
export type RateKey = "od_percent" | "tp_percent" | "net_percent" | "odtp_percent" | "flat_amount";

export type RuleRates = Partial<Record<RateKey, number | null>>;

export interface RuleCopyIn {
  rule_ids: string[];
  insurer: string | null; // null = keep
  broker_ids: string[] | null; // null = keep, [] = all partners
  valid_from: string | null;
  valid_to: string | null;
  rates: Record<string, RuleRates>;
  agent_id?: string | null; // payable only: copy to this one agent
  on_conflict?: "keep" | "overwrite"; // target already has rules for the company + product (default keep)
  preview: boolean;
}

export interface RuleToolRow {
  key: string;
  name: string;
  action: "create" | "update" | "unchanged" | "error";
  error: string | null;
  rule_id: string | null;
  conflicts: string[]; // copy to a target: its existing rules for the same company + product
}

export interface RuleToolResult {
  preview: boolean;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  rows: RuleToolRow[];
}

export interface ReopenRulesIn {
  rule_ids: string[];
  preview: boolean;
}

export interface MatrixColumn {
  label: string;
  rtos: string[];
  gvw_min: number | null;
  gvw_max: number | null;
}

export interface MatrixCell {
  age: string | null;
  col: number;
  value: number | null;
}

export interface RateMatrixIn {
  kind: RuleKind;
  insurer: string;
  broker_ids: string[];
  products: string[];
  agent_group: string | null;
  agent_id: string | null;
  component: RateKey;
  columns: MatrixColumn[];
  cells: MatrixCell[];
  valid_from: string | null;
  preview: boolean;
}

// ---------- AI grid reading (mirror models/commission.py) ----------
export interface AiGridRow {
  kind: string | null;
  name: string | null;
  insurer: string | null;
  broker: string | null;
  agent_group: string | null;
  agent_code: string | null;
  ptype: string | null;
  products: string | null;
  makes: string | null;
  model: string | null;
  rtos: string | null;
  vehicle_ages: string | null;
  fuel_types: string | null;
  business_types: string | null;
  ncb: string | null;
  cover: string | null;
  gvw_min: number | null;
  gvw_max: number | null;
  cc_min: number | null;
  cc_max: number | null;
  seating_min: number | null;
  seating_max: number | null;
  od_percent: number | null;
  tp_percent: number | null;
  net_percent: number | null;
  odtp_percent: number | null;
  flat_amount: number | null;
  valid_from: string | null;
  valid_to: string | null;
  needs_review: boolean;
  review_note: string | null;
}

export interface AiGridRead {
  file_name: string;
  rows: AiGridRow[];
  note: string | null;
  template_insurer: string | null; // saved layout used for this read
  template_uses: number;
  today: string; // server date — rows ending before it are flagged
}

export interface AiGridApplyIn {
  rows: AiGridRow[];
  preview: boolean;
  valid_from: string | null;
  valid_to: string | null;
  original_rows: AiGridRow[]; // AI's reading of the same rows → corrections are learned
  template_insurer: string | null;
  file_name: string | null;
  used_layout: boolean;
}

// ---------- saved AI grid layouts (mirror models/commission.py GridTemplate) ----------
export interface GridCorrection {
  field: string;
  ai_value: string;
  approved_value: string;
  count: number;
}
export interface GridUploadStat {
  at: string;
  file: string | null;
  rows: number;
  cells_checked: number;
  cells_corrected: number;
  rows_corrected: number;
  accuracy: number; // % of cells the admin did not have to correct
  used_layout: boolean;
}
export interface GridTemplate {
  id: string;
  insurer: string;
  kind: string;
  notes: string;
  corrections: GridCorrection[];
  examples: AiGridRow[];
  uploads: GridUploadStat[]; // newest last
  uses: number;
  last_file: string | null;
  updated_at: string;
  updated_by: string | null;
}
export interface GridTemplateIn {
  notes: string;
}

// ---------- agent-wise payables ----------
export interface AgentPayableRow {
  receivable_id: string;
  insurer: string | null;
  product: string;
  products: string[]; // receivable's products (empty = all products)
  broker: string | null;
  receivable_name: string;
  conditions: string[];
  receivable: CompareRates;
  payable: CompareRates | null; // null = missing
  source: "agent_rule" | "group_margin" | "group_rule" | "common_rule" | "missing";
  source_label: string;
  agent_rule_id: string | null;
}

export interface AgentPayablesView {
  agent_id: string;
  agent_label: string;
  agent_group: string | null;
  rows: AgentPayableRow[];
}

export interface AgentPayablesIn {
  agent_id: string;
  rows: { receivable_id: string; rates: RuleRates }[];
  valid_from: string | null;
  valid_to: string | null; // blank = open-ended
  preview: boolean;
}

// ---------- commission snapshot recalculation + audit, missing payables (mirror models/recalc.py) ----------
export interface CommissionValues {
  receivable: number | null;
  payable: number | null;
  margin: number | null;
  receivable_rule_name: string | null;
  receivable_rate: string | null;
  payable_rule_name: string | null;
  payable_rate: string | null;
}
export interface RecalcPreviewIn {
  policy_ids: string[];
}
export interface RecalcApplyIn extends RecalcPreviewIn {
  reason: string;
}
export interface RecalcRow {
  policy_id: string;
  policy_number: string | null;
  customer_name: string | null;
  agent_name: string | null;
  status: string;
  before: CommissionValues;
  after: CommissionValues;
  changed: boolean;
  blocked: string | null;
}
export interface RecalcPreview {
  rows: RecalcRow[];
  eligible: number;
  changed: number;
  blocked: number;
}
export interface RecalcResult extends RecalcPreview {
  batch_id: string;
  updated: number;
}
export interface CommissionAudit {
  id: string;
  batch_id: string | null;
  policy_id: string;
  policy_number: string | null;
  action: "admin_recalculate" | "policy_corrected";
  reason: string | null;
  by_id: string | null;
  by_name: string;
  by_role: string;
  at: string;
  before: CommissionValues;
  after: CommissionValues;
}
export interface MissingPayableAgent {
  agent_id: string;
  agent_label: string;
  missing_count: number;
  receivables: string[];
}
export interface MissingPayables {
  rule_count: number;
  since: string | null;
  agents: MissingPayableAgent[];
}

// ---------- delete grid rules by date (mirror routers/rule_purge.py) ----------
export interface PurgeIn {
  date_from: string;
  date_to: string;
  kinds: RuleKind[];
}
export interface PurgeApplyIn extends PurgeIn {
  confirm_count: number;
}
export interface PurgeRuleRow {
  id: string;
  kind: string;
  name: string;
  insurer: string | null;
  created_at: string;
  updated_at: string;
}
export interface PurgePreview {
  count: number;
  receivable: number;
  payable: number;
  policies_snapshotted: number;
  rules: PurgeRuleRow[];
}
export interface PurgeResult {
  deleted: number;
  receivable: number;
  payable: number;
}

// ---------- statement approval (mirror models/statement.py) ----------
export type StatementStatus = "pending_approval" | "approved" | "rejected" | "paid";
export interface StatementAudit {
  action: "generated" | "approved" | "rejected" | "paid";
  by_id: string | null;
  by_name: string;
  by_role: string;
  at: string;
  note: string | null;
}
export interface StatementDecisionIn {
  note: string | null;
}
export interface StatementRejectIn {
  note: string;
}

// ---------- date-range rule revision → explicit recalculation (mirror models/recalc.py RangePolicies) ----------
export interface RangePolicies {
  rule_id: string;
  valid_from: string | null;
  valid_to: string | null;
  count: number;
  policy_ids: string[];
}

// ---------- undo delete (mirror routers/rule_purge.py) ----------
export interface PurgeBatch {
  id: string;
  by_name: string;
  at: string;
  date_from: string;
  date_to: string;
  kinds: string[];
  count: number;
  restored: boolean;
  restored_by_name: string | null;
  restored_at: string | null;
}
export interface RestoreResult {
  restored: number;
  skipped: number;
}

// ---------- margin presets (mirror routers/margin_presets.py) ----------
export interface ProductMargin {
  product: string;
  minus_percent: number | null;
  minus_flat: number | null;
}
export interface MarginPresetIn {
  name: string;
  minus_percent: number | null; // default for products without their own line
  minus_flat: number | null;
  agent_group: string | null;
  by_product: ProductMargin[]; // per-product overrides
}
export interface MarginPreset extends MarginPresetIn {
  id: string;
  created_by_name: string;
  created_at: string;
}
