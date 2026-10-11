import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Plus, Save, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/SimpleSelect";
import { useCommissionMasters } from "@/components/RuleDialog";
import { apiGet, apiPut, apiUpload } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { MarginGrid, MarginGridIn, MarginGridRow, MarginGridSaveResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALL_COS = "__all_cos__";
const ALL_PRODUCTS = "__all_products__";
type Draft = { key: string; insurer: string; ptype: string; product: string; cells: Record<string, string>; since: Record<string, string | null> };

const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const show = (v: number | null | undefined) => (v == null ? "" : v === 0 ? "0" : `-${v}`);
const parse = (s: string): number | null => (s.trim() === "" ? null : Math.abs(Number(s.replace("%", ""))));
const rowKey = (r: { insurer: string; ptype: string; product: string }) => `${r.insurer}|${r.ptype}|${r.product}`;
let seq = 0;
const toDraft = (r: MarginGridRow, groups: string[]): Draft => ({
  key: `r${seq++}`,
  insurer: r.insurer ?? ALL_COS,
  ptype: r.product_type ?? ALL_PRODUCTS,
  product: r.product ?? "",
  cells: Object.fromEntries(groups.map((g) => [g, show(r.margins[g])])),
  since: r.since ?? {},
});

/** Payable for agent groups as a simple grid: company × product rows, one column per group, cell = −2 / −3 / −4. */
export function MarginGridTab() {
  const qc = useQueryClient();
  const masters = useCommissionMasters();
  const grid = useQuery({ queryKey: ["margin-grid"], queryFn: () => apiGet<MarginGrid>("/commission/margin-grid") });
  const groups = grid.data?.groups ?? [];
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [from, setFrom] = useState(todayIst());
  const [past, setPast] = useState(false);
  const base = (grid.data?.rows ?? []).map((r) => toDraft(r, groups));
  const rows = draft ?? base;
  const original = new Map((grid.data?.rows ?? []).map((r) => [rowKey({ insurer: r.insurer ?? ALL_COS, ptype: r.product_type ?? ALL_PRODUCTS, product: r.product ?? "" }), r]));
  const types = masters.data?.product_types ?? {};
  const insurers = masters.data?.insurers ?? [];

  const edit = (fn: (rs: Draft[]) => Draft[]) => setDraft(fn(rows));
  const setRow = (key: string, patch: Partial<Draft>) => edit((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const isChanged = (r: Draft, g: string) => {
    const o = original.get(rowKey(r));
    return parse(r.cells[g] ?? "") !== (o?.margins[g] ?? null);
  };
  const keys = rows.map(rowKey);
  const dupes = new Set(keys.filter((k, i) => keys.indexOf(k) !== i));
  const bad = rows.some((r) => groups.some((g) => { const v = parse(r.cells[g] ?? ""); return v !== null && (Number.isNaN(v) || v > 100); }));
  const removed = [...original.keys()].filter((k) => !keys.includes(k)).length;
  const pending = rows.reduce((n, r) => n + groups.filter((g) => isChanged(r, g)).length, 0) + removed;

  const save = useMutation({
    mutationFn: () => apiPut<MarginGridSaveResult>("/commission/margin-grid", {
      rows: rows.map((r) => ({
        insurer: r.insurer === ALL_COS ? null : r.insurer, product_type: r.ptype === ALL_PRODUCTS ? null : r.ptype, product: r.product || null,
        margins: Object.fromEntries(groups.map((g) => [g, parse(r.cells[g] ?? "")])), since: {},
      })),
      valid_from: past ? null : from, apply_to_past: past,
    } satisfies MarginGridIn),
    onSuccess: (res) => {
      ["margin-grid", "agent-groups", "commission-compare", "my-rates", "policies", "commission"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setDraft(null);
      toast.success(res.changed ? `${res.changed} margin${res.changed === 1 ? "" : "s"} saved ${past ? "for all policies" : `from ${from}`}` : "No changes");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const suggest = useMutation({
    mutationFn: () => apiGet<MarginGridRow[]>("/commission/margin-grid/suggest"),
    onSuccess: (list) => {
      const have = new Set(keys);
      const add = list.map((r) => toDraft(r, groups)).filter((d) => !have.has(rowKey(d)));
      edit((rs) => [...rs, ...add]);
      toast.success(add.length ? `${add.length} company × product rows added from the receivable grid — type the margins and Save` : "All receivable companies are already in the grid");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const readExcel = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); return apiUpload<MarginGrid>("/commission/margin-grid/excel", fd); },
    onSuccess: (g) => {
      setDraft(g.rows.map((r) => ({ ...toDraft(r, groups), since: original.get(rowKey({ insurer: r.insurer ?? ALL_COS, ptype: r.product_type ?? ALL_PRODUCTS, product: r.product ?? "" }))?.since ?? {} })));
      toast.success(`Excel loaded — ${g.rows.length} rows. Check the highlighted changes and press Save.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-4" data-testid="margin-grid-tab">
      <p className="text-sm text-muted-foreground">
        Payable for every agent in a group = <b className="text-foreground">receivable % − margin</b>. Type <span className="font-mono text-teal-300">-2</span>, <span className="font-mono text-teal-300">-3</span>, <span className="font-mono text-teal-300">-4</span>… per company and product.
        It follows every receivable rule change automatically. Product is optional — pick it only for a specific product like PCV - Taxi. An agent's personal payable rule still wins.
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/5 px-3 py-2">
        <Button size="sm" variant="outline" onClick={() => edit((rs) => [...rs, { key: `r${seq++}`, insurer: "", ptype: ALL_PRODUCTS, product: "", cells: {}, since: {} }])} data-testid="margin-grid-add-row">
          <Plus className="size-3.5" /> Add row
        </Button>
        <Button size="sm" variant="outline" disabled={suggest.isPending} onClick={() => suggest.mutate()} data-testid="margin-grid-suggest">
          <Sparkles className="size-3.5" /> Add companies from receivable grid
        </Button>
        <a href="/api/commission/margin-grid/excel" data-testid="margin-grid-excel-download"><Button size="sm" variant="outline"><FileDown className="size-3.5" /> Excel</Button></a>
        <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent", readExcel.isPending && "pointer-events-none opacity-60")}>
          <Upload className="size-3.5" /> Load Excel
          <input type="file" accept=".xlsx" className="hidden" data-testid="margin-grid-excel-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) readExcel.mutate(f); e.target.value = ""; }} />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">Applicable from</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={past} className="h-8 w-40 text-xs" data-testid="margin-grid-from" />
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={past} onCheckedChange={(v) => setPast(!!v)} data-testid="margin-grid-apply-past" /> Apply to past policies
          </label>
          {draft && <Button size="sm" variant="ghost" onClick={() => setDraft(null)} data-testid="margin-grid-discard">Discard</Button>}
          <Button size="sm" disabled={!pending || dupes.size > 0 || bad || rows.some((r) => !r.insurer) || save.isPending || (!past && !from)} onClick={() => save.mutate()} data-testid="margin-grid-save">
            <Save className="size-3.5" /> {save.isPending ? "Saving…" : `Save${pending ? ` ${pending} change${pending === 1 ? "" : "s"}` : ""}`}
          </Button>
        </div>
      </div>
      {past && <p className="text-xs text-amber-300" data-testid="margin-grid-past-warning">Apply to past policies: the new margins replace the old ones for every policy, including ones already in the MIS.</p>}
      {!past && <p className="text-xs text-muted-foreground">Old margins stay on policies with risk start before {from || "the date"} — only newer policies use the new margin.</p>}
      {dupes.size > 0 && <p className="text-xs text-red-300">The same company + product is listed twice.</p>}
      {groups.length === 0 && grid.isSuccess && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No agent groups yet — create groups in the Agent groups tab first.</p>}

      {groups.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card" data-testid="margin-grid-table">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Insurance company</th>
                <th className="px-3 py-2 font-medium">Product type</th>
                <th className="px-3 py-2 font-medium">Product (optional)</th>
                {groups.map((g) => <th key={g} className="px-3 py-2 text-center font-medium">Group {g}</th>)}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isNew = !original.has(rowKey(r));
                return (
                  <tr key={r.key} className={cn("border-t border-border/60", dupes.has(rowKey(r)) && "bg-red-500/5")} data-testid={`margin-grid-row-${i}`}>
                    <td className="px-3 py-1.5">
                      <SimpleSelect value={r.insurer} onChange={(v) => setRow(r.key, { insurer: v })} placeholder="Pick company" testId={`margin-grid-insurer-${i}`} className="w-60" searchable
                        options={[{ value: ALL_COS, label: "All other companies" }, ...[...new Set([...insurers, ...(r.insurer && r.insurer !== ALL_COS ? [r.insurer] : [])])].map((n) => ({ value: n, label: n }))]} />
                    </td>
                    <td className="px-3 py-1.5">
                      <SimpleSelect value={r.ptype} onChange={(v) => setRow(r.key, { ptype: v, product: "" })} placeholder="Product type" testId={`margin-grid-ptype-${i}`} className="w-40"
                        options={[{ value: ALL_PRODUCTS, label: "All products" }, ...Object.keys(types).map((t) => ({ value: t, label: t }))]} />
                    </td>
                    <td className="px-3 py-1.5">
                      {r.ptype !== ALL_PRODUCTS && (types[r.ptype]?.length ?? 0) > 1 ? (
                        <SimpleSelect value={r.product} onChange={(v) => setRow(r.key, { product: v })} allLabel={`All ${r.ptype}`} placeholder="Product" testId={`margin-grid-product-${i}`} className="w-52"
                          options={(types[r.ptype] ?? []).map((p) => ({ value: p, label: p }))} />
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    {groups.map((g) => {
                      const changed = isChanged(r, g);
                      const v = r.cells[g] ?? "";
                      const invalid = v.trim() !== "" && (Number.isNaN(Number(v.replace("%", ""))) || Math.abs(Number(v.replace("%", ""))) > 100);
                      return (
                        <td key={g} className="px-2 py-1.5 text-center">
                          <Input value={v} inputMode="decimal" placeholder="—" onChange={(e) => setRow(r.key, { cells: { ...r.cells, [g]: e.target.value } })}
                            data-testid={`margin-grid-cell-${i}-${g.toLowerCase()}`}
                            className={cn("mx-auto h-8 w-20 text-center font-mono transition-[border-color,background-color] duration-150", changed && "border-teal-400 bg-teal-500/10", invalid && "border-red-400 bg-red-500/10")} />
                          {!isNew && r.since[g] && !changed && <div className="mt-0.5 text-[10px] text-muted-foreground">from {r.since[g]}</div>}
                          {changed && <div className="mt-0.5 text-[10px] text-teal-300">{past ? "all policies" : `from ${from}`}</div>}
                        </td>
                      );
                    })}
                    <td className="px-2">
                      <Button size="icon-sm" variant="ghost" aria-label="Remove row" data-testid={`margin-grid-remove-${i}`} onClick={() => edit((rs) => rs.filter((x) => x.key !== r.key))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={groups.length + 4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No margins yet. Press <b>Add companies from receivable grid</b> to list every company and product, then type -2 / -3 / -4.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
