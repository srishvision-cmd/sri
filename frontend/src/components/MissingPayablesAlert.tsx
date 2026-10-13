import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertOctagon, X } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { MissingPayables } from "@/lib/types";

/** Admin dashboard: agents with no payable on receivable rules uploaded since the last dismiss (clears itself once rates exist). */
export function MissingPayablesAlert() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["missing-payables"], queryFn: () => apiGet<MissingPayables>("/commission/missing-payables") });
  const dismiss = useMutation({
    mutationFn: () => apiPost<MissingPayables>("/commission/missing-payables/dismiss", {}),
    onSuccess: (d) => {
      qc.setQueryData(["missing-payables"], d);
      toast.success("Alert dismissed — it returns with the next receivable upload");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const d = q.data;
  if (!d || d.agents.length === 0) return null;
  const shown = d.agents.slice(0, 8);
  return (
    <div role="alert" data-testid="missing-payables-alert" className="relative rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 animate-rise">
      <div className="flex flex-wrap items-start gap-3">
        <AlertOctagon className="mt-0.5 size-5 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-300" data-testid="missing-payables-title">
            {d.agents.length} agent{d.agents.length === 1 ? "" : "s"} have no payable rate on {d.rule_count} newly uploaded receivable rule{d.rule_count === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground">These agents would be paid ₹0 on matching policies. The alert clears by itself once their payables are set.</p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2" data-testid="missing-payables-list">
            {shown.map((a) => (
              <li key={a.agent_id} data-testid={`missing-payables-agent-${a.agent_id}`} className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <b className="truncate text-foreground">{a.agent_label}</b>
                  <span className="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-red-300">{a.missing_count} missing</span>
                </div>
                <div className="truncate text-muted-foreground" title={a.receivables.join(", ")}>{a.receivables.join(", ")}</div>
              </li>
            ))}
          </ul>
          {d.agents.length > shown.length && <p className="mt-1 text-xs text-muted-foreground">+ {d.agents.length - shown.length} more agents</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to="/commission?tab=agent-payables" data-testid="missing-payables-fix-link" className={buttonVariants({ size: "sm" })}>Set payables</Link>
            <Button size="sm" variant="outline" onClick={() => dismiss.mutate()} disabled={dismiss.isPending} data-testid="missing-payables-dismiss-button">
              <X className="size-3.5" /> Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
