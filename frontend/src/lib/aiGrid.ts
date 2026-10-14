import type { AiGridRow, CommissionMasters } from "@/lib/types";

/** Columns of the AI grid check screen (same as the grid Excel). */
export type Col = { key: keyof AiGridRow; label: string; num?: boolean; w: string };
export const COLS: Col[] = [
  { key: "kind", label: "Type", w: "w-24" }, { key: "insurer", label: "Company", w: "w-36" }, { key: "broker", label: "Partner", w: "w-28" },
  { key: "agent_group", label: "Agent group", w: "w-24" }, { key: "ptype", label: "Product type", w: "w-24" }, { key: "products", label: "Products", w: "w-40" },
  { key: "rtos", label: "RTOs", w: "w-32" }, { key: "vehicle_ages", label: "Age", w: "w-44" }, { key: "makes", label: "Makes", w: "w-40" },
  { key: "model", label: "Model", w: "w-36" }, { key: "fuel_types", label: "Fuel", w: "w-32" }, { key: "business_types", label: "Business", w: "w-36" },
  { key: "cover", label: "Package / SATP", w: "w-32" },
  { key: "gvw_min", label: "GVW from", num: true, w: "w-20" }, { key: "gvw_max", label: "GVW to", num: true, w: "w-20" },
  { key: "od_percent", label: "OD %", num: true, w: "w-16" }, { key: "tp_percent", label: "TP %", num: true, w: "w-16" },
  { key: "net_percent", label: "Net %", num: true, w: "w-16" }, { key: "odtp_percent", label: "OD+TP %", num: true, w: "w-16" },
  { key: "flat_amount", label: "Flat ₹", num: true, w: "w-20" }, { key: "valid_from", label: "From (optional)", w: "w-32" }, { key: "valid_to", label: "To (optional)", w: "w-32" },
];

export const LIST_KEYS = ["products", "vehicle_ages", "makes", "fuel_types", "business_types"] as const;
export type ListKey = (typeof LIST_KEYS)[number];
export const isList = (k: keyof AiGridRow): k is ListKey => (LIST_KEYS as readonly string[]).includes(k);
export const split = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export const FILLABLE = new Set<keyof AiGridRow>(["ptype", "products", "rtos", "vehicle_ages", "makes", "model", "fuel_types", "business_types", "cover", "valid_from", "valid_to"]);
/** Package / SATP choices (blank = applies to both). The AI may return any casing — normalised to these labels. */
export const COVER_OPTS = [{ value: "Package", label: "Package" }, { value: "SATP", label: "SATP" }];
export const coverValue = (v: string | null) => {
  const s = (v ?? "").trim().toLowerCase();
  return s.startsWith("pack") ? "Package" : s.startsWith("satp") || s.startsWith("liab") || s.includes("third") ? "SATP" : "";
};
export type BulkKey = "makes" | "fuel_types" | "business_types";
export const BULK: { key: BulkKey; label: string }[] = [{ key: "makes", label: "Makes" }, { key: "fuel_types", label: "Fuel" }, { key: "business_types", label: "Business" }];
export const EMPTY_BULK: Record<BulkKey, string[]> = { makes: [], fuel_types: [], business_types: [] };
export const LIST_ALL: Record<ListKey, string> = { products: "All products", vehicle_ages: "All ages", makes: "All makes", fuel_types: "All fuels", business_types: "All business" };
export const plural = (n: number, word = "row") => `${n} ${word}${n === 1 ? "" : "s"}`;

function baseOptions(m: CommissionMasters | undefined, pt: string, k: ListKey): string[] {
  switch (k) {
    case "products": return pt ? m?.product_types[pt] ?? [] : Object.values(m?.product_types ?? {}).flat();
    case "makes": return pt ? m?.makes[pt] ?? [] : [...new Set(Object.values(m?.makes ?? {}).flat())].sort();
    case "fuel_types": return m?.fuel_by_type[pt] ?? m?.fuel_types ?? [];
    case "business_types": return m?.business_types ?? [];
    default: return m?.age_bands ?? [];
  }
}

/** Same choices as the New rule form for the row's product type; values the AI read that are not in the list stay selectable. */
export const optionsFor = (m: CommissionMasters | undefined, r: AiGridRow, k: ListKey): string[] => [...new Set([...baseOptions(m, r.ptype ?? "", k), ...split(r[k])])];
export const modelsFor = (m: CommissionMasters | undefined, r: AiGridRow) => [...new Set(split(r.makes).flatMap((mk) => m?.models[mk] ?? []))].sort();

/** One editable AI row with a stable React key (rows can be re-ordered / edited without losing input state). */
export type KeyedRow = AiGridRow & { _key: string };
let seq = 0;
export const withKeys = (rows: AiGridRow[]): KeyedRow[] => rows.map((r) => ({ ...r, _key: `ai-${++seq}` }));
export const stripKey = ({ _key, ...r }: KeyedRow): AiGridRow => { void _key; return r; };
