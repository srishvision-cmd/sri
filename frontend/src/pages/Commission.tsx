import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { useAgentGroups, useAgentOptions, useBrokers, useMeta } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { Broker, BrokerIn, CommissionRule, CommissionRuleIn, RuleKind } from "@/lib/types";

type Tab = "receivable" | "payable" | "brokers" | "groups";

const NUM_KEYS = ["gvw_min", "gvw_max", "cc_min", "cc_max", "od_percent", "tp_percent", "net_percent", "odtp_percent", "flat_amount"] as const;
type NumKey = (typeof NUM_KEYS)[number];

const BLANK_RULE = (kind: RuleKind): CommissionRuleIn => ({
  kind, name: "", active: true, insurer: null, broker_id: null, agent_group: null, agent_id: null, products: [], rtos: [], ncb: "any",
  gvw_min: null, gvw_max: null, cc_min: null, cc_max: null, make: null, model: null, valid_from: null, valid_to: null,
  od_percent: null, tp_percent: null, net_percent: null, odtp_percent: null, flat_amount: null,
});

function pctSummary(r: CommissionRuleIn): string {
  const parts: string[] = [];
  if (r.od_percent != null) parts.push(`OD ${r.od_percent}%`);
  if (r.tp_percent != null) parts.push(`TP ${r.tp_percent}%`);
  if (r.net_percent != null) parts.push(`Net ${r.net_percent}%`);
  if (r.odtp_percent != null) parts.push(`OD+TP ${r.odtp_percent}%`);
  if (r.flat_amount != null) parts.push(`₹${r.flat_amount} flat`);
  return parts.join(" · ") || "—";
}

