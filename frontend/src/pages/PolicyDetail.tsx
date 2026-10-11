import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Download, Flag, History, Lock, RefreshCw, Save, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { BrokerPaymentPanel, PaymentPanel } from "@/components/PaymentPanel";
import { CommissionPanel } from "@/components/CommissionPanel";
import { ReassignAgent } from "@/components/ReassignAgent";
import { ConfidenceChip, StatusBadge } from "@/components/StatusBadge";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useMeta } from "@/lib/auth";
import { applyMotorRules, errorMessage, FIELD_GROUPS, fmtBytes, fmtDateTime, notApplicableReason } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { Policy, PolicyFields, User } from "@/lib/types";

const NUMERIC = new Set(FIELD_GROUPS.flatMap((g) => g.fields.filter((f) => f.kind === "number").map((f) => f.key)));

function DocumentViewer({ policy }: { policy: Policy }) {
  const src = `/api/policies/${policy.id}/file`;
  return (
    <div className="relative flex h-full min-h-[480px] flex-col overflow-hidden rounded-xl border border-border bg-muted">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span data-testid="document-file-name" className="truncate font-mono text-xs text-muted-foreground">
          {policy.file_name ?? "No source document"}
        </span>
        {policy.has_file && (
          <div className="flex shrink-0 items-center gap-3">
            {policy.file_size ? (
              <span data-testid="document-stored-size" className="font-mono text-[11px] text-muted-foreground">
                {policy.original_size && policy.original_size > policy.file_size ? `${fmtBytes(policy.original_size)} → ` : ""}
                {fmtBytes(policy.file_size)}
              </span>
            ) : null}
            <a href={src} target="_blank" rel="noreferrer" data-testid="document-open-new-tab" className="text-xs text-sky-400 hover:underline">
              Open
            </a>
            <a href={`${src}?download=true`} data-testid="document-download" className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline">
              <Download className="size-3.5" /> Download
            </a>
          </div>
        )}
      </div>
      <div className="relative flex-1">
        {!policy.has_file ? (
          <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
            This record was entered without a source document.
          </div>
        ) : policy.file_mime === "application/pdf" ? (
          <iframe data-testid="document-pdf-viewer" title="Policy document" src={src} className="absolute inset-0 h-full w-full" />
        ) : (
          <div className="absolute inset-0 overflow-auto p-4">
            <img data-testid="document-image-viewer" src={src} alt="Policy document" className="mx-auto max-w-full rounded" />
          </div>
        )}
        {policy.status === "processing" && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden bg-muted/40">
            <div className="h-1/3 w-full animate-ocr-scan bg-gradient-to-b from-transparent via-sky-400/25 to-transparent motion-reduce:animate-none" />
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-sky-500/30 bg-card/90 px-3 py-1.5 text-xs text-sky-300">
              <ScanLine className="size-3.5" /> AI OCR reading document…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function toInput(v: string | number | null): string {
  return v === null || v === undefined ? "" : String(v);
}

function VerificationForm({ policy, me }: { policy: Policy; me: User }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const meta = useMeta();
  const [draft, setDraft] = useState<PolicyFields>(policy.fields);
  const [note, setNote] = useState("");
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagReason, setFlagReason] = useState("");

  const processing = policy.status === "processing";
  const agentLocked = me.role === "agent" && policy.status === "verified";
  const readOnly = processing || agentLocked;
  const canReview = me.role !== "agent";
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(policy.fields), [draft, policy.fields]);

  const refresh = (p: Policy) => {
    qc.setQueryData(["policy", p.id], p);
    qc.invalidateQueries({ queryKey: ["policies"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };
  const onErr = (err: unknown) => toast.error(errorMessage(err));

  const save = useMutation({
    mutationFn: () => apiPatch<Policy>(`/policies/${policy.id}`, { fields: draft, note: note || null }),
    onSuccess: (p) => {
      refresh(p);
      setNote("");
      toast.success("Corrections saved");
    },
    onError: onErr,
  });
  const verify = useMutation({
    mutationFn: async () => {
      if (dirty) await apiPatch<Policy>(`/policies/${policy.id}`, { fields: draft, note: note || null });
      return apiPost<Policy>(`/policies/${policy.id}/verify`, { note: note || null });
    },
    onSuccess: (p) => {
      refresh(p);
      setNote("");
      toast.success("Policy verified and locked");
    },
    onError: onErr,
  });
  const flag = useMutation({
    mutationFn: () => apiPost<Policy>(`/policies/${policy.id}/flag`, { reason: flagReason }),
    onSuccess: (p) => {
      refresh(p);
      setFlagOpen(false);
      setFlagReason("");
      toast.success("Discrepancy flagged");
    },
    onError: onErr,
  });
  const reextract = useMutation({
    mutationFn: () => apiPost<Policy>(`/policies/${policy.id}/reextract`),
    onSuccess: (p) => {
      refresh(p);
      toast.info("Re-running OCR");
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete<{ ok: boolean }>(`/policies/${policy.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["policies"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.success("Policy deleted");
      navigate("/policies");
    },
    onError: onErr,
  });

  const setField = (key: keyof PolicyFields, raw: string) => {
    setDraft((d) => {
      let value: string | number | null;
      if (NUMERIC.has(key)) {
        const n = raw.trim() === "" ? null : Number(raw);
        value = n === null || Number.isNaN(n) ? null : n;
      } else {
        value = raw.trim() === "" ? null : raw;
      }
      return applyMotorRules({ ...d, [key]: value });
    });
  };

  const groups = FIELD_GROUPS.map((g) => (me.role === "agent" ? { ...g, fields: g.fields.filter((f) => f.key !== "intermediary_name") } : g)).filter(
    (g) => !g.lob || draft.lob === g.lob || g.fields.some((f) => !f.derived && draft[f.key] !== null && draft[f.key] !== undefined),
  );

  const premiumMismatch =
    draft.net_premium !== null && draft.gst !== null && draft.gross_premium !== null && Math.abs(draft.net_premium + draft.gst - draft.gross_premium) > 2;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-3">
          <StatusBadge status={policy.status} testId="policy-status-badge" />
          <span className="text-xs text-muted-foreground">
            <span data-testid="policy-agent-label">{policy.agent_name} · <span className="font-mono">{policy.agent_code}</span></span> · {policy.branch ?? "—"}
          </span>
          {canReview && !processing && <ReassignAgent policyIds={[policy.id]} currentAgentId={policy.agent_id} testId="policy-reassign-agent" />}
        </div>
        {readOnly && !processing && (
          <span data-testid="policy-locked-note" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" /> Locked after verification — flag to request a correction
          </span>
        )}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {policy.status === "flagged" && policy.flag_reason && (
          <div data-testid="policy-flag-reason" className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
            <span className="font-semibold">Flagged:</span> {policy.flag_reason}
          </div>
        )}
        {policy.status === "duplicate" && (
          <div data-testid="policy-duplicate-reason" className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <span className="font-semibold">Duplicate – not added to MIS:</span> {policy.duplicate_reason}
            {policy.duplicate_of_id && (
              <Link to={`/policies/${policy.duplicate_of_id}`} data-testid="policy-duplicate-original-link" className="ml-2 text-sky-400 hover:underline">
                View existing policy
              </Link>
            )}
          </div>
        )}
        {policy.status === "failed" && (
          <div data-testid="policy-ocr-error" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            OCR could not read this document{policy.ocr_error ? ` (${policy.ocr_error})` : ""}. Re-run OCR or enter the details manually.
          </div>
        )}
        {policy.status === "verified" && (
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="size-3.5" /> Verified by {policy.verified_by_name} · {fmtDateTime(policy.verified_at)}
          </div>
        )}

        {groups.map((g) => (
          <fieldset key={g.id} disabled={readOnly} className="space-y-3">
            <legend className="label-caps mb-3">{g.title}</legend>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {g.fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`f-${f.key}`} className="text-xs text-slate-400">{f.label}</Label>
                    {notApplicableReason(draft, f.key) ? (
                      <span data-testid={`na-${f.key}`} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {notApplicableReason(draft, f.key)}
                      </span>
                    ) : (
                      <ConfidenceChip value={policy.confidence[f.key]} testId={`confidence-${f.key}`} />
                    )}
                  </div>
                  {f.kind === "select" && f.metaKey ? (
                    <SimpleSelect
                      value={(draft[f.key] as string | null) ?? ""}
                      onChange={(v) => setField(f.key, v)}
                      placeholder={`Select ${f.label.toLowerCase()}`}
                      testId={`field-${f.key.replace(/_/g, "-")}`}
                      className="w-full"
                      options={(meta.data?.[f.metaKey] ?? []).map((l) => ({ value: l, label: l }))}
                    />
                  ) : (
                    <Input
                      id={`f-${f.key}`}
                      data-testid={`field-${f.key.replace(/_/g, "-")}`}
                      type={f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"}
                      step={f.kind === "number" ? "any" : undefined}
                      value={toInput(draft[f.key])}
                      onChange={(e) => setField(f.key, e.target.value)}
                      readOnly={f.derived || !!notApplicableReason(draft, f.key)}
                      tabIndex={f.derived || notApplicableReason(draft, f.key) ? -1 : undefined}
                      placeholder={f.derived ? "Needs risk start + reg. date / mfg year" : notApplicableReason(draft, f.key) ? "N/A" : undefined}
                      className={cn(
                        "font-mono text-sm",
                        notApplicableReason(draft, f.key) && "cursor-not-allowed border-dashed bg-slate-800/40 text-slate-400",
                        f.derived && "cursor-default border-dashed bg-teal-500/5 text-teal-200",
                        draft[f.key] !== policy.fields[f.key] && "border-sky-500/60",
                        f.key === "gross_premium" && premiumMismatch && "border-amber-500/70",
                      )}
                    />
                  )}
                </div>
              ))}
            </div>
            {g.id === "motor" && (
              <p className="text-xs text-muted-foreground">
                RTO is read from the registration no. and vehicle age is auto-calculated from risk start date vs registration date (or year of manufacturing) when you save.
                Liability Only policies auto-set NCB, IDV, OD and add-on premium to 0; GVW is not applicable for Private Car, Two Wheeler and Passenger Carrying vehicles.
              </p>
            )}
            {g.id === "premium" && premiumMismatch && (
              <p data-testid="premium-mismatch-warning" className="text-xs text-amber-300">
                Net premium + GST does not equal gross premium — please double-check.
              </p>
            )}
          </fieldset>
        ))}

        <PaymentPanel policy={policy} me={me} onUpdated={refresh} />
        {policy.broker_id && me.role !== "agent" && <BrokerPaymentPanel policy={policy} me={me} onUpdated={refresh} />}
        <CommissionPanel policy={policy} me={me} onUpdated={refresh} />

        <div className="space-y-2">
          <p className="label-caps flex items-center gap-1.5">
            <History className="size-3" /> Audit trail
          </p>
          <ol data-testid="policy-history" className="space-y-2 border-l border-border pl-4">
            {[...policy.history].reverse().map((h) => (
              <li key={`${h.at}-${h.action}-${h.by_name}`} className="text-xs">
                <span className="font-medium text-foreground">{h.action}</span>
                <span className="text-muted-foreground"> · {h.by_name} ({h.by_role}) · {fmtDateTime(h.at)}</span>
                {h.note && <div className="mt-0.5 text-muted-foreground">{h.note}</div>}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="space-y-3 border-t border-border bg-muted/60 p-4">
        {!readOnly && (
          <Input
            data-testid="policy-note-input"
            placeholder="Optional note for the audit trail"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <Button variant="outline" data-testid="policy-save-button" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              <Save className="size-4" /> {save.isPending ? "Saving…" : "Save corrections"}
            </Button>
          )}
          {canReview && !processing && policy.status !== "verified" && (
            <Button data-testid="verify-approve-btn" disabled={verify.isPending} onClick={() => verify.mutate()} className="bg-emerald-600 text-white hover:bg-emerald-500">
              <CheckCircle2 className="size-4" /> {verify.isPending ? "Verifying…" : "Verify & lock"}
            </Button>
          )}
          {!processing && (
            <Button variant="outline" data-testid="flag-discrepancy-btn" onClick={() => setFlagOpen(true)} className="border-orange-500/40 text-orange-300 hover:bg-orange-500/10">
              <Flag className="size-4" /> Flag discrepancy
            </Button>
          )}
          {policy.has_file && !processing && !agentLocked && (
            <Button variant="ghost" data-testid="reextract-ocr-btn" disabled={reextract.isPending} onClick={() => reextract.mutate()}>
              <RefreshCw className="size-4" /> Re-run OCR
            </Button>
          )}
          {me.role === "admin" && (
            <Button
              variant="ghost"
              data-testid="policy-delete-btn"
              className="ml-auto text-red-300 hover:bg-red-500/10"
              onClick={() => window.confirm("Delete this policy record?") && remove.mutate()}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <Dialog open={flagOpen} onOpenChange={setFlagOpen}>
        <DialogContent data-testid="flag-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Flag a discrepancy</DialogTitle>
            <DialogDescription>Describe what's wrong. Backoffice will see this in the review queue.</DialogDescription>
          </DialogHeader>
          <Textarea
            data-testid="flag-reason-input"
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            placeholder="e.g. Sum insured on schedule differs from proposal"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlagOpen(false)} data-testid="flag-cancel-btn">Cancel</Button>
            <Button data-testid="flag-submit-btn" disabled={flagReason.trim().length < 3 || flag.isPending} onClick={() => flag.mutate()}>
              {flag.isPending ? "Flagging…" : "Flag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PolicyDetail() {
  const { id = "" } = useParams();
  const me = useOutletContext<User>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["policy", id],
    queryFn: () => apiGet<Policy>(`/policies/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 2500 : false),
  });

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex items-center gap-3">
        <Link to="/policies" data-testid="back-to-policies" className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <h2 data-testid="policy-detail-title" className="font-heading text-xl font-bold tracking-tight">
          {data?.fields.policy_number ?? data?.file_name ?? "Policy"}
        </h2>
      </div>
      {isError ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          This policy could not be loaded, or it is outside your access scope.
        </div>
      ) : isLoading || !data ? (
        <div className="h-[70vh] animate-pulse rounded-xl bg-muted" />
      ) : (
        <div className="grid gap-4 lg:h-[calc(100vh-9.5rem)] lg:grid-cols-12">
          <div className="lg:col-span-5">
            <DocumentViewer policy={data} />
          </div>
          <div className="min-h-0 lg:col-span-7">
            <VerificationForm key={`${data.id}-${data.updated_at}`} policy={data} me={me} />
          </div>
        </div>
      )}
    </div>
  );
}
