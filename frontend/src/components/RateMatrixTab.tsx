import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Grid3x3, ListChecks, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/MultiSelect";
import { SimpleSelect } from "@/components/SimpleSelect";
import { useCommissionMasters, useCompanyZones } from "@/components/RuleDialog";
import { apiGet, apiPost } from "@/lib/api";
import { useAgentGroups, useBrokers } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { CommissionRule, MatrixColumn, RateKey, RateMatrixIn, RuleKind, RuleToolResult } from "@/lib/types";

const COMPONENTS: { value: RateKey; label: string }[] = [
  { value: "od_percent", label: "OD %" }, { value: "tp_percent", label: "TP %" }, { value: "net_percent", label: "Net %" },
  { value: "odtp_percent", label: "OD+TP %" }, { value: "flat_amount", label: "Flat ₹" },
];
const ALL_RTOS = "All RTOs";
const sameSet = (a: string[] = [], b: string[] = []) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const sameNum = (a: number | null, b: number | null) => (a == null && b == null) || (a != null && b != null && Number(a) === Number(b));

/** "0-2500, 2501-3500, 12001-" → GVW slab columns */
function gvwColumns(text: string): MatrixColumn[] {
  return text.split(",").map((t) => t.trim()).filter(Boolean).map((t) => {
    const [lo, hi] = t.split("-").map((x) => x.trim());
    const n = (v?: string) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
    return { label: `${n(lo) ?? 0}–${n(hi) ?? "∞"} kg`, rtos: [], gvw_min: n(lo), gvw_max: n(hi) };
  });
}

