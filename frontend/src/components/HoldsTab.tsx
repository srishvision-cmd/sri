import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseCircle, PlayCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/SimpleSelect";
import { MultiSelect } from "@/components/MultiSelect";
import { useCommissionMasters } from "@/components/RuleDialog";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useAgentGroups, useAgentOptions } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import type { CommissionHold, CommissionHoldIn, HoldReleaseIn } from "@/lib/types";
import { cn } from "@/lib/utils";

const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const BLANK = { insurer: "", ptype: "", product: "", scope: "all" as "all" | "selected", agents: [] as string[], groups: [] as string[], from: todayIst(), reason: "" };

function status(h: CommissionHold, today: string): [string, string] {
  if (h.released_on && h.released_on <= today) return ["Released", "bg-muted text-muted-foreground"];
  const ends = h.released_on ? ` · ends ${h.released_on}` : "";
  if (h.hold_from > today) return ["Starts " + h.hold_from + ends, "bg-sky-500/15 text-sky-300"];
  return ["On hold" + ends, "bg-amber-500/15 text-amber-300"];
}

/** Hold agent commission for a company / product from a date (insurer terminated its grid). Rates disappear from agents' rate card. */
export function HoldsTab() {
  const qc = useQueryClient();
  const masters = useCommissionMasters();
  const agents = useAgentOptions();
  const groups = useAgentGroups();
  const holds = useQuery({ queryKey: ["commission-holds"], queryFn: () => apiGet<CommissionHold[]>("/commission/holds") });
  const [f, setF] = useState(BLANK);
  const [releaseOn, setReleaseOn] = useState<Record<string, string>>({});
  const today = todayIst();
  const types = masters.data?.product_types ?? {};
  const agentLabel = (id: string) => { const a = agents.data?.find((x) => x.id === id); return a ? `${a.full_name} (${a.username.toUpperCase()})` : id; };
  const agentOptions = (agents.data ?? []).map((a) => `${a.full_name} (${a.username.toUpperCase()})`);
  const idOf = (label: string) => agents.data?.find((a) => `${a.full_name} (${a.username.toUpperCase()})` === label)?.id ?? label;
  const invalidate = () => ["commission-holds", "policies", "commission", "my-rates", "commission-compare"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const create = useMutation({
    mutationFn: () => apiPost<CommissionHold>("/commission/holds", {
      insurer: f.insurer || null, product_type: f.ptype || null, product: f.product || null,
      agent_ids: f.scope === "selected" ? f.agents : [], agent_groups: f.scope === "selected" ? f.groups : [],
      hold_from: f.from, reason: f.reason.trim() || null,
    } satisfies CommissionHoldIn),
    onSuccess: (h) => { invalidate(); setF({ ...BLANK, from: todayIst() }); toast.success(`Hold saved — ${h.insurer ?? "All companies"} from ${h.hold_from}`); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const release = useMutation({
    mutationFn: ({ id, on }: { id: string; on: string }) => apiPost<CommissionHold>(`/commission/holds/${id}/release`, { released_on: on || null } satisfies HoldReleaseIn),
    onSuccess: (h) => { invalidate(); toast.success(`Hold released — policies from ${h.released_on} get commission again`); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/commission/holds/${id}`),
    onSuccess: () => { invalidate(); toast.success("Hold deleted"); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const needsPick = f.scope === "selected" && f.agents.length === 0 && f.groups.length === 0;

  return (
    <div className="space-y-5" data-testid="holds-tab">
      <p className="text-sm text-muted-foreground">
        When a company stops its grid, put it on hold from that date. Policies with risk start <b className="text-foreground">before</b> the hold date are paid as normal;
        policies on/after it get <b className="text-foreground">no agent commission</b> until you release the hold, and the held rates are hidden from the agents' rate card from the hold date.
        You can save a hold in advance (e.g. today for 15 Oct).
      </p>

      <div className="grid gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 md:grid-cols-3" data-testid="hold-form">
        <div className="space-y-1">
          <Label className="text-xs">Insurance company</Label>
          <SimpleSelect value={f.insurer} onChange={(v) => setF({ ...f, insurer: v })} allLabel="All companies" placeholder="Company" testId="hold-insurer-select" className="w-full" searchable
            options={(masters.data?.insurers ?? []).map((n) => ({ value: n, label: n }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Product type</Label>
          <SimpleSelect value={f.ptype} onChange={(v) => setF({ ...f, ptype: v, product: "" })} allLabel="All products" placeholder="Product type" testId="hold-ptype-select" className="w-full"
            options={Object.keys(types).map((t) => ({ value: t, label: t }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Product (optional)</Label>
          <SimpleSelect value={f.product} onChange={(v) => setF({ ...f, product: v })} allLabel={f.ptype ? `All ${f.ptype}` : "Pick a product type first"} placeholder="Product" testId="hold-product-select" className="w-full"
            options={(types[f.ptype] ?? []).map((p) => ({ value: p, label: p }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Agents</Label>
          <div className="flex gap-1.5" data-testid="hold-scope">
            {(["all", "selected"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setF({ ...f, scope: s })} data-testid={`hold-scope-${s}`}
                className={cn("rounded-full border px-3 py-1 text-xs transition-colors duration-150", f.scope === s ? "border-primary bg-primary text-white" : "border-border text-muted-foreground hover:text-foreground")}>
                {s === "all" ? "All agents" : "Selected agents / groups"}
              </button>
            ))}
          </div>
        </div>
        {f.scope === "selected" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Agents</Label>
              <MultiSelect value={f.agents.map(agentLabel)} onChange={(v) => setF({ ...f, agents: v.map(idOf) })} options={agentOptions} placeholder="Pick agents" testId="hold-agents-select" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Agent groups</Label>
              <MultiSelect value={f.groups} onChange={(v) => setF({ ...f, groups: v })} options={(groups.data ?? []).map((g) => g.name)} placeholder="Pick groups" testId="hold-groups-select" />
            </div>
          </>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Hold from (policy risk start)</Label>
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="h-9" data-testid="hold-from-input" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">Reason</Label>
          <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. ICICI terminated grid" data-testid="hold-reason-input" />
        </div>
        <div className="flex items-end md:col-span-3">
          {needsPick && <span className="mr-auto text-xs text-amber-300">Pick at least one agent or group.</span>}
          <Button className="ml-auto" disabled={!f.from || needsPick || create.isPending} onClick={() => create.mutate()} data-testid="hold-save-button">
            <PauseCircle className="size-4" /> {create.isPending ? "Saving…" : "Put on hold"}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card" data-testid="holds-list">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Company · product</th><th className="px-3 py-2">Agents</th><th className="px-3 py-2">Hold from</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {(holds.data ?? []).map((h) => {
              const [label, tone] = status(h, today);
              const open = !h.released_on;
              return (
                <tr key={h.id} className="border-t border-border/60 align-top" data-testid={`hold-row-${h.id}`}>
                  <td className="px-3 py-2"><div className="font-medium">{h.insurer ?? "All companies"}</div><div className="text-xs text-muted-foreground">{h.product ?? h.product_type ?? "All products"}</div></td>
                  <td className="px-3 py-2 text-xs">
                    {!h.agent_ids.length && !h.agent_groups.length ? "All agents" : [...h.agent_groups.map((g) => `Group ${g}`), ...h.agent_ids.map(agentLabel)].join(", ")}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{h.hold_from}{h.released_on && <div className="text-muted-foreground">to {h.released_on} (released)</div>}</td>
                  <td className="px-3 py-2 text-xs">{h.reason ?? "—"}<div className="text-[10px] text-muted-foreground">by {h.created_by_name}{h.released_by_name ? ` · released by ${h.released_by_name}` : ""}</div></td>
                  <td className="px-3 py-2"><span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]", tone)} data-testid={`hold-status-${h.id}`}>{label}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      {open && (
                        <>
                          <Input type="date" value={releaseOn[h.id] ?? today} onChange={(e) => setReleaseOn({ ...releaseOn, [h.id]: e.target.value })} className="h-8 w-36 text-xs" data-testid={`hold-release-date-${h.id}`} />
                          <Button size="sm" variant="secondary" disabled={release.isPending} data-testid={`hold-release-${h.id}`}
                            onClick={() => release.mutate({ id: h.id, on: releaseOn[h.id] ?? today })}>
                            <PlayCircle className="size-3.5" /> Release
                          </Button>
                        </>
                      )}
                      <Button size="icon-sm" variant="ghost" aria-label="Delete hold" data-testid={`hold-delete-${h.id}`}
                        onClick={() => window.confirm("Delete this hold completely? Policies in its period will get commission again.") && remove.mutate(h.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {holds.isSuccess && holds.data.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">No holds. Every grid is active.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
