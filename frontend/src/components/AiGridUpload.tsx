import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownToLine, CheckCircle2, ListChecks, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiPost, apiUpload } from "@/lib/api";
import { useBrokers } from "@/lib/auth";
import { SimpleSelect } from "@/components/SimpleSelect";
import { ComboBox, MultiSelect } from "@/components/MultiSelect";
import { useCommissionMasters } from "@/components/RuleDialog";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { AiGridApplyIn, AiGridRead, AiGridRow, GridUploadResult, RuleKind } from "@/lib/types";

type Col = { key: keyof AiGridRow; label: string; num?: boolean; w: string };
const COLS: Col[] = [
  { key: "kind", label: "Type", w: "w-24" }, { key: "insurer", label: "Company", w: "w-36" }, { key: "broker", label: "Partner", w: "w-28" },
  { key: "agent_group", label: "Agent group", w: "w-24" }, { key: "ptype", label: "Product type", w: "w-24" }, { key: "products", label: "Products", w: "w-40" },
  { key: "rtos", label: "RTOs", w: "w-32" }, { key: "vehicle_ages", label: "Age", w: "w-44" }, { key: "makes", label: "Makes", w: "w-40" },
  { key: "model", label: "Model", w: "w-36" }, { key: "fuel_types", label: "Fuel", w: "w-32" }, { key: "business_types", label: "Business", w: "w-36" },
  { key: "gvw_min", label: "GVW from", num: true, w: "w-20" }, { key: "gvw_max", label: "GVW to", num: true, w: "w-20" },
  { key: "od_percent", label: "OD %", num: true, w: "w-16" }, { key: "tp_percent", label: "TP %", num: true, w: "w-16" },
  { key: "net_percent", label: "Net %", num: true, w: "w-16" }, { key: "odtp_percent", label: "OD+TP %", num: true, w: "w-16" },
  { key: "flat_amount", label: "Flat ₹", num: true, w: "w-20" }, { key: "valid_from", label: "From (optional)", w: "w-32" }, { key: "valid_to", label: "To (optional)", w: "w-32" },
];

const LIST_KEYS = ["products", "vehicle_ages", "makes", "fuel_types", "business_types"] as const;
type ListKey = (typeof LIST_KEYS)[number];
const isList = (k: keyof AiGridRow): k is ListKey => (LIST_KEYS as readonly string[]).includes(k);
const split = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const FILLABLE = new Set<keyof AiGridRow>(["ptype", "products", "rtos", "vehicle_ages", "makes", "model", "fuel_types", "business_types", "valid_from", "valid_to"]);
const LIST_ALL: Record<ListKey, string> = { products: "All products", vehicle_ages: "All ages", makes: "All makes", fuel_types: "All fuels", business_types: "All business" };

