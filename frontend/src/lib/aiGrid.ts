import type { AiGridRow, CommissionMasters } from "@/lib/types";
import { COVER_TYPES, showsFor } from "@/lib/ruleShows";

/** Columns of the AI grid check screen (same as the grid Excel). */
export type Col = { key: keyof AiGridRow; label: string; num?: boolean; w: string };
export const COLS: Col[] = [
  { key: "kind", label: "Type", w: "w-24" }, { key: "insurer", label: "Company", w: "w-36" }, { key: "broker", label: "Partner", w: "w-28" },
  { key: "agent_group", label: "Partner group", w: "w-24" }, { key: "ptype", label: "Product type", w: "w-24" }, { key: "products", label: "Products", w: "w-40" },
  { key: "rtos", label: "RTOs", w: "w-32" }, { key: "vehicle_ages", label: "Age", w: "w-44" }, { key: "makes", label: "Makes", w: "w-40" },
  { key: "model", label: "Model", w: "w-36" }, { key: "fuel_types", label: "Fuel", w: "w-32" }, { key: "business_types", label: "Business", w: "w-36" },
  { key: "ncb", label: "NCB", w: "w-44" }, { key: "cover", label: "Package / SATP", w: "w-44" },
  { key: "gvw_min", label: "GVW from", num: true, w: "w-20" }, { key: "gvw_max", label: "GVW to", num: true, w: "w-20" },
  { key: "cc_min", label: "CC from", num: true, w: "w-20" }, { key: "cc_max", label: "CC to", num: true, w: "w-20" },
  { key: "seating_min", label: "Seats from", num: true, w: "w-20" }, { key: "seating_max", label: "Seats to", num: true, w: "w-20" },
  { key: "od_percent", label: "OD %", num: true, w: "w-16" }, { key: "tp_percent", label: "TP %", num: true, w: "w-16" },
  { key: "net_percent", label: "Net %", num: true, w: "w-16" }, { key: "odtp_percent", label: "OD+TP %", num: true, w: "w-16" },
  { key: "flat_amount", label: "Flat ₹", num: true, w: "w-20" }, { key: "valid_from", label: "From (optional)", w: "w-32" }, { key: "valid_to", label: "To (optional)", w: "w-32" },
];

export const LIST_KEYS = ["products", "vehicle_ages", "makes", "fuel_types", "business_types"] as const;
export type ListKey = (typeof LIST_KEYS)[number];
export const isList = (k: keyof AiGridRow): k is ListKey => (LIST_KEYS as readonly string[]).includes(k);
export const split = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export const FILLABLE = new Set<keyof AiGridRow>(["ptype", "products", "rtos", "vehicle_ages", "makes", "model", "fuel_types", "business_types", "ncb", "cover", "valid_from", "valid_to"]);
/** AI text → the New rule form's values (any / package / satp, any / with / without). */
export const coverValue = (v: string | null) => {
  const s = (v ?? "").trim().toLowerCase();
  return s.startsWith("pack") || s.startsWith("comp") ? "package" : s.startsWith("satp") || s.startsWith("liab") || s.includes("third") ? "satp" : "any";
};
export const ncbValue = (v: string | null) => {
  const s = (v ?? "").trim().toLowerCase();
  return s.startsWith("without") || s === "no" || s === "0" ? "without" : s.startsWith("with") || s === "yes" ? "with" : "any";
};

/** Product type of a row: the one the AI / admin picked, else the type all its products belong to. */
export const rowType = (m: CommissionMasters | undefined, r: AiGridRow): string => {
  if (r.ptype) return r.ptype;
  const prods = split(r.products);
  return prods.length ? Object.keys(m?.product_types ?? {}).find((t) => prods.every((p) => m?.product_types[t].includes(p))) ?? "" : "";
};
/** Same show / hide as the New rule form: a column a product type does not use is "n/a" and never saved. */
export const applies = (ptype: string, k: keyof AiGridRow): boolean => {
  const s = showsFor(ptype);
  switch (k) {
    case "makes": case "model": return s.make;
    case "cc_min": case "cc_max": return s.cc;
    case "seating_min": case "seating_max": return s.seating;
    case "gvw_min": case "gvw_max": return s.gvw;
    case "rtos": return s.rto;
    case "vehicle_ages": return s.age;
    case "fuel_types": return s.fuel;
    case "cover": return COVER_TYPES.includes(ptype);
    default: return true;
  }
};
const DEPENDENT: (keyof AiGridRow)[] = ["makes", "model", "cc_min", "cc_max", "seating_min", "seating_max", "gvw_min", "gvw_max", "rtos", "vehicle_ages", "fuel_types", "cover"];
/** Row as saved: n/a columns cleared, NCB / cover normalised to the form's values. */
export const cleanRow = (m: CommissionMasters | undefined, r: AiGridRow): AiGridRow => {
  const t = rowType(m, r);
  const cleared = Object.fromEntries(DEPENDENT.filter((k) => k !== "cover" && !applies(t, k)).map((k) => [k, null])) as Partial<AiGridRow>;
  return { ...r, ...cleared, ncb: ncbValue(r.ncb), cover: applies(t, "cover") ? coverValue(r.cover) : "any" };
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
