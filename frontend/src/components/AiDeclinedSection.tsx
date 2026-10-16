import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { AiDeclinedRow, CommissionMasters, DeclinedRto, DeclinedRtoIn } from "@/lib/types";

const list = (s: string | null) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export const ccText = (lo: number | null, hi: number | null, unit = "cc") => {
  if (lo != null && hi != null) return `${lo}–${hi} ${unit}`;
  if (lo != null) return `from ${lo} ${unit}`;
  return hi != null ? `up to ${hi} ${unit}` : "";
};

/** Body for the company-wide declined list; unknown product type / products are dropped (= all products). */
export function declinedBody(r: AiDeclinedRow, m: CommissionMasters | undefined): DeclinedRtoIn {
  const ptype = r.ptype && m?.product_types[r.ptype] ? r.ptype : null;
  return {
    insurer: r.insurer ?? "", product_type: ptype, products: ptype ? list(r.products).filter((p) => m?.product_types[ptype].includes(p)) : [],
    rtos: list(r.rtos), makes: list(r.makes), models: list(r.models), cc_min: r.cc_min, cc_max: r.cc_max, gvw_min: r.gvw_min ?? null, gvw_max: r.gvw_max ?? null, note: r.note,
  };
}

/** "Declined / Excluded" tables the AI found — edit, tick and save them to the company-wide declined list (separate from the rates). */
export function AiDeclinedSection({ rows, masters }: { rows: AiDeclinedRow[]; masters: CommissionMasters | undefined }) {
  const qc = useQueryClient();
  const [items, setItems] = useState(rows);
  const [picked, setPicked] = useState(() => rows.map((r) => !!r.insurer));
  const [saved, setSaved] = useState(false);
  const set = (i: number, k: keyof AiDeclinedRow, v: string) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: (k.startsWith("cc_") || k.startsWith("gvw_")) ? (v === "" ? null : Number(v)) : v || null } : x)));
  const ticked = items.filter((_, i) => picked[i]);
  const save = useMutation({
    mutationFn: async () => { for (const r of ticked) await apiPost<DeclinedRto>("/commission/declined-rtos", declinedBody(r, masters)); },
    onSuccess: () => { ["declined-rtos", "policies", "policy", "commission"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setSaved(true); toast.success(`${ticked.length} declined entr${ticked.length === 1 ? "y" : "ies"} saved to Declined RTOs`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cell = (i: number, k: keyof AiDeclinedRow, w: string, num = false) => (
    <td className="px-1 py-1"><Input type={num ? "number" : "text"} value={items[i][k] ?? ""} onChange={(e) => set(i, k, e.target.value)} className={`h-7 text-xs ${w}`} data-testid={`grid-ai-declined-${i}-${k}`} /></td>
  );
  return (
    <div data-testid="grid-ai-declined" className="space-y-2 rounded-lg border border-red-300 bg-red-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Ban className="size-4 text-red-700" />
        <span className="font-semibold text-red-800">Declined / excluded found in the file ({rows.length})</span>
        <span className="text-xs text-muted-foreground">Saved to Commission Grid → Declined RTOs: policies matching them get no receivable and no payable. Separate from the rates above.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead className="text-left text-muted-foreground">
            <tr><th className="px-1" /><th className="px-1">Company</th><th className="px-1">Product type</th><th className="px-1">Products</th><th className="px-1">RTOs</th><th className="px-1">Makes</th><th className="px-1">Models</th><th className="px-1">CC from</th><th className="px-1">CC to</th><th className="px-1">GVW from (kg)</th><th className="px-1">GVW to (kg)</th><th className="px-1">Remarks</th></tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={i /* fixed list from one AI read — rows are never added, removed or reordered */} data-testid={`grid-ai-declined-row-${i}`}>
                <td className="px-1"><Checkbox checked={!!picked[i]} disabled={saved} onCheckedChange={(v) => setPicked((p) => p.map((x, j) => (j === i ? !!v : x)))} data-testid={`grid-ai-declined-tick-${i}`} /></td>
                {cell(i, "insurer", "w-36")}{cell(i, "ptype", "w-24")}{cell(i, "products", "w-36")}{cell(i, "rtos", "w-48 font-mono")}
                {cell(i, "makes", "w-28")}{cell(i, "models", "w-28")}{cell(i, "cc_min", "w-20", true)}{cell(i, "cc_max", "w-20", true)}{cell(i, "gvw_min", "w-24", true)}{cell(i, "gvw_max", "w-24", true)}{cell(i, "note", "w-32")}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="border-red-300 text-red-700" disabled={saved || !ticked.length || ticked.some((r) => !r.insurer) || save.isPending}
          onClick={() => save.mutate()} data-testid="grid-ai-declined-save">
          <Ban className="size-3.5" /> {saved ? "Saved" : `Save ${ticked.length} declined entr${ticked.length === 1 ? "y" : "ies"}`}
        </Button>
      </div>
    </div>
  );
}
