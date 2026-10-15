import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { RATE_COLS, asText } from "@/components/CopyRulesDialog";
import { PercentChangeBar, scaleRates } from "@/components/PercentChangeBar";
import { apiPost } from "@/lib/api";
import { useAgentOptions, useBrokers } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { CommissionRule, RateKey, RuleCopyIn, RuleKind, RuleRates, RuleToolResult } from "@/lib/types";

type Conflict = "keep" | "overwrite";

/** Copy one company group to ONE channel partner (receivable) or ONE agent (payable). Sources are never changed. */
export function CopyGroupDialog({ kind, company, rules, onClose }: { kind: RuleKind; company: string; rules: CommissionRule[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isPay = kind === "payable";
  const brokers = useBrokers();
  const agents = useAgentOptions(isPay);
  const [target, setTarget] = useState("");
  const [onConflict, setOnConflict] = useState<Conflict>("keep");
  const [orig] = useState<Record<string, Record<RateKey, string>>>(() =>
    Object.fromEntries(rules.map((r) => [r.id, Object.fromEntries(RATE_COLS.map((c) => [c.key, asText(r[c.key])])) as Record<RateKey, string>])));
  const [rates, setRates] = useState(orig);
  const [result, setResult] = useState<RuleToolResult | null>(null);

  const targets = isPay
    ? (agents.data ?? []).map((a) => ({ value: a.id, label: `${a.full_name} · ${a.username.toUpperCase()}${a.branch ? ` · ${a.branch}` : ""}` }))
    : (brokers.data ?? []).filter((b) => b.active).map((b) => ({ value: b.id, label: b.name }));
  const targetName = targets.find((t) => t.value === target)?.label ?? "";

  const body = (preview: boolean): RuleCopyIn => ({
    rule_ids: rules.map((r) => r.id),
    insurer: null,
    broker_ids: isPay ? null : [target],
    agent_id: isPay ? target : null,
    valid_from: null,
    valid_to: null,
    rates: Object.fromEntries(Object.entries(rates).map(([id, v]) => [id, Object.fromEntries(RATE_COLS.map((c) => [c.key, v[c.key] === "" ? null : Number(v[c.key])])) as RuleRates])),
    on_conflict: onConflict,
    preview,
  });
  const run = useMutation({
    mutationFn: (preview: boolean) => apiPost<RuleToolResult>("/commission/rules/copy", body(preview)),
    onSuccess: (res) => {
      setResult(res);
      if (res.errors) return void toast.error(`${res.errors} of ${res.rows.length} copies have a problem — nothing saved`);
      if (res.preview) return;
      for (const k of ["commission-rules", "commission-compare", "agent-payables", "missing-payables"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(`${res.created} rule${res.created === 1 ? "" : "s"} copied to ${targetName}${res.unchanged ? ` · ${res.unchanged} kept as is` : ""}`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rowOf = (id: string) => result?.rows.find((r) => r.key === id);
  const reset = () => setResult(null);
  const clashes = (result?.rows ?? []).filter((r) => r.conflicts.length > 0);
  const existing = [...new Set(clashes.flatMap((r) => r.conflicts))];
  const canSave = !!result?.preview && result.errors === 0 && result.created > 0 && !run.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent data-testid="copy-group-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-heading">Copy {company} {kind} rules to another {isPay ? "agent" : "channel partner"}</DialogTitle>
          <DialogDescription>
            Creates a new, independent set of {rules.length} {kind} rule{rules.length === 1 ? "" : "s"} for the selected {isPay ? "agent" : "channel partner"} only. The original rules are never changed, and the {isPay ? "receivable" : "payable"} grid is not touched. Edit any rate below before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="max-w-md space-y-1">
          <Label className="text-xs">Copy to {isPay ? "agent" : "channel partner"}</Label>
          <SimpleSelect value={target} onChange={(v) => { reset(); setTarget(v); }} placeholder={isPay ? "Select agent" : "Select channel partner"} testId="copy-group-target" className="w-full" searchable options={targets} />
        </div>

        <PercentChangeBar testPrefix="copy-group" onApply={(p) => { reset(); setRates(scaleRates(orig, p)); }} onReset={() => { reset(); setRates(orig); }} />
        <div className="overflow-x-auto rounded-lg border border-border">
          <table data-testid="copy-group-table" className="w-full text-xs">
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
                let check = <span className="text-muted-foreground">—</span>;
                if (row?.action === "error") check = <span className="text-red-700">{row.error}</span>;
                else if (row?.action === "unchanged") check = <span className="text-amber-700">{row.error ?? "Skipped — target keeps its existing rule"}</span>;
                else if (row) check = <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-3.5" /> {row.conflicts.length ? "Will replace target's rule" : "New copy"}</span>;
                return (
                  <tr key={r.id} data-testid={`copy-group-row-${r.id}`} className={cn("border-t border-border/60 align-top", row?.action === "error" && "bg-red-500/5")}>
                    <td className="max-w-64 px-2 py-1.5 font-medium">{r.name}</td>
                    {RATE_COLS.map((c) => (
                      <td key={c.key} className="px-1 py-1">
                        <Input type="number" min={0} step="0.01" data-testid={`copy-group-rate-${r.id}-${c.key}`} value={rates[r.id][c.key]}
                          onChange={(e) => { reset(); setRates((s) => ({ ...s, [r.id]: { ...s[r.id], [c.key]: e.target.value } })); }}
                          className={cn("mx-auto h-7 w-20 text-right font-mono text-xs", rates[r.id][c.key] !== asText(r[c.key]) && "border-amber-400")} />
                      </td>
                    ))}
                    <td data-testid={`copy-group-check-${r.id}`} className="max-w-60 px-2 py-1.5">{check}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {existing.length > 0 && (
          <div data-testid="copy-group-conflict" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-start gap-2 font-medium">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {targetName} already has {existing.length} {kind} rule{existing.length === 1 ? "" : "s"} for {company} on the same products:
            </p>
            <ul className="ml-6 list-disc text-xs" data-testid="copy-group-conflict-list">{existing.map((n) => <li key={n}>{n}</li>)}</ul>
            <div className="flex flex-wrap gap-2 pt-1">
              {(["keep", "overwrite"] as const).map((m) => (
                <Button key={m} type="button" size="sm" variant={onConflict === m ? "default" : "outline"} data-testid={`copy-group-conflict-${m}`}
                  className={cn(m === "overwrite" && onConflict === m && "bg-red-600 hover:bg-red-700")}
                  onClick={() => { setOnConflict(m); reset(); run.mutate(true); }}>
                  {m === "keep" ? "Keep existing rules (skip those copies)" : "Overwrite — stop the existing rules and use the copies"}
                </Button>
              ))}
            </div>
          </div>
        )}

        {result && (
          <p data-testid="copy-group-summary" className={cn("text-sm", result.errors ? "text-red-700" : "text-emerald-700")}>
            {result.errors ? `${result.errors} problem${result.errors === 1 ? "" : "s"} — fix them and check again. Nothing has been saved.`
              : `${result.created} new cop${result.created === 1 ? "y" : "ies"}${result.unchanged ? `, ${result.unchanged} skipped (kept existing)` : ""} — ready to save.`}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="copy-group-cancel">Cancel</Button>
          <Button variant="outline" disabled={!target || run.isPending} onClick={() => run.mutate(true)} data-testid="copy-group-check"><ListChecks className="size-4" /> Check</Button>
          <Button disabled={!canSave} onClick={() => run.mutate(false)} data-testid="copy-group-save"
            className={cn(onConflict === "overwrite" && clashes.length > 0 && "bg-red-600 hover:bg-red-700")}>
            <Copy className="size-4" /> {onConflict === "overwrite" && clashes.length > 0 ? "Overwrite & save" : "Save copies"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
