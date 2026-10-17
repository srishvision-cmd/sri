import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Plus, Trash2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { AgentPayableRow, MarginPreset, MarginPresetIn, ProductMargin, RateKey } from "@/lib/types";

const PCT: RateKey[] = ["od_percent", "tp_percent", "net_percent", "odtp_percent"];
const round2 = (n: number) => Math.round(Math.max(0, n) * 100) / 100;
const num = (s: string) => (s === "" ? null : Number(s));
const txt = (n: number | null) => (n == null ? "" : String(n));
const label = (pct: number | null, flat: number | null) => [pct != null && `−${pct}%`, flat != null && `−₹${flat}`].filter(Boolean).join(" ") || "—";

/** Payable rates = receivable minus a margin, for every component the receivable defines. */
export function marginRates(r: AgentPayableRow, pct: number | null, flat: number | null): Partial<Record<RateKey, string>> {
  const out: Partial<Record<RateKey, string>> = {};
  for (const k of PCT) {
    const rv = r.receivable[k];
    if (rv != null && pct != null) out[k] = String(round2(rv - pct));
  }
  if (r.receivable.flat_amount != null && flat != null) out.flat_amount = String(round2(r.receivable.flat_amount - flat));
  return out;
}

/** The margin for one row: its product's own line (first product of the row that has one), else the default. */
export function marginFor(r: AgentPayableRow, dflt: { pct: number | null; flat: number | null }, lines: ProductMargin[]) {
  const hit = lines.find((m) => r.products.includes(m.product));
  return hit ? { pct: hit.minus_percent, flat: hit.minus_flat } : dflt;
}

type Line = { id: string; product: string; pct: string; flat: string }; // id = stable React key
const newLine = (product = "", pct = "", flat = ""): Line => ({ id: crypto.randomUUID(), product, pct, flat });

