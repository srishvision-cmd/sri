import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage, money } from "@/lib/fields";
import { invalidatePayments } from "@/components/PartnerPayments";
import type { Policy, UploadPaymentAction, User } from "@/lib/types";

/** Payment typed at upload: waiting for the premium, or above the premium → admin must approve (excess goes to the partner's oldest outstanding). */
export function UploadPaymentApproval({ policy, me, onUpdated }: { policy: Policy; me: User; onUpdated: (p: Policy) => void }) {
  const qc = useQueryClient();
  const up = policy.upload_payment;
  const [fix, setFix] = useState("");
  const needs = up?.status === "needs_approval";
  const others = useQuery({
    queryKey: ["policies", `outstanding-${policy.agent_id}`],
    queryFn: () => apiGet<Policy[]>(`/policies?agent_id=${policy.agent_id}&outstanding_only=true`),
    enabled: needs && me.role === "admin",
  });
  const act = useMutation({
    mutationFn: (body: UploadPaymentAction) => apiPost<Policy>(`/policies/${policy.id}/upload-payment`, body),
    onSuccess: (p, b) => { invalidatePayments(qc, policy.agent_id); toast.success(b.action === "approve" ? "Payment approved and applied" : b.action === "discard" ? "Upload payment discarded" : "Amount corrected"); onUpdated(p); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!up) return null;
  if (!needs) {
    return (
      <p data-testid="upload-payment-waiting" className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Clock className="size-3.5" /> Partner payment of {money(up.amount)} entered at upload is applied once the total premium is known.
      </p>
    );
  }
  const gross = up.gross ?? policy.fields.gross_premium ?? 0;
  const own = Math.max(gross - (policy.amount_paid ?? 0), 0);
  let excess = Math.round((up.amount - own) * 100) / 100;
  const plan = [...(others.data ?? [])].filter((p) => p.id !== policy.id && (p.outstanding ?? 0) > 0)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((p) => { const amt = Math.min(excess, p.outstanding ?? 0); excess = Math.round((excess - amt) * 100) / 100; return { p, amt }; })
    .filter((x) => x.amt > 0);
  return (
    <div data-testid="upload-payment-approval" className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Payment entered ({money(up.amount)}) exceeds total premium ({money(gross)}). Approve to proceed?
      </p>
      <p className="text-xs">Entered by {up.recorded_by_name} on {up.paid_on}. Nothing has been applied yet.</p>
      {me.role === "admin" ? (
        <>
          <div className="space-y-1 text-xs" data-testid="upload-payment-plan">
            <p className="font-semibold">If approved: {money(Math.min(up.amount, own))} to this policy, the excess {money(Math.max(up.amount - own, 0))} to {policy.agent_name}&apos;s oldest outstanding first:</p>
            {plan.length ? (
              <ul className="ml-4 list-disc">{plan.map(({ p, amt }) => <li key={p.id}>{p.fields.policy_number ?? p.fields.vehicle_reg_no ?? p.file_name} · outstanding {money(p.outstanding)} → {money(amt)}</li>)}</ul>
            ) : <p className="ml-4">No other outstanding policies.</p>}
            {excess > 0 && <p className="ml-4">{money(excess)} left over stays on-account.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700" disabled={act.isPending} onClick={() => act.mutate({ action: "approve" })} data-testid="upload-payment-approve"><Check className="size-4" /> Approve</Button>
            <Input type="number" min="0" step="any" placeholder="Correct amount ₹" value={fix} onChange={(e) => setFix(e.target.value)} className="h-8 w-40 bg-white font-mono" data-testid="upload-payment-correct-input" />
            <Button size="sm" variant="outline" disabled={!(Number(fix) > 0) || act.isPending} onClick={() => act.mutate({ action: "correct", amount: Number(fix) })} data-testid="upload-payment-correct">Save correct amount</Button>
            <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: "discard" })} data-testid="upload-payment-discard">Discard</Button>
          </div>
        </>
      ) : <p className="text-xs">Waiting for admin approval.</p>}
    </div>
  );
}
