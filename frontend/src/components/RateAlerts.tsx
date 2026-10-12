import { Link } from "react-router-dom";
import { BellRing, CalendarClock, TrendingDown, TrendingUp } from "lucide-react";
import { niceDate, rateParts } from "@/lib/rates";
import { cn } from "@/lib/utils";
import type { AgentRate } from "@/lib/types";

const ENDING_SOON_DAYS = 30;

/** Conditions only (no dates / rates / ids) — rows with the same key are versions of one grid line. */
const condKey = (r: AgentRate) =>
  JSON.stringify([r.insurer, [...r.products].sort(), [...r.rtos].sort(), r.ncb, r.cover, r.gvw_min, r.gvw_max, r.cc_min, r.cc_max,
    [...r.vehicle_ages].sort(), [...r.fuel_types].sort(), r.seating_min, r.seating_max, [...r.makes].sort(), r.model]);
const rateText = (r: AgentRate) => rateParts(r).map((p) => `${p.value} ${p.of.replace(/ \(.*\)/, "")}`).join(" + ");
const total = (r: AgentRate) => (r.od_percent ?? 0) + (r.tp_percent ?? 0) + (r.net_percent ?? 0) + (r.odtp_percent ?? 0);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

export interface RateAlert {
  id: string;
  kind: "up" | "down" | "new" | "ending";
  date: string;
  title: string;
  detail: string;
}

export function rateAlerts(rates: AgentRate[], today: string): RateAlert[] {
  const out: RateAlert[] = [];
  const current = rates.filter((r) => !r.upcoming);
  for (const r of rates.filter((x) => x.upcoming && x.valid_from)) {
    const old = current.find((c) => condKey(c) === condKey(r));
    const what = `${r.insurer ?? "Any company"} · ${r.name}`;
    if (!old) out.push({ id: r.id, kind: "new", date: r.valid_from!, title: `New rate from ${niceDate(r.valid_from!)}`, detail: `${what}: ${rateText(r)}` });
    else out.push({ id: r.id, kind: total(r) >= total(old) ? "up" : "down", date: r.valid_from!, title: `Your rate changes from ${niceDate(r.valid_from!)}`, detail: `${what}: ${rateText(old)} → ${rateText(r)}` });
  }
  const soon = addDays(today, ENDING_SOON_DAYS);
  for (const r of current.filter((x) => x.valid_to && x.valid_to <= soon)) {
    if (rates.some((u) => u.upcoming && condKey(u) === condKey(r))) continue; // already announced as a change
    out.push({ id: r.id, kind: "ending", date: r.valid_to!, title: `Rate ends on ${niceDate(r.valid_to!)}`, detail: `${r.insurer ?? "Any company"} · ${r.name}: ${rateText(r)}` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const STYLE = {
  up: { icon: TrendingUp, tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  down: { icon: TrendingDown, tone: "border-red-500/40 bg-red-500/10 text-red-300" },
  new: { icon: CalendarClock, tone: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  ending: { icon: CalendarClock, tone: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
};

export function RateAlerts({ rates, today, link = false, max = 6 }: { rates: AgentRate[]; today: string; link?: boolean; max?: number }) {
  const alerts = rateAlerts(rates, today);
  if (!alerts.length) return null;
  return (
    <section data-testid="rate-alerts" className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-heading text-base font-semibold">
          <BellRing className="size-4 animate-pulse text-violet-300" /> Rate changes coming up
          <span className="rounded-full bg-violet-500/20 px-2 text-xs text-violet-200">{alerts.length}</span>
        </h3>
        {link && <Link to="/my-rates" data-testid="rate-alerts-open" className="text-xs text-violet-300 underline-offset-2 hover:underline">See my rates →</Link>}
      </div>
      <ul className="grid gap-2 md:grid-cols-2">
        {alerts.slice(0, max).map((a) => {
          const S = STYLE[a.kind];
          return (
            <li key={a.id} data-testid={`rate-alert-${a.id}`} className={cn("flex gap-3 rounded-lg border p-3", S.tone)}>
              <S.icon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{a.title}</p>
                <p className="mt-0.5 text-sm text-foreground/90">{a.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {alerts.length > max && <p className="mt-2 text-xs text-muted-foreground">+{alerts.length - max} more on your rate card.</p>}
    </section>
  );
}