/** "Receivable minus X" (optionally a different X per product) → fills the rate inputs of every missing (or every shown) row; nothing is saved until Check & Save. */
export function MarginFillBar({ rows, group, onFill }: { rows: AgentPayableRow[]; group: string | null; onFill: (fills: Record<string, Partial<Record<RateKey, string>>>) => void }) {
  const qc = useQueryClient();
  const [pct, setPct] = useState("");
  const [flat, setFlat] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [allShown, setAllShown] = useState(false);
  const presets = useQuery({ queryKey: ["margin-presets"], queryFn: () => apiGet<MarginPreset[]>("/commission/margin-presets") });
  // the agent's group presets first, then the "any agent" ones
  const list = useMemo(() => (presets.data ?? []).filter((p) => !p.agent_group || p.agent_group === group)
    .sort((a, b) => Number(!a.agent_group) - Number(!b.agent_group) || a.name.localeCompare(b.name)), [presets.data, group]);
  const products = useMemo(() => [...new Set([...rows.flatMap((r) => r.products), ...lines.map((l) => l.product).filter(Boolean)])].sort(), [rows, lines]);
  const savePreset = useMutation({
    mutationFn: (body: MarginPresetIn) => apiPost<MarginPreset>("/commission/margin-presets", body),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["margin-presets"] }); toast.success(`Preset "${p.name}" saved${p.agent_group ? ` for group ${p.agent_group}` : ""}`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dropPreset = useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: boolean }>(`/commission/margin-presets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["margin-presets"] }); toast.success("Preset removed"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const targets = rows.filter((r) => allShown || r.source === "missing");
  const filled = lines.filter((l) => l.product && (l.pct !== "" || l.flat !== ""));
  const current: ProductMargin[] = filled.map((l) => ({ product: l.product, minus_percent: num(l.pct), minus_flat: num(l.flat) }));
  const hasInput = pct !== "" || flat !== "" || filled.length > 0;
  // each product can have one line: a line's dropdown offers its own product + the unused ones
  const used = useMemo(() => new Set(lines.map((l) => l.product)), [lines]);
  const productOptionsFor = (own: string) => products.filter((p) => p === own || !used.has(p)).map((p) => ({ value: p, label: p }));
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const onSave = () => {
    const name = window.prompt("Preset name, e.g. Standard −4%", pct ? `Standard −${pct}%` : "");
    if (!name?.trim()) return;
    const forGroup = group ? window.confirm(`Save only for partner group ${group}? (Cancel = for every partner)`) : false;
    savePreset.mutate({ name: name.trim(), minus_percent: num(pct), minus_flat: num(flat), agent_group: forGroup ? group : null, by_product: current });
  };
  const apply = (pp?: MarginPreset) => {
    const dflt = pp ? { pct: pp.minus_percent, flat: pp.minus_flat } : { pct: num(pct), flat: num(flat) };
    const byProduct = pp ? pp.by_product ?? [] : current;
    const fills = Object.fromEntries(targets.map((r) => {
      const m = marginFor(r, dflt, byProduct);
      return [r.receivable_id, marginRates(r, m.pct, m.flat)];
    }).filter(([, v]) => Object.keys(v).length > 0));
    const n = Object.keys(fills).length;
    if (!n) return toast.error("No row has a receivable component for this margin");
    onFill(fills);
    if (pp) {
      setPct(txt(pp.minus_percent)); setFlat(txt(pp.minus_flat));
      setLines((pp.by_product ?? []).map((m) => newLine(m.product, txt(m.minus_percent), txt(m.minus_flat))));
    }
    toast.success(`${pp ? `"${pp.name}": ` : ""}filled ${n} row${n === 1 ? "" : "s"} — press Check, then Save partner rates`);
  };
  return (
    <div data-testid="agent-margin-fill-bar" className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="font-semibold text-foreground">Copy margin to rows</div>
          <div className="text-muted-foreground">Partner rate = receivable minus your margin (never below 0)</div>
        </div>
        <label className="space-y-0.5">
          <span className="text-muted-foreground">Minus % (OD / TP / Net / OD+TP){lines.length ? " · other products" : ""}</span>
          <Input type="number" min={0} step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="e.g. 4" className="h-8 w-28 text-right font-mono" data-testid="agent-margin-pct" />
        </label>
        <label className="space-y-0.5">
          <span className="text-muted-foreground">Minus ₹ (flat)</span>
          <Input type="number" min={0} step="1" value={flat} onChange={(e) => setFlat(e.target.value)} placeholder="optional" className="h-8 w-24 text-right font-mono" data-testid="agent-margin-flat" />
        </label>
        <label className="flex h-8 items-center gap-1.5 text-muted-foreground">
          <Checkbox checked={allShown} onCheckedChange={(v) => setAllShown(!!v)} data-testid="agent-margin-all-shown" /> All shown rows (not only missing)
        </label>
        <Button size="sm" onClick={() => apply()} disabled={!hasInput || !targets.length} data-testid="agent-margin-apply">
          <Wand2 className="size-3.5" /> Fill {targets.length} row{targets.length === 1 ? "" : "s"}
        </Button>
        <Button size="sm" variant="outline" onClick={onSave} disabled={!hasInput || savePreset.isPending} data-testid="agent-margin-save-preset">
          <Bookmark className="size-3.5" /> Save as preset
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, newLine()])} data-testid="agent-margin-add-product">
          <Plus className="size-3.5" /> Different margin for a product
        </Button>
      </div>

      {lines.length > 0 && (
        <div data-testid="agent-margin-product-lines" className="space-y-1.5 rounded-md border border-border bg-card/70 p-2">
          <div className="text-muted-foreground">Per-product margins — these override the default above; every other product uses the default.</div>
          {lines.map((l, i) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2" data-testid={`agent-margin-line-${i}`}>
              <SimpleSelect value={l.product} onChange={(v) => setLine(i, { product: v })} placeholder="Product" testId={`agent-margin-line-product-${i}`} className="h-8 w-60" searchable
                options={productOptionsFor(l.product)} />
              <Input type="number" min={0} step="0.01" value={l.pct} onChange={(e) => setLine(i, { pct: e.target.value })} placeholder="minus %" className="h-8 w-24 text-right font-mono" data-testid={`agent-margin-line-pct-${i}`} />
              <Input type="number" min={0} step="1" value={l.flat} onChange={(e) => setLine(i, { flat: e.target.value })} placeholder="minus ₹" className="h-8 w-24 text-right font-mono" data-testid={`agent-margin-line-flat-${i}`} />
              <Button size="sm" variant="ghost" className="h-8 px-2" aria-label="Remove product margin" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} data-testid={`agent-margin-line-remove-${i}`}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {list.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-1.5" data-testid="agent-margin-presets">
          <span className="text-muted-foreground">Presets (one click fills {targets.length} rows):</span>
          {list.map((p) => {
            const per = p.by_product ?? [];
            const title = [`Default ${label(p.minus_percent, p.minus_flat)}`, ...per.map((m) => `${m.product} ${label(m.minus_percent, m.minus_flat)}`)].join("\n");
            return (
              <span key={p.id} className="inline-flex items-center overflow-hidden rounded-full border border-primary/40 bg-card">
                <button type="button" className="px-2.5 py-1 font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50" disabled={!targets.length}
                  onClick={() => apply(p)} data-testid={`agent-margin-preset-${p.id}`} title={title}>
                  {p.name}{p.agent_group ? ` · ${p.agent_group}` : ""}{per.length ? ` · ${per.length} product${per.length === 1 ? "" : "s"}` : ""}
                </button>
                <button type="button" aria-label={`Delete preset ${p.name}`} className="border-l border-border px-1.5 py-1 text-muted-foreground hover:text-red-300"
                  onClick={() => window.confirm(`Delete preset "${p.name}"?`) && dropPreset.mutate(p.id)} data-testid={`agent-margin-preset-delete-${p.id}`}><X className="size-3" /></button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
