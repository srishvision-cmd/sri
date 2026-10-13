import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Percent, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { useBrokers } from "@/lib/auth";
import { errorMessage, money } from "@/lib/fields";
import type { BrokerSetIn, CommissionResult, Policy, User } from "@/lib/types";

/** Broker picker (admin/backoffice) + commission receivable/payable/margin (admin only). */
export function CommissionPanel({ policy, me, onUpdated }: { policy: Policy; me: User; onUpdated: (p: Policy) => void }) {
  const qc = useQueryClient();
  const isAdmin = me.role === "admin";
  const brokers = useBrokers(me.role !== "agent");
  const comm = useQuery({
    queryKey: ["commission", policy.id, policy.updated_at],
    queryFn: () => apiGet<CommissionResult>(`/policies/${policy.id}/commission`),
    enabled: isAdmin,
  });
  const recalc = useMutation({
    mutationFn: () => apiPost<CommissionResult>(`/policies/${policy.id}/commission/recalculate`, {}),
    onSuccess: (r) => {
      qc.setQueryData(["commission", policy.id, policy.updated_at], r);
      qc.invalidateQueries({ queryKey: ["policy", policy.id] });
      toast.success("Commission recalculated with today's rules");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const setBroker = useMutation({
    mutationFn: (body: BrokerSetIn) => apiPut<Policy>(`/policies/${policy.id}/broker`, body),
    onSuccess: (p) => {
      onUpdated(p);
      qc.invalidateQueries({ queryKey: ["commission", policy.id] });
      toast.success("Channel Partner updated");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (me.role === "agent") return null;
  const c = comm.data;

  return (
    <div data-testid="commission-panel" className="space-y-3 rounded-lg border border-border bg-muted p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-caps flex items-center gap-1.5">
          <Percent className="size-3.5 text-sky-400" /> Broker & commission
        </p>
        <SimpleSelect
          value={policy.broker_id ?? ""}
          onChange={(v) => setBroker.mutate({ broker_id: v || null })}
          allLabel="No channel partner"
          options={(brokers.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
          placeholder="Channel Partner"
          testId="policy-broker-select"
          className="min-w-56"
        />
      </div>
      {isAdmin && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Receivable", value: c?.receivable, sub: c?.receivable_rule_name, tone: "text-sky-300", id: "receivable" },
              { label: "Payable to agent", value: c?.payable, sub: [c?.payable_rate, c?.payable_rule_name].filter(Boolean).join(" · ") || null, tone: c?.capped ? "text-amber-300" : "text-slate-100", id: "payable" },
              { label: "Margin", value: c?.margin, sub: null, tone: "text-teal-300", id: "margin" },
            ].map((t) => (
              <div key={t.id} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="text-[11px] text-muted-foreground">{t.label}</div>
                <div data-testid={`commission-${t.id}`} className={`font-mono text-lg font-semibold tabular ${t.tone}`}>{money(t.value)}</div>
                {t.sub && <div className="truncate text-[11px] text-muted-foreground" title={t.sub}>{t.sub}</div>}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {c?.locked_at ? (
              <span data-testid="commission-locked" className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-300">
                <Lock className="size-3" /> Locked at verification ({new Date(c.locked_at).toLocaleDateString("en-IN")}) — rule edits don't change it
              </span>
            ) : (
              <span data-testid="commission-live" className="text-muted-foreground">{policy.status === "verified" ? "Not locked yet — locks when a rule matches" : "Live — locks when the policy is verified"}</span>
            )}
            <Button size="sm" variant="outline" className="ml-auto h-7" disabled={recalc.isPending} data-testid="commission-recalculate-button"
              onClick={() => { if (confirm("Recalculate this policy's commission with today's rules? The locked amounts will be replaced.")) recalc.mutate(); }}>
              <RefreshCw className={`size-3.5 ${recalc.isPending ? "animate-spin" : ""}`} /> Recalculate
            </Button>
          </div>
          {c?.note && <p data-testid="commission-note" className="text-xs text-amber-300">{c.note}</p>}
          {c && c.receivable == null && c.payable == null && !c.note && (
            <p className="text-xs text-muted-foreground">No commission rule matches this policy yet.</p>
          )}
          {c && c.misses.length > 0 && (
            <details data-testid="commission-misses" className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs" open={c.receivable == null}>
              <summary className="cursor-pointer font-medium text-amber-200">Why other rules did not apply ({c.misses.length})</summary>
              <ul className="mt-2 space-y-1.5">
                {c.misses.map((m) => (
                  <li key={m.rule_id} data-testid={`commission-miss-${m.rule_id}`}>
                    <span className="font-semibold text-slate-200">{m.rule_name}</span> <span className="text-muted-foreground">({m.kind})</span>
                    <ul className="ml-3 list-disc text-amber-100/80">{m.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">Fix the policy field (e.g. channel partner, GVW) in the form above or adjust the rule — commission recalculates instantly.</p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
