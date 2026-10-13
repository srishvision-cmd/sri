import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { CheckCircle2, FileDown, FileSpreadsheet, ReceiptText, ShieldCheck, Trash2, XCircle } from "lucide-react";
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
import type { CommissionStatement, PeriodType, StatementDecisionIn, StatementGenerateIn, StatementPaidIn, StatementRejectIn, StatementStatus, User } from "@/lib/types";

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
        <SimpleSelect value={agentId} onChange={setAgentId} placeholder="Select agent" testId="statement-agent-select" className="w-full" searchable
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
        Includes the agent's policies uploaded in the period that are not on an earlier statement. The agent's premium outstanding (Cash / Partial) is deducted from the commission, oldest first, up to the commission earned — anything left stays in Agent Outstanding.
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

const STATUS: Record<StatementStatus, { label: string; cls: string }> = {
  pending_approval: { label: "Pending approval", cls: "border-amber-400/50 text-amber-300" },
  approved: { label: "Approved · awaiting payment", cls: "border-sky-400/50 text-sky-300" },
  rejected: { label: "Rejected", cls: "border-red-400/50 text-red-300" },
  paid: { label: "Paid", cls: "bg-emerald-500/15 text-emerald-300" },
};

function StatusPill({ s }: { s: CommissionStatement }) {
  const st = STATUS[s.status] ?? STATUS.pending_approval;
  return (
    <Badge data-testid={`statement-status-${s.number}`} variant="outline" className={st.cls}>
      {st.label}{s.status === "paid" ? ` ${s.paid_date} · ${s.utr}` : ""}
    </Badge>
  );
}

