import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiPost } from "@/lib/api";
import { errorMessage, money } from "@/lib/fields";
import type { RecalcApplyIn, RecalcPreview, RecalcPreviewIn, RecalcResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Admin-only: preview existing vs revised commission for the selected policies, then recalculate with a mandatory reason. */
export function RecalcDialog({ policyIds, onClose, onDone }: { policyIds: string[]; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const preview = useQuery({
    queryKey: ["recalc-preview", policyIds],
    queryFn: () => apiPost<RecalcPreview>("/commission/recalculate/preview", { policy_ids: policyIds } satisfies RecalcPreviewIn),
    gcTime: 0,
  });
  const apply = useMutation({
    mutationFn: () => apiPost<RecalcResult>("/commission/recalculate", { policy_ids: policyIds, reason: reason.trim() } satisfies RecalcApplyIn),
    onSuccess: (r) => {
      toast.success(`Commission recalculated on ${r.updated} polic${r.updated === 1 ? "y" : "ies"}${r.blocked ? ` · ${r.blocked} skipped (settled)` : ""}`);
      qc.invalidateQueries({ queryKey: ["commission"] });
      qc.invalidateQueries({ queryKey: ["policies"] });
      qc.invalidateQueries({ queryKey: ["policy"] });
      qc.invalidateQueries({ queryKey: ["recalc-log"] });
      onDone?.();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const p = preview.data;
  const tooShort = reason.trim().length < 5;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="recalc-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-amber-400" /> Recalculate commission</DialogTitle>
          <DialogDescription>
            Saved commission is a permanent snapshot. Recalculating replaces it with today's grid for ONLY these policies. Policies on a commission
            statement or with a confirmed on-spot deduction are skipped.
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading && <p className="text-sm text-muted-foreground" data-testid="recalc-loading">Working out revised amounts…</p>}
        {preview.isError && <p className="text-sm text-red-300" data-testid="recalc-error">{errorMessage(preview.error)}</p>}
        {p && (
          <>
            <div className="flex flex-wrap gap-2 text-xs" data-testid="recalc-summary">
              <span className="rounded bg-muted px-2 py-1">{p.rows.length} selected</span>
              <span className="rounded bg-sky-500/10 px-2 py-1 text-sky-300">{p.eligible} can be recalculated</span>
              <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300" data-testid="recalc-changed-count">{p.changed} will change</span>
              {p.blocked > 0 && <span className="rounded bg-red-500/10 px-2 py-1 text-red-300">{p.blocked} settled · skipped</span>}
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs" data-testid="recalc-table">
                <thead className="bg-muted text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">Policy</th>
                    <th className="px-2 py-1.5">Partner</th>
                    <th className="px-2 py-1.5 text-right">Receivable (existing → revised)</th>
                    <th className="px-2 py-1.5 text-right">Payable (existing → revised)</th>
                    <th className="px-2 py-1.5 text-right">Margin (existing → revised)</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.policy_id} data-testid={`recalc-row-${r.policy_id}`} className={cn("border-t border-border", r.blocked ? "opacity-60" : r.changed && "bg-amber-500/5")}>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{r.policy_number ?? "—"}</div>
                        <div className="text-muted-foreground">{r.customer_name ?? ""}</div>
                        {r.blocked && <div className="text-red-300" data-testid={`recalc-blocked-${r.policy_id}`}>{r.blocked}</div>}
                      </td>
                      <td className="px-2 py-1.5">{r.agent_name ?? "—"}</td>
                      {(["receivable", "payable", "margin"] as const).map((k) => (
                        <td key={k} className="px-2 py-1.5 text-right font-mono tabular" data-testid={`recalc-${k}-${r.policy_id}`}>
                          {money(r.before[k])} <span className="text-muted-foreground">→</span>{" "}
                          <span className={cn(r.before[k] !== r.after[k] && "font-semibold text-amber-300")}>{money(r.after[k])}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Reason for recalculation <span className="text-red-300">*</span></span>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Insurer revised the grid for October with retrospective effect"
                data-testid="recalc-reason-input" />
              <span className="text-[11px] text-muted-foreground">Recorded with your user ID, date & time, previous and revised values.</span>
            </label>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="recalc-cancel-button">Cancel</Button>
          <Button onClick={() => apply.mutate()} disabled={!p || p.eligible === 0 || tooShort || apply.isPending} data-testid="recalc-confirm-button">
            <RefreshCw className={cn("size-4", apply.isPending && "animate-spin")} /> Confirm & recalculate {p ? p.eligible : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
