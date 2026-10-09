import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { BadgePercent, Bike, Bus, Car, CalendarClock, HeartPulse, Package, RotateCcw, Sparkles, Tractor, Trophy, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    { key: "ncb", label: "No-claim bonus (NCB)", hint: "Does the old policy have NCB?", value: (r) => (r.ncb === "with" ? ["With NCB"] : r.ncb === "without" ? ["Without NCB"] : null) },
    { key: "rto", label: "Vehicle RTO / area", hint: "Where the vehicle is registered", value: (r) => one(r.rtos.length ? rtoLabel(r.rtos, zones) : null) },
    { key: "make", label: "Make", hint: "", value: (r) => one(r.make) },
    { key: "insurer", label: "Insurance company", hint: "", value: (r) => one(r.insurer) },
  ];
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

  const zones = useMemo(() => masters.data?.rto_zones ?? [], [masters.data]);
  const types = useMemo(() => masters.data?.product_types ?? {}, [masters.data]);
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
  const describe = (r: AgentRate) =>
    DIMS.flatMap((d) => (pick[d.key] && pick[d.key] !== ALL ? [] : (d.value(r) ?? []).map((v) => (d.key === "insurer" ? null : v)))).filter(Boolean) as string[];

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight" data-testid="my-rates-title">{isAdmin ? "Agent rate card" : "My commission rates"}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isAdmin ? "Preview exactly what an agent sees." : "Pick what you are selling, answer a couple of simple questions, and see every company's grid — highest first."}
          </p>
        </div>
        {isAdmin && (
          <SimpleSelect value={agentId} onChange={(v) => { setAgentId(v); setPick({}); }} allLabel="Common rates (all agents)" placeholder="Agent" testId="my-rates-agent-select" className="w-72"
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
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <h3 className="font-heading text-sm font-semibold">{ptype}{product !== ALL ? ` · ${product}` : ""} — your grid</h3>
                <span data-testid="my-rates-count" className="text-xs text-muted-foreground">{results.length} rate{results.length === 1 ? "" : "s"} · as of {card.data ? niceDate(card.data.as_of) : "—"}</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Company</TableHead>
                    <TableHead>For</TableHead>
                    <TableHead className="text-right">Your commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody data-testid="my-rates-grid">
                  {results.map((r) => {
                    const top = best != null && best > 0 && rank(r) === best;
                    const extra = describe(r);
                    return (
                      <TableRow key={r.id} data-testid={`rate-row-${r.id}`}
                        className={cn(top && "bg-gradient-to-r from-amber-400/20 via-amber-400/10 to-transparent shadow-[inset_4px_0_0_0_rgb(251,191,36)] hover:from-amber-400/25")}>
                        <TableCell className="align-top">
                          <div className={cn(top ? "font-heading text-base font-extrabold text-amber-200" : "font-medium")}>{r.insurer ?? "Any company"}</div>
                          {r.broker_name && <div className="text-[11px] text-muted-foreground">via {r.broker_name}</div>}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {top && <Badge data-testid={`rate-best-${r.id}`} className="bg-amber-400 text-[10px] font-bold text-amber-950"><Trophy className="size-3" /> Highest grid</Badge>}
                            {r.personal && <Badge className="bg-amber-500/15 text-[10px] text-amber-300"><Sparkles className="size-3" /> Just for you</Badge>}
                            {r.upcoming && <Badge variant="outline" className="text-[10px] text-violet-300"><CalendarClock className="size-3" /> From {niceDate(r.valid_from!)}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[16rem] whitespace-normal align-top text-xs text-muted-foreground">
                          {extra.length ? extra.join(" · ") : "All vehicles in this choice"}
                          <div className="mt-1 text-[10px]">{validity(r)}</div>
                        </TableCell>
                        <TableCell className="text-right align-top" data-testid={`rate-commission-${r.id}`}>
                          {rateParts(r).map((p, i) => (
                            <div key={i} className="whitespace-nowrap text-xs">
                              <span className={cn("font-mono font-semibold", top ? "text-2xl font-extrabold text-amber-300" : "text-base text-teal-300")}>{p.value}</span>{" "}
                              <span className={cn(top ? "font-semibold text-amber-100" : "text-muted-foreground")}>{p.of}</span>
                            </div>
                          ))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {results.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="h-24 text-center text-sm text-muted-foreground">No rate for this combination — try "Not sure / show all" on a question, or ask your admin.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-muted-foreground">If two rates fit a policy, the one matching more details is used. Highest grid is listed first; final commission is confirmed in your Commission Statement.</p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
