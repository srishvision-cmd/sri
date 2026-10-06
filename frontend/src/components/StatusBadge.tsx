import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { PolicyStatus } from "@/lib/types";

const STYLES: Record<PolicyStatus, string> = {
  processing: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  extracted: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  failed: "border-red-500/30 bg-red-500/10 text-red-300",
  flagged: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  verified: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  duplicate: "border-rose-500/40 bg-rose-500/15 text-rose-300",
};

export function StatusBadge({ status, testId }: { status: PolicyStatus; testId?: string }) {
  return (
    <Badge variant="outline" data-testid={testId} className={cn("gap-1.5 font-medium", STYLES[status])}>
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          status === "processing" && "animate-pulse motion-reduce:animate-none",
        )}
      />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function ConfidenceChip({ value, testId }: { value: number | undefined; testId?: string }) {
  if (value === undefined) return null;
  const pct = Math.round(value * 100);
  const high = value >= 0.85;
  return (
    <span
      data-testid={testId}
      title="OCR confidence"
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular",
        high ? "bg-[#064E3B] text-[#34D399]" : "bg-[#78350F] text-[#FDE68A]",
      )}
    >
      {pct}%
    </span>
  );
}
