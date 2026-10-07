import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { useAgentGroups, useAgentOptions, useBrokers } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { CommissionMasters, CommissionRule, CommissionRuleIn, RuleKind } from "@/lib/types";

export function useCommissionMasters() {
  return useQuery({ queryKey: ["commission-masters"], queryFn: () => apiGet<CommissionMasters>("/commission/masters"), staleTime: Infinity });
}

export function pctSummary(r: CommissionRuleIn): string {
  const parts: string[] = [];
  if (r.od_percent != null) parts.push(`OD ${r.od_percent}%`);
  if (r.tp_percent != null) parts.push(`TP ${r.tp_percent}%`);
  if (r.net_percent != null) parts.push(`Net ${r.net_percent}%`);
  if (r.odtp_percent != null) parts.push(`OD+TP ${r.odtp_percent}%`);
  if (r.flat_amount != null) parts.push(`₹${r.flat_amount} flat`);
  return parts.join(" · ") || "—";
}

const BLANK = (kind: RuleKind): CommissionRuleIn => ({
  kind, name: "", active: true, insurer: null, broker_id: null, agent_group: null, agent_id: null, products: [], rtos: [], ncb: "any",
  vehicle_ages: [], fuel_types: [], gvw_min: null, gvw_max: null, cc_min: null, cc_max: null, seating_min: null, seating_max: null, make: null, model: null,
  valid_from: null, valid_to: null, od_percent: null, tp_percent: null, net_percent: null, odtp_percent: null, flat_amount: null,
});

// which extra conditions each product type uses (business rule)
const SHOWS: Record<string, { make: boolean; cc: boolean; seating: boolean; gvw: boolean; rto: boolean; age: boolean; fuel: boolean }> = {
  "": { make: false, cc: false, seating: false, gvw: false, rto: true, age: true, fuel: false },
  "Private Car": { make: true, cc: true, seating: false, gvw: false, rto: true, age: true, fuel: true },
  "Two Wheeler": { make: true, cc: true, seating: false, gvw: false, rto: true, age: true, fuel: false },
  PCV: { make: true, cc: false, seating: true, gvw: false, rto: true, age: true, fuel: false },
  GCV: { make: true, cc: false, seating: false, gvw: true, rto: true, age: true, fuel: false },
  "Misc D": { make: true, cc: false, seating: false, gvw: false, rto: true, age: true, fuel: false },
  Health: { make: false, cc: false, seating: false, gvw: false, rto: false, age: false, fuel: false },
  Others: { make: false, cc: false, seating: false, gvw: false, rto: true, age: true, fuel: false },
};

type NumKey = "gvw_min" | "gvw_max" | "cc_min" | "cc_max" | "seating_min" | "seating_max" | "od_percent" | "tp_percent" | "net_percent" | "odtp_percent" | "flat_amount";

