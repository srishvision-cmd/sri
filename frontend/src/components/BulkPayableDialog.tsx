import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiPost } from "@/lib/api";
import { useAgentGroups } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import type { BulkPayableIn, BulkPayableResult, CompareRates } from "@/lib/types";
import { cn } from "@/lib/utils";

const KEYS: [keyof CompareRates, string][] = [["od_percent", "OD"], ["tp_percent", "TP"], ["net_percent", "Net"], ["odtp_percent", "OD+TP"], ["flat_amount", "Flat ₹"]];
const txt = (r: CompareRates) => KEYS.filter(([k]) => r[k] != null).map(([k, l]) => `${l} ${+(r[k] as number).toFixed(2)}${k === "flat_amount" ? "" : "%"}`).join(", ") || "—";
const STATUS: Record<string, string> = { ready: "bg-sky-500/15 text-sky-300", created: "bg-emerald-500/15 text-emerald-300", skipped: "bg-amber-500/15 text-amber-300", error: "bg-red-500/15 text-red-300" };

/** One agent group's payable on every receivable that has no payable yet: receivable % − margin points. Preview first, then create. */
export function BulkPayableDialog({ insurer, missing, onClose }: { insurer: string; missing: number; onClose: () => void }) {
  const qc = useQueryClient();
  const groups = useAgentGroups();
  const [group, setGroup] = useState("");
  const [margin, setMargin] = useState("2");
  const [result, setResult] = useState<BulkPayableResult | null>(null);
  const m = Number(margin);
  const valid = !!group && margin.trim() !== "" && m >= 0 && m <= 100;
  const run = useMutation({
    mutationFn: (preview: boolean) =>
      apiPost<BulkPayableResult>("/commission/compare/bulk-payable", { agent_group: group, margin: m, insurer: insurer || null, rule_ids: preview ? null : (result?.rows.filter((r) => r.status === "ready").map((r) => r.rule_id) ?? null), preview } satisfies BulkPayableIn),
    onSuccess: (res) => {
      setResult(res);
      if (!res.preview) {
        ["commission-rules", "commission-compare", "policies", "my-rates"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        toast.success(`${res.created} payable rule${res.created === 1 ? "" : "s"} created for Group ${group}`);
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const ready = result?.rows.filter((r) => r.status === "ready").length ?? 0;
  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent className="sm:max-w-3xl" data-testid="bulk-payable-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Bulk set payable</DialogTitle>
          <DialogDescription>
            Creates a payable for one partner group on every receivable {insurer ? `of ${insurer} ` : ""}that has no payable yet ({missing}). Payable % = receivable % minus your margin. Same conditions and dates as the receivable.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Partner group</Label>
            <SimpleSelect value={group} onChange={(v) => { setGroup(v); setResult(null); }} placeholder="Pick group" testId="bulk-payable-group-select" className="min-w-44"
              options={(groups.data ?? []).map((g) => ({ value: g.name, label: `Group ${g.name}` }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Your margin (percentage points)</Label>
            <Input data-testid="bulk-payable-margin-input" type="number" step="0.25" min={0} value={margin} onChange={(e) => { setMargin(e.target.value); setResult(null); }} className="w-36" />
          </div>
          <Button variant="secondary" disabled={!valid || run.isPending} onClick={() => run.mutate(true)} data-testid="bulk-payable-preview-button">
            {run.isPending && !result ? "Checking…" : "Preview"}
          </Button>
        </div>
        {groups.isSuccess && !groups.data.length && <p className="text-xs text-amber-300">No partner groups yet — create one in the Partner groups tab.</p>}
        {result && (
          <div className="max-h-[45vh] overflow-auto rounded-lg border border-border" data-testid="bulk-payable-rows">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                <tr><th className="px-2 py-1.5">Receivable</th><th className="px-2 py-1.5">Receives</th><th className="px-2 py-1.5">Group {group} gets</th><th className="px-2 py-1.5">Status</th></tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.rule_id} className="border-t border-border/60 align-top" data-testid={`bulk-payable-row-${r.rule_id}`}>
                    <td className="px-2 py-1.5"><div className="font-medium">{r.product}</div><div className="text-[11px] text-muted-foreground">{[r.insurer, r.receivable_name].filter(Boolean).join(" · ")}</div></td>
                    <td className="px-2 py-1.5 font-mono">{txt(r.receivable)}</td>
                    <td className="px-2 py-1.5 font-mono">{r.status === "skipped" ? "—" : txt(r.payable)}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] capitalize", STATUS[r.status])}>{r.status === "ready" ? "Will create" : r.status}</span>
                      {r.note && <div className="mt-0.5 text-[11px] text-muted-foreground">{r.note}</div>}
                    </td>
                  </tr>
                ))}
                {result.rows.length === 0 && <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">Every receivable already has a payable.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending} data-testid="bulk-payable-close">{result && !result.preview ? "Done" : "Cancel"}</Button>
          {result?.preview && (
            <Button disabled={!ready || run.isPending} onClick={() => run.mutate(false)} data-testid="bulk-payable-confirm">
              {run.isPending ? "Creating…" : `Create ${ready} payable${ready === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