function NumInput({ label, value, onChange, testId, suffix }: { label: string; value: number | null; onChange: (v: number | null) => void; testId: string; suffix?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          step="any"
          min="0"
          data-testid={testId}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={cn("font-mono", suffix && "pr-7")}
        />
        {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function RuleDialog({ kind, editing, onClose }: { kind: RuleKind; editing: CommissionRule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const brokers = useBrokers();
  const groups = useAgentGroups();
  const agents = useAgentOptions(kind === "payable");
  const insurers = useQuery({ queryKey: ["commission-insurers"], queryFn: () => apiGet<string[]>("/commission/insurers") });
  const [r, setR] = useState<CommissionRuleIn>(editing ? { ...editing } : BLANK_RULE(kind));
  const [rtoText, setRtoText] = useState((editing?.rtos ?? []).join(", "));
  const set = <K extends keyof CommissionRuleIn>(k: K, v: CommissionRuleIn[K]) => setR((x) => ({ ...x, [k]: v }));
  const num = (k: NumKey) => ({ value: r[k], onChange: (v: number | null) => set(k, v) });

  const save = useMutation({
    mutationFn: () => {
      const body: CommissionRuleIn = { ...r, rtos: rtoText.split(/[,\s]+/).filter(Boolean) };
      return editing ? apiPut<CommissionRule>(`/commission/rules/${editing.id}`, body) : apiPost<CommissionRule>("/commission/rules", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commission-rules"] });
      qc.invalidateQueries({ queryKey: ["policies"] });
      qc.invalidateQueries({ queryKey: ["commission"] });
      toast.success(editing ? "Rule updated" : "Rule added");
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggleProduct = (p: string) => set("products", r.products.includes(p) ? r.products.filter((x) => x !== p) : [...r.products, p]);
  const isPayable = kind === "payable";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="rule-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {editing ? "Edit" : "New"} {isPayable ? "payable rule (to agents)" : "receivable rule (from broker)"}
          </DialogTitle>
          <DialogDescription>
            Leave a condition empty to apply to all. When several rules match a policy, the one with the most matching conditions wins.
            {isPayable && " Payable values can never exceed the matching receivable."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Rule name</Label>
            <Input data-testid="rule-name-input" value={r.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. ICICI · Private car package · TN" />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <Checkbox data-testid="rule-active-checkbox" checked={r.active} onCheckedChange={(v) => set("active", !!v)} /> Active
          </label>

          <div className="space-y-1">
            <Label className="text-xs">1. Insurance company</Label>
            <Input list="insurer-list" data-testid="rule-insurer-input" value={r.insurer ?? ""} onChange={(e) => set("insurer", e.target.value || null)} placeholder="All insurers" />
            <datalist id="insurer-list">{(insurers.data ?? []).map((i) => <option key={i} value={i} />)}</datalist>
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

          <div className="space-y-1.5 sm:col-span-3">
            <Label className="text-xs">3. Products (common codes) — none ticked = all products</Label>
            <div data-testid="rule-products" className="flex flex-wrap gap-1.5">
              {(meta.data?.product_categories ?? []).map((p) => (
                <button key={p} type="button" onClick={() => toggleProduct(p)} data-testid={`rule-product-${p.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  className={cn("rounded-full border px-2.5 py-1 text-xs transition-[background-color,border-color,color] duration-150",
                    r.products.includes(p) ? "border-primary bg-primary text-white" : "border-border text-muted-foreground hover:border-sky-500/40 hover:text-foreground")}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">RTO wise (TN = whole state, TN10 = one RTO)</Label>
            <Input data-testid="rule-rto-input" value={rtoText} onChange={(e) => setRtoText(e.target.value.toUpperCase())} placeholder="All RTOs — e.g. TN01, TN10" className="font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">NCB</Label>
            <SimpleSelect value={r.ncb} onChange={(v) => set("ncb", v === "with" || v === "without" ? v : "any")} placeholder="NCB" testId="rule-ncb-select" className="w-full"
              options={[{ value: "any", label: "With or without NCB" }, { value: "with", label: "With NCB only" }, { value: "without", label: "Without NCB only" }]} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Input data-testid="rule-make-input" value={r.make ?? ""} onChange={(e) => set("make", e.target.value || null)} placeholder="Make (all)" className="self-end" />
            <Input data-testid="rule-model-input" value={r.model ?? ""} onChange={(e) => set("model", e.target.value || null)} placeholder="Model (all)" className="self-end" />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <NumInput label="GVW from (kg)" testId="rule-gvw-min" {...num("gvw_min")} />
            <NumInput label="GVW to (kg)" testId="rule-gvw-max" {...num("gvw_max")} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumInput label="CC from" testId="rule-cc-min" {...num("cc_min")} />
            <NumInput label="CC to" testId="rule-cc-max" {...num("cc_max")} />
          </div>
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
          <Button onClick={() => save.mutate()} disabled={!r.name.trim() || save.isPending} data-testid="rule-save-button">
            {save.isPending ? "Saving…" : "Save rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RulesTable({ kind }: { kind: RuleKind }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["commission-rules"], queryFn: () => apiGet<CommissionRule[]>("/commission/rules") });
  const brokers = useBrokers();
  const agents = useAgentOptions(kind === "payable");
  const [dialog, setDialog] = useState<{ editing: CommissionRule | null; key: number } | null>(null);
  const bName = Object.fromEntries((brokers.data ?? []).map((b) => [b.id, b.name]));
  const aName = Object.fromEntries((agents.data ?? []).map((a) => [a.id, `${a.full_name} · ${a.username.toUpperCase()}`]));
  const list = (rules.data ?? []).filter((r) => r.kind === kind);

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/commission/rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commission-rules"] });
      toast.success("Rule deleted");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const conditions = (r: CommissionRule) =>
    [
      r.insurer, r.broker_id && bName[r.broker_id], r.agent_group && `Group ${r.agent_group}`, r.agent_id && aName[r.agent_id],
      r.products.length ? r.products.join(", ") : null, r.rtos.length ? `RTO ${r.rtos.join("/")}` : null,
      r.ncb !== "any" ? (r.ncb === "with" ? "With NCB" : "Without NCB") : null,
      r.gvw_min != null || r.gvw_max != null ? `GVW ${r.gvw_min ?? 0}–${r.gvw_max ?? "∞"}` : null,
      r.cc_min != null || r.cc_max != null ? `CC ${r.cc_min ?? 0}–${r.cc_max ?? "∞"}` : null,
      r.make, r.model, r.valid_from || r.valid_to ? `${r.valid_from ?? "…"} → ${r.valid_to ?? "…"}` : null,
    ].filter(Boolean).join(" · ") || "All policies";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {kind === "receivable" ? "What brokers pay Srish Vision on each policy." : "What Srish Vision pays agents — capped at the receivable."}
        </p>
        <Button data-testid={`add-${kind}-rule-button`} onClick={() => setDialog({ editing: null, key: Date.now() })}>
          <Plus className="size-4" /> Add {kind} rule
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Rule</TableHead>
              <TableHead>Applies to</TableHead>
              <TableHead>Commission</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody data-testid={`${kind}-rules-table`}>
            {list.map((r) => (
              <TableRow key={r.id} data-testid={`rule-row-${r.id}`}>
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  {!r.active && <Badge variant="outline" className="mt-1 text-[10px] text-muted-foreground">Inactive</Badge>}
                </TableCell>
                <TableCell className="max-w-md whitespace-normal text-xs text-muted-foreground">{conditions(r)}</TableCell>
                <TableCell className="font-mono text-xs text-teal-300">{pctSummary(r)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label="Edit rule" data-testid={`rule-edit-${r.id}`} onClick={() => setDialog({ editing: r, key: Date.now() })}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete rule" data-testid={`rule-delete-${r.id}`} onClick={() => window.confirm(`Delete rule "${r.name}"?`) && del.mutate(r.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!rules.isLoading && list.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">No {kind} rules yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {dialog && <RuleDialog key={dialog.key} kind={kind} editing={dialog.editing} onClose={() => setDialog(null)} />}
    </div>
  );
}

function BrokersTab() {
  const qc = useQueryClient();
  const brokers = useBrokers();
  const [form, setForm] = useState<{ id: string | null; name: string; code: string; aliases: string; active: boolean }>({ id: null, name: "", code: "", aliases: "", active: true });
  const save = useMutation({
    mutationFn: () => {
      const body: BrokerIn = { name: form.name, code: form.code || null, aliases: form.aliases.split(",").map((a) => a.trim()).filter(Boolean), active: form.active };
      return form.id ? apiPut<Broker>(`/brokers/${form.id}`, body) : apiPost<Broker>("/brokers", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brokers"] });
      toast.success(form.id ? "Broker updated" : "Broker added");
      setForm({ id: null, name: "", code: "", aliases: "", active: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Broker</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Other names on policies (OCR match)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody data-testid="brokers-table">
            {(brokers.data ?? []).map((b) => (
              <TableRow key={b.id} data-testid={`broker-row-${b.id}`}>
                <TableCell className="font-medium">{b.name}</TableCell>
                <TableCell className="font-mono text-xs">{b.code ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{b.aliases.join(", ") || "—"}</TableCell>
                <TableCell className={cn("text-xs", b.active ? "text-emerald-300" : "text-red-300")}>{b.active ? "Active" : "Inactive"}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon-sm" variant="ghost" aria-label="Edit broker" data-testid={`broker-edit-${b.id}`}
                    onClick={() => setForm({ id: b.id, name: b.name, code: b.code ?? "", aliases: b.aliases.join(", "), active: b.active })}>
                    <Pencil className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(brokers.data ?? []).length === 0 && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No brokers yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="broker-form">
        <p className="label-caps">{form.id ? "Edit broker" : "Add broker"}</p>
        <Input data-testid="broker-name-input" placeholder="Broker name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input data-testid="broker-code-input" placeholder="Code (optional)" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
        <Input data-testid="broker-aliases-input" placeholder="Other spellings, comma separated" value={form.aliases} onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))} />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox data-testid="broker-active-checkbox" checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: !!v }))} /> Active
        </label>
        <div className="flex gap-2">
          <Button data-testid="broker-save-button" disabled={form.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
            {form.id ? "Save broker" : "Add broker"}
          </Button>
          {form.id && <Button variant="ghost" onClick={() => setForm({ id: null, name: "", code: "", aliases: "", active: true })}>Cancel</Button>}
        </div>
        <p className="text-xs text-muted-foreground">Policy broker = chosen at upload › agent's default broker › name OCR reads from the policy.</p>
      </div>
    </div>
  );
}

function GroupsTab() {
  const qc = useQueryClient();
  const groups = useAgentGroups();
  const [name, setName] = useState("");
  const inv = () => qc.invalidateQueries({ queryKey: ["agent-groups"] });
  const add = useMutation({
    mutationFn: () => apiPost("/agent-groups", { name }),
    onSuccess: () => { inv(); setName(""); toast.success("Group added"); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/agent-groups/${id}`),
    onSuccess: () => { inv(); toast.success("Group deleted"); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-sm text-muted-foreground">Put agents into groups (A, B, C…) in Users & Access, then create payable rules per group.</p>
      <div className="flex gap-2">
        <Input data-testid="group-name-input" placeholder="Group name, e.g. A" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button data-testid="group-add-button" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
          <Plus className="size-4" /> Add group
        </Button>
      </div>
      <div className="flex flex-wrap gap-2" data-testid="groups-list">
        {(groups.data ?? []).map((g) => (
          <span key={g.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm">
            Group {g.name}
            <button aria-label={`Delete group ${g.name}`} data-testid={`group-delete-${g.id}`} onClick={() => del.mutate(g.id)} className="text-muted-foreground transition-colors duration-150 hover:text-red-300">
              <Trash2 className="size-3.5" />
            </button>
          </span>
        ))}
        {(groups.data ?? []).length === 0 && <span className="text-sm text-muted-foreground">No groups yet.</span>}
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "receivable", label: "Receivable (from brokers)" },
  { id: "payable", label: "Payable (to agents)" },
  { id: "brokers", label: "Brokers" },
  { id: "groups", label: "Agent groups" },
];

export default function Commission() {
  const [tab, setTab] = useState<Tab>("receivable");
  return (
    <div className="space-y-5 animate-rise">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Commission grid</h2>
        <p className="mt-1 text-sm text-muted-foreground">Admin only. Receivable and payable commission is worked out on every policy automatically and added to the MIS Excel.</p>
      </div>
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`commission-tab-${t.id}`} onClick={() => setTab(t.id)}
            className={cn("rounded-md px-3 py-1.5 text-sm transition-colors duration-150", tab === t.id ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "receivable" && <RulesTable kind="receivable" />}
      {tab === "payable" && <RulesTable kind="payable" />}
      {tab === "brokers" && <BrokersTab />}
      {tab === "groups" && <GroupsTab />}
    </div>
  );
}
