import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Copy, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MultiSelect } from "@/components/MultiSelect";
import { SimpleSelect } from "@/components/SimpleSelect";
import { useCommissionMasters } from "@/components/RuleDialog";
import { apiPost } from "@/lib/api";
import { useBrokers } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { CommissionRule, RateKey, RuleCopyIn, RuleRates, RuleToolResult } from "@/lib/types";

const KEEP = "__keep__";
const RATE_COLS: { key: RateKey; label: string }[] = [
  { key: "od_percent", label: "OD %" }, { key: "tp_percent", label: "TP %" }, { key: "net_percent", label: "Net %" },
  { key: "odtp_percent", label: "OD+TP %" }, { key: "flat_amount", label: "Flat ₹" },
];
const asText = (v: number | null | undefined) => (v == null ? "" : String(v));

/** Copy selected rules to another company / channel partners / dates; rates are editable per rule before saving. */
export function CopyRulesDialog({ rules, onClose, onDone }: { rules: CommissionRule[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const masters = useCommissionMasters();
  const brokers = useBrokers();
  const [insurer, setInsurer] = useState(KEEP);
  const [partnerMode, setPartnerMode] = useState<"keep" | "set">("keep");
  const [partners, setPartners] = useState<string[]>([]); // names
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rates, setRates] = useState<Record<string, Record<RateKey, string>>>(() =>
    Object.fromEntries(rules.map((r) => [r.id, Object.fromEntries(RATE_COLS.map((c) => [c.key, asText(r[c.key])])) as Record<RateKey, string>])));
  const [result, setResult] = useState<RuleToolResult | null>(null);

  const body = (preview: boolean): RuleCopyIn => ({
    rule_ids: rules.map((r) => r.id),
    insurer: insurer === KEEP ? null : insurer,
    broker_ids: partnerMode === "keep" ? null : partners.map((n) => brokers.data?.find((b) => b.name === n)?.id ?? n),
    valid_from: from || null,
    valid_to: to || null,
    rates: Object.fromEntries(Object.entries(rates).map(([id, v]) => [id, Object.fromEntries(RATE_COLS.map((c) => [c.key, v[c.key] === "" ? null : Number(v[c.key])])) as RuleRates])),
    preview,
  });
  const run = useMutation({
    mutationFn: (preview: boolean) => apiPost<RuleToolResult>("/commission/rules/copy", body(preview)),
    onSuccess: (res) => {
      setResult(res);
      if (!res.preview && !res.errors) {
        qc.invalidateQueries({ queryKey: ["commission-rules"] });
        toast.success(`${res.created} rule${res.created === 1 ? "" : "s"} copied`);
        onDone();
      } else if (res.errors) toast.error(`${res.errors} of ${res.rows.length} copies have a problem — nothing saved yet`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rowOf = (id: string) => result?.rows.find((r) => r.key === id);
  const setRate = (id: string, k: RateKey, v: string) => { setResult(null); setRates((s) => ({ ...s, [id]: { ...s[id], [k]: v } })); };
  const touch = <T,>(fn: (v: T) => void) => (v: T) => { setResult(null); fn(v); };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="copy-rules-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Copy {rules.length} rule{rules.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Pick what changes — everything else (products, RTOs, ages, GVW, fuel…) is copied as is. Edit the rates below if they differ. The original rules are not changed.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Insurance company</Label>
            <SimpleSelect value={insurer} onChange={touch(setInsurer)} placeholder="Company" testId="copy-insurer-select" className="w-full" searchable
              options={[{ value: KEEP, label: "Keep same company" }, ...(masters.data?.insurers ?? []).map((i) => ({ value: i, label: i }))]} />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs">Channel partners</Label>
            <div className="flex gap-1.5">
              {(["keep", "set"] as const).map((m) => (
                <Button key={m} type="button" size="sm" variant={partnerMode === m ? "default" : "outline"} data-testid={`copy-partner-mode-${m}`} onClick={() => { setResult(null); setPartnerMode(m); }}>
                  {m === "keep" ? "Keep same" : "Change to…"}
                </Button>
              ))}
            </div>
            {partnerMode === "set" && (
              <MultiSelect value={partners} onChange={touch(setPartners)} options={(brokers.data ?? []).map((b) => b.name)} placeholder="All channel partners" testId="copy-partners-select" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">From (blank = keep)</Label>
              <Input type="date" data-testid="copy-valid-from" value={from} onChange={(e) => { setResult(null); setFrom(e.target.value); }} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To (blank = keep)</Label>
              <Input type="date" data-testid="copy-valid-to" value={to} onChange={(e) => { setResult(null); setTo(e.target.value); }} className="text-xs" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table data-testid="copy-rules-table" className="w-full text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Rule</th>
                {RATE_COLS.map((c) => <th key={c.key} className="px-2 py-1.5 text-center">{c.label}</th>)}
                <th className="px-2 py-1.5">Check</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const row = rowOf(r.id);
                return (
                  <tr key={r.id} data-testid={`copy-row-${r.id}`} className={cn("border-t border-border/60 align-top", row?.action === "error" && "bg-red-500/5")}>
                    <td className="max-w-64 px-2 py-1.5"><div className="font-medium">{r.name}</div><div className="text-[10px] text-muted-foreground">{r.insurer ?? "All companies"}</div></td>
                    {RATE_COLS.map((c) => (
                      <td key={c.key} className="px-1 py-1">
                        <Input type="number" min={0} step="0.01" data-testid={`copy-rate-${r.id}-${c.key}`} value={rates[r.id][c.key]} onChange={(e) => setRate(r.id, c.key, e.target.value)}
                          className={cn("mx-auto h-7 w-20 text-right font-mono text-xs", rates[r.id][c.key] !== asText(r[c.key]) && "border-amber-400")} />
                      </td>
                    ))}
                    <td data-testid={`copy-check-${r.id}`} className="max-w-60 px-2 py-1.5">
                      {!row ? <span className="text-muted-foreground">—</span>
                        : row.action === "error" ? <span className="text-red-300">{row.error}</span>
                        : <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="size-3.5" /> OK</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {result && (
          <p data-testid="copy-result-summary" className={cn("text-sm", result.errors ? "text-red-300" : "text-emerald-300")}>
            {result.errors ? `${result.errors} problem${result.errors === 1 ? "" : "s"} — fix the rates / partner / dates and check again. Nothing has been saved.`
              : result.preview ? `All ${result.created} copies are valid — click Save copies.` : `${result.created} rules copied.`}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="copy-cancel-button">Cancel</Button>
          <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate(true)} data-testid="copy-check-button"><ListChecks className="size-4" /> Check</Button>
          <Button disabled={run.isPending || !result?.preview || result.errors > 0} onClick={() => run.mutate(false)} data-testid="copy-save-button"><Copy className="size-4" /> Save copies</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
