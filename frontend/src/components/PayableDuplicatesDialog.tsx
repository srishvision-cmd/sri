import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiPost } from "@/lib/api";
import { useAgentOptions } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import type { PayableDupIn, PayableDupReport } from "@/lib/types";

/** Admin: find (and, after confirming, delete) duplicate payable rules for ONE agent + ONE company. Receivables are never touched. */
export function PayableDuplicatesDialog({ companies, onClose }: { companies: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const agents = useAgentOptions();
  const [agent, setAgent] = useState("");
  const [insurer, setInsurer] = useState("");
  const [report, setReport] = useState<PayableDupReport | null>(null);
  const [confirm, setConfirm] = useState(false);
  const run = useMutation({
    mutationFn: (del: boolean) => apiPost<PayableDupReport>("/commission/payable-duplicates", { agent, insurer, delete: del } satisfies PayableDupIn),
    onSuccess: (r) => {
      setReport(r);
      setConfirm(false);
      if (r.deleted) {
        for (const k of ["commission-rules", "commission-compare", "agent-payables", "missing-payables"]) qc.invalidateQueries({ queryKey: [k] });
        toast.success(`${r.deleted} duplicate rule${r.deleted === 1 ? "" : "s"} deleted — ${r.unique_rules} unique rules remain`);
        run.mutate(false); // refresh the report from the database
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pick = (f: () => void) => { setReport(null); setConfirm(false); f(); };

  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent data-testid="payable-dups-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-heading">Find duplicate payable rules</DialogTitle>
          <DialogDescription>
            Checks one agent's payable rules for one company in the database. Rules with the same conditions, products and dates count as duplicates; the most recently saved one is kept. Receivable rules and other agents are never touched.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Agent</Label>
            <SimpleSelect value={agent} onChange={(v) => pick(() => setAgent(v))} placeholder="Select agent" testId="payable-dups-agent" className="w-72" searchable
              options={(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.username.toUpperCase()} · ${a.full_name}` }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Insurance company</Label>
            <SimpleSelect value={insurer} onChange={(v) => pick(() => setInsurer(v))} placeholder="Select company" testId="payable-dups-insurer" className="w-64" searchable
              options={companies.map((c) => ({ value: c, label: c }))} />
          </div>
          <Button variant="outline" disabled={!agent || !insurer || run.isPending} onClick={() => run.mutate(false)} data-testid="payable-dups-find">
            <SearchCheck className="size-4" /> Find duplicates
          </Button>
        </div>

        {report && (
          <div className="space-y-3">
            <p data-testid="payable-dups-summary" className="text-sm">
              <b>{report.agent_label}</b> · {report.insurer}: <b data-testid="payable-dups-total">{report.total}</b> payable rule documents,{" "}
              <b data-testid="payable-dups-unique">{report.unique_rules}</b> unique —{" "}
              {report.to_delete ? <span className="font-semibold text-red-600">{report.to_delete} duplicate{report.to_delete === 1 ? "" : "s"}</span> : <span className="text-emerald-700">no duplicates</span>}
            </p>
            {report.groups.map((g, gi) => (
              <div key={g.rules[0].id} data-testid={`payable-dups-group-${gi}`} className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-left text-muted-foreground">
                    <tr><th className="px-2 py-1.5">Rule</th><th className="px-2 py-1.5">Products</th><th className="px-2 py-1.5">Dates</th><th className="px-2 py-1.5">Rate</th><th className="px-2 py-1.5">Saved</th><th className="px-2 py-1.5">Action</th></tr>
                  </thead>
                  <tbody>
                    {g.rules.map((r) => (
                      <tr key={r.id} data-testid={`payable-dups-rule-${r.id}`} className="border-t border-border/60">
                        <td className="px-2 py-1.5"><div className="font-medium">{r.name}</div><div className="font-mono text-[10px] text-muted-foreground">{r.id}</div></td>
                        <td className="px-2 py-1.5">{r.products.join(", ") || "All"}</td>
                        <td className="px-2 py-1.5">{r.valid_from ?? "—"} → {r.valid_to ?? "open"}</td>
                        <td className="px-2 py-1.5 font-mono">{r.rate ?? "—"}</td>
                        <td className="px-2 py-1.5">{r.updated_at?.replace("T", " ") ?? "—"}</td>
                        <td className={r.keep ? "px-2 py-1.5 text-emerald-700" : "px-2 py-1.5 font-semibold text-red-600"}>{r.keep ? "Keep" : "Delete"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {confirm && (
              <p data-testid="payable-dups-confirm-text" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                Delete {report.to_delete} duplicate payable rule{report.to_delete === 1 ? "" : "s"} of {report.agent_label} for {report.insurer}? The kept rules stay exactly as they are. This cannot be undone.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="payable-dups-close">Close</Button>
          {report && report.to_delete > 0 && (confirm ? (
            <Button className="bg-red-600 hover:bg-red-700" disabled={run.isPending} onClick={() => run.mutate(true)} data-testid="payable-dups-delete-confirm">
              <Trash2 className="size-4" /> Yes, delete {report.to_delete}
            </Button>
          ) : (
            <Button variant="outline" className="border-red-300 text-red-700" onClick={() => setConfirm(true)} data-testid="payable-dups-delete">
              <Trash2 className="size-4" /> Delete {report.to_delete} duplicate{report.to_delete === 1 ? "" : "s"}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
