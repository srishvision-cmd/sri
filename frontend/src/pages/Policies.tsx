import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { ReassignAgent } from "@/components/ReassignAgent";
import { BulkBroker } from "@/components/BulkBroker";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileDown, FileSpreadsheet, RotateCcw, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/components/SimpleSelect";
import { StatusBadge } from "@/components/StatusBadge";
import { apiGet } from "@/lib/api";
import { useAgentOptions, useMeta } from "@/lib/auth";
import { EMPTY_FILTERS, filterQuery, fmtDate, fmtDateTime, GVW_NA_CLASSES, money, STATUS_LABEL } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { Policy, PolicyFilterState, User } from "@/lib/types";

interface MisColumn {
  id: string;
  label: string;
  render: (p: Policy) => ReactNode;
  align?: "right";
  mono?: boolean;
  sticky?: boolean;
}

const txt = (v: string | number | null) => (v === null || v === "" ? <span className="text-muted-foreground">—</span> : v);
// Partial Payment on either side (agent → Srishvision or Srishvision → broker) is highlighted in amber
const isPartial = (p: Policy) => p.payment_mode === "Partial Payment" || p.broker_payment_mode === "Partial Payment";
const num = (v: number | null) => (v === null ? <span className="text-muted-foreground">—</span> : v.toLocaleString("en-IN"));

const AGE_TONE: Record<string, string> = {
  "Below 5 Years": "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  "5-7 Years": "text-sky-300 border-sky-500/30 bg-sky-500/10",
  "7-10 Years": "text-amber-300 border-amber-500/30 bg-amber-500/10",
  "Above 10 Years": "text-red-300 border-red-500/30 bg-red-500/10",
};

// Business-requested motor MIS column order (mirrors MIS_COLUMNS in backend/routers/policies.py)
const MIS_COLUMNS: MisColumn[] = [
  { id: "agent", label: "Agent name", sticky: true, render: (p) => <span>{p.agent_name} <span className="font-mono text-[11px] text-muted-foreground">{p.agent_code}</span></span> },
  { id: "intermediary", label: "Broker / Agent / POS", render: (p) => txt(p.fields.intermediary_name) },
  { id: "insurer", label: "Insurer", render: (p) => txt(p.fields.insurer) },
  { id: "lob", label: "LOB", render: (p) => txt(p.fields.lob) },
  { id: "risk-start", label: "Risk start", render: (p) => (p.fields.start_date ? fmtDate(p.fields.start_date) : txt(null)) },
  { id: "customer", label: "Customer name", render: (p) => txt(p.fields.insured_name) },
  { id: "policy-no", label: "Policy no.", mono: true, render: (p) => p.fields.policy_number ?? <span className="text-muted-foreground">{p.file_name}</span> },
  { id: "reg-no", label: "Registration no.", mono: true, render: (p) => txt(p.fields.vehicle_reg_no) },
  { id: "mfg-year", label: "Year of mfg", mono: true, render: (p) => txt(p.fields.mfg_year) },
  { id: "product", label: "Product", render: (p) => txt(p.fields.product_name) },
  { id: "make", label: "Make", render: (p) => txt(p.fields.make) },
  { id: "model", label: "Model", render: (p) => txt(p.fields.model) },
  { id: "idv", label: "IDV / Sum insured", align: "right", render: (p) => money(p.fields.lob === "Motor" ? p.fields.idv ?? p.fields.sum_insured : p.fields.sum_insured) },
  { id: "od-premium", label: "OD prem. (incl. add-ons)", align: "right", render: (p) => money(p.fields.od_premium) },
  { id: "tp-premium", label: "TP prem. (liability)", align: "right", render: (p) => money(p.fields.tp_premium) },
  { id: "net-premium", label: "Net premium", align: "right", render: (p) => money(p.fields.net_premium) },
  { id: "gst", label: "GST", align: "right", render: (p) => money(p.fields.gst) },
  { id: "total-premium", label: "Total premium", align: "right", render: (p) => money(p.fields.gross_premium) },
  {
    id: "gvw",
    label: "GVW (kg)",
    align: "right",
    render: (p) =>
      p.fields.vehicle_class && GVW_NA_CLASSES.includes(p.fields.vehicle_class) ? <span className="text-muted-foreground">NA</span> : num(p.fields.gvw),
  },
  { id: "cc", label: "CC", align: "right", render: (p) => num(p.fields.cc) },
  { id: "seating", label: "Seating", align: "right", render: (p) => num(p.fields.seating_capacity) },
  { id: "rto", label: "RTO", mono: true, render: (p) => txt(p.fields.rto) },
  {
    id: "vehicle-age",
    label: "Vehicle age",
    render: (p) =>
      p.fields.vehicle_age_bucket ? (
        <span className={cn("rounded border px-1.5 py-0.5 text-[11px] font-medium", AGE_TONE[p.fields.vehicle_age_bucket])}>
          {p.fields.vehicle_age_bucket} · {p.fields.vehicle_age_years}y
        </span>
      ) : (
        txt(null)
      ),
  },
  { id: "status", label: "Status", render: (p) => <StatusBadge status={p.status} /> },
  { id: "payment-mode", label: "Paid by", render: (p) => (
    <span className="inline-flex items-center gap-1.5">{txt(p.payment_mode)}
      {isPartial(p) && <span data-testid={`policy-partial-badge-${p.id}`} title={p.upload_batch_id ? `Batch ${p.upload_batch_id.slice(0, 8)}` : undefined}
        className="rounded border border-yellow-400/50 bg-yellow-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-200">
        Partial{p.broker_payment_mode === "Partial Payment" ? (p.payment_mode === "Partial Payment" ? " · A+B" : " · Broker") : ""}{p.upload_batch_id ? ` · ${p.upload_batch_id.slice(0, 4)}` : ""}</span>}
    </span>
  ) },
  { id: "amount-paid", label: "Amount paid", align: "right", render: (p) => money(p.amount_paid) },
  {
    id: "outstanding",
    label: "Outstanding",
    align: "right",
    render: (p) => <span className={cn((p.outstanding ?? 0) > 0 && "font-semibold text-orange-300")}>{money(p.outstanding)}</span>,
  },
  {
    id: "document",
    label: "Policy copy",
    render: (p) =>
      p.has_file ? (
        <a
          href={`/api/policies/${p.id}/file?download=true`}
          onClick={(e) => e.stopPropagation()}
          data-testid={`policy-download-${p.id}`}
          className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
        >
          <FileDown className="size-3.5" /> Download
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">Not available</span>
      ),
  },
  { id: "uploaded", label: "Uploaded", render: (p) => <span className="text-xs text-muted-foreground">{fmtDateTime(p.created_at)}</span> },
];

