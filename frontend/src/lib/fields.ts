import type { PolicyFields, PolicyFilterState } from "./types";

export interface FieldDef {
  key: keyof PolicyFields;
  label: string;
  kind: "text" | "number" | "date" | "select";
  metaKey?: "lobs" | "cover_types" | "vehicle_classes"; // option source for kind "select"
  derived?: boolean; // computed by the server, read-only
}

export interface FieldGroup {
  id: string;
  title: string;
  lob?: string;
  fields: FieldDef[];
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    id: "policy",
    title: "Policy details",
    fields: [
      { key: "policy_number", label: "Policy No.", kind: "text" },
      { key: "insurer", label: "Insurer", kind: "text" },
      { key: "lob", label: "Line of business", kind: "select", metaKey: "lobs" },
      { key: "product_name", label: "Product", kind: "text" },
      { key: "start_date", label: "Risk start date", kind: "date" },
      { key: "end_date", label: "Risk end date", kind: "date" },
    ],
  },
  {
    id: "insured",
    title: "Insured",
    fields: [
      { key: "insured_name", label: "Customer name", kind: "text" },
      { key: "mobile", label: "Mobile", kind: "text" },
      { key: "email", label: "Email", kind: "text" },
    ],
  },
  {
    id: "premium",
    title: "Premium breakdown",
    fields: [
      { key: "sum_insured", label: "Sum insured", kind: "number" },
      { key: "net_premium", label: "Net premium", kind: "number" },
      { key: "gst", label: "GST", kind: "number" },
      { key: "gross_premium", label: "Total premium", kind: "number" },
    ],
  },
  {
    id: "motor",
    title: "Motor / vehicle",
    lob: "Motor",
    fields: [
      { key: "cover_type", label: "Cover type", kind: "select", metaKey: "cover_types" },
      { key: "vehicle_class", label: "Vehicle class", kind: "select", metaKey: "vehicle_classes" },
      { key: "vehicle_reg_no", label: "Registration no.", kind: "text" },
      { key: "rto", label: "RTO", kind: "text" },
      { key: "registration_date", label: "Registration date", kind: "date" },
      { key: "mfg_year", label: "Year of manufacturing", kind: "text" },
      { key: "make", label: "Make", kind: "text" },
      { key: "model", label: "Model", kind: "text" },
      { key: "cc", label: "CC", kind: "number" },
      { key: "seating_capacity", label: "Seating capacity", kind: "number" },
      { key: "gvw", label: "GVW (kg)", kind: "number" },
      { key: "idv", label: "IDV", kind: "number" },
      { key: "od_premium", label: "OD premium (incl. add-ons)", kind: "number" },
      { key: "addon_premium", label: "Add-on premium", kind: "number" },
      { key: "tp_premium", label: "TP premium (liability)", kind: "number" },
      { key: "chassis_no", label: "Chassis no.", kind: "text" },
      { key: "engine_no", label: "Engine no.", kind: "text" },
      { key: "ncb_percent", label: "NCB %", kind: "number" },
      { key: "vehicle_age_years", label: "Vehicle age (yrs) · auto", kind: "number", derived: true },
      { key: "vehicle_age_bucket", label: "Vehicle age band · auto", kind: "text", derived: true },
    ],
  },
  {
    id: "health",
    title: "Health",
    lob: "Health",
    fields: [
      { key: "plan_name", label: "Plan", kind: "text" },
      { key: "members_covered", label: "Members covered", kind: "text" },
      { key: "deductible", label: "Deductible", kind: "number" },
    ],
  },
];

// Mirrors derive_fields() in backend/models/policy.py — applied live while editing; the server re-applies on save.
export const LIABILITY_ZERO_FIELDS: (keyof PolicyFields)[] = ["ncb_percent", "idv", "od_premium", "addon_premium"];
export const GVW_NA_CLASSES = ["Private Car", "Two Wheeler", "Passenger Carrying"];

export function applyMotorRules(f: PolicyFields): PolicyFields {
  const next = { ...f };
  if (next.cover_type === "Liability Only") LIABILITY_ZERO_FIELDS.forEach((k) => Object.assign(next, { [k]: 0 }));
  if (next.vehicle_class && GVW_NA_CLASSES.includes(next.vehicle_class)) next.gvw = null;
  return next;
}

export function notApplicableReason(f: PolicyFields, key: keyof PolicyFields): string | null {
  if (f.cover_type === "Liability Only" && LIABILITY_ZERO_FIELDS.includes(key)) return "Liability only · auto 0";
  if (key === "gvw" && f.vehicle_class && GVW_NA_CLASSES.includes(f.vehicle_class)) return `N/A for ${f.vehicle_class}`;
  return null;
}

export const STATUS_LABEL: Record<string, string> = {
  processing: "OCR running",
  extracted: "Pending review",
  failed: "OCR failed",
  flagged: "Flagged",
  verified: "Verified",
};

export const EMPTY_FILTERS: PolicyFilterState = { status: "", lob: "", agent_id: "", q: "", date_from: "", date_to: "", age_bucket: "" };

export function filterQuery(f: Partial<PolicyFilterState>): string {
  const params = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  return params.toString();
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `₹${inr.format(n)}`;
}

export function compactInr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${inr.format(n)}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  const body = (err as { body?: { detail?: unknown } } | null)?.body;
  if (body && typeof body.detail === "string") return body.detail;
  if (body && Array.isArray(body.detail)) return "Please check the highlighted fields";
  return fallback;
}
