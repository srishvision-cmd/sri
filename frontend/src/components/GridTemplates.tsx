import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPut } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { GridTemplate, GridTemplateIn, GridUploadStat } from "@/lib/types";

export const TEMPLATES_KEY = ["grid-templates"];

export function useGridTemplates() {
  return useQuery({ queryKey: TEMPLATES_KEY, queryFn: () => apiGet<GridTemplate[]>("/commission/grid/templates") });
}

const tone = (a: number) => (a >= 95 ? "bg-emerald-400" : a >= 85 ? "bg-amber-400" : "bg-red-400");

/** Accuracy per approved upload (oldest → newest) — shows whether the saved layout is making the AI better. */
function AccuracyTrend({ uploads, id }: { uploads: GridUploadStat[]; id: string }) {
  if (!uploads.length) return null;
  const last = uploads[uploads.length - 1];
  const first = uploads[0];
  const delta = uploads.length > 1 ? Math.round((last.accuracy - first.accuracy) * 10) / 10 : null;
  return (
    <div data-testid={`grid-template-accuracy-${id}`} className="rounded-md border border-border bg-muted/30 p-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">Layout accuracy</span>
        <span className="font-mono text-foreground" data-testid={`grid-template-accuracy-last-${id}`}>{last.accuracy}%</span>
        <span className="text-muted-foreground">last upload · {last.cells_corrected} of {last.cells_checked} cells corrected in {last.rows_corrected}/{last.rows} rows</span>
        {delta != null && (
          <span className={delta >= 0 ? "text-emerald-300" : "text-red-300"} data-testid={`grid-template-accuracy-delta-${id}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts since first upload
          </span>
        )}
      </div>
      <div className="flex h-12 items-end gap-1" aria-label="Accuracy per upload">
        {uploads.map((u, i) => (
          <div key={`${u.at}-${i}`} className="group/bar relative flex h-full w-5 items-end" data-testid={`grid-template-accuracy-bar-${id}-${i}`}>
            <div className={`w-full rounded-t transition-[height] duration-300 ${tone(u.accuracy)}`} style={{ height: `${Math.max(6, u.accuracy)}%` }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow group-hover/bar:block">
              {new Date(u.at).toLocaleDateString("en-IN")} · {u.file ?? "—"} · {u.accuracy}% · {u.cells_corrected} fixes{u.used_layout ? " · with layout" : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplateCard({ t }: { t: GridTemplate }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(t.notes);
  const done = (msg: string) => () => { qc.invalidateQueries({ queryKey: TEMPLATES_KEY }); toast.success(msg); };
  const fail = (err: unknown) => toast.error(errorMessage(err));
  const save = useMutation({ mutationFn: () => apiPut<GridTemplate>(`/commission/grid/templates/${t.id}`, { notes } satisfies GridTemplateIn), onSuccess: done("Layout notes saved"), onError: fail });
  const dropFix = useMutation({ mutationFn: (i: number) => apiDelete<GridTemplate>(`/commission/grid/templates/${t.id}/corrections/${i}`), onSuccess: done("Correction removed"), onError: fail });
  const remove = useMutation({ mutationFn: () => apiDelete<{ ok: boolean }>(`/commission/grid/templates/${t.id}`), onSuccess: done(`Saved layout for ${t.insurer} deleted`), onError: fail });
  return (
    <div data-testid={`grid-template-${t.id}`} className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm text-foreground" data-testid={`grid-template-insurer-${t.id}`}>{t.insurer}</b>
        <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{t.kind}</span>
        <span className="text-muted-foreground">learned from {t.uses} upload{t.uses === 1 ? "" : "s"} · {t.examples.length} example rows · last {t.last_file ?? "—"} by {t.updated_by ?? "—"}</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-red-300" disabled={remove.isPending}
          onClick={() => window.confirm(`Forget the saved layout for ${t.insurer}?`) && remove.mutate()} data-testid={`grid-template-delete-${t.id}`}>
          <Trash2 className="size-3.5" /> Forget
        </Button>
      </div>
      <AccuracyTrend uploads={t.uploads} id={t.id} />
      <label className="block space-y-1">
        <span className="font-medium text-foreground">Instructions for the AI (optional)</span>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid={`grid-template-notes-${t.id}`}
          placeholder="e.g. Use the 'Total' column; GVW slabs are in tonnes; 'Other than New' means 1–15 years" />
      </label>
      <Button size="sm" variant="outline" className="h-7" disabled={notes === t.notes || save.isPending} onClick={() => save.mutate()} data-testid={`grid-template-save-${t.id}`}>Save notes</Button>
      {t.corrections.length > 0 && (
        <div>
          <div className="mb-1 font-medium text-foreground">Learned corrections</div>
          <ul className="space-y-1">
            {t.corrections.map((c, i) => (
              <li key={`${c.field}-${c.ai_value}-${c.approved_value}`} className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1" data-testid={`grid-template-fix-${t.id}-${i}`}>
                <span className="font-mono text-muted-foreground">{c.field}</span>
                <span>“{c.ai_value || "blank"}” → <b className="text-foreground">“{c.approved_value || "blank"}”</b></span>
                <span className="text-muted-foreground">×{c.count}</span>
                <button type="button" aria-label="Remove correction" className="ml-auto rounded p-0.5 hover:bg-red-500/10 hover:text-red-300" onClick={() => dropFix.mutate(i)}
                  data-testid={`grid-template-fix-delete-${t.id}-${i}`}><X className="size-3" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "AI layouts" — the per-company grid layouts the AI has learned from approved uploads. */
export function GridTemplatesButton() {
  const [open, setOpen] = useState(false);
  const q = useGridTemplates();
  const list = q.data ?? [];
  return (
    <>
      <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)} data-testid="grid-templates-button" title="Company grid layouts the AI remembers">
        <BookMarked className="size-3.5" /> AI layouts{list.length ? ` (${list.length})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="grid-templates-dialog" className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-heading">Saved AI grid layouts</DialogTitle>
            <DialogDescription>
              Every time you approve an AI-read grid, the AI remembers that company's layout — the labels you chose and the cells you corrected — and uses it the next time
              that company's grid is uploaded. Pick the company before uploading (or keep its name in the file name).
            </DialogDescription>
          </DialogHeader>
          {list.length === 0 && <p className="text-sm text-muted-foreground" data-testid="grid-templates-empty">No layouts yet — approve an AI-read grid to create one.</p>}
          <div className="space-y-3">{list.map((t) => <TemplateCard key={`${t.id}-${t.updated_at}`} t={t} />)}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
