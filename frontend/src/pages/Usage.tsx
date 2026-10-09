import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Cpu, Gauge, HardDrive, IndianRupee, Minimize2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import { fmtBytes } from "@/lib/fields";

const money = (n: number | null | undefined) => `₹${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
import { cn } from "@/lib/utils";
import type { RecompressResult, Usage, UsageGroup } from "@/lib/types";

function Tile({ label, value, sub, icon: Icon, tone, testId }: { label: string; value: string; sub?: string; icon: typeof Gauge; tone: string; testId: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-transform duration-150 hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className="label-caps">{label}</span>
        <Icon className={cn("size-4", tone)} />
      </div>
      <div data-testid={testId} className="mt-3 font-mono text-2xl font-semibold tracking-tight tabular">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function GroupTable({ rows, testId }: { rows: UsageGroup[]; testId: string }) {
  return (
    <Table data-testid={testId}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Files</TableHead>
          <TableHead className="text-right">Uploaded size</TableHead>
          <TableHead className="text-right">Stored (compressed)</TableHead>
          <TableHead className="text-right">OCR runs</TableHead>
          <TableHead className="text-right">Est. LLM cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.label} data-testid={`${testId}-row`}>
            <TableCell>{r.label}</TableCell>
            <TableCell className="text-right font-mono tabular">{r.files}</TableCell>
            <TableCell className="text-right font-mono tabular text-muted-foreground">{fmtBytes(r.original_bytes)}</TableCell>
            <TableCell className="text-right font-mono tabular">{fmtBytes(r.stored_bytes)}</TableCell>
            <TableCell className="text-right font-mono tabular">{r.ocr_runs}</TableCell>
            <TableCell className="text-right font-mono tabular text-teal-300">{money(r.est_cost_inr)}</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No uploaded documents yet.</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export default function UsagePage() {
  const [tab, setTab] = useState<"branch" | "agent">("branch");
  const { data, isError } = useQuery({ queryKey: ["usage"], queryFn: () => apiGet<Usage>("/usage") });
  const u = isError ? undefined : data;
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);
  const recompress = useMutation({
    mutationFn: async () => {
      let total = 0, files = 0;
      for (let i = 0; i < 100; i++) {  // batches of 5 until every large file was tried
        const r = await apiPost<RecompressResult>("/usage/recompress?limit=5", {});
        total += r.saved_bytes; files += r.compressed;
        setProgress(`${files} files shrunk · ${fmtBytes(total)} saved · ${r.remaining} left`);
        if (r.remaining === 0 || r.checked === 0) break;
      }
      return { total, files };
    },
    onSuccess: ({ total, files }) => {
      qc.invalidateQueries({ queryKey: ["usage"] });
      toast.success(files ? `Compressed ${files} stored files — ${fmtBytes(total)} freed` : "All stored files are already as small as they can be");
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setProgress(null),
  });
  const saved = u && u.original_bytes > 0 ? Math.round((1 - u.stored_bytes / u.original_bytes) * 100) : 0;

  return (
    <div className="space-y-6 animate-rise">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Storage & OCR usage</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          New uploads are compressed to about {u ? fmtBytes(u.target_bytes) : "100 KB"} before storage; OCR still reads the original
          for best accuracy. LLM cost is an <span className="text-foreground">estimate</span> ({u ? money(u.est_cost_per_policy_inr) : "—"} per OCR run on{" "}
          <span className="font-mono">{u?.model_name ?? "Gemini"}</span>) — actual charges are deducted from your Emergent LLM key balance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Cloud storage used" value={u ? fmtBytes(u.stored_bytes) : "—"} sub={u ? `${u.total_files} files · avg ${fmtBytes(u.avg_file_bytes)}` : undefined} icon={HardDrive} tone="text-sky-400" testId="usage-storage-used" />
        <Tile label="Compression saving" value={u ? `${saved}%` : "—"} sub={u ? `${fmtBytes(u.original_bytes)} uploaded · ${u.under_target_files} files ≤ ${fmtBytes(u.target_bytes)}` : undefined} icon={Minimize2} tone="text-emerald-400" testId="usage-compression-saving" />
        <Tile label="OCR policies processed" value={u ? String(u.ocr_runs) : "—"} sub={u ? `${u.ocr_runs_this_month} this month · ${u.ocr_success} ok · ${u.ocr_failed} failed` : undefined} icon={Cpu} tone="text-amber-400" testId="usage-ocr-runs" />
        <Tile label="Est. LLM cost" value={u ? money(u.est_cost_total_inr) : "—"} sub={u ? `${money(u.est_cost_this_month_inr)} this month · ${money(u.est_cost_per_policy_inr)} / policy` : undefined} icon={IndianRupee} tone="text-teal-400" testId="usage-est-cost" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4" data-testid="usage-recompress-card">
        <div className="text-sm">
          <b className="font-heading">Shrink files already stored</b>
          <p className="text-xs text-muted-foreground">
            Re-compresses older uploads above {u ? fmtBytes(u.target_bytes) : "100 KB"} (fonts trimmed, scans re-encoded). Text stays readable; long multi-page policies may stay a little above the target.
          </p>
          {progress && <p data-testid="usage-recompress-progress" className="mt-1 font-mono text-xs text-emerald-300">{progress}</p>}
        </div>
        <Button data-testid="usage-recompress-button" variant="outline" disabled={recompress.isPending} onClick={() => recompress.mutate()}>
          <Minimize2 className="size-4" /> {recompress.isPending ? "Compressing…" : "Compress existing files"}
        </Button>
      </div>

      <div data-testid="usage-monthly-chart" className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h3 className="font-heading text-sm font-semibold">OCR runs per month</h3>
          <span className="text-xs text-muted-foreground">Last 12 months</span>
        </div>
        {!u || u.by_month.length === 0 ? (
          <div className="grid h-56 place-items-center text-sm text-muted-foreground">No OCR activity yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            <BarChart data={u.by_month} margin={{ left: 0, right: 16 }}>
              <CartesianGrid vertical={false} stroke="#1E293B" />
              <XAxis dataKey="month" stroke="#64748B" fontSize={11} />
              <YAxis allowDecimals={false} stroke="#64748B" fontSize={11} />
              <Tooltip
                cursor={{ fill: "rgba(56,189,248,0.06)" }}
                contentStyle={{ background: "#1A2234", border: "1px solid #1E293B", borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, name: string) => [value, name === "ocr_runs" ? "OCR runs" : "Files uploaded"]}
              />
              <Bar dataKey="ocr_runs" fill="#F59E0B" radius={[4, 4, 0, 0]} barSize={18} />
              <Bar dataKey="files" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-1 border-b border-border px-4 py-2.5">
          {(["branch", "agent"] as const).map((t) => (
            <button
              key={t}
              data-testid={`usage-tab-${t}`}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors duration-150",
                tab === t ? "bg-sidebar-accent text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              By {t}
            </button>
          ))}
        </div>
        <GroupTable rows={(tab === "branch" ? u?.by_branch : u?.by_agent) ?? []} testId={`usage-table-${tab}`} />
      </div>
    </div>
  );
}
