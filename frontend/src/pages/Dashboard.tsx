import { useQuery } from "@tanstack/react-query";
import { Link, useOutletContext } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileStack, IndianRupee, UploadCloud, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { apiGet } from "@/lib/api";
import { compactInr, fmtDateTime, money } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { AgentRateCard, GroupStat, Policy, Stats, User } from "@/lib/types";
import { RateAlerts } from "@/components/RateAlerts";
import { HoldNotice } from "@/components/HoldNotice";

function Kpi({ label, value, sub, icon: Icon, tone, testId }: { label: string; value: string; sub?: string; icon: typeof FileStack; tone: string; testId: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-transform duration-150 hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className="label-caps">{label}</span>
        <Icon className={cn("size-4", tone)} />
      </div>
      <div data-testid={testId} className="mt-3 font-mono text-2xl font-semibold tracking-tight tabular">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const LOW_NET = 10000; // agents below this net premium are highlighted

function PremiumChart({ title, data, testId, lowBelow }: { title: string; data: GroupStat[]; testId: string; lowBelow?: number }) {
  const low = lowBelow == null ? 0 : data.filter((d) => d.premium < lowBelow).length;
  const height = lowBelow == null ? 224 : Math.max(224, data.length * 26 + 30);
  return (
    <div data-testid={testId} className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="font-heading text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">Net premium</span>
      </div>
      {lowBelow != null && low > 0 && (
        <p data-testid={`${testId}-low-count`} className="-mt-2 mb-3 text-xs text-red-300">{low} agent{low === 1 ? "" : "s"} below {compactInr(lowBelow)} net premium (red bars)</p>
      )}
      {data.length === 0 ? (
        <div className="grid h-56 place-items-center text-sm text-muted-foreground">No data yet</div>
      ) : (
        <div className={cn(lowBelow != null && "max-h-[420px] overflow-y-auto")}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} stroke="#DCE4EE" />
            <XAxis type="number" tickFormatter={(v: number) => compactInr(v)} stroke="#52647A" fontSize={11} />
            <YAxis type="category" dataKey="label" width={130} stroke="#52647A" fontSize={11} tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 19) + "…" : v)} />
            <Tooltip
              cursor={{ fill: "rgba(37,99,235,0.06)" }}
              contentStyle={{ background: "#FFFFFF", color: "#102A43", border: "1px solid #DCE4EE", borderRadius: 8, fontSize: 12 }}
              formatter={(value: number) => [money(value), lowBelow != null && value < lowBelow ? "Net premium (below target)" : "Net premium"]}
            />
            <Bar dataKey="premium" fill="#2563EB" radius={[0, 4, 4, 0]} barSize={14}>
              {data.map((d) => <Cell key={d.label} fill={lowBelow != null && d.premium < lowBelow ? "#B91C1C" : "#2563EB"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const me = useOutletContext<User>();
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => apiGet<Stats>("/stats") });
  const recent = useQuery({ queryKey: ["policies", ""], queryFn: () => apiGet<Policy[]>("/policies") });
  const myRates = useQuery({ queryKey: ["my-rates", ""], queryFn: () => apiGet<AgentRateCard>("/commission/my-rates"), enabled: me.role === "agent" });
  const s = stats.isError ? undefined : stats.data;
  const pending = s ? s.extracted + s.flagged + s.failed : 0;
  const scopeLabel = me.role === "admin" ? "All branches" : me.role === "agent" ? "Your policies" : `${me.branch} branch + mapped team`;

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-caps">{scopeLabel}</p>
          <h2 data-testid="dashboard-greeting" className="mt-1 font-heading text-2xl font-bold tracking-tight">
            Good to see you, {me.full_name.split(" ")[0]}
          </h2>
        </div>
        <div className="flex gap-2">
          <Link to="/policies" data-testid="dashboard-open-mis" className={buttonVariants({ variant: "outline" })}>
            <FileStack className="size-4" /> Open MIS
          </Link>
          <Link to="/upload" data-testid="dashboard-upload-cta" className={buttonVariants()}>
            <UploadCloud className="size-4" /> Upload policies
          </Link>
        </div>
      </div>

      {me.role === "agent" && <HoldNotice />}
      {myRates.data && <RateAlerts rates={myRates.data.rates} today={myRates.data.as_of} link max={4} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Policies" value={s ? String(s.total) : "—"} sub={s ? `${s.processing} in OCR` : undefined} icon={FileStack} tone="text-sky-400" testId="kpi-total-policies" />
        <Kpi label="Net premium" value={s ? compactInr(s.net_premium) : "—"} sub="OD + TP, before GST" icon={IndianRupee} tone="text-teal-400" testId="kpi-net-premium" />
        <Kpi label="Pending review" value={s ? String(pending) : "—"} sub={s ? `${s.flagged} flagged · ${s.failed} OCR failed` : undefined} icon={AlertTriangle} tone="text-amber-400" testId="kpi-pending-review" />
        <Kpi label="Verified" value={s ? String(s.verified) : "—"} sub={s && s.total ? `${Math.round((s.verified / s.total) * 100)}% of book` : undefined} icon={CheckCircle2} tone="text-emerald-400" testId="kpi-verified" />
        <Kpi label="Agent outstanding" value={s ? compactInr(s.outstanding) : "—"} sub="Cash + partial-payment balances" icon={Wallet} tone="text-orange-400" testId="kpi-agent-outstanding" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <PremiumChart title="Net premium by line of business" data={s?.by_lob ?? []} testId="chart-by-lob" />
        <PremiumChart title="Motor net premium by vehicle age" data={(s?.by_age ?? []).filter((a) => a.count > 0)} testId="chart-by-vehicle-age" />
        {me.role === "agent"
          ? <PremiumChart title="Net premium by insurer" data={s?.by_insurer ?? []} testId="chart-secondary" />
          : <PremiumChart title="All agents — net premium" data={s?.by_agent ?? []} testId="chart-all-agents" lowBelow={LOW_NET} />}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="font-heading text-sm font-semibold">Recent documents</h3>
          <Link to="/policies" className="text-xs text-sky-400 hover:underline">View all</Link>
        </div>
        <ul data-testid="recent-policies-list" className="divide-y divide-border">
          {(recent.isError ? [] : recent.data ?? []).slice(0, 6).map((p) => (
            <li key={p.id}>
              <Link to={`/policies/${p.id}`} data-testid={`recent-policy-${p.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors duration-150 hover:bg-accent/40">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm">{p.fields.policy_number ?? p.file_name ?? "Untitled"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.fields.insured_name ?? "—"} · {p.fields.insurer ?? "Insurer pending"} · {p.agent_name}
                  </div>
                </div>
                <div className="hidden text-right font-mono text-sm tabular sm:block">{money(p.fields.net_premium)}<div className="font-sans text-[10px] text-muted-foreground">Net</div></div>
                <StatusBadge status={p.status} />
                <div className="hidden w-36 text-right text-xs text-muted-foreground lg:block">{fmtDateTime(p.created_at)}</div>
              </Link>
            </li>
          ))}
          {!recent.isLoading && (recent.isError || (recent.data ?? []).length === 0) && (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">No documents yet — upload your first policy.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