/** Pick company + partners + products, then type one rate per (vehicle age × RTO group / GVW slab) cell — each cell is a rule. */
export function RateMatrixTab() {
  const qc = useQueryClient();
  const masters = useCommissionMasters();
  const brokers = useBrokers();
  const groups = useAgentGroups();
  const zones = useCompanyZones();
  const rules = useQuery({ queryKey: ["commission-rules"], queryFn: () => apiGet<CommissionRule[]>("/commission/rules") });
  const types = masters.data?.product_types ?? {};

  const [kind, setKind] = useState<RuleKind>("receivable");
  const [insurer, setInsurer] = useState("");
  const [partners, setPartners] = useState<string[]>([]);
  const [ptype, setPtype] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [group, setGroup] = useState("");
  const [component, setComponent] = useState<RateKey>("od_percent");
  const [ages, setAges] = useState<string[]>([]);
  const [rtoCols, setRtoCols] = useState<string[]>([ALL_RTOS]);
  const [gvwText, setGvwText] = useState("0-2500, 2501-3500, 3501-7500, 7501-12000, 12001-");
  const [from, setFrom] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RuleToolResult | null>(null);

  const isGcv = ptype === "GCV";
  const zoneOpts = useMemo(() => [
    ...(zones.data ?? []).filter((z) => !z.insurer || z.insurer === insurer).map((z) => ({ label: z.insurer ? `${z.name} (${z.insurer})` : z.name, rtos: z.rtos })),
    ...(masters.data?.rto_zones ?? []).map((z) => ({ label: z.name, rtos: z.rtos })),
    ...(masters.data?.rto_states ?? []).map((s) => ({ label: `${s.code} · ${s.name}`, rtos: [s.code] })),
  ], [zones.data, masters.data, insurer]);
  const columns: MatrixColumn[] = isGcv
    ? gvwColumns(gvwText)
    : rtoCols.map((l) => (l === ALL_RTOS ? { label: ALL_RTOS, rtos: [], gvw_min: null, gvw_max: null } : { label: l, rtos: zoneOpts.find((z) => z.label === l)?.rtos ?? [], gvw_min: null, gvw_max: null }));
  const rows: (string | null)[] = ages.length ? ages : [null];
  const brokerIds = partners.map((n) => brokers.data?.find((b) => b.name === n)?.id ?? n);
  const ready = !!insurer && products.length > 0 && columns.length > 0;
  const groupVal = kind === "payable" ? group || null : null;

  /** existing rule filling a cell = exactly the cell's conditions (mirrors routers/rule_tools._same_cell) */
  const existing = (age: string | null, col: MatrixColumn) => (rules.data ?? []).find((r) =>
    r.kind === kind && !r.superseded_by && r.active && (r.insurer ?? "").toLowerCase() === insurer.toLowerCase() && sameSet(r.broker_ids, brokerIds)
    && sameSet(r.products, products) && sameSet(r.vehicle_ages, age ? [age] : []) && sameSet(r.rtos, col.rtos)
    && sameNum(r.gvw_min, col.gvw_min) && sameNum(r.gvw_max, col.gvw_max) && (r.agent_group ?? null) === groupVal && !r.agent_id
    && !r.makes.length && !r.fuel_types.length && !(r.business_types ?? []).length && !r.model && r.cc_min == null && r.cc_max == null
    && r.seating_min == null && r.seating_max == null && r.ncb === "any" && r.cover === "any");
  const key = (age: string | null, ci: number) => `${age ?? ""}|${ci}`;
  const cellValue = (age: string | null, ci: number) => {
    const k = key(age, ci);
    if (k in edits) return edits[k];
    const v = existing(age, columns[ci])?.[component];
    return v == null ? "" : String(v);
  };
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { setEdits({}); setResult(null); fn(v); };

  const body = (preview: boolean): RateMatrixIn => ({
    kind, insurer, broker_ids: brokerIds, products, agent_group: groupVal, agent_id: null, component, columns, valid_from: from || null, preview,
    cells: rows.flatMap((age) => columns.map((_, ci) => ({ age, col: ci, value: cellValue(age, ci) === "" ? null : Number(cellValue(age, ci)) }))),
  });
  const run = useMutation({
    mutationFn: (preview: boolean) => apiPost<RuleToolResult>("/commission/matrix", body(preview)),
    onSuccess: (res) => {
      setResult(res);
      if (res.errors) toast.error(`${res.errors} cell${res.errors === 1 ? "" : "s"} have a problem — nothing saved yet`);
      else if (!res.preview) {
        qc.invalidateQueries({ queryKey: ["commission-rules"] });
        setEdits({});
        toast.success(`Saved: ${res.created} new rule${res.created === 1 ? "" : "s"}, ${res.updated} updated, ${res.unchanged} unchanged`);
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rowResult = (age: string | null, ci: number) => result?.rows.find((r) => r.key === key(age, ci));

  return (
    <div className="space-y-4">
      <div data-testid="matrix-setup" className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Grid</Label>
          <div className="flex gap-1.5">
            {(["receivable", "payable"] as const).map((k) => (
              <Button key={k} size="sm" type="button" variant={kind === k ? "default" : "outline"} data-testid={`matrix-kind-${k}`} onClick={() => reset(setKind)(k)}>
                {k === "receivable" ? "Receivable" : "Payable"}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">1. Insurance company</Label>
          <SimpleSelect value={insurer} onChange={reset(setInsurer)} placeholder="Pick company" testId="matrix-insurer-select" className="w-full" searchable
            options={(masters.data?.insurers ?? []).map((i) => ({ value: i, label: i }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">2. Channel partners — none = all</Label>
          <MultiSelect value={partners} onChange={reset(setPartners)} options={(brokers.data ?? []).map((b) => b.name)} placeholder="All channel partners" testId="matrix-partners-select" />
        </div>
        {kind === "payable" && (
          <div className="space-y-1">
            <Label className="text-xs">Agent group — none = all agents</Label>
            <SimpleSelect value={group} onChange={reset(setGroup)} allLabel="All agents" placeholder="Group" testId="matrix-group-select" className="w-full"
              options={(groups.data ?? []).map((g) => ({ value: g.name, label: g.name }))} />
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">3. Product type</Label>
          <SimpleSelect value={ptype} onChange={(v) => { setEdits({}); setResult(null); setPtype(v); setProducts(types[v] ? [...types[v]] : []); }} placeholder="Pick product type" testId="matrix-ptype-select" className="w-full"
            options={Object.keys(types).map((t) => ({ value: t, label: t }))} />
        </div>
        <div className="space-y-1 xl:col-span-2">
          <Label className="text-xs">Products</Label>
          <MultiSelect value={products} onChange={reset(setProducts)} options={types[ptype] ?? []} placeholder="Pick products" testId="matrix-products-select" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">4. Rate to enter</Label>
          <SimpleSelect value={component} onChange={(v) => { setEdits({}); setResult(null); setComponent(v as RateKey); }} placeholder="Rate" testId="matrix-component-select" className="w-full" options={COMPONENTS} />
        </div>
        <div className="space-y-1 xl:col-span-2">
          <Label className="text-xs">Rows — vehicle age bands (none = one row for all ages)</Label>
          <MultiSelect value={ages} onChange={reset(setAges)} options={masters.data?.age_bands ?? []} placeholder="All ages" testId="matrix-ages-select" />
        </div>
        <div className="space-y-1 xl:col-span-2">
          {isGcv ? (
            <>
              <Label className="text-xs">Columns — GVW slabs in kg (from-to, comma separated; blank end = no limit)</Label>
              <Input data-testid="matrix-gvw-input" value={gvwText} onChange={(e) => { setEdits({}); setResult(null); setGvwText(e.target.value); }} className="font-mono text-xs" />
            </>
          ) : (
            <>
              <Label className="text-xs">Columns — RTO groups (manage them in the RTO groups tab)</Label>
              <MultiSelect value={rtoCols} onChange={reset(setRtoCols)} options={[ALL_RTOS, ...zoneOpts.map((z) => z.label)]} placeholder="Pick RTO groups" testId="matrix-rto-columns-select" />
            </>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rates apply from (blank = today)</Label>
          <Input type="date" data-testid="matrix-valid-from" value={from} onChange={(e) => { setResult(null); setFrom(e.target.value); }} className="text-xs" />
        </div>
      </div>

      {!ready ? (
        <div data-testid="matrix-empty" className="grid place-items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          <Grid3x3 className="size-6" />
          Pick a company, product type and products to open the rate table.
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Type {COMPONENTS.find((c) => c.value === component)?.label} in each cell. Filled cells already in the grid are pre-loaded; changed cells are outlined amber. Empty cells are left as they are.
            Each cell saves as one {kind} rule (other rates on an existing rule are kept).
          </p>
          <div className="overflow-x-auto">
            <table data-testid="matrix-table" className="text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-card px-2 py-1.5 text-left text-muted-foreground">Vehicle age ↓ / {isGcv ? "GVW" : "RTO"} →</th>
                  {columns.map((c, ci) => <th key={c.label} data-testid={`matrix-col-${ci}`} className="min-w-24 px-2 py-1.5 text-center font-semibold">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((age) => (
                  <tr key={age ?? "all"} className="border-t border-border/60">
                    <th className="sticky left-0 bg-card px-2 py-1 text-left font-medium">{age ?? "All ages"}</th>
                    {columns.map((c, ci) => {
                      const k = key(age, ci);
                      const res = rowResult(age, ci);
                      const had = existing(age, c);
                      return (
                        <td key={c.label} className="px-1 py-1 text-center" title={res?.error ?? (had ? `Existing rule: ${had.name}` : "New rule")}>
                          <Input type="number" min={0} step="0.01" data-testid={`matrix-cell-${(age ?? "all").replace(/\s+/g, "-").toLowerCase()}-${ci}`}
                            value={cellValue(age, ci)} onChange={(e) => { setResult(null); setEdits((s) => ({ ...s, [k]: e.target.value })); }}
                            className={cn("mx-auto h-8 w-20 text-center font-mono text-xs", k in edits && "border-amber-400", had && !(k in edits) && "bg-sky-500/5",
                              res?.action === "error" && "border-red-400 bg-red-500/10")} />
                          {res && res.action !== "unchanged" && (
                            <div className={cn("mt-0.5 text-[10px]", res.action === "error" ? "text-red-300" : "text-emerald-300")}>{res.action === "error" ? "problem" : res.action === "create" ? "new" : "update"}</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result && (
            <div data-testid="matrix-result" className="space-y-1 text-sm">
              <p className={result.errors ? "text-red-300" : "text-emerald-300"}>
                {result.errors ? `${result.errors} problem${result.errors === 1 ? "" : "s"} — nothing saved.` : result.preview ? "Check passed:" : "Saved:"} {result.created} new · {result.updated} updated · {result.unchanged} unchanged
              </p>
              {result.rows.filter((r) => r.action === "error").map((r) => <p key={r.key} className="text-xs text-red-300">{r.name}: {r.error}</p>)}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate(true)} data-testid="matrix-check-button"><ListChecks className="size-4" /> Check</Button>
            <Button disabled={run.isPending || !result?.preview || result.errors > 0} onClick={() => run.mutate(false)} data-testid="matrix-save-button"><Save className="size-4" /> Save rates</Button>
            {result && !result.preview && !result.errors && <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="size-3.5" /> Grid updated</span>}
          </div>
        </div>
      )}
    </div>
  );
}
