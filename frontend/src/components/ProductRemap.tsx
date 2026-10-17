import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { ProductRemapResult, ProductRemapRow } from "@/lib/types";

/** Admin banner: policies whose product is not a Product Master name → preview the mapping, then apply. */
export function ProductRemap() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rows = useQuery({ queryKey: ["product-remap"], queryFn: () => apiGet<ProductRemapRow[]>("/policies/product-remap") });
  const list = rows.data ?? [];
  const ready = list.filter((r) => r.suggested);
  const apply = useMutation({
    mutationFn: () => apiPost<ProductRemapResult>("/policies/product-remap", { ids: ready.map((r) => r.id) }),
    onSuccess: (r) => {
      for (const k of ["product-remap", "policies", "outstanding"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(`${r.updated} polic${r.updated === 1 ? "y" : "ies"} mapped to the Product Master`);
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!list.length) return null;
  return (
    <>
      <div data-testid="product-remap-banner" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        <span className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0 text-amber-500" />
          {list.length} polic{list.length === 1 ? "y has" : "ies have"} a product that is not in the Product Master{ready.length ? ` — ${ready.length} can be mapped automatically` : ""}.</span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="product-remap-open"><Wand2 className="size-3.5" /> Review mapping</Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => !apply.isPending && setOpen(o)}>
        <DialogContent data-testid="product-remap-dialog" className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-heading">Map products to the Product Master</DialogTitle>
            <DialogDescription>Preview — nothing changes until you apply. Rows without a confident match stay flagged; open the policy and pick the product there.</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr><th className="px-2 py-1.5">Policy</th><th className="px-2 py-1.5">Company</th><th className="px-2 py-1.5">Read on document</th><th className="px-2 py-1.5">Now</th><th className="px-2 py-1.5">Will become</th></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} data-testid={`product-remap-row-${r.id}`} className="border-t border-border/60">
                    <td className="px-2 py-1.5"><Link to={`/policies/${r.id}`} className="font-mono text-sky-600 hover:underline">{r.policy_number ?? r.id.slice(0, 8)}</Link></td>
                    <td className="px-2 py-1.5">{r.insurer ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.raw_product ?? "—"}</td>
                    <td className="px-2 py-1.5 text-amber-700">{r.current ?? "none"}</td>
                    <td className="px-2 py-1.5 font-semibold">{r.suggested ? <span className="text-emerald-700">{r.suggested}</span> : <span className="text-red-600">No confident match — map by hand</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} data-testid="product-remap-cancel">Cancel</Button>
            <Button disabled={!ready.length || apply.isPending} onClick={() => apply.mutate()} data-testid="product-remap-apply">Apply {ready.length} mapping{ready.length === 1 ? "" : "s"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
