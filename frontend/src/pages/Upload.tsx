import { useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useOutletContext } from "react-router-dom";
import { FileStack, FileText, ImageIcon, Loader2, ScanLine, Trash2, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { SimpleSelect } from "@/components/SimpleSelect";
import { StatusBadge } from "@/components/StatusBadge";
import { apiGet, apiUpload } from "@/lib/api";
import { useAgentOptions } from "@/lib/auth";
import { errorMessage, money } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { Policy, User } from "@/lib/types";

interface QueueItem {
  key: string;
  name: string;
  size: number;
  isPdf: boolean;
  state: "queued" | "uploading" | "uploaded" | "error";
  policyId?: string;
  error?: string;
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
const OK_EXT = /\.(pdf|jpe?g|png|webp)$/i;
const MAX_FILES = 50;
const PARALLEL_UPLOADS = 6; // OCR starts server-side the moment each file lands, so all files process concurrently

const policyQuery = (id: string) => ({
  queryKey: ["policy", id],
  queryFn: () => apiGet<Policy>(`/policies/${id}`),
  refetchInterval: (q: { state: { data?: Policy } }) => (q.state.data?.status === "processing" ? 2500 : false),
});

function OcrStatus({ policyId }: { policyId: string }) {
  const { data } = useQuery(policyQuery(policyId));
  if (!data) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  return (
    <div className="flex items-center gap-3">
      {data.status !== "processing" && data.fields.policy_number && (
        <span className="hidden font-mono text-xs text-muted-foreground md:inline">
          {data.fields.policy_number} · {money(data.fields.gross_premium)}
        </span>
      )}
      <StatusBadge status={data.status} testId={`upload-ocr-status-${policyId}`} />
      {data.status !== "processing" && (
        <Link to={`/policies/${policyId}`} data-testid={`upload-review-link-${policyId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
          Review
        </Link>
      )}
    </div>
  );
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

export default function Upload() {
  const me = useOutletContext<User>();
  const qc = useQueryClient();
  const canAssign = me.role !== "agent";
  const agents = useAgentOptions(canAssign);
  const [agentId, setAgentId] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<QueueItem>) => setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const ids = queue.filter((i) => i.policyId).map((i) => i.policyId as string);
  const statuses = useQueries({ queries: ids.map(policyQuery) });
  const count = (s: Policy["status"]) => statuses.filter((r) => r.data?.status === s).length;
  const uploading = queue.filter((i) => i.state === "queued" || i.state === "uploading").length;
  const ocrRunning = count("processing");
  const extracted = count("extracted") + count("verified") + count("flagged");
  const failed = count("failed") + queue.filter((i) => i.state === "error").length;
  const done = extracted + failed;
  const pct = queue.length ? Math.round((done / queue.length) * 100) : 0;

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    let files = Array.from(list);
    if (files.length > MAX_FILES) {
      toast.warning(`Only the first ${MAX_FILES} files were taken — upload the rest in another batch`);
      files = files.slice(0, MAX_FILES);
    }
    const stamp = Date.now();
    const items = files.map((f, i): QueueItem & { file: File } => ({
      key: `${stamp}-${i}-${f.name}`,
      file: f,
      name: f.name,
      size: f.size,
      isPdf: /\.pdf$/i.test(f.name),
      state: OK_EXT.test(f.name) ? "queued" : "error",
      error: OK_EXT.test(f.name) ? undefined : "Unsupported file type",
    }));
    setQueue((q) => [...items.map(({ file: _f, ...rest }) => rest), ...q]);
    if (inputRef.current) inputRef.current.value = "";

    const valid = items.filter((i) => i.state !== "error");
    await runPool(valid, PARALLEL_UPLOADS, async (item) => {
      patch(item.key, { state: "uploading" });
      const form = new FormData();
      form.append("file", item.file);
      if (canAssign && agentId) form.append("agent_id", agentId);
      try {
        const policy = await apiUpload<Policy>("/policies/upload", form);
        qc.setQueryData(["policy", policy.id], policy);
        patch(item.key, { state: "uploaded", policyId: policy.id });
      } catch (err) {
        const msg = errorMessage(err, "Upload failed");
        patch(item.key, { state: "error", error: msg });
        toast.error(`${item.name}: ${msg}`);
      }
    });
    if (valid.length > 1) toast.success(`${valid.length} documents uploaded — OCR is running on all of them`);
    qc.invalidateQueries({ queryKey: ["policies"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  }

  const agentOptions = (agents.data ?? []).map((a) => ({ value: a.id, label: `${a.full_name} · ${a.username.toUpperCase()}` }));

  return (
    <div className="grid gap-6 animate-rise xl:grid-cols-[1fr_1.1fr]">
      <div className="space-y-4">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Upload policy documents</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select or drop multiple PDFs / images at once (up to {MAX_FILES}, 15 MB each). AI OCR reads all of them in parallel — review each before verification.
          </p>
        </div>

        {canAssign && (
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="label-caps mb-2">Attribute uploads to agent</p>
            <SimpleSelect
              value={agentId}
              onChange={setAgentId}
              options={agentOptions}
              placeholder="Myself"
              allLabel={`Myself (${me.full_name})`}
              testId="upload-agent-select"
              className="w-full"
            />
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          data-testid="upload-dropzone"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "grid-bg relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border-2 border-dashed px-6 py-16 text-center transition-[border-color,background-color] duration-200",
            dragging ? "border-sky-400 bg-sky-500/10" : "border-border bg-[#0D131F] hover:border-sky-500/50",
          )}
        >
          <div className="grid size-12 place-items-center rounded-full bg-primary/15">
            <FileStack className="size-6 text-sky-400" />
          </div>
          <div className="font-heading text-base font-semibold">Drop multiple policy PDFs here</div>
          <div className="text-xs text-muted-foreground">or click to select many files · PDF, JPG, PNG, WEBP · processed simultaneously</div>
          <span className={cn(buttonVariants({ size: "sm" }), "mt-1 pointer-events-none")}>
            <UploadCloud className="size-4" /> Choose files
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            data-testid="upload-file-input"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      <div className="flex flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="flex items-center gap-2 font-heading text-sm font-semibold">
            <ScanLine className="size-4 text-teal-400" /> Batch OCR pipeline
          </h3>
          {queue.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="upload-clear-queue"
              disabled={uploading > 0}
              onClick={() => setQueue([])}
            >
              <Trash2 className="size-3.5" /> Clear list
            </Button>
          )}
        </div>

        {queue.length > 0 && (
          <div data-testid="upload-batch-summary" className="space-y-2 border-b border-border px-5 py-3" aria-live="polite">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <span>
                Total <span data-testid="batch-total" className="font-mono text-foreground">{queue.length}</span>
              </span>
              <span className="text-sky-300">
                Uploading <span data-testid="batch-uploading" className="font-mono">{uploading}</span>
              </span>
              <span className="text-sky-300">
                OCR running <span data-testid="batch-ocr-running" className="font-mono">{ocrRunning}</span>
              </span>
              <span className="text-amber-300">
                Ready for review <span data-testid="batch-extracted" className="font-mono">{extracted}</span>
              </span>
              <span className="text-red-300">
                Failed <span data-testid="batch-failed" className="font-mono">{failed}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div data-testid="batch-progress-bar" className="h-full rounded-full bg-teal-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
            {done === queue.length && extracted > 0 && (
              <Link to="/policies" data-testid="batch-open-mis" className="inline-block text-xs text-sky-400 hover:underline">
                All done — open Policy MIS to review &rarr;
              </Link>
            )}
          </div>
        )}

        {queue.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">Uploaded documents and their extraction status appear here.</div>
        ) : (
          <ul data-testid="upload-queue" className="max-h-[65vh] divide-y divide-border overflow-y-auto">
            {queue.map((item) => (
              <li key={item.key} data-testid="upload-queue-item" className="flex items-center gap-3 px-5 py-3 animate-rise">
                <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
                  {item.isPdf ? <FileText className="size-4 text-red-300" /> : <ImageIcon className="size-4 text-sky-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{item.name}</div>
                  <div className="text-xs text-muted-foreground">{(item.size / 1024).toFixed(0)} KB</div>
                </div>
                {item.state === "uploading" && (
                  <span className="flex items-center gap-1.5 text-xs text-sky-300">
                    <Loader2 className="size-3.5 animate-spin" /> Uploading
                  </span>
                )}
                {item.state === "queued" && <span className="text-xs text-muted-foreground">Queued</span>}
                {item.state === "error" && (
                  <span className="flex items-center gap-1.5 text-xs text-red-300">
                    <XCircle className="size-3.5" /> {item.error}
                  </span>
                )}
                {item.state === "uploaded" && item.policyId && <OcrStatus policyId={item.policyId} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
