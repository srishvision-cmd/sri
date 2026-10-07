import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { CheckCircle2, FileDown, FileSpreadsheet, ReceiptText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useAgentOptions } from "@/lib/auth";
import { errorMessage, money } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { CommissionStatement, PeriodType, StatementGenerateIn, StatementPaidIn, User } from "@/lib/types";

const PERIODS: { value: PeriodType; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly (Mon–Sun)" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom dates" },
];

function GenerateCard({ onCreated }: { onCreated: (s: CommissionStatement) => void }) {
  const qc = useQueryClient();
  const agents = useAgentOptions(true);
  const [agentId, setAgentId] = useState("");
  const [period, setPeriod] = useState<PeriodType>("monthly");
  const [ref, setRef] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const gen = useMutation({
    mutationFn: (body: StatementGenerateIn) => apiPost<CommissionStatement>("/statements", body),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["statements"] });
      qc.invalidateQueries({ queryKey: ["policies"] });
      toast.success(`Statement ${s.number} generated — net payable ${money(s.net_payable)}`);
      onCreated(s);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const ready = agentId && (period !== "custom" || (from && to));
  return (
    <div data-testid="statement-generate-card" className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end">
      <div className="space-y-1">
        <Label className="text-xs">Agent</Label>
        <SimpleSelect value={agentId} onChange={setAgentId} placeholder="Select agent" testId="statement-agent-select" className="w-full"
          options={(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.full_name} · ${a.username.toUpperCase()}` }))} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Statement period</Label>
        <SimpleSelect value={period} onChange={(v) => setPeriod(v as PeriodType)} placeholder="Period" testId="statement-period-select" className="w-full" options={PERIODS} />
      </div>
      {period === "custom" ? (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="statement-from-input" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="statement-to-input" />
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">Any date in the {period === "daily" ? "day" : period === "weekly" ? "week" : "month"} (blank = today)</Label>
          <Input type="date" value={ref} onChange={(e) => setRef(e.target.value)} data-testid="statement-ref-date-input" />
        </div>
      )}
      <Button data-testid="statement-generate-button" disabled={!ready || gen.isPending}
        onClick={() => gen.mutate({ agent_id: agentId, period_type: period, ref_date: ref || null, from_date: from || null, to_date: to || null })}>
        <ReceiptText className="size-4" /> {gen.isPending ? "Generating…" : "Generate statement"}
      </Button>
      <p className="text-xs text-muted-foreground md:col-span-4">
        Includes the agent's policies uploaded in the period that are not on an earlier statement. All of the agent's premium outstanding (Cash / Partial) is deducted from the commission.
      </p>
    </div>
  );
}

function PaidDialog({ s, onClose }: { s: CommissionStatement; onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [utr, setUtr] = useState("");
  const pay = useMutation({
    mutationFn: (body: StatementPaidIn) => apiPost<CommissionStatement>(`/statements/${s.id}/paid`, body),
    onSuccess: () => {
      for (const k of ["statements", "policies", "policy", "outstanding", "stats"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(`${s.number} marked paid · UTR ${utr}`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="statement-paid-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Mark {s.number} as paid</DialogTitle>
          <DialogDescription>
            Pay {money(s.net_payable)} to {s.agent_name}. The {s.lines.length} policies are marked commission-paid in the MIS and {money(s.outstanding_deducted)} is recorded against their premium outstanding.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Paid date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="statement-paid-date-input" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">UTR / reference no.</Label>
            <Input value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} placeholder="e.g. SBIN226100012345" data-testid="statement-utr-input" className="font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button data-testid="statement-paid-confirm" disabled={!date || utr.trim().length < 4 || pay.isPending} onClick={() => pay.mutate({ paid_date: date, utr: utr.trim() })}>
            <CheckCircle2 className="size-4" /> Mark paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatementView({ s }: { s: CommissionStatement }) {
  return (
    <div data-testid="statement-view" className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-heading text-lg font-semibold">{s.number} · {s.agent_name} <span className="font-mono text-sm text-muted-foreground">{s.agent_code}</span></div>
          <div className="text-xs text-muted-foreground">{s.period_type} · {s.from_date} → {s.to_date}</div>
        </div>
        <div className="flex gap-2">
          <a href={`/api/statements/${s.id}/pdf`} data-testid="statement-view-pdf"><Button size="sm" variant="outline"><FileDown className="size-4" /> PDF</Button></a>
          <a href={`/api/statements/${s.id}/excel`} data-testid="statement-view-excel"><Button size="sm" variant="outline"><FileSpreadsheet className="size-4" /> Excel</Button></a>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[["Commission earned", s.total_payable, "text-sky-300", "earned"], ["Outstanding deducted", s.outstanding_deducted, "text-amber-300", "deducted"],
          ["Balance outstanding", s.outstanding_balance, "text-red-300", "balance"], ["Net payable", s.net_payable, "text-teal-300", "net"]].map(([l, v, tone, id]) => (
          <div key={id as string} className="rounded-md border border-border px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{l}</div>
            <div data-testid={`statement-${id}`} className={cn("font-mono text-lg font-semibold tabular", tone as string)}>{money(v as number)}</div>
          </div>
        ))}
      </div>
      <div>
        <p className="label-caps mb-1.5">A. Commission earned ({s.lines.length})</p>
        <Table data-testid="statement-lines">
          <TableHeader><TableRow><TableHead>Policy no</TableHead><TableHead>Reg no</TableHead><TableHead>Insured</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Net premium</TableHead><TableHead className="text-right">Commission</TableHead></TableRow></TableHeader>
          <TableBody>
            {s.lines.map((l) => (
              <TableRow key={l.policy_id}><TableCell className="font-mono text-xs">{l.policy_number}</TableCell><TableCell className="font-mono text-xs">{l.reg_no}</TableCell><TableCell>{l.insured_name}</TableCell><TableCell className="text-xs">{l.product}</TableCell><TableCell className="text-right font-mono">{money(l.net_premium)}</TableCell><TableCell className="text-right font-mono text-sky-300">{money(l.payable)}</TableCell></TableRow>
            ))}
            {s.lines.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground">No commission in this period</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <div>
        <p className="label-caps mb-1.5">B. Premium outstanding deducted ({s.outstanding_lines.length})</p>
        <Table data-testid="statement-outstanding-lines">
          <TableHeader><TableRow><TableHead>Policy no</TableHead><TableHead>Reg no</TableHead><TableHead>Insured</TableHead><TableHead>Mode</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Deducted</TableHead></TableRow></TableHeader>
          <TableBody>
            {s.outstanding_lines.map((o) => (
              <TableRow key={o.policy_id}><TableCell className="font-mono text-xs">{o.policy_number}</TableCell><TableCell className="font-mono text-xs">{o.reg_no}</TableCell><TableCell>{o.insured_name}</TableCell><TableCell className="text-xs">{o.payment_mode}</TableCell><TableCell className="text-right font-mono">{money(o.outstanding)}</TableCell><TableCell className="text-right font-mono text-amber-300">{money(o.deducted)}</TableCell></TableRow>
            ))}
            {s.outstanding_lines.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground">No premium outstanding</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function Statements() {
  const me = useOutletContext<User>();
  const qc = useQueryClient();
  const isAdmin = me.role === "admin";
  const list = useQuery({ queryKey: ["statements"], queryFn: () => apiGet<CommissionStatement[]>("/statements") });
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState<CommissionStatement | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/statements/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["statements"] }); qc.invalidateQueries({ queryKey: ["policies"] }); toast.success("Statement deleted — policies released"); setOpen(null); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rows = list.data ?? [];
  const current = rows.find((s) => s.id === open);

  return (
    <div className="space-y-5 animate-rise">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Commission statements</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin ? "Generate daily, weekly or monthly statements per agent, download PDF / Excel and mark them paid with UTR." : "Your commission statements — download PDF or Excel."}
        </p>
      </div>
      {isAdmin && <GenerateCard onCreated={(s) => setOpen(s.id)} />}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Statement</TableHead><TableHead>Agent</TableHead><TableHead>Period</TableHead>
              <TableHead className="text-right">Commission</TableHead><TableHead className="text-right">Deducted</TableHead><TableHead className="text-right">Net payable</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody data-testid="statements-table">
            {rows.map((s) => (
              <TableRow key={s.id} data-testid={`statement-row-${s.number}`} className={cn("cursor-pointer", open === s.id && "bg-sky-500/10")} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <TableCell className="font-mono text-xs">{s.number}</TableCell>
                <TableCell>{s.agent_name} <span className="font-mono text-xs text-muted-foreground">{s.agent_code}</span></TableCell>
                <TableCell className="text-xs">{s.period_type} · {s.from_date} → {s.to_date}</TableCell>
                <TableCell className="text-right font-mono">{money(s.total_payable)}</TableCell>
                <TableCell className="text-right font-mono text-amber-300">{money(s.outstanding_deducted)}</TableCell>
                <TableCell className="text-right font-mono font-semibold text-teal-300">{money(s.net_payable)}</TableCell>
                <TableCell>
                  {s.status === "paid" ? (
                    <Badge data-testid={`statement-status-${s.number}`} className="bg-emerald-500/15 text-emerald-300">Paid {s.paid_date} · {s.utr}</Badge>
                  ) : (
                    <Badge data-testid={`statement-status-${s.number}`} variant="outline" className="text-amber-300">Pending payment</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <a href={`/api/statements/${s.id}/pdf`} data-testid={`statement-pdf-${s.number}`}><Button size="icon-sm" variant="ghost" aria-label="Download PDF"><FileDown className="size-4" /></Button></a>
                    <a href={`/api/statements/${s.id}/excel`} data-testid={`statement-excel-${s.number}`}><Button size="icon-sm" variant="ghost" aria-label="Download Excel"><FileSpreadsheet className="size-4" /></Button></a>
                    {isAdmin && s.status !== "paid" && (
                      <>
                        <Button size="sm" data-testid={`statement-mark-paid-${s.number}`} onClick={() => setPaying(s)}><CheckCircle2 className="size-3.5" /> Mark paid</Button>
                        <Button size="icon-sm" variant="ghost" aria-label="Delete statement" data-testid={`statement-delete-${s.number}`} onClick={() => window.confirm(`Delete ${s.number}?`) && del.mutate(s.id)}><Trash2 className="size-3.5" /></Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!list.isLoading && rows.length === 0 && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No statements yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {current && <StatementView s={current} />}
      {paying && <PaidDialog s={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}
