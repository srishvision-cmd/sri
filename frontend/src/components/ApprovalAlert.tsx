import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ShieldCheck, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage, money } from "@/lib/fields";
import type { CommissionStatement, StatementDecisionIn } from "@/lib/types";

/** Admin dashboard: commission statements waiting for approval, each approvable in one click (logged with the approver). */
export function ApprovalAlert() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["statements", "pending_approval"], queryFn: () => apiGet<CommissionStatement[]>("/statements?status=pending_approval") });
  const approve = useMutation({
    mutationFn: (s: CommissionStatement) => apiPost<CommissionStatement>(`/statements/${s.id}/approve`, { note: "Approved from dashboard" } satisfies StatementDecisionIn),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["statements"] });
      toast.success(`${s.number} approved — it can now be paid`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const list = q.data ?? [];
  if (!list.length) return null;
  const total = list.reduce((a, s) => a + (s.net_payable ?? 0), 0);
  return (
    <div role="status" data-testid="approval-alert" className="rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3 animate-rise">
      <div className="flex flex-wrap items-center gap-3">
        <Hourglass className="size-5 shrink-0 text-amber-400" />
        <p className="text-sm font-semibold text-amber-300" data-testid="approval-alert-title">
          <span data-testid="approval-alert-count">{list.length}</span> commission statement{list.length === 1 ? "" : "s"} waiting for approval · {money(total)} net payable
        </p>
        <Link to="/statements?status=pending_approval" className={`${buttonVariants({ size: "sm", variant: "outline" })} ml-auto`} data-testid="approval-alert-review-link">Review all</Link>
      </div>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2" data-testid="approval-alert-list">
        {list.slice(0, 6).map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs" data-testid={`approval-alert-item-${s.number}`}>
            <div className="min-w-0 flex-1">
              <b className="text-foreground">{s.number}</b> · {s.agent_name}
              <div className="truncate text-muted-foreground">{s.from_date} → {s.to_date} · {money(s.net_payable)} · by {s.created_by_name}</div>
            </div>
            <Button size="sm" className="h-7 shrink-0" disabled={approve.isPending} onClick={() => approve.mutate(s)} data-testid={`approval-alert-approve-${s.number}`}>
              <ShieldCheck className="size-3.5" /> Approve
            </Button>
          </li>
        ))}
      </ul>
      {list.length > 6 && <p className="mt-1 text-xs text-muted-foreground">+ {list.length - 6} more on the Statements page</p>}
    </div>
  );
}
