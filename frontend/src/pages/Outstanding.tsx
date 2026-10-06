import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useOutletContext } from "react-router-dom";
import { ChevronDown, ChevronRight, Wallet } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import { fmtDate, money } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { AgentOutstanding, Policy, User } from "@/lib/types";

function AgentPolicies({ agentId }: { agentId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["policies", `outstanding-${agentId}`],
    queryFn: () => apiGet<Policy[]>(`/policies?agent_id=${agentId}&outstanding_only=true`),
  });
  if (isLoading) return <div className="h-10 animate-pulse rounded bg-muted" />;
  const rows = data ?? [];
  if (rows.length === 0) return <p className="px-2 py-2 text-xs text-muted-foreground">No open balances.</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-[#0D131F]">
      {rows.map((p) => (
        <li key={p.id}>
          <Link to={`/policies/${p.id}`} data-testid={`outstanding-policy-${p.id}`} className="flex items-center gap-4 px-3 py-2 text-xs transition-colors duration-150 hover:bg-accent/40">
            <span className="font-mono">{p.fields.policy_number ?? p.file_name}</span>
            <span className="truncate text-muted-foreground">{p.fields.insured_name ?? "—"}</span>
            <span className="text-muted-foreground">{fmtDate(p.fields.start_date)}</span>
            <span className="ml-auto font-mono tabular">{money(p.fields.gross_premium)}</span>
            <span className="w-24 text-right font-mono tabular text-emerald-300">{money(p.amount_paid)}</span>
            <span className="w-24 text-right font-mono font-semibold tabular text-orange-300">{money(p.outstanding)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Outstanding() {
  const me = useOutletContext<User>();
  const [open, setOpen] = useState<string | null>(me.role === "agent" ? me.id : null);
  const { data, isLoading, isError } = useQuery({ queryKey: ["outstanding"], queryFn: () => apiGet<AgentOutstanding[]>("/outstanding") });
  const rows = isError ? [] : data ?? [];
  const totalOwed = rows.reduce((s, r) => s + r.outstanding, 0);
  const exportHref = (fmt: "csv" | "xlsx") => `/api/mis/export?format=${fmt}&outstanding_only=true`;

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Agent outstanding premium</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cash policies (full total premium) and partial payments (total premium − amount paid) owed by each agent. Record settlements on each policy.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="label-caps">Total outstanding</div>
            <div data-testid="outstanding-total" className="font-mono text-2xl font-semibold tabular text-orange-300">{money(totalOwed)}</div>
          </div>
          <a href={exportHref("xlsx")} data-testid="outstanding-export-xlsx" className="text-xs text-sky-400 hover:underline">
            Download outstanding MIS
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead>Agent</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">Policies</TableHead>
              <TableHead className="text-right">Total premium</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody data-testid="outstanding-table-body">
            {rows.map((r) => (
              <Fragment key={r.agent_id}>
                <TableRow
                  data-testid={`outstanding-row-${r.agent_code.toLowerCase()}`}
                  className="cursor-pointer"
                  onClick={() => setOpen((o) => (o === r.agent_id ? null : r.agent_id))}
                >
                  <TableCell>{open === r.agent_id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                  <TableCell>
                    <span className="font-medium">{r.agent_name}</span> <span className="font-mono text-[11px] text-muted-foreground">{r.agent_code}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.branch ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular">{r.policies}</TableCell>
                  <TableCell className="text-right font-mono tabular">{money(r.total_premium)}</TableCell>
                  <TableCell className="text-right font-mono tabular text-emerald-300">{money(r.paid)}</TableCell>
                  <TableCell data-testid={`outstanding-amount-${r.agent_code.toLowerCase()}`} className={cn("text-right font-mono font-semibold tabular", r.outstanding > 0 ? "text-orange-300" : "text-muted-foreground")}>
                    {money(r.outstanding)}
                  </TableCell>
                </TableRow>
                {open === r.agent_id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="whitespace-normal bg-muted/20 p-3">
                      <AgentPolicies agentId={r.agent_id} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {!isLoading && rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  <Wallet className="mx-auto mb-2 size-5" /> No outstanding premium.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