// admin only — computed from the commission grid
const COMMISSION_COLUMNS: MisColumn[] = [
  { id: "broker", label: "Broker", render: (p) => txt(p.broker_name) },
  { id: "product-category", label: "Common product", render: (p) => txt(p.fields.product_category) },
  { id: "comm-receivable", label: "Comm. receivable", align: "right", render: (p) => money(p.commission?.receivable) },
  { id: "comm-payable", label: "Comm. payable", align: "right", render: (p) => (
    <span className={cn(p.commission?.capped && "text-amber-300")} title={p.commission?.note ?? undefined}>{money(p.commission?.payable)}</span>
  ) },
  { id: "comm-margin", label: "Margin", align: "right", render: (p) => <span className="text-teal-300">{money(p.commission?.margin)}</span> },
  { id: "comm-paid", label: "Comm. paid", render: (p) =>
    p.commission_paid ? (
      <span className="text-xs text-emerald-300" title={`UTR ${p.commission_utr ?? ""}`}>Paid {p.commission_paid_date} · {p.commission_utr}</span>
    ) : p.commission_statement_no ? (
      <span className="text-xs text-amber-300">In {p.commission_statement_no}</span>
    ) : (
      <span className="text-xs text-muted-foreground">Unpaid</span>
    ) },
];

