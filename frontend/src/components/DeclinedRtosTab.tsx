import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/SimpleSelect";
import { MultiSelect } from "@/components/MultiSelect";
import { useCommissionMasters } from "@/components/RuleDialog";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { DeclinedRto, DeclinedRtoIn } from "@/lib/types";

const BLANK = { insurer: "", ptype: "", products: [] as string[], rtos: "", note: "" };

/** Company-wide declined / excluded RTOs per product — no receivable and no payable for policies from them, even inside a bundled zone. */
export function DeclinedRtosTab() {
  const qc = useQueryClient();
  const masters = useCommissionMasters();
  const types = masters.data?.product_types ?? {};
  const list = useQuery({ queryKey: ["declined-rtos"], queryFn: () => apiGet<DeclinedRto[]>("/commission/declined-rtos") });
  const [f, setF] = useState(BLANK);
  const invalidate = () => ["declined-rtos", "policies", "policy", "commission", "commission-compare"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const create = useMutation({
    mutationFn: () => apiPost<DeclinedRto>("/commission/declined-rtos", {
      insurer: f.insurer, product_type: f.ptype || null, products: f.products, rtos: [f.rtos], note: f.note.trim() || null,
    } satisfies DeclinedRtoIn),
    onSuccess: (d) => { invalidate(); setF(BLANK); toast.success(`${d.insurer}: ${d.rtos.length} declined RTO${d.rtos.length === 1 ? "" : "s"} saved`); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/commission/declined-rtos/${id}`),
    onSuccess: () => { invalidate(); toast.success("Declined RTO list removed"); },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-5" data-testid="declined-rtos-tab">
      <p className="text-sm text-muted-foreground">
        When a company declines or excludes some RTOs — even ones inside a bundled zone like <b className="text-foreground">Metro</b> — list them here once per company and product.
        Policies from these RTOs get <b className="text-foreground">no receivable and no payable</b> and are flagged <b className="text-red-700">Declined RTO</b> for review,
        whatever rule would otherwise match. Commission already saved on existing policies is not changed.
      </p>

      <div className="grid gap-3 rounded-xl border border-red-300 bg-red-50/60 p-4 md:grid-cols-3" data-testid="declined-form">
        <div className="space-y-1">
          <Label className="text-xs">Insurance company *</Label>
          <SimpleSelect value={f.insurer} onChange={(v) => setF({ ...f, insurer: v })} placeholder="Company" testId="declined-insurer-select" className="w-full" searchable
            options={(masters.data?.insurers ?? []).map((n) => ({ value: n, label: n }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Product type</Label>
          <SimpleSelect value={f.ptype} onChange={(v) => setF({ ...f, ptype: v, products: [] })} allLabel="All products" placeholder="Product type" testId="declined-ptype-select" className="w-full"
            options={Object.keys(types).map((t) => ({ value: t, label: t }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Products — none = all of the type</Label>
          <MultiSelect value={f.products} onChange={(v) => setF({ ...f, products: v })} options={types[f.ptype] ?? []} placeholder={f.ptype ? `All ${f.ptype}` : "Pick a product type first"} testId="declined-products-select" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">Declined RTO codes * (comma or space separated)</Label>
          <Input value={f.rtos} onChange={(e) => setF({ ...f, rtos: e.target.value })} placeholder="e.g. TN-29, TN-39, TN-52, TN-50" className="font-mono" data-testid="declined-rtos-input" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Remarks</Label>
          <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Excluded per Oct grid" data-testid="declined-note-input" />
        </div>
        <div className="flex items-end md:col-span-3">
          <Button className="ml-auto" disabled={!f.insurer || !f.rtos.trim() || create.isPending} onClick={() => create.mutate()} data-testid="declined-save-button">
            <Ban className="size-4" /> {create.isPending ? "Saving…" : "Save declined RTOs"}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card" data-testid="declined-list">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Company · product</th><th className="px-3 py-2">Declined RTOs</th><th className="px-3 py-2">Remarks</th><th className="px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((d) => (
              <tr key={d.id} className="border-t border-border/60 align-top" data-testid={`declined-row-${d.id}`}>
                <td className="px-3 py-2">
                  <div className="font-medium">{d.insurer}</div>
                  <div className="text-xs text-muted-foreground">{d.products.length ? d.products.join(", ") : d.product_type ?? "All products"}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs" data-testid={`declined-codes-${d.id}`}>{d.rtos.join(", ")}</td>
                <td className="px-3 py-2 text-xs">{d.note ?? "—"}<div className="text-[10px] text-muted-foreground">by {d.created_by_name}</div></td>
                <td className="px-3 py-2 text-right">
                  <Button size="icon-sm" variant="ghost" aria-label="Delete declined RTO list" data-testid={`declined-delete-${d.id}`}
                    onClick={() => window.confirm(`Remove this declined RTO list for ${d.insurer}? New calculations will pay these RTOs again.`) && remove.mutate(d.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {list.isSuccess && list.data.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">No declined RTOs. Every RTO a rule covers is paid.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
