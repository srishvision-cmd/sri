import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, HandCoins } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage, money } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { ReconKind, ReconParty, ReconPolicy, Settlement, SettlementIn, SettleMode } from "@/lib/types";

const MODES: SettleMode[] = ["Cheque", "Online", "NEFT/RTGS", "UPI", "Cash", "Adjustment"];
const COPY: Record<ReconKind, { tab: string; party: string; paid: string; action: string; hint: string }> = {
  agent: { tab: "Agent → Srishvision", party: "Agent", paid: "Received", action: "Record receipt from agent", hint: "Cash / Partial policies the agent still owes premium on." },
  broker: { tab: "Srishvision → Broker", party: "Broker", paid: "Remitted", action: "Record payment to broker", hint: "Premium Srishvision still has to remit to each broker." },
};

function PartyDetail({ kind, party }: { kind: ReconKind; party: ReconParty }) {
  const qc = useQueryClient();
  const c = COPY[kind];
  const pols = useQuery({ queryKey: ["recon-policies", kind, party.party_id], queryFn: () => apiGet<ReconPolicy[]>(`/recon/policies?kind=${kind}&party_id=${party.party_id}`) });
  const sets = useQuery({ queryKey: ["recon-settlements", kind, party.party_id], queryFn: () => apiGet<Settlement[]>(`/recon/settlements?kind=${kind}&party_id=${party.party_id}`) });
  const [sel, setSel] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<SettleMode>("Cheque");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const [onlyOpen, setOnlyOpen] = useState(true);
  const rows = (pols.data ?? []).filter((r) => !onlyOpen || r.outstanding > 0);
  const selTotal = (pols.data ?? []).filter((r) => sel.includes(r.policy_id)).reduce((t, r) => t + r.outstanding, 0);
  const save = useMutation({
    mutationFn: (body: SettlementIn) => apiPost<Settlement>("/recon/settlements", body),
    onSuccess: (s) => {
      for (const k of ["recon-summary", "recon-policies", "recon-settlements", "policies", "policy", "outstanding"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(`${money(s.amount)} ${kind === "agent" ? "received" : "paid"} · allocated to ${s.allocations.length} policies`);
      setSel([]);
      setAmount("");
      setRef("");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div data-testid="recon-party-detail" className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-heading text-lg font-semibold">{party.party_name}</div>
        <a href={`/api/recon/export?kind=${kind}&party_id=${party.party_id}`} data-testid="recon-export"><Button size="sm" variant="outline"><FileSpreadsheet className="size-4" /> Recon Excel</Button></a>
      </div>

      <div className="grid gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end" data-testid="recon-settle-form">
        <div className="space-y-1"><Label className="text-xs">Amount ₹</Label>
          <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="recon-amount-input" className="font-mono"
            placeholder={sel.length ? selTotal.toFixed(2) : party.outstanding.toFixed(2)} /></div>
        <div className="space-y-1"><Label className="text-xs">Mode</Label>
          <SimpleSelect value={mode} onChange={(v) => setMode(v as SettleMode)} options={MODES.map((m) => ({ value: m, label: m }))} placeholder="Mode" testId="recon-mode-select" className="w-full" /></div>
        <div className="space-y-1"><Label className="text-xs">Cheque no / UTR</Label>
          <Input value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} data-testid="recon-ref-input" className="font-mono" /></div>
        <div className="space-y-1"><Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="recon-date-input" /></div>
        <Button data-testid="recon-save-button" disabled={!(Number(amount) > 0) || !date || save.isPending}
          onClick={() => save.mutate({ kind, party_id: party.party_id, amount: Number(amount), mode, reference: ref || null, paid_on: date, policy_ids: sel })}>
          <HandCoins className="size-4" /> {c.action}
        </Button>
        <p className="text-xs text-muted-foreground md:col-span-5">
          {sel.length ? `Allocated to the ${sel.length} ticked policies (outstanding ${money(selTotal)}) in order.` : "No policies ticked — amount is allocated to the oldest outstanding policies first."}{" "}
          Part-payments leave the balance outstanding on that policy.
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="label-caps">Policies</p>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={onlyOpen} onCheckedChange={(v) => setOnlyOpen(!!v)} data-testid="recon-only-outstanding" /> Only outstanding</label>
        </div>
        <Table data-testid="recon-policies-table">
          <TableHeader><TableRow>
            <TableHead className="w-8" /><TableHead>Policy no</TableHead><TableHead>Reg no</TableHead><TableHead>Insured</TableHead><TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Premium</TableHead><TableHead className="text-right">{c.paid}</TableHead><TableHead className="text-right">Outstanding</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.policy_id} data-testid={`recon-policy-${r.policy_id}`}>
                <TableCell>{r.outstanding > 0 && <Checkbox data-testid={`recon-select-${r.policy_id}`} checked={sel.includes(r.policy_id)} onCheckedChange={(v) => setSel((s) => (v ? [...s, r.policy_id] : s.filter((x) => x !== r.policy_id)))} />}</TableCell>
                <TableCell className="font-mono text-xs">{r.policy_number}</TableCell><TableCell className="font-mono text-xs">{r.reg_no}</TableCell><TableCell>{r.insured_name}</TableCell>
                <TableCell className="text-xs">{r.uploaded_on}</TableCell><TableCell className="text-right font-mono">{money(r.premium)}</TableCell>
                <TableCell className="text-right font-mono text-emerald-300">{money(r.paid)}</TableCell>
                <TableCell className={cn("text-right font-mono", r.outstanding > 0 ? "text-amber-300" : "text-muted-foreground")}>{money(r.outstanding)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-xs text-muted-foreground">Nothing outstanding — fully reconciled.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <div>
        <p className="label-caps mb-1.5">Settlement history</p>
        <Table data-testid="recon-settlements-table">
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Mode</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Allocated to</TableHead></TableRow></TableHeader>
          <TableBody>
            {(sets.data ?? []).map((s) => (
              <TableRow key={s.id}><TableCell className="text-xs">{s.paid_on}</TableCell><TableCell className="text-xs">{s.mode}</TableCell><TableCell className="font-mono text-xs">{s.reference ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{money(s.amount)}</TableCell>
                <TableCell className="max-w-md whitespace-normal text-xs text-muted-foreground">{s.allocations.map((a) => `${a.policy_number ?? "—"} (${a.reg_no ?? "—"}) ${money(a.amount)}`).join(" · ")}</TableCell></TableRow>
            ))}
            {(sets.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">No settlements yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function Recon() {
  const [kind, setKind] = useState<ReconKind>("broker");
  const [partyId, setPartyId] = useState<string | null>(null);
  const summary = useQuery({ queryKey: ["recon-summary", kind], queryFn: () => apiGet<ReconParty[]>(`/recon/summary?kind=${kind}`) });
  const parties = summary.data ?? [];
  const party = parties.find((p) => p.party_id === partyId);
  const c = COPY[kind];
  const tot = parties.reduce((t, p) => ({ premium: t.premium + p.premium, paid: t.paid + p.paid, out: t.out + p.outstanding }), { premium: 0, paid: 0, out: 0 });

  return (
    <div className="space-y-5 animate-rise">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Premium recon</h2>
        <p className="mt-1 text-sm text-muted-foreground">Track lump-sum payments policy by policy — what agents owe Srishvision and what Srishvision owes each broker.</p>
      </div>
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1" role="tablist">
        {(["broker", "agent"] as ReconKind[]).map((k) => (
          <button key={k} role="tab" data-testid={`recon-tab-${k}`} onClick={() => { setKind(k); setPartyId(null); }}
            className={cn("rounded-md px-3 py-1.5 text-sm transition-colors duration-150", kind === k ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground")}>
            {COPY[k].tab}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[["Total premium", tot.premium, "text-slate-100", "premium"], [c.paid, tot.paid, "text-emerald-300", "paid"], ["Outstanding", tot.out, "text-amber-300", "outstanding"]].map(([l, v, tone, id]) => (
          <div key={id as string} className="rounded-xl border border-border bg-card p-4">
            <div className="label-caps">{l}</div>
            <div data-testid={`recon-total-${id}`} className={cn("mt-2 font-mono text-xl font-semibold tabular", tone as string)}>{money(v as number)}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{c.hint} Click a row to reconcile.</p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>{c.party}</TableHead><TableHead className="text-right">Policies</TableHead><TableHead className="text-right">Premium</TableHead>
            <TableHead className="text-right">{c.paid}</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Open cases</TableHead>
          </TableRow></TableHeader>
          <TableBody data-testid="recon-summary-table">
            {parties.map((p) => (
              <TableRow key={p.party_id} data-testid={`recon-party-${p.party_id}`} onClick={() => setPartyId(p.party_id === partyId ? null : p.party_id)}
                className={cn("cursor-pointer", p.party_id === partyId && "bg-sky-500/10")}>
                <TableCell className="font-medium">{p.party_name}</TableCell><TableCell className="text-right font-mono">{p.policies}</TableCell>
                <TableCell className="text-right font-mono">{money(p.premium)}</TableCell><TableCell className="text-right font-mono text-emerald-300">{money(p.paid)}</TableCell>
                <TableCell className="text-right font-mono text-amber-300">{money(p.outstanding)}</TableCell><TableCell className="text-right font-mono">{p.outstanding_policies}</TableCell>
              </TableRow>
            ))}
            {!summary.isLoading && parties.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No {kind === "broker" ? "policies with a broker" : "Cash / Partial policies"} yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {party && <PartyDetail key={`${kind}-${party.party_id}`} kind={kind} party={party} />}
    </div>
  );
}
