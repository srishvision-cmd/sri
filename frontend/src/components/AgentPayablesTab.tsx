import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ListChecks, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/SimpleSelect";
import { MarginFillBar } from "@/components/AgentMarginFill";
import { apiGet, apiPost } from "@/lib/api";
import { useAgentOptions } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { AgentPayableRow, AgentPayablesIn, AgentPayablesView, CommissionRule, CompareRates, RateKey, RuleToolResult } from "@/lib/types";

const KEYS: { key: RateKey; label: string }[] = [
  { key: "od_percent", label: "OD %" }, { key: "tp_percent", label: "TP %" }, { key: "net_percent", label: "Net %" },
  { key: "odtp_percent", label: "OD+TP %" }, { key: "flat_amount", label: "Flat ₹" },
];
const SOURCE_TONE: Record<AgentPayableRow["source"], string> = {
  agent_rule: "text-sky-300", group_margin: "text-violet-300", group_rule: "text-teal-300", common_rule: "text-muted-foreground", missing: "text-red-300",
};
const rateText = (r: CompareRates | null) => (r ? KEYS.filter((k) => r[k.key] != null).map((k) => `${k.label.replace(" %", "")} ${r[k.key]}${k.key === "flat_amount" ? "" : "%"}`).join(" + ") || "—" : "—");

