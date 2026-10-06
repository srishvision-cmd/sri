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
  active: boolean;
  created_at: string;
}

export interface UserCreate {
  full_name: string;
  role: "agent" | "backoffice";
  branch: string;
  email?: string | null;
  mobile?: string | null;
  assigned_agent_ids: string[];
}

export interface UserUpdate {
  full_name?: string;
  branch?: string;
  email?: string | null;
  mobile?: string | null;
  assigned_agent_ids?: string[];
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
}

export type PolicyStatus = "processing" | "extracted" | "failed" | "flagged" | "verified";

export interface PolicyFields {
  policy_number: string | null;
  insurer: string | null;
  lob: string | null;
  product_name: string | null;
  insured_name: string | null;
  mobile: string | null;
  email: string | null;
  start_date: string | null;
  end_date: string | null;
  sum_insured: number | null;
  net_premium: number | null;
  gst: number | null;
  gross_premium: number | null;
  vehicle_reg_no: string | null;
  rto: string | null;
  registration_date: string | null;
  make: string | null;
  model: string | null;
  mfg_year: string | null;
  cc: number | null;
  seating_capacity: number | null;
  gvw: number | null;
  chassis_no: string | null;
  engine_no: string | null;
  idv: number | null;
  od_premium: number | null;
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
  flag_reason: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  history: HistoryEntry[];
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
}

export interface Meta {
  branches: string[];
  lobs: string[];
  age_buckets: string[];
}

export interface PolicyFilterState {
  status: string;
  lob: string;
  agent_id: string;
  q: string;
  date_from: string;
  date_to: string;
  age_bucket: string;
}
