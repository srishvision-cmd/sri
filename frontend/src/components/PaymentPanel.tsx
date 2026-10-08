import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiDelete, apiPost, apiPut } from "@/lib/api";
import { BROKER_PAID_MODES, BROKER_PAY_MODES, errorMessage, fmtDate, money, PAYMENT_MODES } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { PaymentIn, Policy, User } from "@/lib/types";

interface Props {
  policy: Policy;
  me: User;
  onUpdated: (p: Policy) => void;
}

export function PaymentPanel({ policy, me, onUpdated }: Props) {
  const canManage = me.role !== "agent";
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  // Cash (collected by agent) and Partial Payment carry a balance the agent owes until settled
  const partial = policy.payment_mode === "Cash" || policy.payment_mode === "Partial Payment";
  const owed = policy.outstanding ?? 0;
  const onErr = (err: unknown) => toast.error(errorMessage(err));

  const setMode = useMutation({
    mutationFn: (payment_mode: string) => apiPut<Policy>(`/policies/${policy.id}/payment-mode`, { payment_mode }),
    onSuccess: (p) => {
      onUpdated(p);
      toast.success(`Payment mode set to ${p.payment_mode}`);
    },
    onError: onErr,
  });
  const record = useMutation({
    mutationFn: () => apiPost<Policy>(`/policies/${policy.id}/payments`, { amount: Number(amount), reference: reference || null } satisfies PaymentIn),
    onSuccess: (p) => {
      onUpdated(p);
      setAmount("");
      setReference("");
      toast.success("Payment recorded");
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (entryId: string) => apiDelete<Policy>(`/policies/${policy.id}/payments/${entryId}`),
    onSuccess: (p) => {
      onUpdated(p);
      toast.success("Payment removed");
    },
    onError: onErr,
  });

  const amountNum = Number(amount);
  const amountValid = amount !== "" && amountNum > 0 && (policy.outstanding === null || amountNum <= owed + 0.5);

  return (
    <section data-testid="payment-panel" className="space-y-3 rounded-lg border border-border bg-[#0D131F]/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-caps flex items-center gap-1.5">
          <Wallet className="size-3" /> Agent premium payment
        </p>
        {canManage ? (
          <SimpleSelect
            value={policy.payment_mode ?? ""}
            onChange={(v) => v && v !== policy.payment_mode && setMode.mutate(v)}
            placeholder="Set payment mode"
            testId="payment-mode-select"
            className="min-w-44"
            options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))}
          />
        ) : (
          <span data-testid="payment-mode-value" className="text-sm">{policy.payment_mode ?? "Not set"}</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Total premium</div>
          <div className="font-mono tabular">{money(policy.fields.gross_premium)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Paid</div>
          <div data-testid="payment-amount-paid" className="font-mono tabular text-emerald-300">{money(policy.amount_paid)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Agent outstanding</div>
          <div data-testid="payment-outstanding" className={cn("font-mono tabular", owed > 0 ? "font-semibold text-orange-300" : "text-muted-foreground")}>
            {money(policy.outstanding)}
          </div>
        </div>
      </div>
      {partial && policy.fields.gross_premium === null && (
        <p className="text-xs text-amber-300">Outstanding is calculated once the total premium is captured.</p>
      )}

      {partial && (
        <>
          <ul data-testid="payment-ledger" className="divide-y divide-border rounded-md border border-border text-xs">
            {policy.payments.length === 0 && <li className="px-3 py-2 text-muted-foreground">No payments recorded yet.</li>}
            {policy.payments.map((p) => (
              <li key={p.id} data-testid={`payment-entry-${p.id}`} className="flex items-center gap-3 px-3 py-2">
                <span className="font-mono tabular text-foreground">{money(p.amount)}</span>
                <span className="text-muted-foreground">{fmtDate(p.paid_on)}</span>
                <span className="truncate text-muted-foreground">{p.reference ?? ""}</span>
                <span className="ml-auto text-muted-foreground">{p.recorded_by_name}</span>
                {me.role === "admin" && (
                  <button
                    data-testid={`payment-delete-${p.id}`}
                    aria-label="Remove payment"
                    className="rounded p-1 text-red-300 transition-colors duration-150 hover:bg-red-500/10"
                    onClick={() => window.confirm("Remove this payment entry?") && remove.mutate(p.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canManage && owed > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                data-testid="payment-amount-input"
                type="number"
                step="any"
                min="0"
                placeholder={`Amount (max ${money(owed)})`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-44 font-mono"
              />
              <Input
                data-testid="payment-reference-input"
                placeholder="Receipt / UTR / cheque no. (optional)"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="min-w-48 flex-1"
              />
              <Button data-testid="payment-record-button" disabled={!amountValid || record.isPending} onClick={() => record.mutate()}>
                <Plus className="size-4" /> Record settlement
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Srishvision → broker premium for one case. Multi-case lump sums go through Premium Recon. */
export function BrokerPaymentPanel({ policy, me, onUpdated }: Props) {
  const canManage = me.role !== "agent";
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  // older policies: Online/Cheque premium went straight to the broker → treated as paid (mirrors backend effective_broker_mode)
  const stored = policy.broker_payment_mode === "Pay Later" ? "Cash" : policy.broker_payment_mode;
  const mode = stored ?? (!policy.broker_payments.length && (policy.payment_mode === "Online" || policy.payment_mode === "Cheque") ? (policy.payment_mode ?? "Cash") : "Cash");
  const owed = policy.broker_outstanding ?? 0;
  const onErr = (err: unknown) => toast.error(errorMessage(err));
  const setMode = useMutation({
    mutationFn: (broker_payment_mode: string) => apiPut<Policy>(`/policies/${policy.id}/broker-payment-mode`, { broker_payment_mode }),
    onSuccess: (p) => { onUpdated(p); toast.success(`Broker payment set to ${p.broker_payment_mode}`); },
    onError: onErr,
  });
  const record = useMutation({
    mutationFn: () => apiPost<Policy>(`/policies/${policy.id}/broker-payments`, { amount: Number(amount), reference: reference || null } satisfies PaymentIn),
    onSuccess: (p) => { onUpdated(p); setAmount(""); setReference(""); toast.success("Payment to broker recorded"); },
    onError: onErr,
  });
  const amountNum = Number(amount);
  const valid = amountNum > 0 && amountNum <= owed + 0.5;
  const full = BROKER_PAID_MODES.includes(mode);

  return (
    <section data-testid="broker-payment-panel" className="space-y-3 rounded-lg border border-border bg-[#0D131F]/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-caps flex items-center gap-1.5"><Wallet className="size-3" /> Premium paid to broker · {policy.broker_name}</p>
        {canManage ? (
          <SimpleSelect value={mode} onChange={(v) => v && v !== mode && setMode.mutate(v)} placeholder="Broker payment" testId="broker-payment-mode-select" className="min-w-44"
            options={BROKER_PAY_MODES.map((m) => ({ value: m, label: m }))} />
        ) : <span data-testid="broker-payment-mode-value" className="text-sm">{mode}</span>}
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div><div className="text-xs text-muted-foreground">Total premium</div><div className="font-mono tabular">{money(policy.fields.gross_premium)}</div></div>
        <div><div className="text-xs text-muted-foreground">Paid to broker</div><div data-testid="broker-paid" className="font-mono tabular text-emerald-300">{money(policy.broker_paid)}</div></div>
        <div><div className="text-xs text-muted-foreground">Broker outstanding</div>
          <div data-testid="broker-outstanding" className={cn("font-mono tabular", owed > 0 ? "font-semibold text-orange-300" : "text-muted-foreground")}>{money(policy.broker_outstanding)}</div></div>
      </div>
      {full ? <p className="text-xs text-teal-300">Srishvision paid by {mode} — nothing pending to the broker.</p> : (
        <>
          {policy.broker_payments.length > 0 && (
            <ul data-testid="broker-payment-ledger" className="divide-y divide-border rounded-md border border-border text-xs">
              {policy.broker_payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="font-mono tabular text-foreground">{money(p.amount)}</span><span className="text-muted-foreground">{fmtDate(p.paid_on)}</span>
                  <span className="truncate text-muted-foreground">{p.reference ?? ""}</span><span className="ml-auto text-muted-foreground">{p.recorded_by_name}</span>
                </li>
              ))}
            </ul>
          )}
          {canManage && owed > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Input data-testid="broker-payment-amount-input" type="number" step="any" min="0" placeholder={`Amount (max ${money(owed)})`} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-44 font-mono" />
              <Input data-testid="broker-payment-reference-input" placeholder="UTR / cheque no. (optional)" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} className="min-w-48 flex-1" />
              <Button data-testid="broker-payment-record-button" disabled={!valid || record.isPending} onClick={() => record.mutate()}><Plus className="size-4" /> Pay broker</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Paying several cases in one cheque / UTR? Use Premium Recon and tick the cases.</p>
        </>
      )}
    </section>
  );
}
