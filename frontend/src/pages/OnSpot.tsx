import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Landmark, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ONSPOT_LABEL, ONSPOT_TONE } from "@/components/OnSpotProof";
import { apiGet, apiPut } from "@/lib/api";
import { errorMessage, fmtDate, money } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { OnSpotCheckIn, OnSpotRow, OnSpotStatus, Policy } from "@/lib/types";

const TABS: { id: string; label: string }[] = [
  { id: "pending", label: "Pending bank check" },
  { id: "not_received", label: "Not received" },
  { id: "confirmed", label: "Confirmed" },
  { id: "", label: "All" },
];

export default function OnSpot() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("pending");
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ["onspot", tab], queryFn: () => apiGet<OnSpotRow[]>(`/onspot${tab ? `?status=${tab}` : ""}`) });
  const check = useMutation({
    mutationFn: (m: { id: string; status: OnSpotStatus }) => apiPut<Policy>(`/policies/${m.id}/onspot-check`, { status: m.status, note: notes[m.id] || null } satisfies OnSpotCheckIn),
    onSuccess: (_p, m) => {
      qc.invalidateQueries({ queryKey: ["onspot"] });
      qc.invalidateQueries({ queryKey: ["policy", m.id] });
      toast.success(ONSPOT_LABEL[m.status]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = (list.data ?? []).filter((r) => !q || `${r.reference ?? ""} ${r.policy_number ?? ""} ${r.insured_name ?? ""} ${r.agent_name} ${r.agent_code} ${r.reg_no ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const expected = rows.reduce((s, r) => s + (r.expected_amount ?? 0), 0);

  return (
    <div className="space-y-5 animate-rise">
      <div>
        <h2 className="flex items-center gap-2 font-heading text-2xl font-bold tracking-tight" data-testid="onspot-title"><Landmark className="size-6 text-emerald-300" /> On-Spot bank check</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          On-Spot (Net of Commission) cases. Match each UTR / screenshot with your bank statement for the expected amount (premium − agent commission), then mark it confirmed or not received.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {TABS.map((t) => (
            <button key={t.id || "all"} type="button" data-testid={`onspot-tab-${t.id || "all"}`} onClick={() => setTab(t.id)}
              className={cn("rounded-md px-3 py-1.5 text-sm transition-colors duration-150", tab === t.id ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span data-testid="onspot-total" className="text-xs text-muted-foreground">{rows.length} cases · expected in bank <b className="font-mono text-foreground">{money(expected)}</b></span>
          <Input data-testid="onspot-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search UTR, policy, agent…" className="w-60" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Policy</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead className="text-right">Premium</TableHead>
              <TableHead className="text-right">Commission</TableHead>
              <TableHead className="text-right">Expected in bank</TableHead>
              <TableHead>UTR / proof</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Bank check</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody data-testid="onspot-table">
            {rows.map((r) => (
              <TableRow key={r.policy_id} data-testid={`onspot-row-${r.policy_id}`} className="align-top">
                <TableCell className="whitespace-normal">
                  <div className="font-medium">{r.policy_number ?? "OCR pending"}</div>
                  <div className="text-[11px] text-muted-foreground">{[r.insured_name, r.reg_no, r.insurer].filter(Boolean).join(" · ")}</div>
                  <div className="text-[11px] text-muted-foreground">Uploaded {fmtDate(r.uploaded_at)}</div>
                </TableCell>
                <TableCell className="text-sm">{r.agent_name}<div className="font-mono text-[11px] text-muted-foreground">{r.agent_code}</div></TableCell>
                <TableCell className="text-right font-mono text-sm">{r.gross_premium != null ? money(r.gross_premium) : "—"}</TableCell>
                <TableCell className="text-right font-mono text-sm text-amber-300">{r.commission != null ? `− ${money(r.commission)}` : "—"}</TableCell>
                <TableCell data-testid={`onspot-expected-${r.policy_id}`} className="text-right font-mono text-base font-bold text-emerald-300">{r.expected_amount != null ? money(r.expected_amount) : "—"}</TableCell>
                <TableCell className="text-sm">
                  <div data-testid={`onspot-ref-${r.policy_id}`} className="font-mono font-semibold">{r.reference ?? <span className="text-red-300">No UTR</span>}</div>
                  {r.has_proof && (
                    <a href={`/api/policies/${r.policy_id}/onspot-proof`} target="_blank" rel="noreferrer" data-testid={`onspot-proof-${r.policy_id}`} className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline">
                      Screenshot <ExternalLink className="size-3" />
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  <span data-testid={`onspot-status-${r.policy_id}`} className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", ONSPOT_TONE[r.status])}>{ONSPOT_LABEL[r.status]}</span>
                  {r.checked_by_name && <div className="mt-1 text-[10px] text-muted-foreground">{r.checked_by_name}{r.note ? ` · ${r.note}` : ""}</div>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    <Input data-testid={`onspot-note-${r.policy_id}`} placeholder="Note (optional)" value={notes[r.policy_id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.policy_id]: e.target.value }))} className="h-7 w-40 text-xs" />
                    <div className="flex gap-1">
                      {r.status !== "confirmed" && (
                        <Button size="sm" className="h-7 bg-emerald-600 text-xs hover:bg-emerald-500" data-testid={`onspot-confirm-${r.policy_id}`} disabled={check.isPending} onClick={() => check.mutate({ id: r.policy_id, status: "confirmed" })}>
                          <CheckCircle2 className="size-3.5" /> Received
                        </Button>
                      )}
                      {r.status !== "not_received" && (
                        <Button size="sm" variant="outline" className="h-7 border-red-500/40 text-xs text-red-300" data-testid={`onspot-reject-${r.policy_id}`} disabled={check.isPending} onClick={() => check.mutate({ id: r.policy_id, status: "not_received" })}>
                          <XCircle className="size-3.5" /> Not received
                        </Button>
                      )}
                      {r.status !== "pending" && (
                        <Button size="icon-sm" variant="ghost" aria-label="Back to pending" data-testid={`onspot-reset-${r.policy_id}`} onClick={() => check.mutate({ id: r.policy_id, status: "pending" })}>
                          <RotateCcw className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!list.isLoading && rows.length === 0 && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No On-Spot cases here.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
