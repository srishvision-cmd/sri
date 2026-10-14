import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { CommissionRule, ReopenRulesIn, RuleToolResult } from "@/lib/types";

/** Company header button: clear the past To date of every ended rule of this company (preview first, then confirm). */
export function ReopenEnded({ rules, company, testKey }: { rules: CommissionRule[]; company: string; testKey: string }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<RuleToolResult | null>(null);
  const run = useMutation({
    mutationFn: (preview: boolean) => apiPost<RuleToolResult>("/commission/rules/reopen-ended", { rule_ids: rules.map((r) => r.id), preview } satisfies ReopenRulesIn),
    onSuccess: (res) => {
      if (res.preview) return setResult(res);
      for (const k of ["commission-rules", "commission-compare", "agent-payables", "missing-payables"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(`${res.updated} rule${res.updated === 1 ? "" : "s"} reopened for ${company}`);
      setResult(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!rules.length) return null;
  return (
    <>
      <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" disabled={run.isPending}
        data-testid={`rule-company-reopen-${testKey}`} onClick={() => run.mutate(true)}>
        <RotateCcw className="size-3.5" /> Reopen {rules.length} ended
      </Button>
      <Dialog open={!!result} onOpenChange={(o) => !o && !run.isPending && setResult(null)}>
        <DialogContent data-testid="reopen-dialog" className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading">Reopen ended {company} rules</DialogTitle>
            <DialogDescription>
              Clears the To date so each rule applies again from its From date, and shows in Agent-wise payables, Rate matrix and Compare & margin. Rates are not changed.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <tbody>
                {result?.rows.map((r) => (
                  <tr key={r.key} className="border-t border-border/60 first:border-0" data-testid={`reopen-row-${r.key}`}>
                    <td className="px-2 py-1.5 font-medium">{r.name}</td>
                    <td className={cn("px-2 py-1.5", r.action === "error" ? "text-red-700" : "text-emerald-700")}>
                      {r.action === "error" ? r.error : r.action === "update" ? "Will reopen" : "Already current"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!result?.errors && <p className="text-xs text-red-700" data-testid="reopen-errors">{result.errors} rule{result.errors === 1 ? "" : "s"} can't be reopened — fix or edit them one by one.</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResult(null)} data-testid="reopen-cancel">Cancel</Button>
            <Button disabled={!result || result.errors > 0 || !result.updated || run.isPending} onClick={() => run.mutate(false)} data-testid="reopen-confirm">
              Reopen {result?.updated ?? 0} rule{result?.updated === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
