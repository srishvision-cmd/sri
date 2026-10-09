import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiPost } from "@/lib/api";
import { useAgentOptions } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import type { ReassignAgentIn, ReassignResult } from "@/lib/types";

/** Agent picker + apply button that moves the given policies (and their outstanding) to another agent. */
export function ReassignAgent({ policyIds, currentAgentId, onDone, testId }: { policyIds: string[]; currentAgentId?: string; onDone?: () => void; testId: string }) {
  const qc = useQueryClient();
  const agents = useAgentOptions(true);
  const [agentId, setAgentId] = useState("");
  const options = (agents.data ?? [])
    .filter((a) => a.id !== currentAgentId)
    .map((a) => ({ value: a.id, label: `${a.full_name} · ${a.username.toUpperCase()}` }));

  const move = useMutation({
    mutationFn: (body: ReassignAgentIn) => apiPost<ReassignResult>("/policies/reassign-agent", body),
    onSuccess: (r) => {
      toast.success(`${r.updated} ${r.updated === 1 ? "policy" : "policies"} moved to ${r.agent_name} · ${r.agent_code}`);
      setAgentId("");
      for (const key of ["policies", "policy", "stats", "outstanding"]) qc.invalidateQueries({ queryKey: [key] });
      onDone?.();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not change agent")),
  });

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
      <SimpleSelect value={agentId} onChange={setAgentId} options={options} placeholder="Change agent to…" testId={`${testId}-select`} className="min-w-56" searchable />
      <Button
        size="sm"
        disabled={!agentId || policyIds.length === 0 || move.isPending}
        onClick={() => move.mutate({ policy_ids: policyIds, agent_id: agentId })}
        data-testid={`${testId}-apply-button`}
      >
        <UserRoundCog className="size-4" /> {move.isPending ? "Moving…" : "Change agent"}
      </Button>
    </div>
  );
}
