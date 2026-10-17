import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileDown, Layers, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { BulkPayableDialog } from "@/components/BulkPayableDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RuleDialog } from "@/components/RuleDialog";
import { apiGet, apiPut } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { CommissionRule, CommissionRuleIn, CommissionSettings, CompareRates, CompareRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const KEYS: [keyof CompareRates, string][] = [["od_percent", "OD"], ["tp_percent", "TP"], ["net_percent", "Net"], ["odtp_percent", "OD+TP"], ["flat_amount", "Flat ₹"]];
const fmt = (k: keyof CompareRates, v: number) => (k === "flat_amount" ? `₹${v.toLocaleString("en-IN")}` : `${+v.toFixed(2)}%`);
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function Rates({ r, margin }: { r: CompareRates; margin?: boolean }) {
  const parts = KEYS.filter(([k]) => r[k] != null);
  if (!parts.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map(([k, l]) => {
        const v = r[k] as number;
        return (
          <span key={k} className={cn("whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[11px]",
            !margin ? "bg-muted/60 text-foreground" : v > 0 ? "bg-emerald-500/15 text-emerald-300" : v === 0 ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300")}>
            {l} {margin && v > 0 ? "+" : ""}{fmt(k, v)}
          </span>
        );
      })}
    </div>
  );
}

/** Each receivable rule beside the payables that overlap it, with the margin left for the business. */
export function GridCompare() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["commission-compare"], queryFn: () => apiGet<CompareRow[]>("/commission/compare") });
  const rules = useQuery({ queryKey: ["commission-rules"], queryFn: () => apiGet<CommissionRule[]>("/commission/rules") });
  const [payFor, setPayFor] = useState<CommissionRule | null>(null);
  const [bulk, setBulk] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const settings = useQuery({ queryKey: ["commission-settings"], queryFn: () => apiGet<CommissionSettings>("/commission/settings") });
  const [minDraft, setMinDraft] = useState<string | null>(null);
  const saveMin = useMutation({
    mutationFn: (min_margin: number) => apiPut<CommissionSettings>("/commission/settings", { min_margin } satisfies CommissionSettings),
    onSuccess: (s) => { qc.setQueryData(["commission-settings"], s); qc.invalidateQueries({ queryKey: ["commission-compare"] }); setMinDraft(null); toast.success(`Low margin alert set to under ${s.min_margin}%`); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const minMargin = settings.data?.min_margin ?? 2;
  const minValue = minDraft ?? String(minMargin);
  // payable pre-filled with the receivable's conditions — only the rates (and who it is for) are left to fill
  const presetFrom = (rec: CommissionRule): Partial<CommissionRuleIn> => {
    const keep: (keyof CommissionRuleIn)[] = ["insurer", "products", "rtos", "vehicle_ages", "fuel_types", "business_types", "ncb", "cover", "broker_ids", "gvw_min", "gvw_max", "cc_min", "cc_max", "seating_min", "seating_max", "makes", "model", "valid_from", "valid_to"];
    return Object.fromEntries(keep.map((k) => [k, rec[k]])) as Partial<CommissionRuleIn>;
  };
  const openPayable = (ruleId: string) => {
    const rec = rules.data?.find((r) => r.id === ruleId);
    if (rec) setPayFor(rec);
  };
  const [search, setSearch] = useState("");
  const [insurer, setInsurer] = useState("");
  const rows = q.data ?? [];
  const insurers = [...new Set(rows.map((r) => r.insurer || "All companies"))];
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!onlyLow || r.payables.some((p) => p.low_margin)) && (!insurer || (r.insurer || "All companies") === insurer) &&
    (!needle || [r.rule_name, r.product, r.insurer, r.broker, ...r.conditions, ...r.payables.map((p) => p.label)].join(" ").toLowerCase().includes(needle)));
  const byInsurer = new Map<string, typeof shown>();
  for (const r of shown) {
    const k = r.insurer || "All companies";
    byInsurer.set(k, [...(byInsurer.get(k) ?? []), r]);
  }
  const groups = insurers.filter((i) => byInsurer.has(i));
  const noPayable = rows.filter((r) => r.payables.length === 0).length;
  const scope = rows.filter((r) => !insurer || (r.insurer || "All companies") === insurer);
  const scopeMissing = scope.filter((r) => r.payables.length === 0).length;
  const lowCount = rows.reduce((n, r) => n + r.payables.filter((p) => p.low_margin).length, 0);

  return (
    <div className="space-y-4" data-testid="grid-compare">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input data-testid="compare-search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product, RTO, partner, group…" className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1" data-testid="compare-insurer-filter">
          {["", ...insurers].map((i) => (
            <button key={i || "all"} type="button" onClick={() => setInsurer(i)} data-testid={`compare-insurer-${slug(i || "all")}`}
              className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors duration-150", insurer === i ? "border-primary bg-primary text-white" : "border-border text-muted-foreground hover:text-foreground")}>
              {i || "All"}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground" data-testid="compare-summary">
          {rows.length} receivable rules{noPayable ? ` · ${noPayable} without any payable` : ""}
        </span>
        <a href={`/api/commission/compare/export${insurer ? `?insurer=${encodeURIComponent(insurer)}` : ""}`} data-testid="compare-export-button">
          <Button size="sm" variant="outline"><FileDown className="size-3.5" /> Download Excel{insurer ? ` · ${insurer}` : " (sheet per company)"}</Button>
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2">
        <AlertTriangle className={cn("size-4", lowCount ? "text-amber-300" : "text-muted-foreground")} />
        <span className="text-xs text-muted-foreground">Flag payables that leave under</span>
        <Input data-testid="compare-min-margin-input" type="number" step="0.25" min={0} value={minValue} onChange={(e) => setMinDraft(e.target.value)} className="h-8 w-20 text-xs" />
        <span className="text-xs text-muted-foreground">% margin</span>
        {minDraft !== null && Number(minDraft) !== minMargin && minDraft.trim() !== "" && (
          <Button size="sm" variant="secondary" disabled={saveMin.isPending} onClick={() => saveMin.mutate(Number(minDraft))} data-testid="compare-min-margin-save">Save</Button>
        )}
        <button type="button" onClick={() => setOnlyLow((v) => !v)} data-testid="compare-low-margin-filter"
          className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors duration-150", onlyLow ? "border-amber-400 bg-amber-500/20 text-amber-200" : lowCount ? "border-amber-500/50 text-amber-300 hover:bg-amber-500/10" : "border-border text-muted-foreground")}>
          {lowCount} low-margin payable{lowCount === 1 ? "" : "s"}{onlyLow ? " · showing only these" : ""}
        </button>
        <Button size="sm" className="ml-auto" disabled={!scopeMissing} onClick={() => setBulk(true)} data-testid="compare-bulk-payable-button">
          <Layers className="size-3.5" /> Bulk set payable ({scopeMissing} without payable{insurer ? ` · ${insurer}` : ""})
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Margin = receivable − payable (percentage points). <span className="text-emerald-300">Green</span> you keep a margin, <span className="text-amber-300">amber</span> nothing left,{" "}
        <span className="text-red-300">red</span> paying more than you receive. Group lines come from each partner group's margin setting.
      </p>
      {q.isLoading && <p className="text-sm text-muted-foreground" data-testid="compare-loading">Loading grid…</p>}
      {q.isSuccess && shown.length === 0 && <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="compare-empty">No receivable rules match.</p>}
      {groups.map((g) => (
        <section key={g} className="overflow-hidden rounded-xl border border-border bg-card" data-testid={`compare-group-${slug(g)}`}>
          <h3 className="border-b border-border bg-muted/30 px-4 py-2 font-heading text-sm font-semibold">{g}</h3>
          <div className="divide-y divide-border/60">
            {(byInsurer.get(g) ?? []).map((r) => (
              <div key={r.rule_id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" data-testid={`compare-row-${r.rule_id}`}>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{r.product}</span>
                    {r.broker && <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-300">{r.broker}</span>}
                    {r.valid_from && <span className="text-[11px] text-muted-foreground">from {r.valid_from}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.rule_name}</div>
                  {r.conditions.length > 0 && <div className="text-[11px] text-muted-foreground">{r.conditions.join(" · ")}</div>}
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">Receivable <Rates r={r.rates} /></div>
                </div>
                <div>
                  {r.payables.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-amber-500/40 px-3 py-2" data-testid={`compare-no-payable-${r.rule_id}`}>
                      <span className="text-xs text-amber-300">No payable set — partners get nothing on these policies.</span>
                      <Button size="sm" onClick={() => openPayable(r.rule_id)} disabled={!rules.data} data-testid={`compare-set-payable-${r.rule_id}`}>
                        <Plus className="size-3.5" /> Set payable
                      </Button>
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-left text-[11px] text-muted-foreground">
                        <tr><th className="pb-1 pr-2 font-normal">Paid to</th><th className="pb-1 pr-2 font-normal">Payable</th><th className="pb-1 font-normal">Your margin</th></tr>
                      </thead>
                      <tbody>
                        {r.payables.map((p, i) => (
                          <tr key={`${p.source}-${p.label}-${p.rule_name ?? ""}-${JSON.stringify(p.rates)}`} className={cn("border-t border-border/40 align-top", p.low_margin && "bg-amber-500/5")} data-testid={`compare-payable-${r.rule_id}-${i}`}>
                            <td className="py-1.5 pr-2">
                              <div>{p.label}</div>
                              <div className="text-[10px] text-muted-foreground">{p.source === "rule" ? p.rule_name : "auto from group margin"}</div>
                            </td>
                            <td className="py-1.5 pr-2"><Rates r={p.rates} /></td>
                            <td className="py-1.5">
                              <Rates r={p.margin} margin />
                              {p.low_margin && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300" data-testid={`compare-low-margin-${r.rule_id}-${i}`}>
                                  <AlertTriangle className="size-3" /> Under {minMargin}% margin
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {r.payables.length > 0 && (
                    <button type="button" onClick={() => openPayable(r.rule_id)} data-testid={`compare-add-payable-${r.rule_id}`}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-300 transition-colors hover:text-sky-200">
                      <Plus className="size-3" /> Add payable for another partner / group
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {bulk && <BulkPayableDialog insurer={insurer} missing={scopeMissing} onClose={() => setBulk(false)} />}
      {payFor && (
        <RuleDialog key={payFor.id} kind="payable" editing={null} preset={presetFrom(payFor)} keepProducts onClose={() => setPayFor(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["commission-compare"] }); setPayFor(null); }} />
      )}
    </div>
  );
}
