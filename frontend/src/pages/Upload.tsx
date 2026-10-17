import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useOutletContext } from "react-router-dom";
import { FileStack, FileText, ImageIcon, Loader2, RotateCcw, ScanLine, Trash2, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { SimpleSelect } from "@/components/SimpleSelect";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { ApiError, apiGet, apiPost, apiUpload } from "@/lib/api";
import { useBrokers, useAgentOptions } from "@/lib/auth";
import { BROKER_PAY_MODES, errorMessage, money, PAYMENT_MODES } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { Policy, UploadBatchIn, UploadBatchPayment, User } from "@/lib/types";

interface QueueItem {
  key: string;
  uploadId: string; // stable per file — a retry sends the same id, so the server never creates a second policy
  name: string;
  size: number;
  isPdf: boolean;
  state: "queued" | "uploading" | "uploaded" | "error";
  policyId?: string;
  error?: string;
}

const UPLOAD_TRIES = 3; // automatic retries on network errors / 429 / 5xx (same upload id → safe)
const transient = (err: unknown) => !(err instanceof ApiError) || err.status === 429 || err.status >= 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isPending = (s?: Policy["status"]) => s === "uploaded" || s === "processing";

/** The 4 stages shown per file. */
function Stage({ label, tone, spin, testId }: { label: string; tone: string; spin?: boolean; testId: string }) {
  return (
    <span data-testid={testId} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", tone)}>
      {spin && <Loader2 className="size-3 animate-spin" />} {label}
    </span>
  );
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
const OK_EXT = /\.(pdf|jpe?g|png|webp)$/i;
const MAX_FILES = 50;
const PARALLEL_UPLOADS = 6; // OCR starts server-side the moment each file lands, so all files process concurrently

const policyQuery = (id: string) => ({
  queryKey: ["policy", id],
  queryFn: () => apiGet<Policy>(`/policies/${id}`),
  refetchInterval: (q: { state: { data?: Policy } }) => (isPending(q.state.data?.status) ? 2500 : false),
});

function OcrStatus({ policyId }: { policyId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery(policyQuery(policyId));
  const dupReason = data?.status === "duplicate" ? data.duplicate_reason : null;
  useEffect(() => {
    if (dupReason) toast.error(`Duplicate rejected — ${dupReason}`, { duration: 10000 });
  }, [dupReason]); // toast is a stable module import, not a dependency
  const retry = useMutation({ // re-runs OCR on the file already in storage — same record, nothing re-uploaded
    mutationFn: () => apiPost<Policy>(`/policies/${policyId}/reextract`),
    onSuccess: (p) => { qc.setQueryData(["policy", p.id], p); toast.success("Retrying OCR on the stored file"); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!data) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  const pending = isPending(data.status);
  return (
    <div className="flex items-center gap-3">
      {pending && <Stage label="OCR running" tone="border-sky-500/30 bg-sky-500/10 text-sky-300" spin testId={`upload-stage-${policyId}`} />}
      {data.status === "failed" && (
        <>
          <Stage label="Failed" tone="border-red-500/30 bg-red-500/10 text-red-300" testId={`upload-stage-${policyId}`} />
          {data.ocr_error && <span className="hidden max-w-56 truncate text-xs text-red-300 lg:inline" title={data.ocr_error}>{data.ocr_error}</span>}
          <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()} data-testid={`upload-retry-ocr-${policyId}`}>
            <RotateCcw className="size-3.5" /> Retry
          </Button>
        </>
      )}
      {["extracted", "flagged", "verified"].includes(data.status) && (
        <Stage label="Ready for review" tone="border-amber-500/30 bg-amber-500/10 text-amber-300" testId={`upload-stage-${policyId}`} />
      )}
      {!pending && data.fields.policy_number && (
        <span className="hidden font-mono text-xs text-muted-foreground md:inline">
          {data.fields.policy_number} · {money(data.fields.gross_premium)}
        </span>
      )}
      {data.status === "duplicate" && data.duplicate_reason && (
        <span data-testid={`upload-duplicate-reason-${policyId}`} className="max-w-md text-xs text-rose-300">
          {data.duplicate_reason}
        </span>
      )}
      {data.status === "duplicate" && <StatusBadge status={data.status} testId={`upload-ocr-status-${policyId}`} />}
      {!pending && (
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
  const isAgent = !canAssign;
  const agents = useAgentOptions(canAssign);
  const [agentId, setAgentId] = useState("");
  const [pickedBroker, setBrokerId] = useState("");
  const brokers = useBrokers();
  const activeBrokers = (brokers.data ?? []).filter((b) => b.active);
  // backoffice with rights to a single broker: fixed, no choice
  const lockedBroker = me.role === "backoffice" && activeBrokers.length === 1 ? activeBrokers[0].id : null;
  const brokerId = lockedBroker ?? (activeBrokers.some((b) => b.id === pickedBroker) ? pickedBroker : "");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const brokerNeeded = !isAgent && activeBrokers.length > 0; // agents never pick (or see) the broker — admin/backoffice set it at review; commission rules are broker-wise, so pick it when brokers exist
  const pickAgent = (id: string) => {
    setAgentId(id);
    const def = agents.data?.find((a) => a.id === id)?.broker_id;
    if (def) setBrokerId(def); // agent's default broker pre-fills
  };
  const [paymentMode, setPaymentMode] = useState(isAgent ? "Online" : "");
  const modeChoices = isAgent ? (["Online"] as const) : PAYMENT_MODES; // agents upload Online-paid policies only
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const isPartial = paymentMode === "Partial Payment";
  const [brokerMode, setBrokerMode] = useState("");
  const [brokerAmount, setBrokerAmount] = useState("");
  const [brokerRef, setBrokerRef] = useState("");
  const brokerPartial = brokerMode === "Partial Payment";
  const brokerPayReady = !brokerId || !!brokerMode;
  const agentReady = !canAssign || !!agentId; // admin/backoffice must pick the agent whose MIS this goes into
  const brokerReady = !brokerNeeded || !!brokerId;
  const onspotProofReady = paymentMode !== "Net of Commission" || !!paymentRef.trim() || !!proofFile;
  const paymentReady = agentReady && brokerReady && brokerPayReady && !!paymentMode && onspotProofReady;
  const blockReason = !agentReady
    ? "Select the partner first"
    : !brokerReady
      ? "Select the channel partner first"
      : !brokerPayReady
      ? "Select how Srishvision pays the premium to the channel partner"
      : !paymentMode
      ? "Select the payment mode first"
      : !onspotProofReady
      ? "Enter the UTR / receipt no. or attach the payment screenshot"
      : "Enter the amount paid for the partial payment";
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<QueueItem>) => setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const forms = useRef(new Map<string, FormData>());

  /** Upload one file; transient failures retry automatically with the same upload id. Returns the policy id or null. */
  async function sendUpload(key: string, name: string, form: FormData): Promise<string | null> {
    patch(key, { state: "uploading", error: undefined });
    for (let attempt = 1; ; attempt++) {
      try {
        const policy = await apiUpload<Policy>("/policies/upload", form);
        qc.setQueryData(["policy", policy.id], policy);
        patch(key, { state: "uploaded", policyId: policy.id });
        return policy.id;
      } catch (err) {
        if (attempt < UPLOAD_TRIES && transient(err)) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        const msg = errorMessage(err, "Upload failed");
        patch(key, { state: "error", error: msg });
        toast.error(`${name}: ${msg}`);
        return null;
      }
    }
  }
  async function retryUpload(item: QueueItem) {
    const form = forms.current.get(item.key);
    if (!form) return toast.error("Pick the file again — it is no longer in this page");
    if (await sendUpload(item.key, item.name, form)) {
      qc.invalidateQueries({ queryKey: ["policies"] });
      toast.success(`${item.name} uploaded`);
    }
  }

  const ids = queue.filter((i) => i.policyId).map((i) => i.policyId as string);
  const statuses = useQueries({ queries: ids.map(policyQuery) });
  const count = (s: Policy["status"]) => statuses.filter((r) => r.data?.status === s).length;
  const uploading = queue.filter((i) => i.state === "queued" || i.state === "uploading").length;
  const ocrRunning = count("processing") + count("uploaded");
  const extracted = count("extracted") + count("verified") + count("flagged");
  const failed = count("failed") + queue.filter((i) => i.state === "error").length;
  const duplicates = count("duplicate");
  const done = extracted + failed + duplicates;
  const pct = queue.length ? Math.round((done / queue.length) * 100) : 0;

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    if (!paymentReady) {
      toast.error(blockReason);
      return;
    }
    let files = Array.from(list);
    if (files.length > MAX_FILES) {
      toast.warning(`Only the first ${MAX_FILES} files were taken — upload the rest in another batch`);
      files = files.slice(0, MAX_FILES);
    }
    const stamp = Date.now();
    const items = files.map((f, i): QueueItem & { file: File } => ({
      key: `${stamp}-${i}-${f.name}`,
      uploadId: crypto.randomUUID(),
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
    // several files: the partial amounts typed are the TOTAL for the batch → split server-side once OCR reads each premium
    const asBatch = valid.length > 1;
    const agentAmt = isPartial && Number(amountPaid) > 0 ? Number(amountPaid) : 0;
    const brokerAmt = brokerId && brokerPartial && Number(brokerAmount) > 0 ? Number(brokerAmount) : 0;
    const uploadedIds: string[] = [];
    await runPool(valid, PARALLEL_UPLOADS, async (item) => {
      const form = new FormData();
      form.append("file", item.file);
      form.append("client_upload_id", item.uploadId);
      if (canAssign) form.append("agent_id", agentId);
      if (brokerId) form.append("broker_id", brokerId);
      form.append("payment_mode", paymentMode);
      if (!asBatch && agentAmt) form.append("amount_paid", amountPaid);
      if (paymentRef) form.append("payment_reference", paymentRef);
      if (paymentMode === "Net of Commission" && proofFile) form.append("onspot_proof", proofFile);
      if (brokerId && brokerMode) {
        form.append("broker_payment_mode", brokerMode);
        if (!asBatch && brokerAmt) form.append("broker_amount_paid", brokerAmount);
        if (brokerRef) form.append("broker_payment_reference", brokerRef);
      }
      forms.current.set(item.key, form); // kept for the Retry button (same file, same id, same payment details)
      const id = await sendUpload(item.key, item.name, form);
      if (id) uploadedIds.push(id);
    });
    if (valid.length > 1) toast.success(`${valid.length} documents uploaded — OCR is running on all of them`);
    if (asBatch && uploadedIds.length && (agentAmt || brokerAmt)) {
      try {
        await apiPost<UploadBatchPayment[]>("/recon/upload-batch", {
          policy_ids: uploadedIds, agent_amount: agentAmt || null, agent_reference: paymentRef || null, broker_amount: brokerAmt || null, broker_reference: brokerRef || null,
        } satisfies UploadBatchIn);
        toast.success(`Batch payment saved — ${[agentAmt && `agent ${money(agentAmt)}`, brokerAmt && `channel partner ${money(brokerAmt)}`].filter(Boolean).join(" · ")} will be split across these ${uploadedIds.length} policies (oldest first) once OCR reads the premiums`);
      } catch (err) {
        toast.error(`Batch payment not saved: ${errorMessage(err)} — record it in Premium Recon`);
      }
    }
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
            <p className="label-caps mb-2">Partner name · required</p>
            <SimpleSelect
              value={agentId}
              onChange={pickAgent}
              options={agentOptions}
              placeholder="Select the partner this policy belongs to"
              testId="upload-agent-select"
              searchable
              className="w-full"
            />
            {agentId ? (
              <p data-testid="upload-agent-confirm" className="mt-1.5 text-xs text-teal-300">
                Uploading for <span className="font-semibold">{agentOptions.find((o) => o.value === agentId)?.label}</span> — check before dropping files.
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-amber-300">The MIS and outstanding premium are generated against this partner.</p>
            )}
          </div>
        )}

        {brokerNeeded && (
          <div className="rounded-xl border border-border bg-card p-4" data-testid="upload-broker-section">
            <p className="label-caps mb-2">Channel Partner · required for commission</p>
            {lockedBroker ? (
              <div data-testid="upload-broker-locked" className="flex h-9 items-center justify-between rounded-md border border-teal-500/40 bg-teal-500/10 px-3 text-sm">
                <span className="font-semibold">{activeBrokers[0].name}</span>
                <span className="text-[11px] text-teal-300">Fixed for your login</span>
              </div>
            ) : (
              <SimpleSelect
                value={brokerId}
                onChange={setBrokerId}
                options={activeBrokers.map((b) => ({ value: b.id, label: b.name }))}
                placeholder="Select the channel partner for these policies"
                testId="upload-broker-select"
                className="w-full"
              />
            )}
            <p className={cn("mt-1.5 text-xs", brokerId ? "text-teal-300" : "text-amber-300")} data-testid="upload-broker-hint">
              {brokerId
                ? `Channel Partner: ${activeBrokers.find((b) => b.id === brokerId)?.name ?? ""} — receivable / payable commission is worked out on this channel partner's grid.`
                : "The channel partner decides which commission rules apply. Set a partner's default channel partner in Users & Access to pre-fill it."}
            </p>
            {brokerId && (
              <div className="mt-3 space-y-2 border-t border-border pt-3" data-testid="upload-broker-payment-section">
                <p className="label-caps">Srishvision → channel partner premium · required</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {BROKER_PAY_MODES.map((m) => (
                    <button key={m} type="button" data-testid={`upload-broker-pay-${m.toLowerCase().replace(/\s+/g, "-")}`} onClick={() => setBrokerMode(m)}
                      className={cn("rounded-md border px-3 py-2 text-sm transition-[border-color,background-color,color] duration-150",
                        brokerMode === m ? "border-primary bg-primary font-semibold text-white" : "border-border text-muted-foreground hover:border-sky-500/40 hover:text-foreground")}>
                      {m}
                    </button>
                  ))}
                </div>
                {brokerPartial && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input data-testid="upload-broker-amount-input" type="number" min="0" step="any" placeholder="Total paid to broker now ₹ (optional)" value={brokerAmount} onChange={(e) => setBrokerAmount(e.target.value)} className="font-mono" />
                    <Input data-testid="upload-broker-reference-input" placeholder="UTR / cheque no. (optional)" value={brokerRef} onChange={(e) => setBrokerRef(e.target.value.toUpperCase())} />
                  </div>
                )}
                <p data-testid="upload-broker-pay-hint" className={cn("text-xs", brokerMode ? "text-teal-300" : "text-amber-300")}>
                  {!brokerMode ? "How does Srishvision pay this premium to the channel partner / insurance company?"
                    : brokerMode === "Cash" ? "Pending to channel partner — the full premium shows in Premium Recon and Policy MIS until Srishvision pays it."
                    : brokerPartial ? "Amount = TOTAL paid for all files dropped now (e.g. ₹1 lakh for 10 policies) — split across them once OCR reads the premiums. Balance stays pending in Premium Recon and Policy MIS."
                    : `Srishvision paid by ${brokerMode} (own card / netbanking / cheque) — nothing pending to the channel partner.`}
                </p>
              </div>
            )}
          </div>
        )}

        <div data-testid="upload-payment-section" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="label-caps">Premium paid by partner · required</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {modeChoices.map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`upload-payment-mode-${m.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => setPaymentMode(m)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm transition-[border-color,background-color,color] duration-150",
                  paymentMode === m ? "border-primary bg-primary font-semibold text-white" : "border-border text-muted-foreground hover:border-sky-500/40 hover:text-foreground",
                )}
              >
                {m === "Net of Commission" ? "On-Spot (Net of Commission)" : m}
              </button>
            ))}
          </div>
          {paymentMode === "Net of Commission" && (
            <div className="grid gap-2 sm:grid-cols-2" data-testid="upload-onspot-proof">
              <Input data-testid="upload-onspot-reference-input" placeholder="UTR / cash deposit receipt no." value={paymentRef} onChange={(e) => setPaymentRef(e.target.value.toUpperCase())} className="font-mono" />
              <label className={cn("flex h-9 cursor-pointer items-center justify-between gap-2 rounded-md border border-dashed px-3 text-xs transition-colors duration-150", proofFile ? "border-emerald-500/60 text-emerald-200" : "border-border text-muted-foreground hover:text-foreground")}>
                <span className="truncate">{proofFile ? proofFile.name : "Attach payment screenshot"}</span>
                <span className="shrink-0 text-sky-300">{proofFile ? "Change" : "Browse"}</span>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" data-testid="upload-onspot-proof-input" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
              </label>
              <p className={cn("text-xs sm:col-span-2", onspotProofReady ? "text-muted-foreground" : "text-amber-300")}>
                Required: UTR / receipt no. or a screenshot — admin checks it against the bank in On-Spot Bank Check.
              </p>
            </div>
          )}
          {paymentMode === "Net of Commission" && (
            <p data-testid="upload-net-commission-note" className="text-xs text-emerald-300">
              Partner paid the premium minus their commission on the spot, before the policy was issued. Commission is worked out from the grid as usual, but it is marked
              <b> deducted on spot</b> — nothing outstanding, no Premium Recon, and it is not paid again in the Commission Statement.
            </p>
          )}
          {isAgent && (
            <p data-testid="upload-agent-online-note" className="text-xs text-teal-300">
              Partners can upload Online-paid policies only. For Cash / Cheque / Partial cases, please send the policy to Backoffice.
            </p>
          )}
          {paymentMode === "Cash" && (
            <p data-testid="upload-cash-note" className="text-xs text-amber-300">
              Cash collected by the partner — the full total premium is kept as the partner&apos;s outstanding premium until Backoffice records the settlement.
            </p>
          )}
          {isPartial && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                data-testid="upload-amount-paid-input"
                type="number"
                min="0"
                step="any"
                placeholder="Total paid by partner now ₹ (optional)"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                className="font-mono"
              />
              <Input
                data-testid="upload-payment-reference-input"
                placeholder="Receipt / UTR / cheque no. (optional)"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
              />
              <p className="text-xs text-muted-foreground sm:col-span-2">
                This is the TOTAL for all files you drop now — it is split across them oldest first once OCR reads each premium (never more than a policy&apos;s premium; any extra stays on-account). The balance stays as partner outstanding in Policy MIS and Premium Recon.
              </p>
            </div>
          )}
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-disabled={!paymentReady}
          data-testid="upload-dropzone"
          onClick={() => (paymentReady ? inputRef.current?.click() : toast.error(blockReason))}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && paymentReady && inputRef.current?.click()}
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
            dragging ? "border-sky-400 bg-sky-500/10" : "border-border bg-muted hover:border-sky-500/50",
            !paymentReady && "opacity-60",
          )}
        >
          <div className="grid size-12 place-items-center rounded-full bg-primary/15">
            <FileStack className="size-6 text-sky-400" />
          </div>
          <div className="font-heading text-base font-semibold">Drop multiple policy PDFs here</div>
          <div className="text-xs text-muted-foreground">
            {paymentReady
              ? `${canAssign ? `For ${agentOptions.find((o) => o.value === agentId)?.label ?? ""} · ` : ""}${brokerId ? `${activeBrokers.find((b) => b.id === brokerId)?.name ?? ""} · ` : ""}or click to select many files · PDF, JPG, PNG, WEBP`
              : `${blockReason} to enable upload`}
          </div>
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
              <span className="text-rose-300">
                Duplicates rejected <span data-testid="batch-duplicates" className="font-mono">{duplicates}</span>
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
                {(item.state === "uploading" || item.state === "queued") && (
                  <Stage label={item.state === "queued" ? "Waiting" : "Uploading"} tone="border-sky-500/30 bg-sky-500/5 text-sky-300" spin={item.state === "uploading"} testId={`upload-stage-${item.uploadId}`} />
                )}
                {item.state === "error" && (
                  <span className="flex items-center gap-2">
                    <Stage label="Failed" tone="border-red-500/30 bg-red-500/10 text-red-300" testId={`upload-stage-${item.uploadId}`} />
                    <span className="flex max-w-56 items-center gap-1 truncate text-xs text-red-300" title={item.error}><XCircle className="size-3.5 shrink-0" /> {item.error}</span>
                    {forms.current.has(item.key) && (
                      <Button size="sm" variant="outline" onClick={() => retryUpload(item)} data-testid={`upload-retry-${item.uploadId}`}>
                        <RotateCcw className="size-3.5" /> Retry
                      </Button>
                    )}
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
