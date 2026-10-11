import type { AgentRate, RtoZone } from "@/lib/types";

/** Collapse RTO codes into zone names (Chennai RTOs, ROTN…) where a whole zone is selected. */
export function rtoLabel(rtos: string[], zones: RtoZone[]): string {
  let rest = [...rtos];
  const parts: string[] = [];
  for (const z of zones) {
    if (z.rtos.every((c) => rest.includes(c))) {
      parts.push(z.name);
      rest = rest.filter((c) => !z.rtos.includes(c));
    }
  }
  return [...parts, ...rest].join(" / ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const niceDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

export const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Each commission part in plain words, e.g. { value: "15%", of: "of OD premium" }. */
export function rateParts(r: AgentRate): { value: string; of: string }[] {
  const out: { value: string; of: string }[] = [];
  if (r.od_percent != null) out.push({ value: `${r.od_percent}%`, of: "of OD (own damage) premium" });
  if (r.tp_percent != null) out.push({ value: `${r.tp_percent}%`, of: "of TP (third party) premium" });
  if (r.net_percent != null) out.push({ value: `${r.net_percent}%`, of: "of Net premium" });
  if (r.odtp_percent != null) out.push({ value: `${r.odtp_percent}%`, of: "of OD + TP premium" });
  if (r.flat_amount != null) out.push({ value: inr(r.flat_amount), of: "fixed per policy" });
  return out;
}

/** What the agent earns on a sample policy (net = OD + TP, before GST). */
export function earn(r: AgentRate, od: number, tp: number): number {
  const p = (v: number | null) => (v ?? 0) / 100;
  return Math.round((p(r.od_percent) * od + p(r.tp_percent) * tp + p(r.net_percent) * (od + tp) + p(r.odtp_percent) * (od + tp) + (r.flat_amount ?? 0)) * 100) / 100;
}

const range = (lo: number | null, hi: number | null, unit: string) =>
  lo != null && hi != null ? `${lo}–${hi} ${unit}` : lo != null ? `${lo}+ ${unit}` : `up to ${hi} ${unit}`;

/** Conditions in everyday language — empty list means "every policy". */
export function conditionChips(r: AgentRate, zones: RtoZone[], productTypes: Record<string, string[]>): string[] {
  const chips: string[] = [];
  const type = Object.keys(productTypes).find((t) => r.products.length > 0 && productTypes[t].length === r.products.length && productTypes[t].every((p) => r.products.includes(p)));
  if (r.products.length) chips.push(type ? `All ${type}` : r.products.join(", "));
  if (r.broker_name) chips.push(`Through ${r.broker_name}`);
  if (r.rtos.length) chips.push(`Vehicle RTO: ${rtoLabel(r.rtos, zones)}`);
  if (r.ncb === "with") chips.push("Only with NCB (no-claim bonus)");
  if (r.ncb === "without") chips.push("Only without NCB");
  if (r.cover === "package") chips.push("Package policy only");
  if (r.cover === "satp") chips.push("SATP (third party) only");
  if (r.vehicle_ages.length) chips.push(`Vehicle age: ${r.vehicle_ages.join(", ")}`);
  if (r.fuel_types.length) chips.push(`Fuel: ${r.fuel_types.join(" / ")}`);
  if (r.business_types?.length) chips.push(`Business: ${r.business_types.join(" / ")}`);
  if (r.makes.length) chips.push(`Make: ${r.makes.join(" / ")}${r.model ? ` ${r.model}` : ""}`);
  else if (r.model) chips.push(`Model: ${r.model}`);
  if (r.cc_min != null || r.cc_max != null) chips.push(`Engine ${range(r.cc_min, r.cc_max, "CC")}`);
  if (r.seating_min != null || r.seating_max != null) chips.push(`Seats ${range(r.seating_min, r.seating_max, "")}`.trim());
  if (r.gvw_min != null || r.gvw_max != null) chips.push(`Goods vehicle weight ${range(r.gvw_min, r.gvw_max, "kg")}`);
  return chips;
}

export function validity(r: AgentRate): string {
  if (r.valid_from && r.valid_to) return `Valid for policies starting ${niceDate(r.valid_from)} to ${niceDate(r.valid_to)}`;
  if (r.valid_from) return `Valid for policies starting from ${niceDate(r.valid_from)}`;
  if (r.valid_to) return `Valid for policies starting up to ${niceDate(r.valid_to)}`;
  return "Valid until the rate is changed";
}
