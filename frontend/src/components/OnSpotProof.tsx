import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUpload } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { OnSpotStatus, Policy } from "@/lib/types";

export const ONSPOT_LABEL: Record<OnSpotStatus, string> = { pending: "Bank check pending", confirmed: "Bank confirmed", not_received: "Not received in bank" };
export const ONSPOT_TONE: Record<OnSpotStatus, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  confirmed: "bg-emerald-500/15 text-emerald-300",
  not_received: "bg-red-500/15 text-red-300",
};

/** UTR / screenshot of an On-Spot case + bank-check status; backoffice/admin can add proof later. */
export function OnSpotProof({ policy, canManage, onUpdated }: { policy: Policy; canManage: boolean; onUpdated: (p: Policy) => void }) {
  const [ref, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const status = policy.onspot_status ?? "pending";
  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (ref.trim()) form.append("reference", ref.trim());
      if (file) form.append("proof", file);
      return apiUpload<Policy>(`/policies/${policy.id}/onspot-proof`, form);
    },
    onSuccess: (p) => { onUpdated(p); setRef(""); setFile(null); toast.success("Payment proof saved"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="mt-2 space-y-2 border-t border-emerald-500/20 pt-2" data-testid="onspot-proof">
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="onspot-status" className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", ONSPOT_TONE[status])}>{ONSPOT_LABEL[status]}</span>
        <span>UTR / receipt: <b data-testid="onspot-reference" className="font-mono">{policy.onspot_reference ?? "—"}</b></span>
        {policy.has_onspot_proof && (
          <a data-testid="onspot-proof-link" href={`/api/policies/${policy.id}/onspot-proof`} target="_blank" rel="noreferrer" className="text-sky-300 underline-offset-2 hover:underline">View screenshot</a>
        )}
      </div>
      {policy.onspot_checked_by_name && <p className="text-[11px] text-muted-foreground">Checked by {policy.onspot_checked_by_name}{policy.onspot_note ? ` · ${policy.onspot_note}` : ""}</p>}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Input data-testid="onspot-add-reference" placeholder="UTR / receipt no." value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} className="h-8 w-44 font-mono text-xs" />
          <label className="cursor-pointer rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
            {file ? file.name : "Screenshot…"}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" data-testid="onspot-add-proof" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Button size="sm" variant="outline" className="h-8" data-testid="onspot-save-proof" disabled={(!ref.trim() && !file) || save.isPending} onClick={() => save.mutate()}>Save proof</Button>
        </div>
      )}
    </div>
  );
}