/** Pick an agent → every receivable (company × product) with what the agent gets; type payable rates in one table. */
export function AgentPayablesTab() {
  const qc = useQueryClient();
  const agents = useAgentOptions();
  const [agentId, setAgentId] = useState("");
  const [company, setCompany] = useState("");
  const [partner, setPartner] = useState("");
  const [to, setTo] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [edits, setEdits] = useState<Record<string, Partial<Record<RateKey, string>>>>({});
  const [from, setFrom] = useState("");
  const [result, setResult] = useState<RuleToolResult | null>(null);
  const view = useQuery({ queryKey: ["agent-payables", agentId], queryFn: () => apiGet<AgentPayablesView>(`/commission/agent-payables/${agentId}`), enabled: !!agentId });
  const allRules = useQuery({ queryKey: ["commission-rules"], queryFn: () => apiGet<CommissionRule[]>("/commission/rules"), enabled: !!agentId });
  const [product, setProduct] = useState("");

  const rows = useMemo(() => view.data?.rows ?? [], [view.data]);
  const companies = useMemo(() => [...new Set(rows.map((r) => r.insurer ?? "All companies"))].sort(), [rows]);
  // products with at least one receivable or payable rule for the selected company (all companies when none picked)
  const products = useMemo(() => [...new Set((allRules.data ?? [])
    .filter((r) => !r.superseded_by && (!company || (r.insurer ?? "All companies") === company))
    .flatMap((r) => r.products))].sort(), [allRules.data, company]);
  const partners = useMemo(() => [...new Set(rows.flatMap((r) => (r.broker ? r.broker.split(", ") : ["All partners"])))].sort(), [rows]);
  const shown = rows.filter((r) => (!company || (r.insurer ?? "All companies") === company) && (!partner || (r.broker ?? "All partners").split(", ").includes(partner))
    && (!product || r.products.length === 0 || r.products.includes(product))
    && (!onlyMissing || r.source === "missing"));
  const missing = rows.filter((r) => r.source === "missing").length;
  const val = (r: AgentPayableRow, k: RateKey) => edits[r.receivable_id]?.[k] ?? (r.source === "agent_rule" && r.payable?.[k] != null ? String(r.payable[k]) : "");
  const changed = Object.keys(edits);
  const setVal = (id: string, k: RateKey, v: string) => { setResult(null); setEdits((s) => ({ ...s, [id]: { ...s[id], [k]: v } })); };

  const body = (preview: boolean): AgentPayablesIn => ({
    agent_id: agentId, valid_from: from || null, valid_to: to || null, preview,
    rows: changed.map((id) => {
      const r = rows.find((x) => x.receivable_id === id)!;
      return { receivable_id: id, rates: Object.fromEntries(KEYS.map((k) => [k.key, val(r, k.key) === "" ? null : Number(val(r, k.key))])) };
    }),
  });
  const run = useMutation({
    mutationFn: (preview: boolean) => apiPost<RuleToolResult>("/commission/agent-payables", body(preview)),
    onSuccess: (res) => {
      setResult(res);
      if (res.errors) toast.error(`${res.errors} row${res.errors === 1 ? "" : "s"} have a problem — nothing saved`);
      else if (!res.preview) {
        toast.success(`Saved for ${view.data?.agent_label}: ${res.created} new, ${res.updated} updated`);
        setEdits({});
        qc.invalidateQueries({ queryKey: ["agent-payables", agentId] });
        qc.invalidateQueries({ queryKey: ["commission-rules"] });
        qc.invalidateQueries({ queryKey: ["agent-groups"] });
        qc.invalidateQueries({ queryKey: ["agents"] });
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const resOf = (id: string) => result?.rows.find((x) => x.key === id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-64 space-y-1">
          <Label className="text-xs">Agent</Label>
          <SimpleSelect value={agentId} onChange={(v) => { setAgentId(v); setEdits({}); setResult(null); setCompany(""); setProduct(""); }} placeholder="Pick an agent" testId="agent-payables-agent-select" className="w-full" searchable
            options={(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.username.toUpperCase()} · ${a.full_name}` }))} />
        </div>
        {view.data && (
          <>
            <div className="min-w-48 space-y-1">
              <Label className="text-xs">Company</Label>
              <SimpleSelect value={company} onChange={(v) => { setCompany(v); setProduct(""); }} allLabel="All companies" placeholder="Company" testId="agent-payables-company-select" className="w-full" options={companies.map((c) => ({ value: c, label: c }))} />
            </div>
            <div className="min-w-48 space-y-1">
              <Label className="text-xs">Product</Label>
              <SimpleSelect value={product} onChange={setProduct} allLabel="All products" placeholder="Product" testId="agent-payables-product-select" className="w-full" searchable options={products.map((p) => ({ value: p, label: p }))} />
            </div>
            <div className="min-w-44 space-y-1">
              <Label className="text-xs">Channel partner</Label>
              <SimpleSelect value={partner} onChange={setPartner} allLabel="All partners" placeholder="Partner" testId="agent-payables-partner-select" className="w-full" options={partners.map((p) => ({ value: p, label: p }))} />
            </div>
            <Button size="sm" variant={onlyMissing ? "default" : "outline"} onClick={() => setOnlyMissing(!onlyMissing)} data-testid="agent-payables-missing-toggle">
              Only missing ({missing})
            </Button>
            <div className="space-y-1">
              <Label className="text-xs">New rates from (blank = today)</Label>
              <Input type="date" value={from} onChange={(e) => { setResult(null); setFrom(e.target.value); }} className="h-8 w-40 text-xs" data-testid="agent-payables-from" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To (blank = open)</Label>
              <Input type="date" value={to} min={from || undefined} onChange={(e) => { setResult(null); setTo(e.target.value); }} className="h-8 w-40 text-xs" data-testid="agent-payables-to" />
            </div>
            <p data-testid="agent-payables-summary" className="ml-auto text-xs text-muted-foreground">
              {view.data.agent_label}{view.data.agent_group ? ` · Group ${view.data.agent_group}` : " · no group"} · {rows.length} receivables · <span className={missing ? "font-semibold text-red-300" : ""}>{missing} missing payable</span>
            </p>
          </>
        )}
      </div>

      {!agentId ? (
        <div data-testid="agent-payables-empty" className="grid place-items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          <UserRound className="size-6" /> Pick an agent to see every company / product they can sell and what they are paid.
        </div>
      ) : view.isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Type the agent's rate in any row to give them their own payable for that receivable (rows without a value keep the current source). Red = agent gets nothing today. Saving moves the agent off their group: whatever the group gave them is copied into their own rules first, so no rate is lost.
          </p>
          <MarginFillBar rows={shown} group={view.data?.agent_group ?? null} onFill={(fills) => { setResult(null); setEdits((e) => ({ ...e, ...fills })); }} />
          <div className="overflow-x-auto">
            <table data-testid="agent-payables-table" className="w-full text-xs">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Company · product</th><th className="px-2 py-1.5">Receivable</th><th className="px-2 py-1.5">Agent gets today</th>
                  {KEYS.map((k) => <th key={k.key} className="px-1 py-1.5 text-center">{k.label}</th>)}<th className="px-2 py-1.5">Check</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const res = resOf(r.receivable_id);
                  return (
                    <tr key={r.receivable_id} data-testid={`agent-payable-row-${r.receivable_id}`} className={cn("border-t border-border/60 align-top", r.source === "missing" && "bg-red-500/5")}>
                      <td className="max-w-64 px-2 py-1.5">
                        <div className="font-medium">{r.insurer ?? "All companies"} · {r.product}</div>
                        <div className="text-[10px] text-muted-foreground">{[r.broker && `via ${r.broker}`, ...r.conditions].filter(Boolean).join(" · ") || r.receivable_name}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono">{rateText(r.receivable)}</td>
                      <td className="max-w-56 px-2 py-1.5" data-testid={`agent-payable-source-${r.receivable_id}`}>
                        <div className={cn("font-mono", SOURCE_TONE[r.source])}>{r.source === "missing" ? "MISSING" : rateText(r.payable)}</div>
                        <div className="text-[10px] text-muted-foreground">{r.source_label}</div>
                      </td>
                      {KEYS.map((k) => (
                        <td key={k.key} className="px-0.5 py-1">
                          <Input type="number" min={0} step="0.01" value={val(r, k.key)} placeholder={r.receivable[k.key] != null ? `≤ ${r.receivable[k.key]}` : ""}
                            data-testid={`agent-payable-${r.receivable_id}-${k.key}`} onChange={(e) => setVal(r.receivable_id, k.key, e.target.value)}
                            className={cn("mx-auto h-7 w-20 text-right font-mono text-xs", edits[r.receivable_id]?.[k.key] !== undefined && "border-amber-400", r.source === "missing" && "border-red-400/60")} />
                        </td>
                      ))}
                      <td className="min-w-40 px-2 py-1.5">
                        {res?.action === "error" && <span className="text-red-300">{res.error}</span>}
                        {res && res.action !== "error" && <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="size-3" /> {res.action === "create" ? "new agent rule" : res.action}</span>}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Nothing to show for this filter.</td></tr>}
              </tbody>
            </table>
          </div>
          {result && (
            <p data-testid="agent-payables-result" className={cn("text-sm", result.errors ? "text-red-300" : "text-emerald-300")}>
              {result.errors ? `${result.errors} problem${result.errors === 1 ? "" : "s"} — nothing saved.` : result.preview ? "Check passed:" : "Saved:"} {result.created} new · {result.updated} updated · {result.unchanged} unchanged
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={!changed.length || run.isPending} onClick={() => run.mutate(true)} data-testid="agent-payables-check"><ListChecks className="size-4" /> Check {changed.length} row{changed.length === 1 ? "" : "s"}</Button>
            <Button disabled={!result?.preview || result.errors > 0 || run.isPending} onClick={() => run.mutate(false)} data-testid="agent-payables-save"><Save className="size-4" /> Save agent rates</Button>
          </div>
        </div>
      )}
    </div>
  );
}
