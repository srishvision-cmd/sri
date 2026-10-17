import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { ComboBox, MultiSelect } from "@/components/MultiSelect";
import { RecalcDialog } from "@/components/RecalcDialog";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { useAgentGroups, useAgentOptions, useBrokers } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import { COVER_OPTS, COVER_TYPES, NCB_OPTS, showsFor } from "@/lib/ruleShows";
import type { CommissionMasters, CommissionRule, CommissionRuleIn, CompanyZone, CompanyZoneIn, RangePolicies, RuleKind, VehicleModelIn } from "@/lib/types";

export function useCommissionMasters() {
  return useQuery({ queryKey: ["commission-masters"], queryFn: () => apiGet<CommissionMasters>("/commission/masters"), staleTime: Infinity });
}

export function useCompanyZones() {
  return useQuery({ queryKey: ["company-zones"], queryFn: () => apiGet<CompanyZone[]>("/commission/zones") });
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
  kind, name: "", active: true, insurer: null, broker_ids: [], agent_group: null, agent_id: null, products: [], rtos: [], ncb: "any", cover: "any",
  vehicle_ages: [], fuel_types: [], business_types: [], gvw_min: null, gvw_max: null, cc_min: null, cc_max: null, seating_min: null, seating_max: null, makes: [], model: null,
  valid_from: null, valid_to: null, od_percent: null, tp_percent: null, net_percent: null, odtp_percent: null, flat_amount: null,
});

// which extra conditions each product type uses — shared with the AI grid check screen

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
        <button type="button" data-testid={`${testId}-all`} onClick={() => onChange([])}
          className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-[background-color,border-color,color] duration-150",
            value.length === 0 ? "border-primary bg-primary text-white" : "border-border text-muted-foreground hover:border-sky-500/40 hover:text-foreground")}>
          All
        </button>
        {options.map((o) => (
          <button key={o} type="button" data-testid={`${testId}-${o.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            onClick={() => {
              const next = value.includes(o) ? value.filter((x) => x !== o) : [...value, o];
              onChange(options.every((x) => next.includes(x)) ? [] : next); // every option picked = All
            }}
            className={cn("rounded-full border px-2.5 py-1 text-xs transition-[background-color,border-color,color] duration-150",
              value.includes(o) ? "border-primary bg-primary text-white" : "border-border text-muted-foreground hover:border-sky-500/40 hover:text-foreground")}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function RtoPicker({ value, onChange, insurer }: { value: string[]; onChange: (v: string[]) => void; insurer: string | null }) {
  const qc = useQueryClient();
  const masters = useCommissionMasters();
  const companyZones = useCompanyZones();
  const states = masters.data?.rto_states ?? [];
  const [stateCode, setStateCode] = useState(value[0]?.slice(0, 2) ?? "TN");
  const [zoneName, setZoneName] = useState("");
  const st = states.find((s) => s.code === stateCode);
  const inState = (rtos: string[]) => rtos.some((c) => c.startsWith(stateCode));
  // quick zones only for the state being viewed; the company's own zones come first
  const ownZones = (companyZones.data ?? []).filter((z) => (!z.insurer || z.insurer === insurer) && inState(z.rtos));
  const stdZones = (masters.data?.rto_zones ?? []).filter((z) => inState(z.rtos));
  // a whole-state code (e.g. TN) and individual codes / zones of that state are mutually exclusive
  const toggle = (code: string) => {
    if (value.includes(code)) return onChange(value.filter((c) => c !== code));
    const next = code.length === 2 ? value.filter((c) => !c.startsWith(code)) : value.filter((c) => c !== code.slice(0, 2));
    onChange([...next, code].sort());
  };
  const zoneOn = (rtos: string[]) => rtos.every((c) => value.includes(c)) && !value.some((c) => c.length === 2 && rtos.some((x) => x.startsWith(c)));
  const toggleZone = (rtos: string[]) =>
    onChange(zoneOn(rtos) ? value.filter((c) => !rtos.includes(c)) : [...new Set([...value.filter((c) => c.length !== 2 || !rtos.some((x) => x.startsWith(c))), ...rtos])].sort());
  const saveZone = useMutation({
    mutationFn: (body: CompanyZoneIn) => apiPost<CompanyZone>("/commission/zones", body),
    onSuccess: (z) => { qc.invalidateQueries({ queryKey: ["company-zones"] }); toast.success(`Zone "${z.name}" saved for ${z.insurer ?? "all companies"} (${z.rtos.length} RTOs)`); setZoneName(""); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const delZone = useMutation({
    mutationFn: (id: string) => apiDelete(`/commission/zones/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["company-zones"] }); toast.success("Zone removed"); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
      {(ownZones.length > 0 || stdZones.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="rule-rto-zones">
          <span className="text-[11px] text-muted-foreground">Quick zones:</span>
          {ownZones.map((z) => (
            <span key={z.id} className="inline-flex items-center">
              <Button type="button" size="sm" variant={zoneOn(z.rtos) ? "default" : "outline"} className="rounded-r-none border-teal-500/50" data-testid={`rule-company-zone-${slug(z.name)}`} onClick={() => toggleZone(z.rtos)}
                title={z.rtos.join(", ")}>
                {z.name} <span className="font-mono text-[10px] opacity-70">({z.rtos.length})</span>
              </Button>
              <Button type="button" size="sm" variant="outline" className="rounded-l-none border-l-0 border-teal-500/50 px-1.5" aria-label={`Delete zone ${z.name}`} data-testid={`rule-company-zone-delete-${slug(z.name)}`}
                onClick={() => window.confirm(`Delete ${insurer} zone "${z.name}"? Rules already saved keep their RTOs.`) && delZone.mutate(z.id)}>
                <X className="size-3" />
              </Button>
            </span>
          ))}
          {stdZones.map((z) => (
            <Button key={z.name} type="button" size="sm" variant={zoneOn(z.rtos) ? "default" : "outline"} data-testid={`rule-rto-zone-${z.name.split(" ")[0].toLowerCase()}`} onClick={() => toggleZone(z.rtos)}>
              {z.name} <span className="font-mono text-[10px] opacity-70">({z.rtos.length})</span>
            </Button>
          ))}
        </div>
      )}
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
      {value.length > 0 && (
        insurer ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2" data-testid="rule-zone-save">
            <span className="text-[11px] text-muted-foreground">Save these {value.length} RTOs as a {insurer} zone:</span>
            <Input data-testid="rule-zone-name-input" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="Zone name, e.g. Chennai" className="h-8 w-44 text-xs" />
            <Button type="button" size="sm" variant="secondary" data-testid="rule-zone-save-button" disabled={!zoneName.trim() || saveZone.isPending}
              onClick={() => saveZone.mutate({ insurer, name: zoneName.trim(), rtos: value })}>
              <Save className="size-3.5" /> Save zone
            </Button>
          </div>
        ) : <p className="text-[11px] text-muted-foreground">Pick an insurance company to save these RTOs as that company's zone.</p>
      )}
    </div>
  );
}

