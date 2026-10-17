import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage, fmtDate, money } from "@/lib/fields";
import type { PartnerPayMode, PartnerPaymentIn, Settlement } from "@/lib/types";

const MODES: PartnerPayMode[] = ["Cash", "Online", "Cheque", "NEFT/RTGS", "UPI"];
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export function invalidatePayments(qc: ReturnType<typeof useQueryClient>, agentId: string) {
  for (const k of ["outstanding", "policies", "policy", "recon-summary", "recon-policies", "recon-settlements", "statements"]) qc.invalidateQueries({ queryKey: [k] });
  qc.invalidateQueries({ queryKey: ["partner-payments", agentId] });
}

/** Admin: one partial payment from a partner → applied to the oldest outstanding policies first; extra stays on-account. */
export function RecordPartnerPayment({ agentId, name, outstanding, onClose }: { agentId: string; name: string; outstanding: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PartnerPayMode>("Cash");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(istToday());
  const save = useMutation({
    mutationFn: () => apiPost<Settlement>("/recon/partner-payment", { agent_id: agentId, amount: Math.round(Number(amount) * 100) / 100, mode, reference: ref || null, paid_on: date } satisfies PartnerPaymentIn),
    onSuccess: (s) => {
      invalidatePayments(qc, agentId);
      toast.success(`${money(s.amount)} applied to ${s.allocations.length} polic${s.allocations.length === 1 ? "y" : "ies"}${s.unallocated ? ` · ${money(s.unallocated)} kept on-account` : ""} · ${money(s.balance_after ?? 0)} still outstanding`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const amt = Number(amount);
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent data-testid="partner-payment-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Record payment · {name}</DialogTitle>
          <DialogDescription>Outstanding {money(outstanding)}. The amount clears the oldest outstanding policies first; anything above the outstanding stays on-account.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label className="text-xs">Amount ₹</Label>
            <Input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" data-testid="partner-payment-amount-input" /></div>
          <div className="space-y-1"><Label className="text-xs">Mode</Label>
            <SimpleSelect value={mode} onChange={(v) => setMode(v as PartnerPayMode)} options={MODES.map((m) => ({ value: m, label: m }))} testId="partner-payment-mode-select" className="w-full" placeholder="Mode" /></div>
          <div className="space-y-1"><Label className="text-xs">Reference</Label>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Receipt / UTR (optional)" data-testid="partner-payment-reference-input" /></div>
          <div className="space-y-1"><Label className="text-xs">Paid on</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="partner-payment-date-input" /></div>
        </div>
        {amt > outstanding && outstanding > 0 && (
          <p className="text-xs text-amber-700" data-testid="partner-payment-extra-note">{money(amt - outstanding)} is more than the outstanding — it will be kept on-account.</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="partner-payment-cancel">Cancel</Button>
          <Button disabled={!(amt > 0) || !date || save.isPending} onClick={() => save.mutate()} data-testid="partner-payment-save"><IndianRupee className="size-4" /> Save payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Full payment history for one partner: date, amount, recorded by, where it went and the outstanding left after it. */
export function PartnerPaymentLog({ agentId }: { agentId: string }) {
  const log = useQuery({ queryKey: ["partner-payments", agentId], queryFn: () => apiGet<Settlement[]>(`/recon/partner-payments/${agentId}`) });
  const rows = log.data ?? [];
  return (
    <div className="space-y-1.5" data-testid={`partner-payment-log-${agentId}`}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><History className="size-3.5" /> Payment history</p>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">{log.isLoading ? "Loading…" : "No payments recorded yet."}</p> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5 text-right">Amount</th><th className="px-2 py-1.5">Mode</th><th className="px-2 py-1.5">Recorded by</th><th className="px-2 py-1.5">Applied to</th><th className="px-2 py-1.5 text-right">Outstanding after</th><th className="px-2 py-1.5">Note</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} data-testid={`partner-payment-row-${s.id}`} className={s.reversed ? "border-t border-border/60 text-muted-foreground line-through" : "border-t border-border/60"}>
                  <td className="px-2 py-1.5">{fmtDate(s.paid_on)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{money(s.amount)}</td>
                  <td className="px-2 py-1.5">{s.mode}{s.reference ? ` · ${s.reference}` : ""}</td>
                  <td className="px-2 py-1.5">{s.created_by_name}</td>
                  <td className="px-2 py-1.5">{s.allocations.map((a) => `${a.policy_number ?? a.reg_no ?? "policy"} ${money(a.amount)}`).join(", ") || "—"}{s.unallocated ? ` · on-account ${money(s.unallocated)}` : ""}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{s.balance_after != null ? money(s.balance_after) : "—"}</td>
                  <td className="px-2 py-1.5">{s.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
