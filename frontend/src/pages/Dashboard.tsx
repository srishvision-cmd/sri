import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useOutletContext } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileStack, IndianRupee, UploadCloud, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { apiGet } from "@/lib/api";
import { compactInr, fmtDateTime, money } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { AgentRateCard, GroupStat, Policy, Stats, User } from "@/lib/types";
import { RateAlerts } from "@/components/RateAlerts";
import { HoldNotice } from "@/components/HoldNotice";
import { MissingPayablesAlert } from "@/components/MissingPayablesAlert";
import { ApprovalAlert } from "@/components/ApprovalAlert";

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

const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);
type ChartRow = GroupStat & { share: number; tag: string; axis: string };

function ChartTip({ active, payload, lowBelow }: { active?: boolean; payload?: { payload: ChartRow }[]; lowBelow?: number }) {
  const d = active && payload?.[0]?.payload;
  if (!d) return null;
  const low = lowBelow != null && d.premium < lowBelow;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-[#102A43] shadow-md">
      <div className="mb-1 font-semibold">{d.label}</div>
      <div>Net premium: <b className="font-mono">{money(d.premium)}</b>{low && <span className="ml-1 text-red-700">(below {compactInr(lowBelow)})</span>}</div>
      <div>Policies: <b className="font-mono">{d.count}</b></div>
      <div>Share of net premium: <b className="font-mono">{d.share}%</b></div>
    </div>
  );
}

/** One-line value label above a column (recharts' default label wraps inside the bar width). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TopLabel(props: any) {
  const x = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
  return <text x={x} y={Number(props.y ?? 0) - 6} textAnchor="middle" fontSize={10} fill="#334E68">{props.value}</text>;
}

/** Columns of net premium with policy count + share % per row (hover a bar for the details). */
function PremiumChart({ title, data, testId, lowBelow, unit = "business share" }: { title: string; data: GroupStat[]; testId: string; lowBelow?: number; unit?: string }) {
  const rows: ChartRow[] = useMemo(() => {
    const total = data.reduce((a, d) => a + d.premium, 0);
    return data.map((d) => { const share = pct(d.premium, total); return { ...d, share, tag: `${compactInr(d.premium)} · ${share}%`, axis: `${d.label} (${d.count})` }; });
  }, [data]);
  const low = lowBelow == null ? 0 : rows.filter((d) => d.premium < lowBelow).length;
  const totalCount = rows.reduce((a, d) => a + d.count, 0);
  return (
    <div data-testid={testId} className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-heading text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground" data-testid={`${testId}-total`}>{totalCount} policies · net premium ₹ · {unit} %</span>
      </div>
      {lowBelow != null && low > 0 && (
        <p data-testid={`${testId}-low-count`} className="-mt-1 mb-3 text-xs text-red-300">{low} agent{low === 1 ? "" : "s"} below {compactInr(lowBelow)} net premium (red bars)</p>
      )}
      {rows.length === 0 ? (
        <div className="grid h-48 place-items-center text-sm text-muted-foreground">No data yet</div>
      ) : (
        <div className="overflow-x-auto" data-testid={`${testId}-scroll`}>
          {/* vertical columns: categories on X, net premium on Y; scrolls sideways on small screens instead of squashing */}
          <div style={{ minWidth: Math.max(280, rows.length * 92) }}>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={rows} margin={{ top: 28, right: 12, left: 4, bottom: 8 }}>
                <CartesianGrid vertical={false} stroke="#DCE4EE" />
                <XAxis dataKey="axis" interval={0} angle={-30} textAnchor="end" height={78} stroke="#52647A" fontSize={11}
                  tickFormatter={(v: string) => (v.length > 22 ? v.slice(0, 21) + "…" : v)} />
                <YAxis type="number" tickFormatter={(v: number) => compactInr(v)} stroke="#52647A" fontSize={11} width={62} />
                <Tooltip cursor={{ fill: "rgba(37,99,235,0.06)" }} content={<ChartTip lowBelow={lowBelow} />} />
                <Bar dataKey="premium" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive>
                  {rows.map((d) => <Cell key={d.label} fill={lowBelow != null && d.premium < lowBelow ? "#B91C1C" : "#2563EB"} />)}
                  <LabelList dataKey="tag" content={(p) => <TopLabel {...p} />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
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
      {me.role === "admin" && <ApprovalAlert />}
      {me.role === "admin" && <MissingPayablesAlert />}
      {myRates.data && <RateAlerts rates={myRates.data.rates} today={myRates.data.as_of} link max={4} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Policies" value={s ? String(s.total) : "—"} sub={s ? `${s.processing} in OCR` : undefined} icon={FileStack} tone="text-sky-400" testId="kpi-total-policies" />
        <Kpi label="Net premium" value={s ? compactInr(s.net_premium) : "—"} sub="OD + TP, before GST" icon={IndianRupee} tone="text-teal-400" testId="kpi-net-premium" />
        <Kpi label="Pending review" value={s ? String(pending) : "—"} sub={s ? `${s.flagged} flagged · ${s.failed} OCR failed` : undefined} icon={AlertTriangle} tone="text-amber-400" testId="kpi-pending-review" />
        <Kpi label="Verified" value={s ? String(s.verified) : "—"} sub={s && s.total ? `${Math.round((s.verified / s.total) * 100)}% of book` : undefined} icon={CheckCircle2} tone="text-emerald-400" testId="kpi-verified" />
        <Kpi label="Agent outstanding" value={s ? compactInr(s.outstanding) : "—"} sub="Cash + partial-payment balances" icon={Wallet} tone="text-orange-400" testId="kpi-agent-outstanding" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <PremiumChart title="Line of business" data={s?.by_lob ?? []} testId="chart-by-lob" />
        <PremiumChart title="Vehicle age (motor)" data={s?.by_age ?? []} testId="chart-by-vehicle-age" unit="motor share" />
        {me.role !== "agent" && <PremiumChart title="Agent-wise performance" data={s?.by_agent ?? []} testId="chart-all-agents" lowBelow={LOW_NET} unit="agent contribution" />}
        <PremiumChart title="Insurance company-wise" data={s?.by_insurer ?? []} testId="chart-by-insurer" unit="company share" />
        <PremiumChart title="Product-wise performance" data={s?.by_product ?? []} testId="chart-by-product" unit="product share" />
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