/** Upload any grid (Excel / PDF / image) → AI reads it → edit / untick rows → Check → Approve & save. */
export function AiGridUpload({ kind }: { kind: RuleKind }) {
  const qc = useQueryClient();
  const [read, setRead] = useState<AiGridRead | null>(null);
  const [rows, setRows] = useState<AiGridRow[]>([]);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [result, setResult] = useState<GridUploadResult | null>(null);
  const [partner, setPartner] = useState("");
  const brokers = useBrokers();
  const masters = useCommissionMasters();
  const m = masters.data;
  const ptypes = Object.keys(m?.product_types ?? {});
  /** Same choices as the New rule form, for this row's product type; values AI read that are not in the list stay selectable. */
  const optionsFor = (r: AiGridRow, k: ListKey): string[] => {
    const pt = r.ptype ?? "";
    const base = k === "products" ? (pt ? m?.product_types[pt] ?? [] : Object.values(m?.product_types ?? {}).flat())
      : k === "makes" ? (pt ? m?.makes[pt] ?? [] : [...new Set(Object.values(m?.makes ?? {}).flat())].sort())
      : k === "fuel_types" ? m?.fuel_by_type[pt] ?? m?.fuel_types ?? []
      : k === "business_types" ? m?.business_types ?? [] : m?.age_bands ?? [];
    return [...new Set([...base, ...split(r[k])])];
  };
  const modelsFor = (r: AiGridRow) => [...new Set(split(r.makes).flatMap((mk) => m?.models[mk] ?? []))].sort();
  const setVal = (i: number, k: keyof AiGridRow, v: string | null) => {
    setResult(null);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v || null, ...(k === "makes" && !v ? { model: null } : {}) } : r)));
  };

  const ai = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); return apiUpload<AiGridRead>(`/commission/grid/ai-read?kind=${kind}&broker_id=${encodeURIComponent(partner)}`, fd); },
    onSuccess: (r) => { setRead(r); setRows(r.rows); setPicked(r.rows.map((x) => !x.needs_review)); setResult(null); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const chosen = rows.filter((_, i) => picked[i]);
  const apply = useMutation({
    mutationFn: (preview: boolean) => apiPost<GridUploadResult>("/commission/grid/ai-apply", { rows: chosen, preview, valid_from: null, valid_to: null } satisfies AiGridApplyIn),
    onSuccess: (res) => {
      setResult(res);
      if (!res.preview) {
        qc.invalidateQueries({ queryKey: ["commission-rules"] });
        toast.success(`Saved: ${res.created} new, ${res.updated} updated`);
        setRead(null);
      } else if (res.errors.length) toast.error(`${res.errors.length} row${res.errors.length === 1 ? "" : "s"} need fixing`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const setCell = (i: number, c: Col, v: string) => {
    setResult(null);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [c.key]: v === "" ? null : c.num ? Number(v) : v } : r)));
  };
  /** Copy row i's value of one column to every ticked row (make picks also carry the model). */
  const fillDown = (i: number, k: keyof AiGridRow) => {
    const src = rows[i];
    const n = rows.filter((_, j) => picked[j] && j !== i).length;
    if (!n) { toast.error("Tick the rows to fill first"); return; }
    setResult(null);
    setRows((rs) => rs.map((r, j) => (picked[j] && j !== i ? { ...r, [k]: src[k], ...(k === "makes" ? { model: src.model } : {}) } : r)));
    toast.success(`${COLS.find((c) => c.key === k)?.label ?? k} copied to ${n} ticked row${n === 1 ? "" : "s"}`);
  };
  const resFor = (i: number) => {
    const n = rows.slice(0, i + 1).filter((_, j) => picked[j]).length; // row numbers count only ticked rows
    return picked[i] ? result?.rows.find((r) => r.row === n) : undefined;
  };
  const review = rows.filter((r) => r.needs_review).length;

  return (
    <>
      <SimpleSelect value={partner} onChange={setPartner} allLabel="Partner as in the file" placeholder="Channel partner" testId={`${kind}-grid-ai-partner-select`} className="min-w-44"
        options={(brokers.data ?? []).map((b) => ({ value: b.id, label: b.name }))} />
      <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15", ai.isPending && "pointer-events-none opacity-60")}
        title="Excel, PDF or image of a commission grid — AI reads it and you approve every rule">
        <Sparkles className="size-3.5" /> {ai.isPending ? "AI reading… (up to 2 min)" : "AI read Excel / PDF / image"}
        <input type="file" accept=".xlsx,.xlsm,.pdf,.png,.jpg,.jpeg,.webp" className="hidden" data-testid={`${kind}-grid-ai-input`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) ai.mutate(f); e.target.value = ""; }} />
      </label>
      <Dialog open={!!read} onOpenChange={(o) => !o && !apply.isPending && setRead(null)}>
        <DialogContent data-testid="grid-ai-dialog" className="max-h-[94vh] overflow-y-auto sm:max-w-[95vw]">
          <DialogHeader>
            <DialogTitle className="font-heading">AI found {rows.length} rule{rows.length === 1 ? "" : "s"} in {read?.file_name}</DialogTitle>
            <DialogDescription>
              {read?.note && <span className="block text-foreground">{read.note}</span>}
              Check each row against the file and edit any cell — leave a dropdown empty for “All”, hover a cell and click ↓ to copy it to every ticked row, From / To dates are optional (blank = no date limit). Only ticked rows are saved.{" "}
              {review > 0 && <span className="text-amber-300">{review} row{review === 1 ? " is" : "s are"} marked “needs review” (amber) and left unticked.</span>}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table data-testid="grid-ai-table" className="text-xs">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5"><Checkbox aria-label="Tick all" data-testid="grid-ai-tick-all" checked={picked.length > 0 && picked.every(Boolean)} onCheckedChange={(v) => { setResult(null); setPicked(rows.map(() => !!v)); }} /></th>
                  {COLS.map((c) => <th key={c.key} className="whitespace-nowrap px-1 py-1.5">{c.label}</th>)}
                  <th className="px-2 py-1.5">Check</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const res = resFor(i);
                  return (
                    <tr key={i} data-testid={`grid-ai-row-${i}`} className={cn("border-t border-border/60 align-top", r.needs_review && "bg-amber-500/10", !picked[i] && "opacity-70")}>
                      <td className="px-2 py-1.5">
                        <Checkbox aria-label={`Tick row ${i + 1}`} data-testid={`grid-ai-tick-${i}`} checked={!!picked[i]} onCheckedChange={(v) => { setResult(null); setPicked((p) => p.map((x, j) => (j === i ? !!v : x))); }} />
                      </td>
                      {COLS.map((c) => (
                        <td key={c.key} className="group/cell relative px-0.5 py-1">
                          {FILLABLE.has(c.key) && (
                            <button type="button" title={`Fill down: copy this ${c.label} to every ticked row`} aria-label={`Fill down ${c.label} from row ${i + 1}`}
                              data-testid={`grid-ai-fill-${i}-${c.key}`} onClick={() => fillDown(i, c.key)}
                              className="absolute -top-1 right-0 z-10 hidden rounded bg-primary p-0.5 text-primary-foreground shadow transition-transform duration-100 hover:scale-110 group-hover/cell:block group-focus-within/cell:block">
                              <ArrowDownToLine className="size-3" />
                            </button>
                          )}
                          {isList(c.key) ? (
                            <MultiSelect value={split(r[c.key])} onChange={(v) => setVal(i, c.key, v.join(", "))} options={optionsFor(r, c.key)}
                              placeholder={LIST_ALL[c.key]} testId={`grid-ai-cell-${i}-${c.key}`} className={cn("min-h-7 py-0.5 text-xs", c.w)} />
                          ) : c.key === "model" ? (
                            <div className={c.w}>
                              <ComboBox value={r.model ?? ""} onChange={(v) => setVal(i, "model", v)} options={modelsFor(r)} placeholder="All models"
                                testId={`grid-ai-cell-${i}-model`} addLabel="Use model" />
                            </div>
                          ) : c.key === "ptype" ? (
                            <SimpleSelect value={r.ptype ?? ""} onChange={(v) => setVal(i, "ptype", v)} allLabel="All product types" placeholder="Product type"
                              testId={`grid-ai-cell-${i}-ptype`} className={cn("h-7 text-xs", "w-36")} options={[...new Set([...ptypes, ...(r.ptype ? [r.ptype] : [])])].map((p) => ({ value: p, label: p }))} />
                          ) : (
                            <Input value={(r[c.key] as string | number | null) ?? ""} type={c.num ? "number" : c.key === "valid_from" || c.key === "valid_to" ? "date" : "text"}
                              data-testid={`grid-ai-cell-${i}-${c.key}`} onChange={(e) => setCell(i, c, e.target.value)} className={cn("h-7 px-1.5 text-xs", c.w, c.num && "text-right font-mono")} />
                          )}
                        </td>
                      ))}
                      <td className="min-w-44 px-2 py-1.5" data-testid={`grid-ai-check-${i}`}>
                        {r.needs_review && <div className="flex items-start gap-1 text-amber-300"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> {r.review_note ?? "Needs review"}</div>}
                        {res?.action === "error" && <div className="text-red-300">{res.error}</div>}
                        {res && res.action !== "error" && <div className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="size-3" /> {res.action === "create" ? "new rule" : res.action === "update" ? "updates a rule" : "already in grid"}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result && (
            <p data-testid="grid-ai-summary" className={cn("text-sm", result.errors.length ? "text-red-300" : "text-emerald-300")}>
              {result.created} new · {result.updated} updated · {result.unchanged} unchanged{result.errors.length ? ` · ${result.errors.length} with problems — fix or untick them` : " — ready to save"}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRead(null)} data-testid="grid-ai-cancel">Cancel</Button>
            <Button variant="outline" disabled={!chosen.length || apply.isPending} onClick={() => apply.mutate(true)} data-testid="grid-ai-check"><ListChecks className="size-4" /> Check {chosen.length} rows</Button>
            <Button disabled={!result?.preview || result.errors.length > 0 || apply.isPending} onClick={() => apply.mutate(false)} data-testid="grid-ai-save"><Save className="size-4" /> Approve & save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
