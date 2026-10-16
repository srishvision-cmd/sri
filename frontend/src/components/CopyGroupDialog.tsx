import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { MultiSelect } from "@/components/MultiSelect";
import { RATE_COLS, asText } from "@/components/CopyRulesDialog";
import { PercentChangeBar, scaleRates } from "@/components/PercentChangeBar";
import { apiPost } from "@/lib/api";
import { useAgentOptions, useBrokers } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { CommissionRule, RateKey, RuleCopyIn, RuleKind, RuleRates, RuleToolResult } from "@/lib/types";

type Conflict = "keep" | "overwrite";
type Results = Record<string, RuleToolResult>; // target id → result

// Display only: the same rule (same id, or identical saved content) is listed once — nothing saved is deleted.
const IGNORE = new Set(["id", "created_at", "updated_at", "version_of", "superseded_by"]);
const sigOf = (r: CommissionRule) => JSON.stringify(Object.entries(r).filter(([k]) => !IGNORE.has(k)).sort(([a], [b]) => a.localeCompare(b)));
export function uniqueRules(rules: CommissionRule[]): CommissionRule[] {
  const best = new Map<string, CommissionRule>();
  for (const r of rules) {
    const k = sigOf(r);
    const prev = best.get(k);
    if (!prev || (prev.id !== r.id && (r.updated_at ?? "") > (prev.updated_at ?? ""))) best.set(k, r);
  }
  const keep = new Set([...best.values()].map((r) => r.id));
  const seen = new Set<string>();
  return rules.filter((r) => keep.has(r.id) && !seen.has(r.id) && seen.add(r.id));
}

