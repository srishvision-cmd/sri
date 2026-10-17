import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, HandCoins, Undo2 } from "lucide-react";
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
import type { PartyStatement, PaidTo, ReconKind, ReconParty, ReconPolicy, Settlement, SettlementIn, SettleMode } from "@/lib/types";

const MODES: SettleMode[] = ["Cheque", "Online", "NEFT/RTGS", "UPI", "Cash", "Adjustment"];
const COPY: Record<ReconKind, { tab: string; party: string; paid: string; action: string; hint: string }> = {
  agent: { tab: "Partner → Srishvision", party: "Partner", paid: "Received", action: "Record receipt from partner", hint: "Cash / Partial policies the partner still owes premium on." },
  broker: { tab: "Srishvision → Broker", party: "Broker", paid: "Remitted", action: "Record payment to broker", hint: "Premium Srishvision still has to remit to each broker." },
};

function PartyDetail({ kind, party }: { kind: ReconKind; party: ReconParty }) {
  const qc = useQueryClient();
  const c = COPY[kind];
  const pols = useQuery({ queryKey: ["recon-policies", kind, party.party_id], queryFn: () => apiGet<ReconPolicy[]>(`/recon/policies?kind=${kind}&party_id=${party.party_id}`) });
  const sets = useQuery({ queryKey: ["recon-settlements", kind, party.party_id], queryFn: () => apiGet<Settlement[]>(`/recon/settlements?kind=${kind}&party_id=${party.party_id}`) });
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<SettleMode>("Cheque");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [paidTo, setPaidTo] = useState<PaidTo>("Broker");
  const all = pols.data ?? [];
  const rows = all.filter((r) => !onlyOpen || r.outstanding > 0);
  const open = all.filter((r) => r.outstanding > 0);
  const multi = open.length > 1;
  const sel = Object.keys(alloc);
  const allocTotal = sel.reduce((t, id) => t + (Number(alloc[id]) || 0), 0);
  const badCase = sel.find((id) => { const r = all.find((x) => x.policy_id === id); const v = Number(alloc[id]); return !r || !(v >= 0) || v > r.outstanding + 0.009; });
  const onAcc = mode === "On-account";
  const defaultAmount = sel.length ? allocTotal : open.length === 1 ? open[0].outstanding : 0;
  const amt = onAcc ? (sel.length ? allocTotal : Math.min(defaultAmount, party.on_account)) : amount ? Number(amount) : defaultAmount;
  const extra = Math.round((amt - (sel.length ? allocTotal : Math.min(amt, open[0]?.outstanding ?? 0))) * 100) / 100;
  const blocker = multi && !(allocTotal > 0) ? `${open.length} cases are outstanding — tick the cases this payment covers and enter the amount for each.`
    : badCase ? "A ticked case amount is more than its outstanding."
    : sel.length && allocTotal > amt + 0.009 ? `Case amounts ${money(allocTotal)} are more than the payment ${money(amt)}.`
    : onAcc && amt > party.on_account + 0.009 ? `On-account balance is only ${money(party.on_account)}.`
    : !(amt > 0) ? "Enter the amount." : null;
  const modes = party.on_account > 0 ? [...MODES, "On-account" as SettleMode] : MODES;
  const invalidate = () => { for (const k of ["recon-summary", "recon-policies", "recon-settlements", "policies", "policy", "outstanding"]) qc.invalidateQueries({ queryKey: [k] }); };
  const save = useMutation({
    mutationFn: (body: SettlementIn) => apiPost<Settlement>("/recon/settlements", body),
    onSuccess: (s) => {
      invalidate();
      toast.success(`${money(s.amount)} ${kind === "agent" ? "received" : "paid"} · ${s.allocations.length} case(s)${s.unallocated > 0 ? ` · ${money(s.unallocated)} kept on-account` : ""}`);
      setAlloc({});
      setAmount("");
      setRef("");
      if (onAcc) setMode("Cheque");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const reverse = useMutation({
    mutationFn: (id: string) => apiPost<Settlement>(`/recon/settlements/${id}/reverse`, {}),
    onSuccess: (s) => { invalidate(); toast.success(`Batch ${s.id.slice(0, 8)} reversed · outstanding restored on ${s.allocations.length} case(s)`); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  // Fill ticked cases oldest-first with the typed payment (each up to its outstanding); still editable per case.
  const split = (total: number, ids: string[]) => {
    let left = Math.round(total * 100) / 100;
    const n: Record<string, string> = {};
    for (const r of open.filter((x) => ids.includes(x.policy_id))) {
      const v = Math.min(left, r.outstanding);
      n[r.policy_id] = String(Math.round(v * 100) / 100);
      left = Math.round((left - v) * 100) / 100;
    }
    setAlloc(n);
  };
  const tick = (r: ReconPolicy, v: boolean) => {
    const ids = v ? [...sel, r.policy_id] : sel.filter((x) => x !== r.policy_id);
    if (Number(amount) > 0 && !onAcc) return split(Number(amount), ids);
    setAlloc((a) => { const n = { ...a }; if (v) n[r.policy_id] = String(r.outstanding); else delete n[r.policy_id]; return n; });
  };
  const changeAmount = (v: string) => { setAmount(v); if (sel.length && Number(v) > 0) split(Number(v), sel); };

  return (
    <div data-testid="recon-party-detail" className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-heading text-lg font-semibold">{party.party_name}</div>
          <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
            <span data-testid="recon-open-cases">{open.length} open case(s) · {money(party.outstanding)}</span>
            {party.on_account !== 0 && <span data-testid="recon-on-account" className="text-sky-300">On-account balance {money(party.on_account)}</span>}
          </div>
        </div>
        <a href={`/api/recon/export?kind=${kind}&party_id=${party.party_id}`} data-testid="recon-export"><Button size="sm" variant="outline"><FileSpreadsheet className="size-4" /> Recon Excel</Button></a>
      </div>

      <div className={cn("grid gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 md:items-end", kind === "broker" ? "md:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]" : "md:grid-cols-[1fr_1fr_1fr_1fr_auto]")} data-testid="recon-settle-form">
        <div className="space-y-1"><Label className="text-xs">{onAcc ? "Adjust from on-account ₹" : "Amount received / paid ₹"}</Label>
          <Input type="number" min="0" value={onAcc ? String(amt || "") : amount} disabled={onAcc} onChange={(e) => changeAmount(e.target.value)} data-testid="recon-amount-input" className="font-mono"
            placeholder={defaultAmount ? defaultAmount.toFixed(2) : "0.00"} /></div>
        <div className="space-y-1"><Label className="text-xs">Mode</Label>
          <SimpleSelect value={mode} onChange={(v) => setMode(v as SettleMode)} options={modes.map((m) => ({ value: m, label: m === "On-account" ? `On-account (${money(party.on_account)})` : m }))} placeholder="Mode" testId="recon-mode-select" className="w-full" /></div>
        <div className="space-y-1"><Label className="text-xs">Cheque no / UTR</Label>
          <Input value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} data-testid="recon-ref-input" className="font-mono" /></div>
        {kind === "broker" && <div className="space-y-1"><Label className="text-xs">Paid to</Label>
          <SimpleSelect value={paidTo} onChange={(v) => setPaidTo(v as PaidTo)} options={[{ value: "Broker", label: "Broker" }, { value: "Insurance Company", label: "Insurance Company" }]} placeholder="Paid to" testId="recon-paid-to-select" className="w-full" /></div>}
        <div className="space-y-1"><Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="recon-date-input" /></div>
        <Button data-testid="recon-save-button" disabled={!!blocker || !date || save.isPending}
          onClick={() => save.mutate({ kind, party_id: party.party_id, amount: Math.round(amt * 100) / 100, mode, reference: ref || null, paid_to: kind === "broker" ? paidTo : null, paid_on: date,
            allocations: sel.filter((id) => Number(alloc[id]) > 0).map((id) => ({ policy_id: id, amount: Number(alloc[id]) })) })}>
          <HandCoins className="size-4" /> {c.action}
        </Button>
        <p data-testid="recon-settle-hint" className={cn("text-xs md:col-span-6", blocker && (multi || badCase) ? "text-amber-300" : "text-muted-foreground")}>
          {blocker ?? (sel.length ? `${sel.length} case(s) ticked · ${money(allocTotal)} applied to cases` : open.length === 1 ? "Single open case — the amount is applied to it automatically." : "No open case — the full amount is kept as on-account balance.")}
          {!blocker && !onAcc && extra > 0.009 && ` · ${money(extra)} will be kept as on-account balance.`}
          {sel.length > 0 && allocTotal > amt + 0.009 && <Button size="sm" variant="outline" className="ml-2 h-6 px-2 text-xs" data-testid="recon-split-button" onClick={() => split(amt, sel)}>Split {money(amt)} across ticked cases</Button>}
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="label-caps">Policies</p>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={onlyOpen} onCheckedChange={(v) => setOnlyOpen(!!v)} data-testid="recon-only-outstanding" /> Only outstanding</label>
        </div>
        <Table data-testid="recon-policies-table">
          <TableHeader><TableRow>
            <TableHead className="w-8">{open.length > 1 && <Checkbox data-testid="recon-select-all" checked={sel.length === open.length}
              onCheckedChange={(v) => (v ? (Number(amount) > 0 && !onAcc ? split(Number(amount), open.map((r) => r.policy_id)) : setAlloc(Object.fromEntries(open.map((r) => [r.policy_id, String(r.outstanding)])))) : setAlloc({}))} />}</TableHead><TableHead>Policy no</TableHead><TableHead>Reg no</TableHead><TableHead>Insured</TableHead><TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Premium</TableHead><TableHead className="text-right">{c.paid}</TableHead><TableHead className="text-right">Outstanding</TableHead>
            <TableHead className="w-36 text-right">Pay now ₹</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => {
              const on = r.policy_id in alloc;
              return (
                <TableRow key={r.policy_id} data-testid={`recon-policy-${r.policy_id}`} className={cn(on && "bg-sky-500/5")}>
                  <TableCell>{r.outstanding > 0 && <Checkbox data-testid={`recon-select-${r.policy_id}`} checked={on} onCheckedChange={(v) => tick(r, !!v)} />}</TableCell>
                  <TableCell className="font-mono text-xs">{r.policy_number}</TableCell><TableCell className="font-mono text-xs">{r.reg_no}</TableCell><TableCell>{r.insured_name}</TableCell>
                  <TableCell className="text-xs">{r.uploaded_on}</TableCell><TableCell className="text-right font-mono">{money(r.premium)}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-300">{money(r.paid)}</TableCell>
                  <TableCell className={cn("text-right font-mono", r.outstanding > 0 ? "text-amber-300" : "text-muted-foreground")}>{money(r.outstanding)}</TableCell>
                  <TableCell className="text-right">
                    {on && <Input type="number" min="0" max={r.outstanding} value={alloc[r.policy_id]} data-testid={`recon-alloc-${r.policy_id}`}
                      onChange={(e) => setAlloc((a) => ({ ...a, [r.policy_id]: e.target.value }))} className="h-8 text-right font-mono" />}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} className="py-6 text-center text-xs text-muted-foreground">Nothing outstanding — fully reconciled.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <div>
        <p className="label-caps mb-1.5">Settlement history</p>
        <Table data-testid="recon-settlements-table">
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Batch</TableHead><TableHead>Mode</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Allocated to</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {(sets.data ?? []).map((s) => (
              <TableRow key={s.id} data-testid={`recon-settlement-${s.id}`} className={cn(s.reversed && "opacity-50")}>
                <TableCell className="text-xs">{s.paid_on}</TableCell><TableCell className="font-mono text-xs">{s.id.slice(0, 8)}</TableCell>
                <TableCell className="text-xs">{s.mode}</TableCell><TableCell className="font-mono text-xs">{s.reference ?? "—"}</TableCell>
                <TableCell className={cn("text-right font-mono", s.reversed && "line-through")}>{money(s.amount)}</TableCell>
                <TableCell className="max-w-md whitespace-normal text-xs text-muted-foreground">
                  {s.allocations.map((a) => `${a.policy_number ?? "—"} (${a.reg_no ?? "—"}) ${money(a.amount)}`).join(" · ")}
                  {s.unallocated > 0 && <span className="text-sky-300">{s.allocations.length ? " · " : ""}On-account {money(s.unallocated)}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {s.reversed ? <span data-testid={`recon-reversed-${s.id}`} className="text-xs text-rose-300">Reversed{s.reversed_by_name ? ` by ${s.reversed_by_name}` : ""}</span>
                    : <Button size="sm" variant="ghost" data-testid={`recon-reverse-${s.id}`} disabled={reverse.isPending}
                        onClick={() => { if (window.confirm(`Reverse batch ${s.id.slice(0, 8)} (${money(s.amount)})? Outstanding returns on every case it paid.`)) reverse.mutate(s.id); }}>
                        <Undo2 className="size-4" /> Reverse</Button>}
                </TableCell>
              </TableRow>
            ))}
            {(sets.data ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">No settlements yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <StatementBox kind={kind} partyId={party.party_id} />
    </div>
  );
}

/** Total commission − premium pending (Cash) − partial payment pending = receivable / payable commission. Excel for the broker or agent. */
function StatementBox({ kind, partyId }: { kind: ReconKind; partyId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const who = kind === "broker" ? "Broker" : "Partner";
  const qs = `kind=${kind}&party_id=${partyId}${from ? `&date_from=${from}` : ""}${to ? `&date_to=${to}` : ""}`;
  const st = useQuery({ queryKey: ["recon-policies", "statement", qs], queryFn: () => apiGet<PartyStatement>(`/recon/statement?${qs}`) });
  const d = st.data;
  const partial = (d?.rows ?? []).filter((r) => r.partial);
  const tiles: [string, string, string, string][] = d ? [
    ["Total commission", money(d.total_commission), "text-emerald-300", "commission"],
    ["− Premium pending (Cash)", money(d.cash_pending), "text-amber-300", "cash-pending"],
    ["− Partial payment pending", money(d.partial_pending), "text-yellow-200", "partial-pending"],
    [d.net_label, money(Math.abs(d.net)), d.net >= 0 ? "text-emerald-300" : "text-rose-300", "net"],
  ] : [];
  return (
    <div data-testid="statement-box" className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="label-caps">{who} statement · commission vs pending premium</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {kind === "broker" ? "Send to the broker: they deduct pending premium from the commission and pay Srishvision the balance."
              : "Partner's commission minus the premium they still owe Srishvision."} Partial Payment cases are highlighted in amber.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">From (upload date)</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="statement-from" className="h-8" /></div>
          <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="statement-to" className="h-8" /></div>
          <a href={`/api/recon/statement/excel?${qs}`} data-testid="statement-excel"><Button size="sm"><FileSpreadsheet className="size-4" /> {who} statement Excel</Button></a>
        </div>
      </div>
      {d && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map(([l, v, tone, id]) => (
            <div key={id} className={cn("rounded-md border bg-card p-3", id === "partial-pending" ? "border-yellow-400/40" : "border-border")}>
              <div className="text-xs text-muted-foreground">{l}</div>
              <div data-testid={`statement-${id}`} className={cn("mt-1 font-mono text-lg font-semibold tabular", tone)}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {partial.length > 0 && (
        <div data-testid="statement-partial-list" className="rounded-md border border-yellow-400/40 bg-yellow-400/5 p-2 text-xs">
          <p className="mb-1 font-semibold text-yellow-200">{partial.length} Partial Payment case(s) in this statement</p>
          {partial.map((r) => (
            <div key={r.policy_id} data-testid={`statement-partial-${r.policy_id}`} className="flex flex-wrap gap-x-3 py-0.5 text-muted-foreground">
              <span className="font-mono text-foreground">{r.policy_number}</span><span>{r.customer_name}</span><span>{r.partial_label}</span>
              <span className="ml-auto font-mono">paid {money(r.premium_paid)} · pending <span className="text-yellow-200">{money(r.pending_premium)}</span></span>
            </div>
          ))}
        </div>
      )}
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
        <p className="mt-1 text-sm text-muted-foreground">Track lump-sum payments policy by policy — what partners owe Srishvision and what Srishvision owes each broker.</p>
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
      <p className="text-xs text-muted-foreground">{c.hint} Click a row to reconcile, or use <b>Statement</b> to view / download the {kind === "broker" ? "broker" : "partner"} statement with every policy.</p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>{c.party}</TableHead><TableHead className="text-right">Policies</TableHead><TableHead className="text-right">Premium</TableHead>
            <TableHead className="text-right">{c.paid}</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Open cases</TableHead><TableHead className="text-right">On-account</TableHead><TableHead className="text-right">Statement</TableHead>
          </TableRow></TableHeader>
          <TableBody data-testid="recon-summary-table">
            {parties.map((p) => (
              <TableRow key={p.party_id} data-testid={`recon-party-${p.party_id}`} onClick={() => setPartyId(p.party_id === partyId ? null : p.party_id)}
                className={cn("cursor-pointer", p.party_id === partyId && "bg-sky-500/10")}>
                <TableCell className="font-medium">{p.party_name}</TableCell><TableCell className="text-right font-mono">{p.policies}</TableCell>
                <TableCell className="text-right font-mono">{money(p.premium)}</TableCell><TableCell className="text-right font-mono text-emerald-300">{money(p.paid)}</TableCell>
                <TableCell className="text-right font-mono text-amber-300">{money(p.outstanding)}</TableCell><TableCell className="text-right font-mono">{p.outstanding_policies}</TableCell><TableCell className="text-right font-mono text-sky-300">{p.on_account ? money(p.on_account) : "—"}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" className="h-7" data-testid={`recon-statement-view-${p.party_id}`} onClick={() => setPartyId(p.party_id)}>View</Button>
                    <a href={`/api/recon/statement/excel?kind=${kind}&party_id=${p.party_id}`} data-testid={`recon-statement-excel-${p.party_id}`}>
                      <Button size="sm" className="h-7"><FileSpreadsheet className="size-3.5" /> Excel</Button>
                    </a>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!summary.isLoading && parties.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">No {kind === "broker" ? "policies with a broker" : "Cash / Partial policies"} yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {party && <PartyDetail key={`${kind}-${party.party_id}`} kind={kind} party={party} />}
    </div>
  );
}
