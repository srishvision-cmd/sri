import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Percent, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiGet, apiPut } from "@/lib/api";
import { useBrokers } from "@/lib/auth";
import { errorMessage, money } from "@/lib/fields";
import type { BrokerSetIn, CommissionAudit, CommissionResult, Policy, User } from "@/lib/types";
import { RecalcDialog } from "@/components/RecalcDialog";
import { useState } from "react";

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
  const [recalcOpen, setRecalcOpen] = useState(false);
  const log = useQuery({
    queryKey: ["recalc-log", policy.id],
    queryFn: () => apiGet<CommissionAudit[]>(`/commission/recalc-log?policy_id=${policy.id}`),
    enabled: isAdmin,
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
              { label: "Receivable", value: c?.receivable, sub: [c?.receivable_rate, c?.receivable_rule_name].filter(Boolean).join(" · ") || null, tone: "text-sky-300", id: "receivable" },
              { label: "Payable to partner", value: c?.payable, sub: [c?.payable_rate, c?.payable_rule_name].filter(Boolean).join(" · ") || null, tone: c?.capped ? "text-amber-300" : "text-slate-100", id: "payable" },
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
                <Lock className="size-3" /> Snapshot saved {new Date(c.locked_at).toLocaleDateString("en-IN")} — grid changes don't alter it
              </span>
            ) : (
              <span data-testid="commission-live" className="text-muted-foreground">No snapshot yet — saved as soon as a receivable rule matches</span>
            )}
            <Button size="sm" variant="outline" className="ml-auto h-7" data-testid="commission-recalculate-button" onClick={() => setRecalcOpen(true)}>
              <RefreshCw className="size-3.5" /> Recalculate
            </Button>
          </div>
          {recalcOpen && <RecalcDialog policyIds={[policy.id]} onClose={() => setRecalcOpen(false)} onDone={() => qc.invalidateQueries({ queryKey: ["commission", policy.id] })} />}
          {(log.data?.length ?? 0) > 0 && (
            <details data-testid="commission-audit-log" className="rounded-md border border-border bg-card px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">Commission audit trail ({log.data?.length})</summary>
              <ul className="mt-2 space-y-1.5">
                {log.data?.map((a) => (
                  <li key={a.id} data-testid={`commission-audit-${a.id}`}>
                    <b>{a.action === "admin_recalculate" ? "Recalculated" : "Re-snapshotted (policy corrected)"}</b> by {a.by_name} ({a.by_role}
                    {a.by_id ? ` · ${a.by_id.slice(0, 8)}` : ""}) on {new Date(a.at).toLocaleString("en-IN")}
                    <div className="font-mono text-muted-foreground">
                      Receivable {money(a.before.receivable)} → {money(a.after.receivable)} · Payable {money(a.before.payable)} → {money(a.after.payable)} · Margin {money(a.before.margin)} → {money(a.after.margin)}
                    </div>
                    {a.reason && <div className="text-muted-foreground">Reason: {a.reason}</div>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {c?.declined && (
            <span data-testid="commission-declined-badge" className="inline-flex w-fit items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-700">Declined RTO</span>
          )}
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