export function RuleDialog({ kind, editing, preset, keepProducts, onClose, onSaved }: {
  kind: RuleKind; editing: CommissionRule | null; preset?: Partial<CommissionRuleIn>; keepProducts?: boolean; onClose: () => void; onSaved: (r: CommissionRule) => void;
}) {
  const qc = useQueryClient();
  const masters = useCommissionMasters();
  const brokers = useBrokers();
  const groups = useAgentGroups();
  const agents = useAgentOptions(kind === "payable");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST
  const typesInit = masters.data?.product_types ?? {};
  const initial: CommissionRuleIn = editing
    ? { ...editing, makes: editing.makes ?? [], business_types: editing.business_types ?? [], valid_from: editing.valid_from && editing.valid_from > today ? editing.valid_from : today, apply_to_past: false }
    : { ...BLANK(kind), ...preset };
  const typeOfProducts = (products: string[]) => Object.keys(typesInit).find((t) => products.length > 0 && products.every((p) => typesInit[t].includes(p))) ?? "";
  const initType = typeOfProducts(initial.products);
  // PCV: product must be chosen — never default to every PCV product on a new rule
  if (!editing && !keepProducts && initType === "PCV" && initial.products.length === typesInit.PCV.length) initial.products = [];
  const [r, setR] = useState<CommissionRuleIn>(initial);
  const [ptype, setPtype] = useState(initType);
  const rules = useQuery({ queryKey: ["commission-rules"], queryFn: () => apiGet<CommissionRule[]>("/commission/rules") });
  const set = <K extends keyof CommissionRuleIn>(k: K, v: CommissionRuleIn[K]) => setR((x) => ({ ...x, [k]: v }));
  const num = (k: NumKey) => ({ value: r[k], onChange: (v: number | null) => set(k, v) });

  const types = masters.data?.product_types ?? {};
  const show = showsFor(ptype);
  const subValue = ptype && r.products.length === 1 && types[ptype].length > 1 ? r.products[0] : "";
  const insurerOptions = [...new Set([...(masters.data?.insurers ?? []), ...(r.insurer ? [r.insurer] : [])])];
  const makeOptions = [...new Set([...(ptype ? masters.data?.makes[ptype] ?? [] : []), ...r.makes])];
  const modelOptions = [...new Set(r.makes.flatMap((m) => masters.data?.models[m] ?? []))].sort();
  const fuelOptions = masters.data?.fuel_by_type[ptype] ?? masters.data?.fuel_types ?? [];
  const pcvMissing = ptype === "PCV" && r.products.length === 0;
  const gvwMissing = ptype === "GCV" && r.gvw_min == null && r.gvw_max == null;
  const blockers = [!r.name.trim() && "Rule name", pcvMissing && "PCV product", gvwMissing && "GVW slab"].filter(Boolean) as string[];
  // auto-suggested rule name from the chosen conditions
  const zoneNames = (useCompanyZones().data ?? []).filter((z) => !z.insurer || z.insurer === r.insurer).concat((masters.data?.rto_zones ?? []).map((z) => ({ ...z, id: z.name, insurer: "", created_at: "" })));
  const rtoText = (() => {
    let rest = [...r.rtos];
    const parts: string[] = [];
    for (const z of zoneNames) if (z.rtos.length && z.rtos.every((c) => rest.includes(c))) { parts.push(z.name.replace(/ RTOs$/, "")); rest = rest.filter((c) => !z.rtos.includes(c)); }
    return [...parts, ...rest.slice(0, 4), ...(rest.length > 4 ? ["…"] : [])].join(", ");
  })();
  const suggestion = [
    (r.insurer ?? "All companies").split(" /")[0], ptype || "All products",
    ptype && r.products.length && r.products.length < (types[ptype]?.length ?? 0) ? r.products.filter((x) => x !== ptype).join(", ") : "",
    r.cover !== "any" && COVER_TYPES.includes(ptype) ? r.cover.toUpperCase() : "",
    r.gvw_min != null || r.gvw_max != null ? `GVW ${r.gvw_min ?? 0}-${r.gvw_max ?? "∞"}` : "",
    r.makes.join(", "), r.fuel_types.join("/"), rtoText,
  ].filter(Boolean).join(" · ");
  const usedNames = [...new Set((rules.data ?? []).filter((x) => x.kind === kind).map((x) => x.name))].sort();
  const addModel = useMutation({
    mutationFn: (body: VehicleModelIn) => apiPost("/commission/models", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commission-masters"] }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const changeType = (t: string) => {
    setPtype(t);
    setR((x) => ({
      ...x,
      products: t && t !== "PCV" ? [...(types[t] ?? [])] : [],
      makes: [], model: null, cc_min: null, cc_max: null, seating_min: null, seating_max: null, gvw_min: null, gvw_max: null,
      fuel_types: [],
      ...(showsFor(t).age === false ? { vehicle_ages: [] } : {}),
      ...(showsFor(t).rto === false ? { rtos: [] } : {}),
    }));
  };

  const [added, setAdded] = useState(0);
  const [rangeRule, setRangeRule] = useState<CommissionRule | null>(null);
  const save = useMutation({
    mutationFn: (_next: boolean) => {
      const body = { ...r, cover: COVER_TYPES.includes(ptype) ? r.cover : ("any" as const) };  // cover filter only for PCV / GCV / Misc D
      return editing ? apiPut<CommissionRule>(`/commission/rules/${editing.id}`, body) : apiPost<CommissionRule>("/commission/rules", body);
    },
    onSuccess: (saved, next) => {
      qc.invalidateQueries({ queryKey: ["commission-rules"] });
      qc.invalidateQueries({ queryKey: ["policies"] });
      qc.invalidateQueries({ queryKey: ["commission"] });
      const past = !!saved.valid_from && saved.valid_from < today;
      toast.success(`Rule "${saved.name}" ${editing ? "updated" : "saved"} — ${pctSummary(saved)} · applies to new policies${saved.valid_from ? ` from ${saved.valid_from}` : ""}${saved.valid_to ? ` to ${saved.valid_to}` : ""}; saved commission of existing policies is unchanged`);
      onSaved(saved);
      if (past && !next) setRangeRule(saved); // offer an explicit, admin-only recalculation of the range — never automatic
      else if (next) {
        // keep the conditions, clear name + values so the next slab can be keyed straight away
        setAdded((n) => n + 1);
        setR((x) => ({ ...x, name: "", od_percent: null, tp_percent: null, net_percent: null, odtp_percent: null, flat_amount: null }));
      } else onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const isPayable = kind === "payable";
  if (rangeRule) return <RangeRecalcPrompt rule={rangeRule} onClose={onClose} />;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="rule-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading">{editing ? "Edit" : "New"} {isPayable ? "payable rule (to partners)" : "receivable rule (from channel partner)"}</DialogTitle>
          <DialogDescription>
            Leave a condition empty to apply to all. The rule matching the most conditions wins.{isPayable && " Payable can never exceed the matching receivable."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Rule name — pick the suggestion, an earlier name, or type a new one</Label>
            <ComboBox value={r.name} onChange={(v) => set("name", v)} options={usedNames} suggestion={suggestion} placeholder="Select rule name" testId="rule-name-input" addLabel="Use new name" />
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
            <Label className="text-xs">2. Channel Partners — none = all</Label>
            <MultiSelect value={r.broker_ids.map((id) => brokers.data?.find((b) => b.id === id)?.name ?? id)}
              onChange={(v) => set("broker_ids", v.map((n) => brokers.data?.find((b) => b.name === n)?.id ?? n))}
              options={(brokers.data ?? []).map((b) => b.name)} placeholder="All channel partners" testId="rule-broker-select" />
          </div>
          {isPayable ? (
            <div className="space-y-1">
              <Label className="text-xs">Partner group / partner</Label>
              <div className="flex gap-1.5">
                <SimpleSelect value={r.agent_group ?? ""} onChange={(v) => set("agent_group", v || null)} allLabel="All groups" placeholder="Group" testId="rule-group-select" className="w-full min-w-0"
                  options={(groups.data ?? []).map((g) => ({ value: g.name, label: `Group ${g.name}` }))} />
                <SimpleSelect value={r.agent_id ?? ""} onChange={(v) => set("agent_id", v || null)} allLabel="All partners" placeholder="Partner" testId="rule-agent-select" className="w-full min-w-0" searchable
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
              <Label className="text-xs">{ptype === "PCV" ? "Product (required)" : "Product"}</Label>
              {ptype === "PCV" ? (
                <MultiSelect value={r.products} onChange={(v) => set("products", v)} options={types[ptype]} placeholder="Select PCV product(s)" testId="rule-product-select"
                  className={cn(pcvMissing && "border-amber-400/70")} />
              ) : (
                <SimpleSelect value={subValue} onChange={(v) => set("products", v ? [v] : [...types[ptype]])} allLabel={`All ${ptype}`} placeholder="Product" testId="rule-product-select" className="w-full"
                  options={types[ptype].map((p) => ({ value: p, label: p }))} />
              )}
            </div>
          ) : <div />}
          {(
            <div className="space-y-1">
              <Label className="text-xs">NCB</Label>
              <SimpleSelect value={r.ncb} onChange={(v) => set("ncb", v === "with" || v === "without" ? v : "any")} placeholder="NCB" testId="rule-ncb-select" className="w-full"
                options={NCB_OPTS} />
            </div>
          )}
          {COVER_TYPES.includes(ptype) && (
            <div className="space-y-1">
              <Label className="text-xs">Package / SATP</Label>
              <SimpleSelect value={r.cover} onChange={(v) => set("cover", v === "package" || v === "satp" ? v : "any")} placeholder="Cover" testId="rule-cover-select" className="w-full"
                options={COVER_OPTS} />
            </div>
          )}

          {show.make && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Makes (pick one or more) — none = all</Label>
                <MultiSelect value={r.makes} onChange={(v) => setR((x) => ({ ...x, makes: v, model: v.length ? x.model : null }))} options={makeOptions} placeholder="All makes" testId="rule-make-select" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Model (optional)</Label>
                {r.makes.length ? (
                  <ComboBox value={r.model ?? ""} onChange={(v) => set("model", v || null)} options={modelOptions} placeholder="All models" testId="rule-model-input" addLabel="Add model"
                    onAdd={(m) => r.makes.length === 1 && addModel.mutate({ make: r.makes[0], model: m })} />
                ) : <Input data-testid="rule-model-input" disabled placeholder="Pick a make first" />}
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
              <NumInput label="GVW from (kg) *" testId="rule-gvw-min" {...num("gvw_min")} />
              <NumInput label="GVW to (kg) · capping *" testId="rule-gvw-max" {...num("gvw_max")} />
              {gvwMissing && <p className="col-span-2 text-[11px] text-amber-300" data-testid="rule-gvw-required">GVW is required for GCV rules.</p>}
            </div>
          )}
          <div className="space-y-1 sm:col-span-2" data-testid="rule-effective-from">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-1">
                <Label className="text-xs">{editing ? "Revised rate applicable from" : "Applicable from (optional)"}</Label>
                <Input type="date" data-testid="rule-valid-from" value={r.valid_from ?? ""} onChange={(e) => set("valid_from", e.target.value || null)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Applicable to (optional)</Label>
                <Input type="date" data-testid="rule-valid-to" value={r.valid_to ?? ""} min={r.valid_from ?? undefined} onChange={(e) => set("valid_to", e.target.value || null)} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground" data-testid="rule-date-help">
              {editing
                ? "Default: the revised rate applies to new policies from this date. Set a From–To range to revise ONLY that period — the old rate stays before and after it."
                : "Rates apply to new policies matched by risk start date (blank = no date limit)."}{" "}
              <b className="text-foreground">Commission already saved on existing policies never changes</b> — an admin can recalculate selected policies explicitly.
            </p>
          </div>
          {show.age && (
            <ChipGroup label="Vehicle age (at risk start)" testId="rule-age" options={masters.data?.age_bands ?? []} value={r.vehicle_ages} onChange={(v) => set("vehicle_ages", v)} />
          )}
          <ChipGroup label="Business type" testId="rule-business-type"
            options={masters.data?.business_types ?? ["New", "Renewal", "Rollover", "Used"]}
            value={r.business_types ?? []} onChange={(v) => set("business_types", v)} />
          {show.fuel && (
            <ChipGroup label="Fuel type" testId="rule-fuel"
              options={fuelOptions}
              value={r.fuel_types} onChange={(v) => set("fuel_types", v)} />
          )}
          {show.rto && <div className="sm:col-span-3"><RtoPicker value={r.rtos} onChange={(v) => set("rtos", v)} insurer={r.insurer} /></div>}
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
          {blockers.length > 0 && <span data-testid="rule-required-hint" className="mr-auto self-center text-xs text-amber-300">Required: {blockers.join(", ")}</span>}
          {added > 0 && <span data-testid="rule-added-count" className="mr-auto self-center text-xs text-teal-300">{added} rule{added > 1 ? "s" : ""} added in this session</span>}
          {!editing && (
            <Button variant="secondary" onClick={() => save.mutate(true)} disabled={blockers.length > 0 || save.isPending} data-testid="rule-save-next-button">
              Save & add next
            </Button>
          )}
          <Button onClick={() => save.mutate(false)} disabled={blockers.length > 0 || save.isPending} data-testid="rule-save-button">{save.isPending ? "Saving…" : editing ? "Save rule" : "Save & close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** After a revision whose dates start in the past: existing policies of that range keep their saved commission unless the admin
 * explicitly reviews and recalculates them (preview + reason + audit). */
function RangeRecalcPrompt({ rule, onClose }: { rule: CommissionRule; onClose: () => void }) {
  const [recalc, setRecalc] = useState(false);
  const q = useQuery({ queryKey: ["range-policies", rule.id], queryFn: () => apiGet<RangePolicies>(`/commission/rules/${rule.id}/range-policies`) });
  const n = q.data?.count ?? 0;
  if (recalc && q.data) return <RecalcDialog policyIds={q.data.policy_ids} onClose={onClose} />;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="range-recalc-prompt" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Rate saved for {rule.valid_from} → {rule.valid_to ?? "onwards"}</DialogTitle>
          <DialogDescription>
            New policies in this range get the revised rate. {q.isLoading ? "Checking existing policies…" : `${n} existing ${rule.insurer ?? ""} polic${n === 1 ? "y" : "ies"} with risk start in this range keep their saved commission.`}
            {" "}Only if the revision must also correct them, review the existing vs revised amounts and recalculate (admin, with a reason — every change is audited). Policies outside the range are never touched.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="range-recalc-skip">Keep existing policies unchanged</Button>
          <Button disabled={!n} onClick={() => setRecalc(true)} data-testid="range-recalc-review">Review & recalculate {n > 500 ? "first 500" : n}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