export default function Policies() {
  const me = useOutletContext<User>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [filters, setFilters] = useState<PolicyFilterState>({ ...EMPTY_FILTERS, q: urlQ });
  const [seenQ, setSeenQ] = useState(urlQ);
  const canSelect = me.role !== "agent";
  const columns = me.role === "admin" ? [...MIS_COLUMNS, ...COMMISSION_COLUMNS] : me.role === "agent" ? MIS_COLUMNS.filter((c) => c.id !== "intermediary") : MIS_COLUMNS;
  const [selected, setSelected] = useState<string[]>([]);
  if (urlQ !== seenQ) {
    // header search navigated here with a new term — adopt it
    setSeenQ(urlQ);
    setFilters((f) => ({ ...f, q: urlQ }));
  }
  const qs = filterQuery(filters);
  const meta = useMeta();
  const agents = useAgentOptions(me.role !== "agent");

  const policies = useQuery({
    queryKey: ["policies", qs],
    queryFn: () => apiGet<Policy[]>(`/policies${qs ? `?${qs}` : ""}`),
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === "processing") ? 3000 : false),
  });
  const rows = policies.isError ? [] : policies.data ?? [];
  const total = rows.reduce((sum, p) => sum + (p.fields.gross_premium ?? 0), 0);

  const set = (k: keyof PolicyFilterState) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const exportHref = (format: "csv" | "xlsx") => `/api/mis/export?format=${format}${qs ? `&${qs}` : ""}`;

  const selectedAgent = agents.data?.find((a) => a.id === filters.agent_id);
  const exportScope =
    me.role === "agent"
      ? "Your policy MIS"
      : selectedAgent
        ? `MIS for ${selectedAgent.full_name}`
        : me.role === "admin"
          ? "Overall system MIS"
          : `Branch / team MIS (${me.branch})`;

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Policy MIS registry</h2>
          <p data-testid="mis-export-scope" className="mt-1 text-sm text-muted-foreground">
            Export scope: <span className="text-foreground">{exportScope}</span> · current filters apply
          </p>
        </div>
        <div className="flex gap-2">
          <a href={exportHref("csv")} data-testid="export-mis-csv" className={buttonVariants({ variant: "outline" })}>
            <Download className="size-4" /> CSV
          </a>
          <a href={exportHref("xlsx")} data-testid="export-mis-xlsx" className={buttonVariants()}>
            <FileSpreadsheet className="size-4" /> Excel
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid="policies-search-input"
            value={filters.q}
            onChange={(e) => set("q")(e.target.value)}
            placeholder="Policy no., insured name, vehicle no."
            className="pl-8"
          />
        </div>
        <SimpleSelect
          value={filters.status}
          onChange={set("status")}
          allLabel="All statuses"
          placeholder="Status"
          testId="policies-status-filter"
          options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <SimpleSelect
          value={filters.lob}
          onChange={set("lob")}
          allLabel="All LOBs"
          placeholder="LOB"
          testId="policies-lob-filter"
          options={(meta.data?.lobs ?? []).map((l) => ({ value: l, label: l }))}
        />
        <SimpleSelect
          value={filters.age_bucket}
          onChange={set("age_bucket")}
          allLabel="All vehicle ages"
          placeholder="Vehicle age"
          testId="policies-age-filter"
          className="min-w-40"
          options={(meta.data?.age_buckets ?? []).map((b) => ({ value: b, label: b }))}
        />
        <SimpleSelect
          value={filters.payment_mode}
          onChange={set("payment_mode")}
          allLabel="All payment modes"
          placeholder="Payment mode"
          testId="policies-payment-filter"
          className="min-w-40"
          options={(meta.data?.payment_modes ?? []).map((m) => ({ value: m, label: m }))}
        />
        {me.role !== "agent" && (
          <SimpleSelect
            value={filters.agent_id}
            onChange={set("agent_id")}
            allLabel="All agents"
            placeholder="Agent"
            testId="policies-agent-filter"
            searchable
            className="min-w-44"
            options={(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.full_name} · ${a.username.toUpperCase()}` }))}
          />
        )}
        <div className="flex items-center gap-1.5">
          <Input type="date" data-testid="policies-date-from" value={filters.date_from} onChange={(e) => set("date_from")(e.target.value)} className="w-36" aria-label="Uploaded from" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" data-testid="policies-date-to" value={filters.date_to} onChange={(e) => set("date_to")(e.target.value)} className="w-36" aria-label="Uploaded to" />
        </div>
        <Button variant="ghost" size="sm" data-testid="policies-reset-filters" onClick={() => setFilters(EMPTY_FILTERS)}>
          <RotateCcw className="size-3.5" /> Reset
        </Button>
      </div>

      {canSelect && selected.length > 0 && (
        <div data-testid="policies-selection-bar" className="sticky top-16 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-sky-500/40 bg-[#111827]/90 px-4 py-3 shadow-lg backdrop-blur-md animate-rise">
          <span data-testid="policies-selected-count" className="text-sm font-semibold">
            {selected.length} selected
          </span>
          <ReassignAgent policyIds={selected} onDone={() => setSelected([])} testId="bulk-reassign-agent" />
          <BulkBroker policyIds={selected} onDone={() => setSelected([])} />
          <Button variant="ghost" size="sm" onClick={() => setSelected([])} data-testid="policies-clear-selection">
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span data-testid="policies-count">{rows.length} policies</span>
          <span>
            Total premium <span data-testid="policies-total-premium" className="ml-1 font-mono text-foreground tabular">{money(total)}</span>
          </span>
        </div>
        <Table className="whitespace-nowrap text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {canSelect && (
                <TableHead className="w-10">
                  <Checkbox
                    data-testid="policies-select-all"
                    aria-label="Select all"
                    checked={rows.length > 0 && selected.length === rows.length}
                    onCheckedChange={(v) => setSelected(v ? rows.map((r) => r.id) : [])}
                  />
                </TableHead>
              )}
              {columns.map((c) => (
                <TableHead key={c.label} className={cn(c.align === "right" && "text-right", c.sticky && "sticky left-0 z-10 bg-card")}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody data-testid="policies-table-body">
            {rows.map((p) => (
              <TableRow
                key={p.id}
                data-testid={`policy-row-${p.id}`}
                onClick={() => navigate(`/policies/${p.id}`)}
                data-partial={isPartial(p) || undefined}
                className={cn("group cursor-pointer transition-colors duration-150", isPartial(p) && "bg-yellow-400/[0.07] shadow-[inset_3px_0_0_0_rgb(250_204_21)]")}
              >
                {canSelect && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      data-testid={`policy-select-${p.id}`}
                      aria-label="Select policy"
                      checked={selected.includes(p.id)}
                      onCheckedChange={(v) => setSelected((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                    />
                  </TableCell>
                )}
                {columns.map((c) => (
                  <TableCell
                    key={c.label}
                    data-testid={`policy-cell-${c.id}`}
                    className={cn(
                      c.align === "right" && "text-right font-mono tabular",
                      c.mono && "font-mono text-xs",
                      c.sticky && "sticky left-0 z-10 bg-card transition-colors duration-150 group-hover:bg-muted",
                    )}
                  >
                    {c.render(p)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!policies.isLoading && rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length + (canSelect ? 1 : 0)} className="py-12 text-center text-sm text-muted-foreground">
                  No policies match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