/** Copy one company group to channel partner (receivable) or to any number of agents (payable) — each target gets its own copy; sources never change. */
export function CopyGroupDialog({ kind, company, rules: allRules, onClose }: { kind: RuleKind; company: string; rules: CommissionRule[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isPay = kind === "payable";
  const rules = useMemo(() => uniqueRules(allRules), [allRules]);
  const brokers = useBrokers();
  const agents = useAgentOptions(isPay);
  const [partner, setPartner] = useState("");
  const [agentLabels, setAgentLabels] = useState<string[]>([]);
  const [onConflict, setOnConflict] = useState<Conflict>("keep");
  const [orig] = useState<Record<string, Record<RateKey, string>>>(() =>
    Object.fromEntries(rules.map((r) => [r.id, Object.fromEntries(RATE_COLS.map((c) => [c.key, asText(r[c.key])])) as Record<RateKey, string>])));
  const [rates, setRates] = useState(orig);
  const [results, setResults] = useState<Results | null>(null);

  const targets = isPay
    ? (agents.data ?? []).map((a) => ({ value: a.id, label: `${a.full_name} · ${a.username.toUpperCase()}${a.branch ? ` · ${a.branch}` : ""}` }))
    : (brokers.data ?? []).filter((b) => b.active).map((b) => ({ value: b.id, label: b.name }));
  const groups = [...new Set((agents.data ?? []).map((a) => a.agent_group).filter((g): g is string => !!g))].sort();
  const addGroup = (g: string) => {
    reset();
    const labels = (agents.data ?? []).filter((a) => a.agent_group === g).map((a) => targets.find((t) => t.value === a.id)?.label).filter((l): l is string => !!l);
    setAgentLabels((cur) => [...new Set([...cur, ...labels])]);
    toast.success(`Group ${g}: ${labels.length} agent${labels.length === 1 ? "" : "s"} added`);
  };
  const nameOf = (id: string) => targets.find((t) => t.value === id)?.label ?? id;
  const picked = isPay ? agentLabels.map((l) => targets.find((t) => t.label === l)?.value).filter((v): v is string => !!v) : partner ? [partner] : [];

  const body = (target: string, preview: boolean, mode: Conflict): RuleCopyIn => ({
    rule_ids: rules.map((r) => r.id),
    insurer: null,
    broker_ids: isPay ? null : [target],
    agent_id: isPay ? target : null,
    valid_from: null,
    valid_to: null,
    rates: Object.fromEntries(Object.entries(rates).map(([id, v]) => [id, Object.fromEntries(RATE_COLS.map((c) => [c.key, v[c.key] === "" ? null : Number(v[c.key])])) as RuleRates])),
    on_conflict: mode,
    preview,
  });
  const run = useMutation({
    mutationFn: async ({ preview, mode }: { preview: boolean; mode: Conflict }) => {
      const out: Results = {};
      for (const t of picked) out[t] = await apiPost<RuleToolResult>("/commission/rules/copy", body(t, preview, mode)); // one independent copy per target
      return { out, preview };
    },
    onSuccess: ({ out, preview }) => {
      setResults(out);
      const all = Object.values(out);
      const errs = all.reduce((n, r) => n + r.errors, 0);
      if (errs) return void toast.error(`${errs} cop${errs === 1 ? "y has" : "ies have"} a problem — fix and check again`);
      if (preview) return;
      for (const k of ["commission-rules", "commission-compare", "agent-payables", "missing-payables"]) qc.invalidateQueries({ queryKey: [k] });
      const created = all.reduce((n, r) => n + r.created, 0);
      const kept = all.reduce((n, r) => n + r.unchanged, 0);
      toast.success(`${created} rule${created === 1 ? "" : "s"} copied to ${picked.length} ${isPay ? "agent" : "channel partner"}${picked.length === 1 ? "" : "s"}${kept ? ` · ${kept} kept as is` : ""}`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const check = (mode: Conflict = onConflict) => run.mutate({ preview: true, mode });
  const reset = () => setResults(null);
  const all = results ? Object.entries(results) : [];
  const clashing = all.map(([t, r]) => ({ t, names: [...new Set(r.rows.flatMap((x) => x.conflicts))] })).filter((c) => c.names.length > 0);
  const errors = all.reduce((n, [, r]) => n + r.errors, 0);
  const created = all.reduce((n, [, r]) => n + r.created, 0);
  const skipped = all.reduce((n, [, r]) => n + r.unchanged, 0);
  const canSave = all.length > 0 && all.every(([, r]) => r.preview) && errors === 0 && created > 0 && !run.isPending;

  const checkCell = (id: string) => {
    if (!results) return <span className="text-muted-foreground">—</span>;
    const rows = all.map(([t, r]) => ({ t, row: r.rows.find((x) => x.key === id) })).filter((x) => x.row);
    const err = rows.find((x) => x.row?.action === "error");
    if (err) return <span className="text-red-700">{picked.length > 1 ? `${nameOf(err.t)}: ` : ""}{err.row?.error}</span>;
    const skip = rows.filter((x) => x.row?.action === "unchanged");
    const copy = rows.length - skip.length;
    const replace = rows.filter((x) => x.row?.action !== "unchanged" && x.row?.conflicts.length).length;
    return (
      <span className="space-y-0.5">
        {copy > 0 && <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-3.5" /> {replace ? `Will replace for ${replace}` : "New copy"}{picked.length > 1 ? ` · ${copy} of ${picked.length}` : ""}</span>}
        {skip.length > 0 && <span className="block text-amber-700">{picked.length > 1 ? `Skipped for ${skip.length} — kept existing` : skip[0].row?.error ?? "Skipped — target keeps its existing rule"}</span>}
      </span>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent data-testid="copy-group-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-heading">Copy {company} {kind} rules to {isPay ? "agents" : "another channel partner"}</DialogTitle>
          <DialogDescription>
            Creates a new, independent set of {rules.length} {kind} rule{rules.length === 1 ? "" : "s"} for {isPay ? "each selected agent" : "the selected channel partner"}. The original rules are never changed, and the {isPay ? "receivable" : "payable"} grid is not touched. Edit any rate below before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-w-3xl flex-wrap items-end gap-3">
        <div className="min-w-72 flex-1 space-y-1">
          <Label className="text-xs">Copy to {isPay ? "agents (pick any number)" : "channel partner"}</Label>
          {isPay ? (
            <MultiSelect value={agentLabels} onChange={(v) => { reset(); setAgentLabels(v); }} options={targets.map((t) => t.label)} placeholder="Select agents" testId="copy-group-target" />
          ) : (
            <SimpleSelect value={partner} onChange={(v) => { reset(); setPartner(v); }} placeholder="Select channel partner" testId="copy-group-target" className="w-full" searchable options={targets} />
          )}
        </div>
        {isPay && (
          <div className="space-y-1">
            <Label className="text-xs">Add a whole agent group</Label>
            <SimpleSelect value="" onChange={addGroup} placeholder={groups.length ? "Pick group" : "No groups set"} testId="copy-group-agent-group" className="w-44"
              options={groups.map((g) => ({ value: g, label: `Group ${g} · ${(agents.data ?? []).filter((a) => a.agent_group === g).length} agents` }))} />
          </div>
        )}
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
              {rules.map((r) => (
                <tr key={r.id} data-testid={`copy-group-row-${r.id}`} className="border-t border-border/60 align-top">
                  <td className="max-w-64 px-2 py-1.5 font-medium">{r.name}</td>
                  {RATE_COLS.map((c) => (
                    <td key={c.key} className="px-1 py-1">
                      <Input type="number" min={0} step="0.01" data-testid={`copy-group-rate-${r.id}-${c.key}`} value={rates[r.id][c.key]}
                        onChange={(e) => { reset(); setRates((s) => ({ ...s, [r.id]: { ...s[r.id], [c.key]: e.target.value } })); }}
                        className={cn("mx-auto h-7 w-20 text-right font-mono text-xs", rates[r.id][c.key] !== asText(r[c.key]) && "border-amber-400")} />
                    </td>
                  ))}
                  <td data-testid={`copy-group-check-${r.id}`} className="max-w-60 px-2 py-1.5">{checkCell(r.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {clashing.length > 0 && (
          <div data-testid="copy-group-conflict" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-start gap-2 font-medium">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {clashing.length} {isPay ? "agent" : "channel partner"}{clashing.length === 1 ? " already has" : "s already have"} {kind} rules for {company} on the same products:
            </p>
            <ul className="ml-6 list-disc text-xs" data-testid="copy-group-conflict-list">
              {clashing.map((c) => <li key={c.t} data-testid={`copy-group-conflict-target-${c.t}`}><b>{nameOf(c.t)}</b> — {c.names.join(", ")}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              {(["keep", "overwrite"] as const).map((m) => (
                <Button key={m} type="button" size="sm" variant={onConflict === m ? "default" : "outline"} data-testid={`copy-group-conflict-${m}`}
                  className={cn(m === "overwrite" && onConflict === m && "bg-red-600 hover:bg-red-700")}
                  onClick={() => { setOnConflict(m); reset(); check(m); }}>
                  {m === "keep" ? "Keep existing rules (skip those copies)" : "Overwrite — stop the existing rules and use the copies"}
                </Button>
              ))}
            </div>
          </div>
        )}

        {results && (
          <p data-testid="copy-group-summary" className={cn("text-sm", errors ? "text-red-700" : "text-emerald-700")}>
            {errors ? `${errors} problem${errors === 1 ? "" : "s"} — fix them and check again. Nothing has been saved.`
              : `${created} new cop${created === 1 ? "y" : "ies"} for ${picked.length} ${isPay ? "agent" : "channel partner"}${picked.length === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped (kept existing)` : ""} — ready to save.`}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="copy-group-cancel">Cancel</Button>
          <Button variant="outline" disabled={!picked.length || run.isPending} onClick={() => check()} data-testid="copy-group-check"><ListChecks className="size-4" /> Check</Button>
          <Button disabled={!canSave} onClick={() => run.mutate({ preview: false, mode: onConflict })} data-testid="copy-group-save"
            className={cn(onConflict === "overwrite" && clashing.length > 0 && "bg-red-600 hover:bg-red-700")}>
            <Copy className="size-4" /> {onConflict === "overwrite" && clashing.length > 0 ? "Overwrite & save" : "Save copies"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
