import { useState } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { AgentPayableRow, RateKey } from "@/lib/types";

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
export function MarginFillBar({ rows, onFill }: { rows: AgentPayableRow[]; onFill: (fills: Record<string, Partial<Record<RateKey, string>>>) => void }) {
  const [pct, setPct] = useState("");
  const [flat, setFlat] = useState("");
  const [allShown, setAllShown] = useState(false);
  const targets = rows.filter((r) => allShown || r.source === "missing");
  const apply = () => {
    const p = pct === "" ? null : Number(pct);
    const f = flat === "" ? null : Number(flat);
    const fills = Object.fromEntries(targets.map((r) => [r.receivable_id, marginRates(r, p, f)]).filter(([, v]) => Object.keys(v).length > 0));
    const n = Object.keys(fills).length;
    if (!n) return toast.error("No row has a receivable component for this margin");
    onFill(fills);
    toast.success(`Filled ${n} row${n === 1 ? "" : "s"} — press Check, then Save agent rates`);
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
      <Button size="sm" onClick={apply} disabled={(pct === "" && flat === "") || !targets.length} data-testid="agent-margin-apply">
        <Wand2 className="size-3.5" /> Fill {targets.length} row{targets.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}
