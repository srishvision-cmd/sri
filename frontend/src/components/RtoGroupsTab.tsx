import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/SimpleSelect";
import { useCommissionMasters, useCompanyZones } from "@/components/RuleDialog";
import { apiDelete, apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { CompanyZone, CompanyZoneIn } from "@/lib/types";

const EMPTY = { name: "", insurer: "", codes: "", state: "" };

/** "TN01, tn02 TN03" → ["TN01", "TN02", "TN03"] */
const parseCodes = (s: string) => [...new Set(s.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))].sort();

/** Manual RTO groups (all companies or one company). They show as quick zones in rules and in the Excel RTO dropdown. */
export function RtoGroupsTab() {
  const qc = useQueryClient();
  const zones = useCompanyZones();
  const masters = useCommissionMasters();
  const [f, setF] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const codes = parseCodes(f.codes);
  const state = masters.data?.rto_states.find((s) => s.code === f.state);

  const save = useMutation({
    mutationFn: (body: CompanyZoneIn) => apiPost<CompanyZone>("/commission/zones", body),
    onSuccess: (z) => {
      qc.invalidateQueries({ queryKey: ["company-zones"] });
      toast.success(`RTO group "${z.name}" saved (${z.rtos.length} RTOs) — it is now in the Excel template`);
      setF(EMPTY);
      setEditing(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/commission/zones/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["company-zones"] }); toast.success("RTO group deleted"); },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const edit = (z: CompanyZone) => { setEditing(z.id); setF({ name: z.name, insurer: z.insurer ?? "", codes: z.rtos.join(", "), state: "" }); };
  const addState = () => state && setF({ ...f, codes: parseCodes(`${f.codes} ${state.rtos.join(" ")}`).join(", ") });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div data-testid="rto-group-form" className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h3 className="font-heading text-sm font-semibold">{editing ? "Edit RTO group" : "New RTO group"}</h3>
          <p className="text-xs text-muted-foreground">Saved groups appear as quick zones in commission rules and in the Excel template's RTO dropdown.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Group name</Label>
          <Input data-testid="rto-group-name-input" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Chennai City" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Insurance company</Label>
          <SimpleSelect value={f.insurer} onChange={(v) => setF({ ...f, insurer: v })} allLabel="All companies" placeholder="Company" testId="rto-group-insurer-select" className="w-full"
            options={(masters.data?.insurers ?? []).map((i) => ({ value: i, label: i }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">RTO codes (comma or space separated)</Label>
          <Textarea data-testid="rto-group-codes-input" rows={4} value={f.codes} onChange={(e) => setF({ ...f, codes: e.target.value })} placeholder="TN01, TN02, TN09, TN10" className="font-mono text-xs" />
          <div className="flex items-center gap-1.5">
            <SimpleSelect value={f.state} onChange={(v) => setF({ ...f, state: v })} placeholder="Add a whole state…" testId="rto-group-state-select" className="flex-1"
              options={(masters.data?.rto_states ?? []).map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))} />
            <Button type="button" size="sm" variant="outline" disabled={!state} onClick={addState} data-testid="rto-group-add-state-button"><Plus className="size-3.5" /> Add RTOs</Button>
          </div>
          <p data-testid="rto-group-count" className="text-[11px] text-muted-foreground">{codes.length} RTO{codes.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex gap-2">
          <Button data-testid="rto-group-save-button" disabled={!f.name.trim() || codes.length === 0 || save.isPending}
            onClick={() => save.mutate({ name: f.name.trim(), insurer: f.insurer || null, rtos: codes })}>
            <Save className="size-4" /> {editing ? "Update group" : "Save group"}
          </Button>
          {editing && <Button variant="ghost" data-testid="rto-group-cancel-button" onClick={() => { setEditing(null); setF(EMPTY); }}><X className="size-4" /> Cancel</Button>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table data-testid="rto-groups-table" className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Group</th><th className="px-3 py-2">Company</th><th className="px-3 py-2">RTOs</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {(zones.data ?? []).map((z) => (
              <tr key={z.id} data-testid={`rto-group-row-${z.id}`} className="border-t border-border/60 align-top">
                <td className="px-3 py-2 font-medium">{z.name}</td>
                <td className="px-3 py-2 text-xs">{z.insurer ?? <span className="text-muted-foreground">All companies</span>}</td>
                <td className="max-w-md px-3 py-2 font-mono text-[11px] text-muted-foreground"><span className="font-sans font-semibold text-foreground">{z.rtos.length}</span> · {z.rtos.join(", ")}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button size="icon" variant="ghost" aria-label={`Edit ${z.name}`} data-testid={`rto-group-edit-${z.id}`} onClick={() => edit(z)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${z.name}`} data-testid={`rto-group-delete-${z.id}`} disabled={del.isPending}
                    onClick={() => { if (confirm(`Delete RTO group "${z.name}"? Rules keep their RTO codes.`)) del.mutate(z.id); }}><Trash2 className="size-4 text-red-300" /></Button>
                </td>
              </tr>
            ))}
            {!zones.isLoading && (zones.data ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">No RTO groups yet — create one on the left.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
