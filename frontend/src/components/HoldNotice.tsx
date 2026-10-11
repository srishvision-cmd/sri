import { useQuery } from "@tanstack/react-query";
import { PauseCircle } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { AgentHoldNotice } from "@/lib/types";
import { cn } from "@/lib/utils";

const nice = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Agent dashboard notice: companies whose rates are stopped (commission hold) now or from an upcoming date. */
export function HoldNotice() {
  const q = useQuery({ queryKey: ["my-holds"], queryFn: () => apiGet<AgentHoldNotice[]>("/commission/my-holds") });
  const holds = q.data ?? [];
  if (!holds.length) return null;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3" data-testid="hold-notice" role="status">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-amber-200">
        <PauseCircle className="size-4" /> Commission rates stopped
      </div>
      <ul className="space-y-1 text-sm">
        {holds.map((h) => (
          <li key={h.id} className="flex flex-wrap items-baseline gap-x-2" data-testid={`hold-notice-${h.id}`}>
            <b className="text-foreground">{h.insurer ?? "All companies"}</b>
            <span className="text-muted-foreground">· {h.product}</span>
            <span className={cn("text-xs", h.upcoming ? "text-sky-300" : "text-amber-300")}>
              {h.upcoming ? `stops from ${nice(h.hold_from)}` : `stopped from ${nice(h.hold_from)}`}
              {h.released_on ? ` · resumes ${nice(h.released_on)}` : ""}
            </span>
            {h.reason && <span className="text-xs text-muted-foreground">— {h.reason}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted-foreground">No commission is paid on these policies with risk start in the stopped period. Policies before that date are paid as usual.</p>
    </div>
  );
}
