import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/components/SimpleSelect";
import { RuleDialog, pctSummary, useCommissionMasters } from "@/components/RuleDialog";
import type { RtoZone } from "@/lib/types";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { useAgentGroups, useAgentOptions, useBrokers } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { Broker, BrokerIn, CommissionRule, GroupMembersIn, RuleKind, User } from "@/lib/types";

type Tab = "receivable" | "payable" | "brokers" | "groups";

/** Collapse RTO codes into zone names (Chennai RTOs, ROTN…) where a whole zone is selected. */
function rtoLabel(rtos: string[], zones: RtoZone[]): string {
  let rest = [...rtos];
  const parts: string[] = [];
  for (const z of zones) {
    if (z.rtos.every((c) => rest.includes(c))) {
      parts.push(z.name);
      rest = rest.filter((c) => !z.rtos.includes(c));
    }
  }
  return [...parts, ...rest].join(" / ");
}

function RulesTable({ kind }: { kind: RuleKind }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["commission-rules"], queryFn: () => apiGet<CommissionRule[]>("/commission/rules") });
  const brokers = useBrokers();
  const agents = useAgentOptions(kind === "payable");
  const [dialog, setDialog] = useState<{ editing: CommissionRule | null; key: number } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const zones = useCommissionMasters().data?.rto_zones ?? [];
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
      r.products.length ? r.products.join(", ") : null, r.rtos.length ? `RTO ${rtoLabel(r.rtos, zones)}` : null,
      r.ncb !== "any" ? (r.ncb === "with" ? "With NCB" : "Without NCB") : null,
      r.gvw_min != null || r.gvw_max != null ? `GVW ${r.gvw_min ?? 0}–${r.gvw_max ?? "∞"}` : null,
      r.cc_min != null || r.cc_max != null ? `CC ${r.cc_min ?? 0}–${r.cc_max ?? "∞"}` : null,
      r.vehicle_ages.length ? `Age ${r.vehicle_ages.join("/")}` : null,
      r.fuel_types.length ? r.fuel_types.join("/") : null,
      r.seating_min != null || r.seating_max != null ? `Seats ${r.seating_min ?? 0}–${r.seating_max ?? "∞"}` : null,
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
              <TableRow
                key={r.id}
                data-testid={`rule-row-${r.id}`}
                ref={(el) => { if (el && r.id === fresh) el.scrollIntoView({ block: "center", behavior: "smooth" }); }}
                className={cn("transition-colors duration-700", r.id === fresh && "bg-sky-500/15 ring-1 ring-inset ring-sky-500/50")}
              >
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  {r.id === fresh && <Badge data-testid="rule-just-saved" className="mt-1 bg-sky-500 text-[10px] text-white">Just saved</Badge>}
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
      {dialog && <RuleDialog key={dialog.key} kind={kind} editing={dialog.editing} onClose={() => setDialog(null)} onSaved={(saved) => setFresh(saved.id)} />}
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
  const delBroker = useMutation({
    mutationFn: (id: string) => apiDelete(`/brokers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brokers"] }); toast.success("Broker deleted"); },
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
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" aria-label="Edit broker" data-testid={`broker-edit-${b.id}`}
                      onClick={() => setForm({ id: b.id, name: b.name, code: b.code ?? "", aliases: b.aliases.join(", "), active: b.active })}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete broker" data-testid={`broker-delete-${b.id}`}
                      onClick={() => window.confirm(`Delete broker ${b.name}?`) && delBroker.mutate(b.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
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
  const users = useQuery({ queryKey: ["users"], queryFn: () => apiGet<User[]>("/users") });
  const agents = (users.data ?? []).filter((u) => u.role === "agent");
  const [name, setName] = useState("");
  const [managing, setManaging] = useState<{ id: string; name: string; ids: string[] } | null>(null);
  const [q, setQ] = useState("");
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["agent-groups"] });
    qc.invalidateQueries({ queryKey: ["users"] });
  };
  const add = useMutation({
    mutationFn: () => apiPost("/agent-groups", { name }),
    onSuccess: () => { inv(); toast.success(`Group ${name} added`); setName(""); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/agent-groups/${id}`),
    onSuccess: () => { inv(); toast.success("Group deleted"); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const saveMembers = useMutation({
    mutationFn: (m: { id: string; body: GroupMembersIn }) => apiPut(`/agent-groups/${m.id}/members`, m.body),
    onSuccess: () => { inv(); toast.success(`Group ${managing?.name} updated — ${managing?.ids.length ?? 0} agents`); setManaging(null); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const filtered = agents.filter((a) => `${a.full_name} ${a.username} ${a.branch ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Create groups (A, B, C…), put agents into them, then add payable rules per group.</p>
      <div className="flex gap-2">
        <Input data-testid="group-name-input" placeholder="Group name, e.g. A" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button data-testid="group-add-button" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
          <Plus className="size-4" /> Add group
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="groups-list">
        {(groups.data ?? []).map((g) => {
          const members = agents.filter((a) => a.agent_group === g.name);
          return (
            <div key={g.id} data-testid={`group-card-${g.name}`} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="font-heading text-lg font-semibold">Group {g.name}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" data-testid={`group-manage-${g.name}`} onClick={() => { setQ(""); setManaging({ id: g.id, name: g.name, ids: members.map((m) => m.id) }); }}>
                    <Users className="size-3.5" /> Assign agents
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete group ${g.name}`} data-testid={`group-delete-${g.name}`} onClick={() => window.confirm(`Delete group ${g.name}?`) && del.mutate(g.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground" data-testid={`group-count-${g.name}`}>{members.length} agents</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {members.map((m) => (
                  <span key={m.id} className="rounded-full bg-muted px-2 py-0.5 text-xs">{m.full_name} <span className="font-mono text-muted-foreground">{m.username.toUpperCase()}</span></span>
                ))}
              </div>
            </div>
          );
        })}
        {(groups.data ?? []).length === 0 && <span className="text-sm text-muted-foreground">No groups yet.</span>}
      </div>

      <Dialog open={!!managing} onOpenChange={(o) => !o && setManaging(null)}>
        <DialogContent data-testid="group-members-dialog" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">Agents in Group {managing?.name}</DialogTitle>
            <DialogDescription>Tick the agents for this group. An agent can be in one group — ticking moves them here.</DialogDescription>
          </DialogHeader>
          <Input data-testid="group-members-search" placeholder="Search agent name / code / branch" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {filtered.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                <Checkbox
                  data-testid={`group-member-${a.username}`}
                  checked={!!managing?.ids.includes(a.id)}
                  onCheckedChange={(v) => setManaging((m) => m && { ...m, ids: v ? [...m.ids, a.id] : m.ids.filter((x) => x !== a.id) })}
                />
                {a.full_name}
                <span className="font-mono text-xs text-muted-foreground">{a.username.toUpperCase()} · {a.branch}</span>
                {a.agent_group && a.agent_group !== managing?.name && <span className="ml-auto text-[11px] text-amber-300">now in {a.agent_group}</span>}
              </label>
            ))}
            {filtered.length === 0 && <p className="p-2 text-xs text-muted-foreground">No agents found.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManaging(null)}>Cancel</Button>
            <Button data-testid="group-members-save" disabled={saveMembers.isPending} onClick={() => managing && saveMembers.mutate({ id: managing.id, body: { agent_ids: managing.ids } })}>
              Save group ({managing?.ids.length ?? 0})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
