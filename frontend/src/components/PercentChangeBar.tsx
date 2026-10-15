import { useState } from "react";
import { Percent, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RateKey } from "@/lib/types";

type RateText = Record<string, Record<RateKey, string>>;

/** Every filled rate of the ORIGINAL rules × (1 + pct/100), 2 decimals — re-applying never compounds. Blank stays blank. */
export function scaleRates(original: RateText, pct: number): RateText {
  return Object.fromEntries(Object.entries(original).map(([id, v]) => [id, Object.fromEntries(Object.entries(v).map(([k, s]) =>
    [k, s === "" ? "" : String(Math.round(Number(s) * (1 + pct / 100) * 100) / 100)])) as Record<RateKey, string>]));
}

/** "Change every rate by ±x %" for the copy dialogs. */
export function PercentChangeBar({ onApply, onReset, testPrefix }: { onApply: (pct: number) => void; onReset: () => void; testPrefix: string }) {
  const [pct, setPct] = useState("");
  const n = Number(pct);
  const valid = pct !== "" && Number.isFinite(n) && n > -100 && n !== 0;
  return (
    <div data-testid={`${testPrefix}-percent-bar`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
      <Percent className="size-3.5 text-muted-foreground" />
      <span className="font-medium">Change every rate by</span>
      <Input type="number" step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="+10 or -5"
        data-testid={`${testPrefix}-percent-input`} className="h-7 w-24 text-right font-mono text-xs" />
      <span>%</span>
      <Button size="sm" variant="outline" className="h-7" disabled={!valid} data-testid={`${testPrefix}-percent-apply`} onClick={() => onApply(n)}>Apply</Button>
      <Button size="sm" variant="ghost" className="h-7" data-testid={`${testPrefix}-percent-reset`} onClick={() => { setPct(""); onReset(); }}>
        <RotateCcw className="size-3" /> Original rates
      </Button>
      <span className="text-muted-foreground">
        {valid ? `e.g. OD 20% → ${Math.round(20 * (1 + n / 100) * 100) / 100}%` : "Relative to the original rates, e.g. +10 turns OD 20% into 22%. Flat ₹ changes too."}
      </span>
    </div>
  );
}
