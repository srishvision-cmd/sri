import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookMarked, ListChecks, Save, Sparkles } from "lucide-react";
import { TEMPLATES_KEY, useGridTemplates } from "@/components/GridTemplates";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiPost, apiUpload } from "@/lib/api";
import { useBrokers } from "@/lib/auth";
import { SimpleSelect } from "@/components/SimpleSelect";
import { AiGridBulkBar, AiGridCell, AiGridCheckCell } from "@/components/AiGridParts";
import { AiDeclinedSection } from "@/components/AiDeclinedSection";
import { useCommissionMasters } from "@/components/RuleDialog";
import { BULK, COLS, EMPTY_BULK, cleanRow, optionsFor, plural, stripKey, withKeys } from "@/lib/aiGrid";
import type { BulkKey, Col, KeyedRow } from "@/lib/aiGrid";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { AiGridApplyIn, AiGridRead, AiGridRow, GridUploadResult, RuleKind } from "@/lib/types";

/** Editable AI rows + ticks, and the row-level edits (cell, fill down, bulk). Any edit clears the last Check result. */
function useAiRows(onEdit: () => void) {
  const [rows, setRows] = useState<KeyedRow[]>([]);
  const [original, setOriginal] = useState<Record<string, AiGridRow>>({}); // AI's own reading, by row key
  const [picked, setPicked] = useState<boolean[]>([]);
  const ticked = rows.filter((_, j) => picked[j]);
  const patchRows = (fn: (r: KeyedRow, j: number) => KeyedRow) => { onEdit(); setRows((rs) => rs.map(fn)); };
  return {
    rows, picked, ticked,
    originalOf: (r: KeyedRow) => original[r._key] ?? stripKey(r),
    load: (rs: AiGridRow[]) => {
      const keyed = withKeys(rs);
      setRows(keyed); setOriginal(Object.fromEntries(keyed.map((r) => [r._key, stripKey(r)]))); setPicked(rs.map((x) => !x.needs_review));
    },
    tick: (i: number, v: boolean) => { onEdit(); setPicked((p) => p.map((x, j) => (j === i ? v : x))); },
    tickAll: (v: boolean) => { onEdit(); setPicked(rows.map(() => v)); },
    setVal: (i: number, k: keyof AiGridRow, v: string | null) =>
      patchRows((r, j) => (j === i ? { ...r, [k]: v || null, ...(k === "makes" && !v ? { model: null } : {}) } : r)),
    setText: (i: number, c: Col, v: string) => patchRows((r, j) => (j === i ? { ...r, [c.key]: v === "" ? null : c.num ? Number(v) : v } : r)),
    /** Copy row i's value of one column to every other ticked row (copying makes also carries the model). */
    fillDown: (i: number, k: keyof AiGridRow) => {
      const src = rows[i];
      const n = rows.filter((_, j) => picked[j] && j !== i).length;
      if (!n) return toast.error("Tick the rows to fill first");
      patchRows((r, j) => (picked[j] && j !== i ? { ...r, [k]: src[k], ...(k === "makes" ? { model: src.model } : {}) } : r));
      toast.success(`${COLS.find((c) => c.key === k)?.label ?? k} copied to ${plural(n, "ticked row")}`);
    },
    /** Set the chosen make / fuel / business on every ticked row (empty pickers are not touched). */
    bulkSet: (bulk: Record<BulkKey, string[]>) => {
      if (!ticked.length) return toast.error("Tick the rows to update first") && false;
      const set = BULK.filter((b) => bulk[b.key].length > 0);
      const patch: Partial<AiGridRow> = Object.fromEntries(set.map((b) => [b.key, bulk[b.key].join(", ")]));
      if (patch.makes) patch.model = null; // a model belongs to the old make
      patchRows((r, j) => (picked[j] ? { ...r, ...patch } : r));
      toast.success(`${set.map((b) => b.label).join(", ")} set on ${plural(ticked.length, "ticked row")}`);
      return true;
    },
  };
}

