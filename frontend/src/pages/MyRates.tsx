import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { BadgePercent, Bike, Bus, Car, CalendarClock, FileText, HeartPulse, Package, RotateCcw, Sparkles, Star, Tractor, Trophy, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RateAlerts } from "@/components/RateAlerts";
import { SimpleSelect } from "@/components/SimpleSelect";
import { useCommissionMasters } from "@/components/RuleDialog";
import { apiGet } from "@/lib/api";
import { useAgentOptions } from "@/lib/auth";
import { earn, niceDate, rateParts, rtoLabel, validity } from "@/lib/rates";
import { cn } from "@/lib/utils";
import type { AgentRate, AgentRateCard, RtoZone, User } from "@/lib/types";

const ICONS: Record<string, typeof Car> = { "Private Car": Car, "Two Wheeler": Bike, PCV: Bus, GCV: Truck, "Misc D": Tractor, Health: HeartPulse };
const ALL = "__all";
// hidden reference policy used only to rank mixed OD/TP/Net/flat rates against each other
const rank = (r: AgentRate) => earn(r, 10000, 5000);

type Dim = {
  key: string;
  label: string;
  hint: string;
  value: (r: AgentRate) => string[] | null; // null = rule applies to every option of this dimension
};

const slab = (lo: number | null, hi: number | null, unit: string): string | null =>
  lo == null && hi == null ? null : lo != null && hi != null ? `${lo.toLocaleString("en-IN")} – ${hi.toLocaleString("en-IN")} ${unit}` : lo != null ? `Above ${lo.toLocaleString("en-IN")} ${unit}` : `Up to ${hi!.toLocaleString("en-IN")} ${unit}`;

function dims(zones: RtoZone[]): Dim[] {
  const one = (v: string | null) => (v ? [v] : null);
  return [
    { key: "gvw", label: "Vehicle weight (GVW)", hint: "Gross vehicle weight on the RC", value: (r) => one(slab(r.gvw_min, r.gvw_max, "kg")) },
    { key: "cc", label: "Engine CC", hint: "Cubic capacity on the RC", value: (r) => one(slab(r.cc_min, r.cc_max, "CC")) },
    { key: "seat", label: "Seating capacity", hint: "Seats on the RC", value: (r) => one(slab(r.seating_min, r.seating_max, "seats")) },
    { key: "age", label: "Vehicle age", hint: "Age at policy start", value: (r) => (r.vehicle_ages.length ? r.vehicle_ages : null) },
    { key: "fuel", label: "Fuel", hint: "", value: (r) => (r.fuel_types.length ? r.fuel_types : null) },
    { key: "cover", label: "Package or Third party?", hint: "Package = full cover · SATP = third party only", value: (r) => (r.cover === "package" ? ["Package"] : r.cover === "satp" ? ["SATP (third party)"] : null) },
    { key: "ncb", label: "No-claim bonus (NCB)", hint: "Does the old policy have NCB?", value: (r) => (r.ncb === "with" ? ["With NCB"] : r.ncb === "without" ? ["Without NCB"] : null) },
    { key: "rto", label: "Vehicle RTO / area", hint: "Where the vehicle is registered", value: (r) => one(r.rtos.length ? rtoLabel(r.rtos, zones) : null) },
    { key: "make", label: "Make", hint: "", value: (r) => (r.makes.length ? r.makes : null) },
    { key: "insurer", label: "Insurance company", hint: "", value: (r) => one(r.insurer) },
  ];
}

const BUSINESS_LABEL: Record<string, string> = { New: "New Vehicle", Renewal: "Renewal", Rollover: "Rollover", Used: "Used Vehicle" };
const joinAnd = (v: string[]) => (v.length > 1 ? `${v.slice(0, -1).join(", ")} & ${v[v.length - 1]}` : v[0]);