/** Approve (optional note) or reject (reason required) a pending statement — recorded in its approval log. */
function DecisionDialog({ s, action, onClose }: { s: CommissionStatement; action: "approve" | "reject"; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const go = useMutation({
    mutationFn: () => action === "approve"
      ? apiPost<CommissionStatement>(`/statements/${s.id}/approve`, { note: note.trim() || null } satisfies StatementDecisionIn)
      : apiPost<CommissionStatement>(`/statements/${s.id}/reject`, { note: note.trim() } satisfies StatementRejectIn),
    onSuccess: () => {
      for (const k of ["statements", "policies", "outstanding", "stats"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(action === "approve" ? `${s.number} approved — it can now be paid` : `${s.number} rejected — its policies are released`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const reject = action === "reject";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="statement-decision-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">{reject ? "Reject" : "Approve"} {s.number}</DialogTitle>
          <DialogDescription>
            {s.agent_name} · net payable {money(s.net_payable)} · generated by {s.created_by_name}.{" "}
            {reject ? "The policies are released so a corrected statement can be generated; this statement stays on record as rejected." : "Only approved statements can be shared with the agent and marked paid."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs">{reject ? "Reason (required)" : "Note (optional)"}</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} data-testid="statement-decision-note" placeholder={reject ? "e.g. Policy 0630 commission wrong" : "e.g. Checked with insurer statement"} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button data-testid="statement-decision-confirm" variant={reject ? "destructive" : "default"} disabled={go.isPending || (reject && note.trim().length < 3)} onClick={() => go.mutate()}>
            {reject ? "Reject statement" : "Approve statement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalLog({ s }: { s: CommissionStatement }) {
  if (!s.approval_log?.length) return null;
  return (
    <div data-testid="statement-approval-log">
      <p className="label-caps mb-1.5">Approval log</p>
      <ul className="space-y-1 text-xs">
        {s.approval_log.map((a, i) => (
          <li key={`${a.action}-${a.at}-${i}`} className="flex flex-wrap gap-x-2 rounded bg-muted/40 px-2 py-1" data-testid={`statement-log-${i}`}>
            <b className="capitalize">{a.action}</b><span>by {a.by_name} ({a.by_role})</span>
            <span className="text-muted-foreground">{new Date(a.at).toLocaleString("en-IN")}</span>
            {a.note && <span className="text-muted-foreground">· {a.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatementView({ s }: { s: CommissionStatement }) {
  return (
    <div data-testid="statement-view" className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-heading text-lg font-semibold">{s.number} · {s.agent_name} <span className="font-mono text-sm text-muted-foreground">{s.agent_code}</span></div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{s.period_type} · {s.from_date} → {s.to_date} <StatusPill s={s} />
            {s.approved_by_name && <span data-testid="statement-approved-by">Approved by {s.approved_by_name}{s.approved_at ? ` · ${new Date(s.approved_at).toLocaleString("en-IN")}` : ""}</span>}</div>
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
          <TableHeader><TableRow><TableHead>Policy no</TableHead><TableHead>Reg no</TableHead><TableHead>Insured</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Net premium</TableHead><TableHead>Commission %</TableHead><TableHead className="text-right">Commission</TableHead></TableRow></TableHeader>
          <TableBody>
            {s.lines.map((l) => (
              <TableRow key={l.policy_id}><TableCell className="font-mono text-xs">{l.policy_number}</TableCell><TableCell className="font-mono text-xs">{l.reg_no}</TableCell><TableCell>{l.insured_name}</TableCell><TableCell className="text-xs">{l.product}</TableCell><TableCell className="text-right font-mono">{money(l.net_premium)}</TableCell><TableCell className="font-mono text-xs text-teal-300" data-testid={`statement-line-rate-${l.policy_id}`}>{l.commission_rate ?? "—"}</TableCell><TableCell className="text-right font-mono text-sky-300">{money(l.payable)}</TableCell></TableRow>
            ))}
            {s.lines.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground">No commission in this period</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <ApprovalLog s={s} />
      <div>
        <p className="label-caps mb-1.5">B. Premium outstanding deducted ({s.outstanding_lines.length})</p>
        <Table data-testid="statement-outstanding-lines">
          <TableHeader><TableRow><TableHead>Policy no</TableHead><TableHead>Reg no</TableHead><TableHead>Insured</TableHead><TableHead>Mode</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Deducted</TableHead><TableHead className="text-right">Still outstanding</TableHead></TableRow></TableHeader>
          <TableBody>
            {s.outstanding_lines.map((o) => (
              <TableRow key={o.policy_id}><TableCell className="font-mono text-xs">{o.policy_number}</TableCell><TableCell className="font-mono text-xs">{o.reg_no}</TableCell><TableCell>{o.insured_name}</TableCell><TableCell className="text-xs">{o.payment_mode}</TableCell><TableCell className="text-right font-mono">{money(o.outstanding)}</TableCell><TableCell className="text-right font-mono text-amber-300">{money(o.deducted)}</TableCell><TableCell data-testid={`statement-still-outstanding-${o.policy_id}`} className={`text-right font-mono ${o.outstanding - o.deducted > 0.005 ? "text-red-300" : "text-muted-foreground"}`}>{money(Math.round((o.outstanding - o.deducted) * 100) / 100)}{o.deducted === 0 && <div className="font-sans text-[10px]">commission not enough — still due</div>}</TableCell></TableRow>
            ))}
            {s.outstanding_lines.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground">No premium outstanding</TableCell></TableRow>}
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
  const [deciding, setDeciding] = useState<{ s: CommissionStatement; action: "approve" | "reject" } | null>(null);
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
          {isAdmin ? "Generate statements per agent — each waits in Pending approval until an approver approves it; only approved statements can be marked paid with UTR." : "Your commission statements — download PDF or Excel."}
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
                  <StatusPill s={s} />
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <a href={`/api/statements/${s.id}/pdf`} data-testid={`statement-pdf-${s.number}`}><Button size="icon-sm" variant="ghost" aria-label="Download PDF"><FileDown className="size-4" /></Button></a>
                    <a href={`/api/statements/${s.id}/excel`} data-testid={`statement-excel-${s.number}`}><Button size="icon-sm" variant="ghost" aria-label="Download Excel"><FileSpreadsheet className="size-4" /></Button></a>
                    {isAdmin && s.status === "pending_approval" && (
                      <>
                        <Button size="sm" data-testid={`statement-approve-${s.number}`} onClick={() => setDeciding({ s, action: "approve" })}><ShieldCheck className="size-3.5" /> Approve</Button>
                        <Button size="sm" variant="outline" className="text-red-300" data-testid={`statement-reject-${s.number}`} onClick={() => setDeciding({ s, action: "reject" })}><XCircle className="size-3.5" /> Reject</Button>
                      </>
                    )}
                    {isAdmin && s.status !== "paid" && (
                      <>
                        {s.status === "approved" && <Button size="sm" data-testid={`statement-mark-paid-${s.number}`} onClick={() => setPaying(s)}><CheckCircle2 className="size-3.5" /> Mark paid</Button>}
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
      {deciding && <DecisionDialog s={deciding.s} action={deciding.action} onClose={() => setDeciding(null)} />}
    </div>
  );
}
