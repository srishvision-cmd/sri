import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiPost } from "@/lib/api";
import { useBrokers } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import type { BulkBrokerIn, ReassignResult } from "@/lib/types";

/** Set the broker on many policies at once — commission rules scoped to a broker then apply. */
export function BulkBroker({ policyIds, onDone }: { policyIds: string[]; onDone?: () => void }) {
  const qc = useQueryClient();
  const brokers = useBrokers();
  const [brokerId, setBrokerId] = useState("");
  const apply = useMutation({
    mutationFn: (body: BulkBrokerIn) => apiPost<ReassignResult>("/policies/set-broker", body),
    onSuccess: (r) => {
      toast.success(`Broker set to ${r.agent_name} on ${r.updated} ${r.updated === 1 ? "policy" : "policies"} — commission recalculated`);
      setBrokerId("");
      for (const key of ["policies", "policy", "commission"]) qc.invalidateQueries({ queryKey: [key] });
      onDone?.();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not set broker")),
  });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="bulk-broker">
      <SimpleSelect value={brokerId} onChange={setBrokerId} placeholder="Set broker to…" testId="bulk-broker-select" className="min-w-52"
        options={(brokers.data ?? []).map((b) => ({ value: b.id, label: b.name }))} />
      <Button size="sm" variant="secondary" disabled={!brokerId || apply.isPending} onClick={() => apply.mutate({ policy_ids: policyIds, broker_id: brokerId })} data-testid="bulk-broker-apply-button">
        <Building2 className="size-4" /> Set broker
      </Button>
    </div>
  );
}