/** Non-standard conditions an agent must know about — always shown on the card, never hidden behind a click. */
export function specialConditions(r: AgentRate, zones: RtoZone[]): string[] {
  const out: string[] = [];
  if (r.business_types.length) out.push(`${joinAnd(r.business_types.map((b) => BUSINESS_LABEL[b] ?? b))} only`);
  if (r.rtos.length) out.push(`Only RTO ${rtoLabel(r.rtos, zones)}`);
  if (r.makes.length) out.push(`Only ${joinAnd(r.makes)}`);
  if (r.model) out.push(`Only model ${r.model}`);
  if (r.ncb === "with") out.push("With NCB only");
  if (r.ncb === "without") out.push("Without NCB only");
  if (r.vehicle_ages.length) out.push(`Vehicle age ${r.vehicle_ages.join(", ")} only`);
  if (r.fuel_types.length) out.push(`${joinAnd(r.fuel_types)} only`);
  return out;
}

function ChoiceRow({ dim, options, value, onChange, step }: { dim: Dim; options: string[]; value: string; onChange: (v: string) => void; step: number }) {
  return (
    <div className="space-y-2" data-testid={`rate-step-${dim.key}`}>
      <p className="text-sm">
        <span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-sky-500/20 font-mono text-[11px] text-sky-300">{step}</span>
        <b className="font-heading">{dim.label}</b>
        {dim.hint && <span className="ml-2 text-xs text-muted-foreground">{dim.hint}</span>}
      </p>
      <div className="flex flex-wrap gap-1.5 pl-7">
        {[ALL, ...options].map((o) => (
          <button
            key={o}
            type="button"
            data-testid={`rate-choice-${dim.key}-${o === ALL ? "all" : o.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            onClick={() => onChange(o)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs transition-[background-color,border-color,color] duration-150",
              value === o ? "border-sky-400 bg-sky-500/20 text-sky-100" : "border-border bg-background/40 text-muted-foreground hover:border-sky-500/50 hover:text-foreground",
            )}
          >
            {o === ALL ? "Not sure / show all" : o}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MyRates() {
  const me = useOutletContext<User>();
  const isAdmin = me.role === "admin";
  const [agentId, setAgentId] = useState("");
  const agents = useAgentOptions(isAdmin);
  const masters = useCommissionMasters();
  const card = useQuery({
    queryKey: ["my-rates", agentId],
    queryFn: () => apiGet<AgentRateCard>(`/commission/my-rates${agentId ? `?agent_id=${agentId}` : ""}`),
  });
  const [ptype, setPtype] = useState("");
  const [product, setProduct] = useState(ALL);
  const [pick, setPick] = useState<Record<string, string>>({});

  const masterData = masters.data;
  const zones = useMemo(() => masterData?.rto_zones ?? [], [masterData]);
  const types = useMemo(() => masterData?.product_types ?? {}, [masterData]);
  const DIMS = useMemo(() => dims(zones), [zones]);
  const rates = card.data?.rates ?? [];

  const inType = (r: AgentRate, t: string) => !r.products.length || r.products.some((p) => types[t]?.includes(p));
  const typeList = Object.keys(types).filter((t) => rates.some((r) => r.products.some((p) => types[t].includes(p))) || rates.some((r) => !r.products.length));
  const byType = ptype ? rates.filter((r) => inType(r, ptype) && (product === ALL || !r.products.length || r.products.includes(product))) : [];
  const subProducts = ptype ? types[ptype].filter((p) => byType.some((r) => r.products.includes(p))) : [];

  // walk the steps in order: each step only offers values the admin actually set on the remaining rates
  const steps: { dim: Dim; options: string[] }[] = [];
  let pool = byType;
  for (const d of DIMS) {
    const opts = [...new Set(pool.flatMap((r) => d.value(r) ?? []))];
    if (!opts.length) continue;
    steps.push({ dim: d, options: opts.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) });
    const v = pick[d.key];
    if (v && v !== ALL && opts.includes(v)) pool = pool.filter((r) => { const vals = d.value(r); return !vals || vals.includes(v); });
  }
  const results = [...pool].sort((a, b) => rank(b) - rank(a));
  const best = results.length ? rank(results[0]) : null;

  const choose = (t: string) => { setPtype(t); setProduct(ALL); setPick({}); };
  const ageOrder = masters.data?.age_bands ?? [];
  /** "6-7 Years, 8-10 Years … Above 15 Years" → "6 years & above" when the picked bands are continuous. */
  const ages = (bands: string[]) => {
    const idx = bands.map((b) => ageOrder.indexOf(b)).filter((i) => i >= 0).sort((a, b) => a - b);
    const continuous = idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
    if (!continuous) return bands.join(", ");
    const first = ageOrder[idx[0]].match(/\d+/)?.[0];
    if (idx[idx.length - 1] === ageOrder.length - 1 && first) return `${first} years & above`;
    return `${ageOrder[idx[0]]} to ${ageOrder[idx[idx.length - 1]]}`;
  };
  const conditions = (r: AgentRate) =>
    DIMS.filter((d) => d.key !== "insurer" && !(pick[d.key] && pick[d.key] !== ALL)).flatMap((d) => {
      const v = d.value(r);
      if (!v) return [];
      return [{ label: d.label.replace(/ \(.*\)/, ""), value: d.key === "age" ? ages(v) : v.join(", ") }];
    });

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight" data-testid="my-rates-title">{isAdmin ? "Partner rate card" : "My commission rates"}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isAdmin ? "Preview exactly what a partner sees." : "Pick what you are selling, answer a couple of simple questions, and see every company's grid — highest first."}
          </p>
        </div>
        {isAdmin && (
          <SimpleSelect value={agentId} onChange={(v) => { setAgentId(v); setPick({}); }} allLabel="Common rates (all partners)" placeholder="Partner" testId="my-rates-agent-select" className="w-72" searchable
            options={(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.full_name} · ${a.username.toUpperCase()}` }))} />
        )}
      </div>

      {card.isLoading && <div className="grid h-40 place-items-center text-sm text-muted-foreground">Loading rates…</div>}
      {card.isError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">Could not load commission rates.</div>}
      {card.data && rates.length === 0 && (
        <div data-testid="my-rates-empty" className="grid h-48 place-items-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">
          <div><BadgePercent className="mx-auto mb-2 size-6" />No commission rates have been set up yet.<br />Please contact your admin.</div>
        </div>
      )}

      {card.data && <RateAlerts rates={rates} today={card.data.as_of} />}

      {rates.length > 0 && (
        <section className="space-y-3" data-testid="rate-step-type">
          <p className="text-sm"><span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-sky-500/20 font-mono text-[11px] text-sky-300">1</span><b className="font-heading">What are you selling?</b></p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {typeList.map((t) => {
              const Icon = ICONS[t] ?? Package;
              const n = rates.filter((r) => inType(r, t)).length;
              return (
                <button key={t} type="button" onClick={() => choose(t)} data-testid={`rate-type-${t.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  className={cn("flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5",
                    ptype === t ? "border-sky-400 bg-sky-500/15" : "border-border bg-card hover:border-sky-500/50")}>
                  <Icon className={cn("size-5", ptype === t ? "text-sky-300" : "text-muted-foreground")} />
                  <span className="font-heading text-sm font-semibold">{t}</span>
                  <span className="text-[11px] text-muted-foreground">{n} rate{n === 1 ? "" : "s"}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {ptype && (
        <motion.div key={ptype} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div className="space-y-4 rounded-xl border border-border bg-card p-5" data-testid="rate-steps">
            {subProducts.length > 1 && (
              <ChoiceRow step={2} dim={{ key: "product", label: "Which policy?", hint: "", value: () => null }} options={subProducts} value={product} onChange={(v) => { setProduct(v); setPick({}); }} />
            )}
            {steps.map((s, i) => (
              <ChoiceRow key={s.dim.key} step={i + (subProducts.length > 1 ? 3 : 2)} dim={s.dim} options={s.options} value={pick[s.dim.key] ?? ALL}
                onChange={(v) => setPick((p) => ({ ...p, [s.dim.key]: v }))} />
            ))}
            {!steps.length && subProducts.length <= 1 && <p className="text-sm text-muted-foreground">No more questions — the rates are on the right.</p>}
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Skip any question you are not sure about.</span>
              <Button size="sm" variant="ghost" data-testid="rate-reset-button" onClick={() => { setProduct(ALL); setPick({}); }}><RotateCcw className="size-3.5" /> Start again</Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="font-heading text-base font-semibold">{ptype}{product !== ALL ? ` · ${product}` : ""} — your grid</h3>
              <span data-testid="my-rates-count" className="text-xs text-muted-foreground">{results.length} rate{results.length === 1 ? "" : "s"} · as of {card.data ? niceDate(card.data.as_of) : "—"}</span>
            </div>
            <div className="space-y-2.5" data-testid="my-rates-grid">
              {results.map((r, i) => {
                const top = best != null && best > 0 && rank(r) === best;
                const conds = conditions(r);
                const special = specialConditions(r, zones);
                return (
                  <motion.article key={r.id} data-testid={`rate-row-${r.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(i, 8) * 0.03 }}
                    className={cn("grid gap-4 rounded-xl border p-4 transition-[border-color] duration-150 sm:grid-cols-[minmax(0,1fr)_auto]",
                      top ? "border-amber-400/70 bg-gradient-to-r from-amber-400/20 via-amber-400/5 to-card shadow-[inset_4px_0_0_0_rgb(251,191,36)]" : "border-border bg-card hover:border-sky-500/40",
                      special.length > 0 && "border-2 border-fuchsia-400 ring-2 ring-fuchsia-400/30")}>
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("font-heading font-bold", top ? "text-lg text-amber-200" : "text-base")}>{r.insurer ?? "Any company"}</span>
                        {top && <Badge data-testid={`rate-best-${r.id}`} className="bg-amber-500 text-[11px] font-bold text-white"><Trophy className="size-3" /> Highest grid</Badge>}
                        {r.personal && <Badge className="bg-amber-500/15 text-[11px] text-amber-300"><Sparkles className="size-3" /> Just for you</Badge>}
                        {r.hold_from && <Badge variant="outline" className="border-amber-400/50 text-[11px] text-amber-300" data-testid={`rate-hold-${r.id}`}><CalendarClock className="size-3" /> Stops {niceDate(r.hold_from)}</Badge>}
                        {r.upcoming && <Badge variant="outline" className="border-violet-400/50 text-[11px] text-violet-300"><CalendarClock className="size-3" /> From {niceDate(r.valid_from!)}</Badge>}
                        {special.length > 0 && <Badge data-testid={`rate-special-${r.id}`} className="bg-fuchsia-500 text-[11px] font-bold text-white"><Star className="size-3" /> Special condition</Badge>}
                      </div>
                      {special.length > 0 && (
                        <div className="flex flex-wrap gap-1.5" data-testid={`rate-special-labels-${r.id}`}>
                          {special.map((c) => <span key={c} className="rounded-md border border-fuchsia-400/60 bg-fuchsia-500/15 px-2 py-0.5 text-xs font-semibold text-fuchsia-700 dark:text-fuchsia-200">{c}</span>)}
                        </div>
                      )}
                      {conds.length ? (
                        <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2" data-testid={`rate-conditions-${r.id}`}>
                          {conds.map((c) => (
                            <div key={c.label} className="min-w-0">
                              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</dt>
                              <dd className="text-sm font-semibold text-foreground">{c.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : <p className="text-sm font-semibold">All vehicles in this choice</p>}
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="size-3.5" /> {validity(r)}</p>
                      {r.terms.length > 0 && (
                        <div className="rounded-lg border border-border bg-background/40 p-2.5" data-testid={`rate-terms-${r.id}`}>
                          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><FileText className="size-3.5" /> Terms &amp; conditions</p>
                          {r.terms.map((t) => <p key={t} className="whitespace-pre-line text-xs text-foreground">{t}</p>)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-start justify-center gap-1 sm:items-end sm:border-l sm:border-border/60 sm:pl-5" data-testid={`rate-commission-${r.id}`}>
                      {rateParts(r).map((p) => (
                        <div key={`${p.of}-${p.value}`} className="text-left sm:text-right">
                          <div className={cn("font-mono font-extrabold leading-none", top ? "text-4xl text-amber-300" : "text-3xl text-teal-300")}>{p.value}</div>
                          <div className={cn("mt-1 text-xs", top ? "font-semibold text-amber-100" : "text-muted-foreground")}>{p.of}</div>
                        </div>
                      ))}
                    </div>
                  </motion.article>
                );
              })}
              {results.length === 0 && (
                <div className="grid h-24 place-items-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">No rate for this combination — try "Not sure / show all" on a question, or ask your admin.</div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">If two rates fit a policy, the one matching more details is used. Highest grid is listed first; final commission is confirmed in your Commission Statement.</p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
