import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { AgentPayableRow, MarginPreset, MarginPresetIn, RateKey } from "@/lib/types";

const PCT: RateKey[] = ["od_percent", "tp_percent", "net_percent", "odtp_percent"];
const round2 = (n: number) => Math.round(Math.max(0, n) * 100) / 100;

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

/** "Receivable minus X" → fills the rate inputs of every missing (or every shown) row at once; nothing is saved until Check & Save. */
export function MarginFillBar({ rows, group, onFill }: { rows: AgentPayableRow[]; group: string | null; onFill: (fills: Record<string, Partial<Record<RateKey, string>>>) => void }) {
  const qc = useQueryClient();
  const [pct, setPct] = useState("");
  const [flat, setFlat] = useState("");
  const [allShown, setAllShown] = useState(false);
  const presets = useQuery({ queryKey: ["margin-presets"], queryFn: () => apiGet<MarginPreset[]>("/commission/margin-presets") });
  // the agent's group presets first, then the "any agent" ones
  const list = useMemo(() => (presets.data ?? []).filter((p) => !p.agent_group || p.agent_group === group)
    .sort((a, b) => Number(!a.agent_group) - Number(!b.agent_group) || a.name.localeCompare(b.name)), [presets.data, group]);
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
  const onSave = () => {
    const name = window.prompt("Preset name, e.g. Standard −4%", pct ? `Standard −${pct}%` : "");
    if (!name?.trim()) return;
    const forGroup = group ? window.confirm(`Save only for agent group ${group}? (Cancel = for every agent)`) : false;
    savePreset.mutate({ name: name.trim(), minus_percent: pct === "" ? null : Number(pct), minus_flat: flat === "" ? null : Number(flat), agent_group: forGroup ? group : null });
  };
  const apply = (pp?: MarginPreset) => {
    const p = pp ? pp.minus_percent : pct === "" ? null : Number(pct);
    const f = pp ? pp.minus_flat : flat === "" ? null : Number(flat);
    const fills = Object.fromEntries(targets.map((r) => [r.receivable_id, marginRates(r, p, f)]).filter(([, v]) => Object.keys(v).length > 0));
    const n = Object.keys(fills).length;
    if (!n) return toast.error("No row has a receivable component for this margin");
    onFill(fills);
    if (pp) { setPct(pp.minus_percent == null ? "" : String(pp.minus_percent)); setFlat(pp.minus_flat == null ? "" : String(pp.minus_flat)); }
    toast.success(`${pp ? `"${pp.name}": ` : ""}filled ${n} row${n === 1 ? "" : "s"} — press Check, then Save agent rates`);
  };
  return (
    <div data-testid="agent-margin-fill-bar" className="flex flex-wrap items-end gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
      <div>
        <div className="font-semibold text-foreground">Copy margin to rows</div>
        <div className="text-muted-foreground">Agent rate = receivable minus your margin (never below 0)</div>
      </div>
      <label className="space-y-0.5">
        <span className="text-muted-foreground">Minus % (OD / TP / Net / OD+TP)</span>
        <Input type="number" min={0} step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="e.g. 4" className="h-8 w-28 text-right font-mono" data-testid="agent-margin-pct" />
      </label>
      <label className="space-y-0.5">
        <span className="text-muted-foreground">Minus ₹ (flat)</span>
        <Input type="number" min={0} step="1" value={flat} onChange={(e) => setFlat(e.target.value)} placeholder="optional" className="h-8 w-24 text-right font-mono" data-testid="agent-margin-flat" />
      </label>
      <label className="flex h-8 items-center gap-1.5 text-muted-foreground">
        <Checkbox checked={allShown} onCheckedChange={(v) => setAllShown(!!v)} data-testid="agent-margin-all-shown" /> All shown rows (not only missing)
      </label>
      <Button size="sm" onClick={() => apply()} disabled={(pct === "" && flat === "") || !targets.length} data-testid="agent-margin-apply">
        <Wand2 className="size-3.5" /> Fill {targets.length} row{targets.length === 1 ? "" : "s"}
      </Button>
      <Button size="sm" variant="outline" onClick={onSave} disabled={(pct === "" && flat === "") || savePreset.isPending} data-testid="agent-margin-save-preset">
        <Bookmark className="size-3.5" /> Save as preset
      </Button>
      {list.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-1.5" data-testid="agent-margin-presets">
          <span className="text-muted-foreground">Presets (one click fills {targets.length} rows):</span>
          {list.map((p) => (
            <span key={p.id} className="inline-flex items-center overflow-hidden rounded-full border border-primary/40 bg-card">
              <button type="button" className="px-2.5 py-1 font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50" disabled={!targets.length}
                onClick={() => apply(p)} data-testid={`agent-margin-preset-${p.id}`} title={`Receivable ${p.minus_percent != null ? `−${p.minus_percent}%` : ""}${p.minus_flat != null ? ` −₹${p.minus_flat}` : ""}`}>
                {p.name}{p.agent_group ? ` · ${p.agent_group}` : ""}
              </button>
              <button type="button" aria-label={`Delete preset ${p.name}`} className="border-l border-border px-1.5 py-1 text-muted-foreground hover:text-red-300"
                onClick={() => window.confirm(`Delete preset "${p.name}"?`) && dropPreset.mutate(p.id)} data-testid={`agent-margin-preset-delete-${p.id}`}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
