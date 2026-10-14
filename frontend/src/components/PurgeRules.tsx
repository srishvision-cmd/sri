import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eraser, FileDown, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { PurgeApplyIn, PurgeBatch, PurgeIn, PurgePreview, PurgeResult, RestoreResult, RuleKind } from "@/lib/types";

const BATCHES_KEY = ["purge-batches"];

/** Undo delete: every deleted batch can be put back exactly as it was, in one click. */
function DeletedBatches() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: BATCHES_KEY, queryFn: () => apiGet<PurgeBatch[]>("/commission/rules/purge/batches") });
  const restore = useMutation({
    mutationFn: (id: string) => apiPost<RestoreResult>(`/commission/rules/purge/batches/${id}/restore`),
    onSuccess: (r) => {
      ["commission-rules", "missing-payables"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: BATCHES_KEY });
      toast.success(`Restored ${r.restored} rules${r.skipped ? ` · ${r.skipped} already existed` : ""}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = q.data ?? [];
  if (!list.length) return null;
  return (
    <div className="space-y-1.5 border-t border-border pt-3 text-xs" data-testid="purge-batches">
      <p className="font-medium text-foreground">Deleted batches — undo</p>
      {list.slice(0, 8).map((b) => (
        <div key={b.id} className="flex flex-wrap items-center gap-2 rounded bg-muted/40 px-2 py-1.5" data-testid={`purge-batch-${b.id}`}>
          <span><b>{b.count}</b> rules · {b.date_from} → {b.date_to} · {b.kinds.join(" + ")}</span>
          <span className="text-muted-foreground">deleted by {b.by_name} {new Date(b.at).toLocaleString("en-IN")}</span>
          {b.restored ? (
            <span className="ml-auto text-emerald-300" data-testid={`purge-batch-restored-${b.id}`}>Restored by {b.restored_by_name}</span>
          ) : (
            <Button size="sm" variant="outline" className="ml-auto h-7" disabled={restore.isPending}
              onClick={() => window.confirm(`Restore ${b.count} deleted rules exactly as they were?`) && restore.mutate(b.id)} data-testid={`purge-batch-restore-${b.id}`}>
              <Undo2 className="size-3.5" /> Undo delete
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Admin: delete the receivable / payable rules created or edited in a date range (preview → Excel backup → confirm). */
export function PurgeRulesButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("2026-10-01");
  const [to, setTo] = useState("2026-10-12");
  const [kinds, setKinds] = useState<RuleKind[]>(["receivable", "payable"]);
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim().toUpperCase() === "DELETE"; // "delete" / " Delete " also accepted
  const body: PurgeIn = { date_from: from, date_to: to, kinds };
  const preview = useMutation({ mutationFn: () => apiPost<PurgePreview>("/commission/rules/purge/preview", body), onError: (e) => toast.error(errorMessage(e)) });
  const purge = useMutation({
    mutationFn: () => apiPost<PurgeResult>("/commission/rules/purge", { ...body, confirm_count: preview.data?.count ?? 0 } satisfies PurgeApplyIn),
    onSuccess: (r) => {
      toast.success(`Deleted ${r.deleted} rules (${r.receivable} receivable, ${r.payable} payable). Policies keep their saved commission.`);
      qc.invalidateQueries({ queryKey: ["commission-rules"] });
      qc.invalidateQueries({ queryKey: ["missing-payables"] });
      qc.invalidateQueries({ queryKey: BATCHES_KEY });
      setOpen(false); preview.reset(); setTyped("");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const p = preview.data;
  const toggle = (k: RuleKind, v: boolean) => { preview.reset(); setKinds((ks) => (v ? [...new Set([...ks, k])] : ks.filter((x) => x !== k))); };
  const qs = `date_from=${from}&date_to=${to}${kinds.map((k) => `&kinds=${k}`).join("")}`;

  return (
    <>
      <Button size="sm" variant="outline" className="h-8 text-red-300" onClick={() => setOpen(true)} data-testid="purge-rules-button" title="Delete rules created / edited in a date range">
        <Eraser className="size-3.5" /> Delete rules by date
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { preview.reset(); setTyped(""); } }}>
        <DialogContent data-testid="purge-rules-dialog" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading">Delete grid rules by date</DialogTitle>
            <DialogDescription>
              Removes the receivable / payable rules created or edited between these dates (India time) so a fresh grid can be uploaded. Policies keep
              their saved commission — no policy, statement, payment or receivable amount changes. Agent groups, group margins and RTO groups are kept.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="space-y-1"><span className="text-xs text-muted-foreground">From</span>
              <Input type="date" value={from} onChange={(e) => { preview.reset(); setFrom(e.target.value); }} className="h-8 w-40" data-testid="purge-from" /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">To</span>
              <Input type="date" value={to} onChange={(e) => { preview.reset(); setTo(e.target.value); }} className="h-8 w-40" data-testid="purge-to" /></label>
            {(["receivable", "payable"] as const).map((k) => (
              <label key={k} className="flex h-8 items-center gap-1.5 capitalize">
                <Checkbox checked={kinds.includes(k)} onCheckedChange={(v) => toggle(k, !!v)} data-testid={`purge-kind-${k}`} /> {k}
              </label>
            ))}
            <Button size="sm" variant="outline" disabled={!from || !to || !kinds.length || preview.isPending} onClick={() => preview.mutate()} data-testid="purge-preview-button">
              Find rules
            </Button>
          </div>
          {preview.isError && <p className="text-sm text-red-300" data-testid="purge-preview-error">{errorMessage(preview.error)}</p>}
          {p && p.count === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="purge-none">No rules were created or edited in these dates (India time). Check the From / To dates and the Receivable / Payable ticks.</p>
          )}
          {p && (
            <div className="space-y-2 text-sm" data-testid="purge-preview">
              <p data-testid="purge-count"><b>{p.count}</b> rules match — {p.receivable} receivable, {p.payable} payable.
                {p.policies_snapshotted > 0 && <span className="text-muted-foreground"> {p.policies_snapshotted} policies used these rules; their saved commission stays as it is.</span>}</p>
              {p.count > 0 && (
                <>
                  <ul className="max-h-48 overflow-y-auto rounded-md border border-border text-xs">
                    {p.rules.map((r) => (
                      <li key={r.id} className="flex gap-2 border-b border-border/60 px-2 py-1 last:border-0" data-testid={`purge-rule-${r.id}`}>
                        <span className="w-20 shrink-0 capitalize text-muted-foreground">{r.kind}</span>
                        <span className="truncate">{r.name}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">{new Date(r.updated_at).toLocaleDateString("en-IN")}</span>
                      </li>
                    ))}
                  </ul>
                  <a href={`/api/commission/rules/purge/backup?${qs}`} data-testid="purge-backup-download">
                    <Button size="sm" variant="outline"><FileDown className="size-3.5" /> Download backup (Excel)</Button>
                  </a>
                  <label className="block space-y-1">
                    <span className="text-xs text-muted-foreground">Type <b className="text-foreground">DELETE</b> to confirm</span>
                    <Input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmed && !purge.isPending && purge.mutate()}
                      className="h-8 w-40" data-testid="purge-confirm-input" autoFocus />
                    <span className="block text-[11px] text-muted-foreground" data-testid="purge-confirm-hint">
                      {confirmed ? "Ready — click the red Delete button below (or press Enter)." : "The Delete button unlocks once DELETE is typed."}
                    </span>
                  </label>
                </>
              )}
            </div>
          )}
          <DeletedBatches />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} data-testid="purge-cancel">Cancel</Button>
            <Button variant="destructive" disabled={!p?.count || !confirmed || purge.isPending} onClick={() => purge.mutate()} data-testid="purge-confirm-button">
              <Trash2 className="size-3.5" /> Delete {p?.count ?? 0} rules
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
