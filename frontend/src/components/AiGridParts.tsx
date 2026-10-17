import { AlertTriangle, ArrowDownToLine, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ComboBox, MultiSelect } from "@/components/MultiSelect";
import { SimpleSelect } from "@/components/SimpleSelect";
import { COVER_OPTS, NCB_OPTS } from "@/lib/ruleShows";
import { BULK, FILLABLE, applies, coverValue, ncbValue, rowType, LIST_ALL, isList, modelsFor, optionsFor, plural, split } from "@/lib/aiGrid";
import type { BulkKey, Col, KeyedRow } from "@/lib/aiGrid";
import type { AiGridRow, CommissionMasters, GridRowPreview } from "@/lib/types";
import { cn } from "@/lib/utils";

type CellProps = {
  row: KeyedRow; i: number; c: Col; masters: CommissionMasters | undefined; ptypes: string[];
  onValue: (k: keyof AiGridRow, v: string | null) => void; onText: (c: Col, v: string) => void; onFill: (k: keyof AiGridRow) => void;
};

/** One cell of the check screen: dropdown for list / model / product type columns, plain input otherwise, plus a fill-down button. */
export function AiGridCell({ row, i, c, masters, ptypes, onValue, onText, onFill }: CellProps) {
  const tid = `grid-ai-cell-${i}-${c.key}`;
  if (!applies(rowType(masters, row), c.key)) {
    return <td className="px-0.5 py-1"><span data-testid={`${tid}-na`} title="Not used for this product type (same as the New rule form)" className={cn("block px-1.5 text-[11px] text-muted-foreground/70", c.w)}>n/a</span></td>;
  }
  let field;
  if (isList(c.key)) {
    const k = c.key;
    field = <MultiSelect value={split(row[k])} onChange={(v) => onValue(k, v.join(", "))} options={optionsFor(masters, row, k)} placeholder={LIST_ALL[k]} testId={tid} className={cn("min-h-7 py-0.5 text-xs", c.w)} />;
  } else if (c.key === "model") {
    field = <div className={c.w}><ComboBox value={row.model ?? ""} onChange={(v) => onValue("model", v)} options={modelsFor(masters, row)} placeholder="All models" testId={tid} addLabel="Use model" /></div>;
  } else if (c.key === "ptype") {
    const opts = [...new Set([...ptypes, ...(row.ptype ? [row.ptype] : [])])].map((p) => ({ value: p, label: p }));
    field = <SimpleSelect value={row.ptype ?? ""} onChange={(v) => onValue("ptype", v)} allLabel="All product types" placeholder="Product type" testId={tid} className="h-7 w-36 text-xs" options={opts} />;
  } else if (c.key === "cover" || c.key === "ncb") {
    const [value, opts] = c.key === "cover" ? [coverValue(row.cover), COVER_OPTS] : [ncbValue(row.ncb), NCB_OPTS];
    field = <SimpleSelect value={value} onChange={(v) => onValue(c.key, v)} placeholder={c.label} testId={tid} className={cn("h-7 text-xs", c.w)} options={opts} />;
  } else {
    const type = c.num ? "number" : c.key === "valid_from" || c.key === "valid_to" ? "date" : "text";
    field = <Input value={(row[c.key] as string | number | null) ?? ""} type={type} data-testid={tid} onChange={(e) => onText(c, e.target.value)} className={cn("h-7 px-1.5 text-xs", c.w, c.num && "text-right font-mono")} />;
  }
  return (
    <td className="group/cell relative px-0.5 py-1">
      {FILLABLE.has(c.key) && (
        <button type="button" title={`Fill down: copy this ${c.label} to every ticked row`} aria-label={`Fill down ${c.label} from row ${i + 1}`}
          data-testid={`grid-ai-fill-${i}-${c.key}`} onClick={() => onFill(c.key)}
          className="absolute -top-1 right-0 z-10 hidden rounded bg-primary p-0.5 text-primary-foreground shadow transition-transform duration-100 hover:scale-110 group-hover/cell:block group-focus-within/cell:block">
          <ArrowDownToLine className="size-3" />
        </button>
      )}
      {field}
    </td>
  );
}

/** Check column: AI's "needs review" note and the result of the last Check. */
export function AiGridCheckCell({ row, i, res, today }: { row: AiGridRow; i: number; res?: GridRowPreview; today?: string }) {
  const ok = res && res.action !== "error";
  const ended = !!today && !!row.valid_to && row.valid_to < today;
  return (
    <td className="min-w-44 px-2 py-1.5" data-testid={`grid-ai-check-${i}`}>
      {row.needs_review && <div className="flex items-start gap-1 text-amber-300"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> {row.review_note ?? "Needs review"}</div>}
      {ended && (
        <div data-testid={`grid-ai-ended-${i}`} className="flex items-start gap-1 text-red-300">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> To date {row.valid_to} has passed — this rule won't apply to new policies or show in Partner-wise payables / Rate matrix / Compare. Clear the To date to keep it current.
        </div>
      )}
      {res?.action === "error" && <div className="text-red-300">{res.error}</div>}
      {ok && <div className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="size-3" /> {res.action === "create" ? "new rule" : res.action === "update" ? "updates a rule" : "already in grid"}</div>}
    </td>
  );
}

/** Bulk edit bar: set make / fuel / business on every ticked row at once (empty pickers leave rows unchanged). */
export function AiGridBulkBar({ ticked, value, onChange, options, onApply }: {
  ticked: number; value: Record<BulkKey, string[]>; onChange: (v: Record<BulkKey, string[]>) => void; options: (k: BulkKey) => string[]; onApply: () => void;
}) {
  const any = BULK.some((b) => value[b.key].length > 0);
  return (
    <div data-testid="grid-ai-bulk-bar" className="flex flex-wrap items-end gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <div className="mr-1 text-xs">
        <div className="font-semibold text-foreground">Bulk edit</div>
        <div className="text-muted-foreground" data-testid="grid-ai-bulk-count">{plural(ticked, "ticked row")}</div>
      </div>
      {BULK.map((b) => (
        <label key={b.key} className="w-52 space-y-0.5 text-[11px] text-muted-foreground">
          <span>{b.label}</span>
          <MultiSelect value={value[b.key]} onChange={(v) => onChange({ ...value, [b.key]: v })} options={options(b.key)} placeholder="Leave unchanged"
            testId={`grid-ai-bulk-${b.key}`} className="min-h-8 bg-card py-0.5 text-xs" />
        </label>
      ))}
      <Button size="sm" onClick={onApply} disabled={!any || !ticked} data-testid="grid-ai-bulk-apply">Apply to {plural(ticked, "ticked row")}</Button>
    </div>
  );
}