/** Upload any grid (Excel / PDF / image) → AI reads it → edit / untick rows → Check → Approve & save. */
export function AiGridUpload({ kind }: { kind: RuleKind }) {
  const qc = useQueryClient();
  const [read, setRead] = useState<AiGridRead | null>(null);
  const [result, setResult] = useState<GridUploadResult | null>(null);
  const [partner, setPartner] = useState("");
  const [company, setCompany] = useState("");
  const [bulk, setBulk] = useState(EMPTY_BULK);
  const brokers = useBrokers();
  const m = useCommissionMasters().data;
  const ptypes = Object.keys(m?.product_types ?? {});
  const g = useAiRows(() => setResult(null));
  const layouts = new Set((useGridTemplates().data ?? []).filter((t) => t.kind === kind).map((t) => t.insurer));

  const ai = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); return apiUpload<AiGridRead>(`/commission/grid/ai-read?kind=${kind}&broker_id=${encodeURIComponent(partner)}&insurer=${encodeURIComponent(company)}`, fd); },
    onSuccess: (r) => { setRead(r); g.load(r.rows); setResult(null); setBulk(EMPTY_BULK); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const apply = useMutation({
    mutationFn: (preview: boolean) => apiPost<GridUploadResult>("/commission/grid/ai-apply", {
      rows: g.ticked.map((r) => cleanRow(m, stripKey(r))), preview, valid_from: null, valid_to: null, original_rows: g.ticked.map(g.originalOf),
      template_insurer: company || read?.template_insurer || null, file_name: read?.file_name ?? null, used_layout: !!read?.template_insurer,
    } satisfies AiGridApplyIn),
    onSuccess: (res) => {
      setResult(res);
      if (!res.preview) {
        qc.invalidateQueries({ queryKey: ["commission-rules"] });
        qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
        toast.success(`Saved: ${res.created} new, ${res.updated} updated${res.learned_insurer ? ` · layout remembered for ${res.learned_insurer}` : ""}${res.learned_accuracy != null ? ` · AI accuracy ${res.learned_accuracy}%` : ""}`);
        setRead(null);
      } else if (res.errors.length) toast.error(`${plural(res.errors.length)} need fixing`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const resFor = (i: number) => {
    const n = g.rows.slice(0, i + 1).filter((_, j) => g.picked[j]).length; // row numbers count only ticked rows
    return g.picked[i] ? result?.rows.find((r) => r.row === n) : undefined;
  };
  const bulkOptions = (k: BulkKey) => [...new Set((g.ticked.length ? g.ticked : g.rows).flatMap((r) => optionsFor(m, { ...r, [k]: null }, k)))].sort();
  const review = g.rows.filter((r) => r.needs_review).length;

  return (
    <>
      <SimpleSelect value={partner} onChange={setPartner} allLabel="Partner as in the file" placeholder="Channel partner" testId={`${kind}-grid-ai-partner-select`} className="min-w-44"
        options={(brokers.data ?? []).map((b) => ({ value: b.id, label: b.name }))} />
      <SimpleSelect value={company} onChange={setCompany} allLabel="Company as in the file" placeholder="Company" testId={`${kind}-grid-ai-company-select`} className="min-w-44"
        options={(m?.insurers ?? []).map((n) => ({ value: n, label: `${n}${layouts.has(n) ? " · saved layout" : ""}` }))} />
      <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15", ai.isPending && "pointer-events-none opacity-60")}
        title="Excel, PDF or image of a commission grid — AI reads it and you approve every rule">
        <Sparkles className="size-3.5" /> {ai.isPending ? "AI reading… (up to 2 min)" : "AI read Excel / PDF / image"}
        <input type="file" accept=".xlsx,.xlsm,.pdf,.png,.jpg,.jpeg,.webp" className="hidden" data-testid={`${kind}-grid-ai-input`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) ai.mutate(f); e.target.value = ""; }} />
      </label>
      <Dialog open={!!read} onOpenChange={(o) => !o && !apply.isPending && setRead(null)}>
        <DialogContent data-testid="grid-ai-dialog" className="max-h-[94vh] overflow-y-auto sm:max-w-[95vw]">
          <DialogHeader>
            <DialogTitle className="font-heading">AI found {plural(g.rows.length, "rule")} in {read?.file_name}</DialogTitle>
            <DialogDescription>
              {read?.template_insurer ? (
                <span data-testid="grid-ai-template-used" className="mb-1 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                  <BookMarked className="size-3" /> Read with the saved {read.template_insurer} layout (learned from {plural(read.template_uses, "approved upload")})
                </span>
              ) : (
                <span data-testid="grid-ai-template-none" className="mb-1 block text-muted-foreground">No saved layout for this company yet — approving these rows teaches the AI for next time.</span>
              )}
              {read?.note && <span className="block text-foreground">{read.note}</span>}
              Check each row against the file and edit any cell — leave a dropdown empty for “All”, hover a cell and click ↓ to copy it to every ticked row, From / To dates are optional (blank = no date limit). Only ticked rows are saved.{" "}
              {review > 0 && <span className="text-amber-300">{review} row{review === 1 ? " is" : "s are"} marked “needs review” (amber) and left unticked.</span>}
            </DialogDescription>
          </DialogHeader>
          <AiGridBulkBar ticked={g.ticked.length} value={bulk} onChange={setBulk} options={bulkOptions} onApply={() => g.bulkSet(bulk) && setBulk(EMPTY_BULK)} />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table data-testid="grid-ai-table" className="text-xs">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5"><Checkbox aria-label="Tick all" data-testid="grid-ai-tick-all" checked={g.picked.length > 0 && g.picked.every(Boolean)} onCheckedChange={(v) => g.tickAll(!!v)} /></th>
                  {COLS.map((c) => <th key={c.key} className="whitespace-nowrap px-1 py-1.5">{c.label}</th>)}
                  <th className="px-2 py-1.5">Check</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={r._key} data-testid={`grid-ai-row-${i}`} className={cn("border-t border-border/60 align-top", r.needs_review && "bg-amber-500/10", !g.picked[i] && "opacity-70")}>
                    <td className="px-2 py-1.5">
                      <Checkbox aria-label={`Tick row ${i + 1}`} data-testid={`grid-ai-tick-${i}`} checked={!!g.picked[i]} onCheckedChange={(v) => g.tick(i, !!v)} />
                    </td>
                    {COLS.map((c) => (
                      <AiGridCell key={c.key} row={r} i={i} c={c} masters={m} ptypes={ptypes}
                        onValue={(k, v) => g.setVal(i, k, v)} onText={(col, v) => g.setText(i, col, v)} onFill={(k) => g.fillDown(i, k)} />
                    ))}
                    <AiGridCheckCell row={r} i={i} res={resFor(i)} today={read?.today} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {read && read.declined.length > 0 && <AiDeclinedSection key={read.file_name} rows={read.declined} masters={m} />}
          {result && (
            <p data-testid="grid-ai-summary" className={cn("text-sm", result.errors.length ? "text-red-300" : "text-emerald-300")}>
              {result.created} new · {result.updated} updated · {result.unchanged} unchanged{result.errors.length ? ` · ${result.errors.length} with problems — fix or untick them` : " — ready to save"}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRead(null)} data-testid="grid-ai-cancel">Cancel</Button>
            <Button variant="outline" disabled={!g.ticked.length || apply.isPending} onClick={() => apply.mutate(true)} data-testid="grid-ai-check"><ListChecks className="size-4" /> Check {g.ticked.length} rows</Button>
            <Button disabled={!result?.preview || result.errors.length > 0 || apply.isPending} onClick={() => apply.mutate(false)} data-testid="grid-ai-save"><Save className="size-4" /> Approve & save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
