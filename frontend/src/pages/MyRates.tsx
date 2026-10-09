import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { BadgePercent, CalendarClock, Calculator, Info, Search, Sparkles, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/SimpleSelect";
import { useCommissionMasters } from "@/components/RuleDialog";
import { apiGet } from "@/lib/api";
import { useAgentOptions } from "@/lib/auth";
import { conditionChips, earn, inr, niceDate, rateParts, validity } from "@/lib/rates";
import { cn } from "@/lib/utils";
import type { AgentRate, AgentRateCard, User } from "@/lib/types";

function RateCard({ r, chips, od, tp, index }: { r: AgentRate; chips: string[]; od: number; tp: number; index: number }) {
  const parts = rateParts(r);
  return (
    <motion.article
      data-testid={`rate-card-${r.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03 }}
      className="group rounded-xl border border-border bg-card p-4 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-sky-500/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 data-testid={`rate-name-${r.id}`} className="font-heading text-sm font-semibold">{r.name}</h4>
        <div className="flex flex-wrap gap-1">
          {r.personal && <Badge data-testid={`rate-personal-${r.id}`} className="bg-amber-500/15 text-[10px] text-amber-300"><Sparkles className="size-3" /> Special rate for you</Badge>}
          {!r.personal && r.group_rate && <Badge variant="outline" className="text-[10px] text-sky-300"><Users className="size-3" /> Your group rate</Badge>}
          {r.upcoming && <Badge data-testid={`rate-upcoming-${r.id}`} variant="outline" className="border-violet-400/40 text-[10px] text-violet-300"><CalendarClock className="size-3" /> Starts {niceDate(r.valid_from!)}</Badge>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {parts.map((p, i) => (
          <div key={i} className="flex items-baseline gap-1.5 rounded-lg bg-teal-500/10 px-3 py-1.5">
            {i > 0 && <span className="text-xs text-muted-foreground">+</span>}
            <span data-testid={`rate-value-${r.id}-${i}`} className="font-mono text-xl font-semibold text-teal-300">{p.value}</span>
            <span className="text-xs text-muted-foreground">{p.of}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.length ? chips.map((c) => (
          <span key={c} className="rounded-md border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground">{c}</span>
        )) : <span className="rounded-md border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground">Every policy of this company</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs">
        <span className="text-muted-foreground">{validity(r)}</span>
        <span data-testid={`rate-example-${r.id}`} className="text-muted-foreground">
          On the sample policy you earn <b className="font-mono text-sm text-foreground">{inr(earn(r, od, tp))}</b>
        </span>
      </div>
    </motion.article>
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
  const [od, setOd] = useState(10000);
  const [tp, setTp] = useState(5000);
  const [insurer, setInsurer] = useState("");
  const [q, setQ] = useState("");

  const zones = masters.data?.rto_zones ?? [];
  const types = masters.data?.product_types ?? {};
  const rates = card.data?.rates ?? [];
  const withChips = useMemo(() => rates.map((r) => ({ r, chips: conditionChips(r, zones, types) })), [rates, zones, types]);
  const insurers = [...new Set(rates.map((r) => r.insurer ?? "All insurance companies"))];
  const shown = withChips.filter(({ r, chips }) =>
    (!insurer || (r.insurer ?? "All insurance companies") === insurer) &&
    (!q || `${r.name} ${r.insurer ?? ""} ${chips.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  );
  const groups = insurers.filter((i) => shown.some(({ r }) => (r.insurer ?? "All insurance companies") === i));
  let idx = 0;

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight" data-testid="my-rates-title">{isAdmin ? "Agent rate card" : "My commission rates"}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isAdmin
              ? "Exactly what each agent sees — pick an agent to preview their personal, group and common rates."
              : "What you earn on each policy you bring in. Rates are set by the admin and update here automatically."}
          </p>
        </div>
        {isAdmin && (
          <SimpleSelect value={agentId} onChange={setAgentId} allLabel="Common rates (all agents)" placeholder="Agent" testId="my-rates-agent-select" className="w-72"
            options={(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.full_name} · ${a.username.toUpperCase()}` }))} />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-5" data-testid="my-rates-howto">
          <p className="label-caps mb-3 flex items-center gap-1.5 text-sky-300"><Info className="size-3.5" /> How your commission is worked out</p>
          <ol className="grid gap-3 text-sm sm:grid-cols-3">
            <li><b className="font-heading">1. Find your policy type</b><br /><span className="text-muted-foreground">Look for the insurance company and vehicle type below.</span></li>
            <li><b className="font-heading">2. Read the rate</b><br /><span className="text-muted-foreground">e.g. <span className="font-mono text-teal-300">15%</span> of OD premium means ₹15 for every ₹100 of OD premium.</span></li>
            <li><b className="font-heading">3. Most specific wins</b><br /><span className="text-muted-foreground">If two rates fit, the one matching more details (RTO, NCB, age…) is used.</span></li>
          </ol>
          <p className="mt-3 text-[11px] text-muted-foreground">The date that counts is the policy's risk start date. Premiums are before GST.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5" data-testid="my-rates-calculator">
          <p className="label-caps mb-3 flex items-center gap-1.5"><Calculator className="size-3.5" /> Sample policy — try your numbers</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">OD premium (₹)</Label>
              <Input type="number" min={0} data-testid="calc-od-input" value={od} onChange={(e) => setOd(Math.max(0, Number(e.target.value) || 0))} className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">TP premium (₹)</Label>
              <Input type="number" min={0} data-testid="calc-tp-input" value={tp} onChange={(e) => setTp(Math.max(0, Number(e.target.value) || 0))} className="font-mono" />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Net premium = <span data-testid="calc-net" className="font-mono text-foreground">{inr(od + tp)}</span>. Every card shows what you would earn on this policy.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input data-testid="my-rates-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: car, two wheeler, TN…" className="w-64 pl-8" />
        </div>
        <SimpleSelect value={insurer} onChange={setInsurer} allLabel="All companies" placeholder="Company" testId="my-rates-insurer-filter" className="w-60"
          options={insurers.map((i) => ({ value: i, label: i }))} />
        <span data-testid="my-rates-count" className="text-xs text-muted-foreground">{shown.length} rate{shown.length === 1 ? "" : "s"} · as of {card.data ? niceDate(card.data.as_of) : "—"}</span>
      </div>

      {card.isLoading && <div className="grid h-40 place-items-center text-sm text-muted-foreground">Loading rates…</div>}
      {card.isError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">Could not load commission rates.</div>}
      {card.data && rates.length === 0 && (
        <div data-testid="my-rates-empty" className="grid h-48 place-items-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">
          <div><BadgePercent className="mx-auto mb-2 size-6" />No commission rates have been set up yet.<br />Please contact your admin.</div>
        </div>
      )}

      {groups.map((g) => (
        <section key={g} className="space-y-3" data-testid={`rate-group-${g.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
          <h3 className="flex items-center gap-2 font-heading text-base font-semibold">
            <span className="h-4 w-1 rounded-full bg-teal-400" /> {g}
            <span className="text-xs font-normal text-muted-foreground">{shown.filter(({ r }) => (r.insurer ?? "All insurance companies") === g).length} rates</span>
          </h3>
          <div className={cn("grid gap-3 xl:grid-cols-2")}>
            {shown.filter(({ r }) => (r.insurer ?? "All insurance companies") === g).map(({ r, chips }) => (
              <RateCard key={r.id} r={r} chips={chips} od={od} tp={tp} index={idx++} />
            ))}
          </div>
        </section>
      ))}
      {rates.length > 0 && <p className="text-[11px] text-muted-foreground">Final commission is confirmed in your Commission Statement after the policy is verified.</p>}
    </div>
  );
}