function NumInput({ label, value, onChange, testId, suffix }: { label: string; value: number | null; onChange: (v: number | null) => void; testId: string; suffix?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input type="number" step="any" min="0" data-testid={testId} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className={cn("font-mono", suffix && "pr-7")} />
        {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function ChipGroup({ label, options, value, onChange, testId }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; testId: string }) {
  return (
    <div className="space-y-1.5 sm:col-span-3">
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-wrap gap-1.5" data-testid={testId}>
        {options.map((o) => (
          <button key={o} type="button" data-testid={`${testId}-${o.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}
            className={cn("rounded-full border px-2.5 py-1 text-xs transition-[background-color,border-color,color] duration-150",
              value.includes(o) ? "border-primary bg-primary text-white" : "border-border text-muted-foreground hover:border-sky-500/40 hover:text-foreground")}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function RtoPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const masters = useCommissionMasters();
  const states = masters.data?.rto_states ?? [];
  const [stateCode, setStateCode] = useState(value[0]?.slice(0, 2) ?? "TN");
  const st = states.find((s) => s.code === stateCode);
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code].sort());
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid="rule-rto-picker">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs">RTO wise (VAHAN codes)</Label>
        <SimpleSelect value={stateCode} onChange={setStateCode} placeholder="State" testId="rule-rto-state-select" className="min-w-52"
          options={states.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))} />
        {st && (
          <Button type="button" size="sm" variant={value.includes(st.code) ? "default" : "outline"} onClick={() => toggle(st.code)} data-testid="rule-rto-whole-state">
            Whole {st.name}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{value.length ? `${value.length} selected` : "None selected = all RTOs"}</span>
      </div>
      {st && (
        <div className="grid max-h-28 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-10">
          {st.rtos.map((c) => (
            <button key={c} type="button" onClick={() => toggle(c)} data-testid={`rule-rto-${c.toLowerCase()}`}
              className={cn("rounded border px-1 py-0.5 font-mono text-[11px] transition-colors duration-150",
                value.includes(c) ? "border-primary bg-primary text-white" : "border-border text-muted-foreground hover:text-foreground")}>
              {c}
            </button>
          ))}
        </div>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="rule-rto-selected">
          {value.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 font-mono text-[11px] text-sky-200">
              {c}
              <button type="button" aria-label={`Remove ${c}`} onClick={() => toggle(c)}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function RuleDialog({ kind, editing, onClose, onSaved }: { kind: RuleKind; editing: CommissionRule | null; onClose: () => void; onSaved: (r: CommissionRule) => void }) {
  const qc = useQueryClient();
  const masters = useCommissionMasters();
  const brokers = useBrokers();
  const groups = useAgentGroups();
  const agents = useAgentOptions(kind === "payable");
  const [r, setR] = useState<CommissionRuleIn>(editing ? { ...editing } : BLANK(kind));
  const set = <K extends keyof CommissionRuleIn>(k: K, v: CommissionRuleIn[K]) => setR((x) => ({ ...x, [k]: v }));
  const num = (k: NumKey) => ({ value: r[k], onChange: (v: number | null) => set(k, v) });

  const types = masters.data?.product_types ?? {};
  const ptype = Object.keys(types).find((t) => r.products.length > 0 && r.products.every((p) => types[t].includes(p))) ?? "";
  const show = SHOWS[ptype] ?? SHOWS[""];
  const subValue = ptype && r.products.length === 1 && types[ptype].length > 1 ? r.products[0] : "";
  const insurerOptions = [...new Set([...(masters.data?.insurers ?? []), ...(r.insurer ? [r.insurer] : [])])];
  const makeOptions = ptype ? masters.data?.makes[ptype] ?? [] : [];

  const changeType = (t: string) =>
    setR((x) => ({
      ...x,
      products: t ? [...(types[t] ?? [])] : [],
      make: null, model: null, cc_min: null, cc_max: null, seating_min: null, seating_max: null, gvw_min: null, gvw_max: null,
      ...(SHOWS[t]?.fuel ? {} : { fuel_types: [] }),
      ...(SHOWS[t]?.age === false ? { vehicle_ages: [] } : {}),
      ...(SHOWS[t]?.rto === false ? { rtos: [] } : {}),
    }));

  const [added, setAdded] = useState(0);
  const save = useMutation({
    mutationFn: (_next: boolean) => (editing ? apiPut<CommissionRule>(`/commission/rules/${editing.id}`, r) : apiPost<CommissionRule>("/commission/rules", r)),
    onSuccess: (saved, next) => {
      qc.invalidateQueries({ queryKey: ["commission-rules"] });
      qc.invalidateQueries({ queryKey: ["policies"] });
      qc.invalidateQueries({ queryKey: ["commission"] });
      toast.success(`Rule "${saved.name}" ${editing ? "updated" : "saved"} — ${pctSummary(saved)} · applied to existing MIS policies`);
      onSaved(saved);
      if (next) {
        // keep the conditions, clear name + values so the next slab can be keyed straight away
        setAdded((n) => n + 1);
        setR((x) => ({ ...x, name: "", od_percent: null, tp_percent: null, net_percent: null, odtp_percent: null, flat_amount: null }));
      } else onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const isPayable = kind === "payable";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="rule-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading">{editing ? "Edit" : "New"} {isPayable ? "payable rule (to agents)" : "receivable rule (from broker)"}</DialogTitle>
          <DialogDescription>
            Leave a condition empty to apply to all. The rule matching the most conditions wins.{isPayable && " Payable can never exceed the matching receivable."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Rule name</Label>
            <Input data-testid="rule-name-input" value={r.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. ICICI · Private car SAOD · TN" />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <Checkbox data-testid="rule-active-checkbox" checked={r.active} onCheckedChange={(v) => set("active", !!v)} /> Active
          </label>

          <div className="space-y-1">
            <Label className="text-xs">1. Insurance company</Label>
            <SimpleSelect value={r.insurer ?? ""} onChange={(v) => set("insurer", v || null)} allLabel="All insurers" placeholder="Insurer" testId="rule-insurer-select" className="w-full"
              options={insurerOptions.map((i) => ({ value: i, label: i }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">2. Broker</Label>
            <SimpleSelect value={r.broker_id ?? ""} onChange={(v) => set("broker_id", v || null)} allLabel="All brokers" placeholder="Broker" testId="rule-broker-select" className="w-full"
              options={(brokers.data ?? []).map((b) => ({ value: b.id, label: b.name }))} />
          </div>
          {isPayable ? (
            <div className="space-y-1">
              <Label className="text-xs">Agent group / agent</Label>
              <div className="flex gap-1.5">
                <SimpleSelect value={r.agent_group ?? ""} onChange={(v) => set("agent_group", v || null)} allLabel="All groups" placeholder="Group" testId="rule-group-select" className="w-full min-w-0"
                  options={(groups.data ?? []).map((g) => ({ value: g.name, label: `Group ${g.name}` }))} />
                <SimpleSelect value={r.agent_id ?? ""} onChange={(v) => set("agent_id", v || null)} allLabel="All agents" placeholder="Agent" testId="rule-agent-select" className="w-full min-w-0"
                  options={(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.full_name} · ${a.username.toUpperCase()}` }))} />
              </div>
            </div>
          ) : <div />}

          <div className="space-y-1">
            <Label className="text-xs">3. Product type</Label>
            <SimpleSelect value={ptype} onChange={changeType} allLabel="All products" placeholder="Product type" testId="rule-product-type-select" className="w-full"
              options={Object.keys(types).map((t) => ({ value: t, label: t }))} />
          </div>
          {ptype && types[ptype].length > 1 ? (
            <div className="space-y-1">
              <Label className="text-xs">Product</Label>
              <SimpleSelect value={subValue} onChange={(v) => set("products", v ? [v] : [...types[ptype]])} allLabel={`All ${ptype}`} placeholder="Product" testId="rule-product-select" className="w-full"
                options={types[ptype].map((p) => ({ value: p, label: p }))} />
            </div>
          ) : <div />}
          {(
            <div className="space-y-1">
              <Label className="text-xs">NCB</Label>
              <SimpleSelect value={r.ncb} onChange={(v) => set("ncb", v === "with" || v === "without" ? v : "any")} placeholder="NCB" testId="rule-ncb-select" className="w-full"
                options={[{ value: "any", label: "All (with & without NCB)" }, { value: "with", label: "With NCB only" }, { value: "without", label: "Without NCB only" }]} />
            </div>
          )}

          {show.make && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Make (manufacturer)</Label>
                <SimpleSelect value={r.make ?? ""} onChange={(v) => set("make", v || null)} allLabel="All makes" placeholder="Make" testId="rule-make-select" className="w-full"
                  options={makeOptions.map((m) => ({ value: m, label: m }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Model (optional)</Label>
                <Input data-testid="rule-model-input" value={r.model ?? ""} onChange={(e) => set("model", e.target.value || null)} placeholder="All models" />
              </div>
            </>
          )}
          {show.cc && (
            <div className="grid grid-cols-2 gap-1.5">
              <NumInput label="CC from" testId="rule-cc-min" {...num("cc_min")} />
              <NumInput label="CC to" testId="rule-cc-max" {...num("cc_max")} />
            </div>
          )}
          {show.seating && (
            <div className="grid grid-cols-2 gap-1.5">
              <NumInput label="Seating from" testId="rule-seating-min" {...num("seating_min")} />
              <NumInput label="Seating to" testId="rule-seating-max" {...num("seating_max")} />
            </div>
          )}
          {show.gvw && (
            <div className="grid grid-cols-2 gap-1.5">
              <NumInput label="GVW from (kg)" testId="rule-gvw-min" {...num("gvw_min")} />
              <NumInput label="GVW to (kg) · capping" testId="rule-gvw-max" {...num("gvw_max")} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-1">
              <Label className="text-xs">Risk start from</Label>
              <Input type="date" data-testid="rule-valid-from" value={r.valid_from ?? ""} onChange={(e) => set("valid_from", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Risk start to</Label>
              <Input type="date" data-testid="rule-valid-to" value={r.valid_to ?? ""} onChange={(e) => set("valid_to", e.target.value || null)} />
            </div>
          </div>
          {show.age && (
            <ChipGroup label="Vehicle age (at risk start) — none = all ages" testId="rule-age" options={masters.data?.age_bands ?? []} value={r.vehicle_ages} onChange={(v) => set("vehicle_ages", v)} />
          )}
          {show.fuel && (
            <ChipGroup label="Fuel type — none = all" testId="rule-fuel" options={masters.data?.fuel_types ?? []} value={r.fuel_types} onChange={(v) => set("fuel_types", v)} />
          )}
          {show.rto && <div className="sm:col-span-3"><RtoPicker value={r.rtos} onChange={(v) => set("rtos", v)} /></div>}
        </div>

        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
          <p className="label-caps mb-2 text-sky-300">Commission — fill any (they are added together)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <NumInput label="On OD premium" suffix="%" testId="rule-od-percent" {...num("od_percent")} />
            <NumInput label="On TP premium" suffix="%" testId="rule-tp-percent" {...num("tp_percent")} />
            <NumInput label="On Net premium" suffix="%" testId="rule-net-percent" {...num("net_percent")} />
            <NumInput label="On OD + TP" suffix="%" testId="rule-odtp-percent" {...num("odtp_percent")} />
            <NumInput label="Flat amount" suffix="₹" testId="rule-flat-amount" {...num("flat_amount")} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="rule-cancel-button">Cancel</Button>
          {added > 0 && <span data-testid="rule-added-count" className="mr-auto self-center text-xs text-teal-300">{added} rule{added > 1 ? "s" : ""} added in this session</span>}
          {!editing && (
            <Button variant="secondary" onClick={() => save.mutate(true)} disabled={!r.name.trim() || save.isPending} data-testid="rule-save-next-button">
              Save & add next
            </Button>
          )}
          <Button onClick={() => save.mutate(false)} disabled={!r.name.trim() || save.isPending} data-testid="rule-save-button">{save.isPending ? "Saving…" : editing ? "Save rule" : "Save & close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
