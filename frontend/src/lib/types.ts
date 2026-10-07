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
}

export interface UserUpdate {
  full_name?: string;
  branch?: string;
  email?: string | null;
  mobile?: string | null;
  assigned_agent_ids?: string[];
  agent_group?: string | null;
  broker_id?: string | null;
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

export type PolicyStatus = "processing" | "extracted" | "failed" | "flagged" | "verified" | "duplicate";

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

export type PaymentMode = "Cash" | "Online" | "Cheque" | "Partial Payment";

export interface PaymentEntry {
  id: string;
  amount: number;
  reference: string | null;
  paid_on: string | null;
  recorded_by_name: string;
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
  broker_paid: number;
  broker_outstanding: number | null;
  commission_statement_no: string | null;
  commission_paid: boolean;
  commission_paid_date: string | null;
  commission_utr: string | null;
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
}

export interface PolicyFilterState {
  status: string;
  lob: string;
  agent_id: string;
  q: string;
  date_from: string;
  date_to: string;
  age_bucket: string;
  payment_mode: string;
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

export interface AgentGroup {
  id: string;
  name: string;
  created_at: string;
}

export interface AgentGroupIn {
  name: string;
}

export type RuleKind = "receivable" | "payable";
export type NcbFilter = "any" | "with" | "without";

export interface CommissionRuleIn {
  kind: RuleKind;
  name: string;
  active: boolean;
  insurer: string | null;
  broker_id: string | null;
  agent_group: string | null;
  agent_id: string | null;
  products: string[];
  rtos: string[];
  ncb: NcbFilter;
  gvw_min: number | null;
  gvw_max: number | null;
  cc_min: number | null;
  cc_max: number | null;
  vehicle_ages: string[];
  fuel_types: string[];
  seating_min: number | null;
  seating_max: number | null;
  make: string | null;
  model: string | null;
  valid_from: string | null;
  valid_to: string | null;
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
  payable_rule_id: string | null;
  payable_rule_name: string | null;
  capped: boolean;
  note: string | null;
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
  status: "generated" | "paid";
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
export type SettleMode = "Cash" | "Online" | "Cheque" | "NEFT/RTGS" | "UPI" | "Adjustment";

export interface Allocation {
  policy_id: string;
  policy_number: string | null;
  reg_no: string | null;
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
  paid_on: string;
  allocations: Allocation[];
  created_by_name: string;
  created_at: string;
}

export interface SettlementIn {
  kind: ReconKind;
  party_id: string;
  amount: number;
  mode: SettleMode;
  reference: string | null;
  paid_on: string;
  policy_ids: string[];
}

export interface ReconParty {
  party_id: string;
  party_name: string;
  policies: number;
  premium: number;
  paid: number;
  outstanding: number;
  outstanding_policies: number;
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
