import { useSearchParams } from "react-router-dom";
import { GridTemplatesButton } from "@/components/GridTemplates";
import { PurgeRulesButton } from "@/components/PurgeRules";
import { rtoLabel } from "@/lib/rates";
import { GridCompare } from "@/components/GridCompare";
import { MarginGridTab } from "@/components/MarginGridTab";
import { HoldsTab } from "@/components/HoldsTab";
import { DeclinedRtosTab } from "@/components/DeclinedRtosTab";
import { RtoGroupsTab } from "@/components/RtoGroupsTab";
import { RateMatrixTab } from "@/components/RateMatrixTab";
import { CopyRulesDialog } from "@/components/CopyRulesDialog";
import { AgentPayablesTab } from "@/components/AgentPayablesTab";
import { AiGridUpload } from "@/components/AiGridUpload";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, FileDown, FileSpreadsheet, Pencil, Plus, Search, SearchCheck, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReopenEnded } from "@/components/ReopenEnded";
import { CopyGroupDialog } from "@/components/CopyGroupDialog";
import { PayableDuplicatesDialog } from "@/components/PayableDuplicatesDialog";
import { InsurerDuplicates } from "@/components/InsurerDuplicates";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/components/SimpleSelect";
import { RuleDialog, pctSummary, useCommissionMasters } from "@/components/RuleDialog";
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from "@/lib/api";
import { useAgentGroups, useAgentOptions, useBrokers } from "@/lib/auth";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { GridRowPreview, GridUploadResult, AgentGroup, Broker, BrokerIn, Insurer, InsurerIn, CommissionRule, GroupMarginsIn, GroupMembersIn, RuleKind, User } from "@/lib/types";

type Tab = "receivable" | "payable" | "margins" | "holds" | "declined-rtos" | "compare" | "brokers" | "groups" | "insurers" | "rto-groups" | "matrix" | "agent-payables";

const ACTION_STYLE: Record<GridRowPreview["action"], [string, string]> = {
  create: ["New rule", "bg-teal-500/15 text-teal-300"],
  update: ["Update", "bg-sky-500/15 text-sky-300"],
  unchanged: ["No change", "bg-muted text-muted-foreground"],
  error: ["Error", "bg-red-500/15 text-red-300"],
};

function GridExcel({ kind }: { kind: RuleKind }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<GridUploadResult | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [opts, setOpts] = useState({ from: "", to: "", past: false });
  const send = (f: File, preview: boolean, o = opts) => {
    const fd = new FormData();
    fd.append("file", f);
    const q = new URLSearchParams({ preview: String(preview), apply_to_past: String(o.past) });
    if (o.from && !o.past) q.set("valid_from", o.from);
    if (o.to) q.set("valid_to", o.to);
    return apiUpload<GridUploadResult>(`/commission/grid/upload?${q}`, fd);
  };
  const check = useMutation({
    mutationFn: ({ f, o }: { f: File; o?: typeof opts }) => send(f, true, o),
    onSuccess: (res, { f }) => { setFile(f); setResult(res); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  // date / apply-to-past changes re-run the check so the screen always shows what Save will do
  const changeOpts = (patch: Partial<typeof opts>) => {
    const o = { ...opts, ...patch };
    setOpts(o);
    if (file) check.mutate({ f: file, o });
  };
  const save = useMutation({
    mutationFn: (f: File) => send(f, false),
    onSuccess: (res) => {
      ["commission-rules", "policies", "commission", "my-rates", "commission-compare"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setResult(res);
      setFile(null);
      toast.success(`Grid saved — ${res.created} added, ${res.updated} updated${res.errors.length ? `, ${res.errors.length} rows skipped` : ""}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const close = () => { setResult(null); setFile(null); setOpts({ from: "", to: "", past: false }); };
  const rows = (result?.rows ?? []).filter((r) => !onlyChanges || r.action !== "unchanged");
  const busy = check.isPending || save.isPending;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/5 px-3 py-2" data-testid={`${kind}-grid-excel`}>
      <FileSpreadsheet className="size-4 text-teal-300" />
      <span className="mr-auto text-xs text-muted-foreground">Bulk update with Excel — one row per rule. Download the current grid, edit rates / add rows (e.g. same company + channel partner, different agent), then upload. You check every change before it is saved.</span>
      <a href={`/api/commission/grid/template?kind=${kind}`} data-testid={`${kind}-grid-template-download`}><Button size="sm" variant="outline"><FileDown className="size-3.5" /> Blank template</Button></a>
      <a href={`/api/commission/grid/template?prefill=true&kind=${kind}`} data-testid={`${kind}-grid-current-download`}><Button size="sm" variant="outline"><FileDown className="size-3.5" /> Current {kind} grid</Button></a>
      <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-teal-600 px-3 text-sm font-medium text-white transition-colors hover:bg-teal-500", busy && "pointer-events-none opacity-60")}>
        <Upload className="size-3.5" /> {check.isPending ? "Checking…" : "Upload grid"}
        <input type="file" accept=".xlsx" className="hidden" data-testid={`${kind}-grid-upload-input`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) check.mutate({ f }); e.target.value = ""; }} />
      </label>
      <AiGridUpload kind={kind} />
      <GridTemplatesButton />
      <PurgeRulesButton />
      <Dialog open={!!result} onOpenChange={(o) => !o && !save.isPending && close()}>
        <DialogContent data-testid="grid-upload-result" className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-heading">{result?.preview ? "Check the changes before saving" : "Grid saved"}</DialogTitle>
            <DialogDescription>
              {result?.preview
                ? `Nothing is saved yet. Rate changes apply to new policies from the date shown${opts.to ? " up to the To date (old rate before and after)" : ""}; existing policies keep their saved commission. Rows with errors are skipped.`
                : "These changes are now live on the grid."}
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                {([["Added", result.created, "text-teal-300"], ["Updated", result.updated, "text-sky-300"], ["Unchanged", result.unchanged, "text-muted-foreground"], ["Errors", result.errors.length, "text-red-300"]] as const).map(([l, v, c]) => (
                  <div key={l} className="rounded-lg border border-border p-2" data-testid={`grid-result-${l.toLowerCase()}`}>
                    <div className={cn("font-mono text-2xl font-bold", c)}>{v}</div>
                    <div className="text-[11px] text-muted-foreground">{result.preview ? `${l === "Errors" ? "Will skip" : "Will be"} ${l === "Errors" ? "" : l.toLowerCase()}`.trim() : l}</div>
                  </div>
                ))}
              </div>
              {result.preview && (
                <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3" data-testid="grid-upload-dates">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Applicable from</Label>
                      <Input type="date" value={opts.from} disabled={opts.past || check.isPending} onChange={(e) => changeOpts({ from: e.target.value })} className="h-8 w-40 text-xs" data-testid="grid-upload-from" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Applicable to (optional)</Label>
                      <Input type="date" value={opts.to} disabled={check.isPending} onChange={(e) => changeOpts({ to: e.target.value })} className="h-8 w-40 text-xs" data-testid="grid-upload-to" />
                    </div>
                    <span className="pb-1.5 text-[11px] text-muted-foreground">{check.isPending ? "Re-checking…" : "Blank = use the dates in each Excel row (rate-only changes start today)."}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground" data-testid="grid-upload-history-note">
                    Revised rates apply to new policies from the date above; with a To date, only inside that range. Commission already saved on existing policies never changes.
                  </p>
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} data-testid="grid-result-only-changes" /> Hide rows with no change
              </label>
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-border" data-testid="grid-result-rows">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                    <tr><th className="px-2 py-1.5">Sheet · row</th><th className="px-2 py-1.5">Action</th><th className="px-2 py-1.5">Rule</th><th className="px-2 py-1.5">What changes</th><th className="px-2 py-1.5">From</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.sheet}-${r.row}`} className="border-t border-border/60 align-top" data-testid={`grid-result-row-${r.sheet ?? "grid"}-${r.row}`}>
                        <td className="px-2 py-1.5 font-mono">{r.sheet ? <span className="block font-sans text-[10px] text-muted-foreground">{r.sheet}</span> : null}{r.row}</td>
                        <td className="px-2 py-1.5"><span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]", ACTION_STYLE[r.action][1])}>{ACTION_STYLE[r.action][0]}</span></td>
                        <td className="px-2 py-1.5"><div className="font-medium">{r.name || "—"}</div><div className="text-[11px] text-muted-foreground">{[r.kind, r.insurer].filter(Boolean).join(" · ")}</div></td>
                        <td className="px-2 py-1.5">
                          {r.action === "error" ? <span className="text-red-300">{r.error}</span> : r.changes.length ? (
                            <ul className="space-y-0.5">{r.changes.map((c) => <li key={c} className="font-mono">{c}</li>)}</ul>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono">{r.action === "create" || r.action === "update" ? r.effective_from || "Always" : ""}{(r.action === "create" || r.action === "update") && opts.to ? ` → ${opts.to}` : ""}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">No changes in this file.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            {result?.preview ? (
              <>
                <Button variant="outline" onClick={close} disabled={save.isPending} data-testid="grid-result-cancel">Cancel</Button>
                <Button onClick={() => file && save.mutate(file)} disabled={!file || save.isPending || check.isPending || result.created + result.updated === 0} data-testid="grid-result-confirm">
                  {save.isPending ? "Saving…" : `Confirm & save ${result.created + result.updated} change${result.created + result.updated === 1 ? "" : "s"}`}
                </Button>
              </>
            ) : <Button onClick={close} data-testid="grid-result-close">Done</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RulesTable({ kind }: { kind: RuleKind }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["commission-rules"], queryFn: () => apiGet<CommissionRule[]>("/commission/rules") });
  const brokers = useBrokers();
  const agents = useAgentOptions(kind === "payable");
  const [dialog, setDialog] = useState<{ editing: CommissionRule | null; key: number } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const zones = useCommissionMasters().data?.rto_zones ?? [];
  const bName = Object.fromEntries((brokers.data ?? []).map((b) => [b.id, b.name]));
  const aName = Object.fromEntries((agents.data ?? []).map((a) => [a.id, `${a.full_name} · ${a.username.toUpperCase()}`]));
  const all = rules.data ?? [];
  const list = all.filter((r) => r.kind === kind && !r.superseded_by);
  const history = (r: CommissionRule) =>
    all.filter((x) => (x.version_of ?? x.id) === (r.version_of ?? r.id)).sort((a, b) => (b.valid_from ?? "").localeCompare(a.valid_from ?? ""));
  const versions = (r: CommissionRule) => history(r).length;
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/commission/rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commission-rules"] });
      toast.success("Rule stopped — earlier policies keep their commission");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const masters = useCommissionMasters();
  const types = masters.data?.product_types ?? {};
  const typeOf = (r: CommissionRule) => Object.keys(types).find((t) => r.products.length > 0 && r.products.every((p) => types[t].includes(p))) ?? "All / mixed products";
  const range = (lo: number | null, hi: number | null) => `${lo ?? 0} – ${hi ?? "∞"}`;
  /** Labelled conditions, excluding company + product type (shown as headings). */
  const conditions = (r: CommissionRule): { label: string; value: string }[] => {
    const t = typeOf(r);
    const subs = types[t] && r.products.length < types[t].length ? r.products.join(", ") : null;
    return [
      ["Channel partner", r.broker_ids.map((b) => bName[b] ?? b).join(", ")], ["Agent", r.agent_id && aName[r.agent_id]], ["Group", r.agent_group],
      ["Product", subs ?? (t === "All / mixed products" && r.products.length ? r.products.join(", ") : null)],
      ["Package / SATP", r.cover === "package" ? "Package only" : r.cover === "satp" ? "SATP only" : null],
      ["RTO", r.rtos.length ? rtoLabel(r.rtos, zones) : null],
      ["GVW (kg)", r.gvw_min != null || r.gvw_max != null ? range(r.gvw_min, r.gvw_max) : null],
      ["CC", r.cc_min != null || r.cc_max != null ? range(r.cc_min, r.cc_max) : null],
      ["Seats", r.seating_min != null || r.seating_max != null ? range(r.seating_min, r.seating_max) : null],
      ["Age", r.vehicle_ages.length ? r.vehicle_ages.join(", ") : null],
      ["NCB", r.ncb !== "any" ? (r.ncb === "with" ? "With NCB" : "Without NCB") : null],
      ["Fuel", r.fuel_types.length ? r.fuel_types.join(", ") : null],
      ["Business type", r.business_types?.length ? r.business_types.join(", ") : null],
      ["Make / model", [r.makes.join(", "), r.model].filter(Boolean).join(" · ") || null],
    ].filter((c): c is [string, string] => !!c[1]).map(([label, value]) => ({ label, value }));
  };
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<Partial<CommissionRule> | undefined>(undefined);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const search = (r: CommissionRule) =>
    !q || `${r.name} ${r.insurer ?? ""} ${typeOf(r)} ${conditions(r).map((c) => c.value).join(" ")}`.toLowerCase().includes(q.toLowerCase());
  const [coFilter, setCoFilter] = useState(""); // "" = all companies (each tab has its own RulesTable → independent)
  const [prodFilter, setProdFilter] = useState(""); // "" = all products
  const [copyGroup, setCopyGroup] = useState<{ company: string; rules: CommissionRule[] } | null>(null);
  const [dups, setDups] = useState(false);
  // rules with no product set apply to every product, so they match any product filter
  const matchesFilters = (r: CommissionRule) => (!coFilter || companyOf(r) === coFilter) && (!prodFilter || r.products.length === 0 || r.products.includes(prodFilter));
  // "ICICI", "ICICI Lombard", "ICICI Lombard General Insurance" are one company — group on the first word
  const firstWord = (v: string) => v.trim().split(/\s+/)[0].toLowerCase();
  const companyOf = (r: CommissionRule) => {
    if (!r.insurer) return "All companies";
    const master = (masters.data?.insurers ?? []).find((n) => firstWord(n) === firstWord(r.insurer!));
    return master ?? r.insurer;
  };
  // single pass: company → product type → rules (avoids re-filtering per company and per type during render)
  const shown = list.filter((r) => search(r) && matchesFilters(r));
  const companyOptions = [...new Set(list.map(companyOf))].sort().map((c) => ({ value: c, label: c }));
  const productOptions = Object.entries(types).flatMap(([t, ps]) => ps.map((p) => ({ value: p, label: p === t ? p : `${p} (${t})` })));
  const grouped = new Map<string, Map<string, CommissionRule[]>>();
  for (const r of shown) {
    const co = companyOf(r);
    const t = typeOf(r);
    const byType = grouped.get(co) ?? new Map<string, CommissionRule[]>();
    byType.set(t, [...(byType.get(t) ?? []), r]);
    grouped.set(co, byType);
  }
  const companies = [...grouped.keys()].sort((a, b) => (a === "All companies" ? 1 : b === "All companies" ? -1 : a.localeCompare(b)));
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const open = (editing: CommissionRule | null, p?: Partial<CommissionRule>) => { setPreset(p); setDialog({ editing, key: Date.now() }); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {kind === "receivable" ? "What channel partners pay Srish Vision on each policy." : "What Srish Vision pays agents — capped at the receivable."} Grouped by company, then product.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input data-testid={`${kind}-rules-search`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, product, RTO…" className="w-64 pl-8" />
          </div>
          {picked.length > 0 && (
            <>
              <Button variant="outline" data-testid={`${kind}-copy-selected-button`} onClick={() => setCopying(true)}>
                <Copy className="size-4" /> Copy {picked.length} selected
              </Button>
              <Button variant="ghost" size="sm" data-testid={`${kind}-clear-selection-button`} onClick={() => setPicked([])}>Clear</Button>
            </>
          )}
          {kind === "payable" && (
            <Button variant="outline" data-testid="payable-find-duplicates-button" onClick={() => setDups(true)}>
              <SearchCheck className="size-4" /> Find duplicates
            </Button>
          )}
          <Button data-testid={`add-${kind}-rule-button`} onClick={() => open(null)}>
            <Plus className="size-4" /> Add {kind} rule
          </Button>
        </div>
      </div>

      <GridExcel kind={kind} />
      <div data-testid={`${kind}-rule-filters`} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="space-y-1">
          <span className="label-caps block text-[10px] text-muted-foreground">Insurance company</span>
          <SimpleSelect value={coFilter} onChange={setCoFilter} allLabel="All companies" placeholder="Insurance company" testId={`${kind}-filter-company`} className="w-64" searchable options={companyOptions} />
        </div>
        <div className="space-y-1">
          <span className="label-caps block text-[10px] text-muted-foreground">Product</span>
          <SimpleSelect value={prodFilter} onChange={setProdFilter} allLabel="All products" placeholder="Product" testId={`${kind}-filter-product`} className="w-64" searchable options={productOptions} />
        </div>
        {(coFilter || prodFilter) && (
          <Button variant="ghost" size="sm" data-testid={`${kind}-filter-clear`} onClick={() => { setCoFilter(""); setProdFilter(""); }}>Clear filters</Button>
        )}
        <span data-testid={`${kind}-filter-count`} className="ml-auto text-xs text-muted-foreground">Showing {shown.length} of {list.length} rules</span>
      </div>
      {dups && <PayableDuplicatesDialog companies={[...new Set(list.map(companyOf))].filter((c) => c !== "All companies").sort()} onClose={() => setDups(false)} />}
      {copyGroup && <CopyGroupDialog kind={kind} company={copyGroup.company} rules={copyGroup.rules} onClose={() => setCopyGroup(null)} />}
      {copying && (
        <CopyRulesDialog rules={list.filter((r) => picked.includes(r.id))} onClose={() => setCopying(false)} onDone={() => { setCopying(false); setPicked([]); }} />
      )}
      <div data-testid={`${kind}-rules-table`} className="space-y-4">
        {companies.map((co) => {
          const byType = grouped.get(co) ?? new Map<string, CommissionRule[]>();
          const ptypes = [...byType.keys()];
          const coCount = [...byType.values()].reduce((n, rs) => n + rs.length, 0);
          const isClosed = closed[co] ?? false;
          return (
            <section key={co} data-testid={`rule-company-${slug(co)}`} className="overflow-hidden rounded-xl border border-border bg-card">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/40 px-4 py-3">
                <button type="button" onClick={() => setClosed((c) => ({ ...c, [co]: !isClosed }))} data-testid={`rule-company-toggle-${slug(co)}`}
                  className="flex items-center gap-2 text-left">
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", isClosed && "-rotate-90")} />
                  <span className="h-5 w-1 rounded-full bg-teal-400" />
                  <span className="font-heading text-lg font-bold">{co}</span>
                  <span className="text-xs text-muted-foreground">{coCount} rule{coCount === 1 ? "" : "s"} · {ptypes.join(", ")}</span>
                </button>
                <Button size="sm" variant="outline" data-testid={`rule-company-add-${slug(co)}`} onClick={() => open(null, co === "All companies" ? {} : { insurer: co })}>
                  <Plus className="size-3.5" /> Add rule for {co}
                </Button>
                <Button size="sm" variant="outline" data-testid={`rule-company-copy-to-${slug(co)}`} onClick={() => setCopyGroup({ company: co, rules: [...byType.values()].flat() })}>
                  <Copy className="size-3.5" /> Copy to {kind === "payable" ? "agent" : "channel partner"}…
                </Button>
                <ReopenEnded company={co} testKey={slug(co)} rules={[...byType.values()].flat().filter((r) => !!r.valid_to && r.valid_to < todayIso())} />
              </header>
              {!isClosed && ptypes.map((t) => (
                <div key={t} className="border-b border-border/60 last:border-0" data-testid={`rule-product-${slug(co)}-${slug(t)}`}>
                  <div className="flex items-center justify-between px-4 pb-1 pt-3">
                    <h4 className="label-caps text-sky-300">{t}</h4>
                    {types[t] && (
                      <button type="button" className="text-xs text-sky-300 underline-offset-2 hover:underline" data-testid={`rule-product-add-${slug(co)}-${slug(t)}`}
                        onClick={() => open(null, { ...(co === "All companies" ? {} : { insurer: co }), products: [...types[t]] })}>
                        + Add {t} rule
                      </button>
                    )}
                  </div>
                  <Table>
                    <TableBody>
                      {(byType.get(t) ?? []).map((r) => {
                        const conds = conditions(r);
                        return (
                          <TableRow key={r.id} data-testid={`rule-row-${r.id}`}
                            ref={(el) => { if (el && r.id === fresh) el.scrollIntoView({ block: "center", behavior: "smooth" }); }}
                            className={cn("align-top transition-colors duration-700", r.id === fresh && "bg-sky-500/15 ring-1 ring-inset ring-sky-500/50")}>
                            <TableCell className="w-8 pr-0">
                              <Checkbox data-testid={`rule-select-${r.id}`} aria-label={`Select ${r.name}`} checked={picked.includes(r.id)} onCheckedChange={() => togglePick(r.id)} />
                            </TableCell>
                            <TableCell className="w-48 whitespace-normal">
                              <div className="text-sm font-semibold">{r.name}</div>
                              <div className="mt-1 text-[11px] text-muted-foreground">{r.valid_from || r.valid_to ? `${r.valid_from ?? "start"} → ${r.valid_to ?? "until changed"}` : "Always"}</div>
                              {r.valid_to && r.valid_to < todayIso() && (
                                <span data-testid={`rule-ended-${r.id}`} title="Past its To date — not used for new policies, Agent-wise payables, Rate matrix or Compare. Edit the rule and clear the To date to make it current."
                                  className="mt-1 inline-block rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Ended — edit To date</span>
                              )}
                              {versions(r) > 1 && (
                                <button type="button" data-testid={`rule-versions-${r.id}`} onClick={() => setOpenHist(openHist === r.id ? null : r.id)}
                                  className="mt-1 rounded-md border border-sky-500/40 px-1.5 py-0.5 text-[10px] text-sky-300 transition-colors hover:bg-sky-500/10">
                                  v{versions(r)} · {openHist === r.id ? "hide history" : "history"}
                                </button>
                              )}
                              {openHist === r.id && (
                                <ul data-testid={`rule-history-${r.id}`} className="mt-2 space-y-1 border-l border-sky-500/40 pl-2 text-[11px]">
                                  {history(r).map((v) => (
                                    <li key={v.id} data-testid={`rule-history-item-${v.id}`} className={cn(v.id === r.id ? "text-foreground" : "text-muted-foreground")}>
                                      <span className="font-mono">{v.valid_from ?? "start"} → {v.valid_to ?? "until changed"}</span> · <span className="font-mono text-teal-300">{pctSummary(v)}</span>
                                      {v.id === r.id && " (current)"}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {r.id === fresh && <Badge data-testid="rule-just-saved" className="mt-1 bg-sky-500 text-[10px] text-white">Just saved</Badge>}
                              {!r.active && <Badge variant="outline" className="mt-1 text-[10px] text-muted-foreground">Inactive</Badge>}
                            </TableCell>
                            <TableCell className="whitespace-normal">
                              {conds.length ? (
                                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 lg:grid-cols-3" data-testid={`rule-conditions-${r.id}`}>
                                  {conds.map((c) => (
                                    <div key={c.label} className="min-w-0">
                                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</dt>
                                      <dd className="text-[13px] font-medium text-foreground">{c.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              ) : <span className="text-[13px] font-medium">All {t === "All / mixed products" ? "policies" : `${t} policies`}</span>}
                            </TableCell>
                            <TableCell className="w-36 text-right">
                              <span data-testid={`rule-rate-${r.id}`} className="font-mono text-lg font-bold text-teal-300">{pctSummary(r)}</span>
                            </TableCell>
                            <TableCell className="w-24 text-right">
                              <div className="flex justify-end gap-1">
                                <Button size="icon-sm" variant="ghost" aria-label="Edit rule" data-testid={`rule-edit-${r.id}`} onClick={() => open(r)}>
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button size="icon-sm" variant="ghost" aria-label="Delete rule" data-testid={`rule-delete-${r.id}`} onClick={() => window.confirm(`Stop rule "${r.name}"? Policies before today keep this commission (rules added today are removed completely).`) && del.mutate(r.id)}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </section>
          );
        })}
        {!rules.isLoading && shown.length === 0 && (
          <div className="grid h-32 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">{q ? `No ${kind} rules match "${q}".` : `No ${kind} rules yet.`}</div>
        )}
      </div>
      {dialog && <RuleDialog key={dialog.key} kind={kind} editing={dialog.editing} preset={preset} onClose={() => setDialog(null)} onSaved={(saved) => setFresh(saved.id)} />}
    </div>
  );
}

function BrokersTab() {
  const qc = useQueryClient();
  const brokers = useBrokers();
  const [form, setForm] = useState<{ id: string | null; name: string; code: string; aliases: string; active: boolean }>({ id: null, name: "", code: "", aliases: "", active: true });
  const save = useMutation({
    mutationFn: () => {
      const body: BrokerIn = { name: form.name, code: form.code || null, aliases: form.aliases.split(",").map((a) => a.trim()).filter(Boolean), active: form.active };
      return form.id ? apiPut<Broker>(`/brokers/${form.id}`, body) : apiPost<Broker>("/brokers", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brokers"] });
      toast.success(form.id ? "Channel Partner updated" : "Channel Partner added");
      setForm({ id: null, name: "", code: "", aliases: "", active: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const delBroker = useMutation({
    mutationFn: (id: string) => apiDelete(`/brokers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brokers"] }); toast.success("Broker deleted"); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Channel Partner</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Other names on policies (OCR match)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody data-testid="brokers-table">
            {(brokers.data ?? []).map((b) => (
              <TableRow key={b.id} data-testid={`broker-row-${b.id}`}>
                <TableCell className="font-medium">{b.name}</TableCell>
                <TableCell className="font-mono text-xs">{b.code ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{b.aliases.join(", ") || "—"}</TableCell>
                <TableCell className={cn("text-xs", b.active ? "text-emerald-300" : "text-red-300")}>{b.active ? "Active" : "Inactive"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" aria-label="Edit broker" data-testid={`broker-edit-${b.id}`}
                      onClick={() => setForm({ id: b.id, name: b.name, code: b.code ?? "", aliases: b.aliases.join(", "), active: b.active })}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete broker" data-testid={`broker-delete-${b.id}`}
                      onClick={() => window.confirm(`Delete channel partner ${b.name}?`) && delBroker.mutate(b.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(brokers.data ?? []).length === 0 && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No channel partners yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="broker-form">
        <p className="label-caps">{form.id ? "Edit channel partner" : "Add channel partner"}</p>
        <Input data-testid="broker-name-input" placeholder="Channel partner name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input data-testid="broker-code-input" placeholder="Code (optional)" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
        <Input data-testid="broker-aliases-input" placeholder="Other spellings, comma separated" value={form.aliases} onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))} />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox data-testid="broker-active-checkbox" checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: !!v }))} /> Active
        </label>
        <div className="flex gap-2">
          <Button data-testid="broker-save-button" disabled={form.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
            {form.id ? "Save channel partner" : "Add channel partner"}
          </Button>
          {form.id && <Button variant="ghost" onClick={() => setForm({ id: null, name: "", code: "", aliases: "", active: true })}>Cancel</Button>}
        </div>
        <p className="text-xs text-muted-foreground">Policy channel partner = chosen at upload › agent's default channel partner › name OCR reads from the policy.</p>
      </div>
    </div>
  );
}

function InsurersTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["insurers"], queryFn: () => apiGet<Insurer[]>("/insurers") });
  const blank = { id: null as string | null, name: "", keywords: "", active: true };
  const [form, setForm] = useState(blank);
  const [q, setQ] = useState("");
  const done = (msg: string) => {
    ["insurers", "commission-masters"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast.success(msg);
    setForm(blank);
  };
  const save = useMutation({
    mutationFn: () => {
      const body: InsurerIn = { name: form.name, keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean), active: form.active };
      return form.id ? apiPut<Insurer>(`/insurers/${form.id}`, body) : apiPost<Insurer>("/insurers", body);
    },
    onSuccess: () => done(form.id ? "Insurance company updated" : "Insurance company added"),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/insurers/${id}`),
    onSuccess: () => done("Insurance company deleted"),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rows = (list.data ?? []).filter((i) => !q || `${i.name} ${i.keywords.join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input data-testid="insurers-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company…" className="pl-8" />
          </div>
          <InsurerDuplicates />
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Insurance company</TableHead>
                <TableHead>Names on policies (OCR match)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody data-testid="insurers-table">
              {rows.map((i) => (
                <TableRow key={i.id} data-testid={`insurer-row-${i.id}`}>
                  <TableCell className="font-medium">
                    {i.name} {i.builtin ? <Badge variant="outline" className="ml-1 text-[10px] text-muted-foreground">Built-in</Badge> : <Badge className="ml-1 bg-teal-500/15 text-[10px] text-teal-300">Added by admin</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.keywords.join(", ") || "—"}</TableCell>
                  <TableCell className={cn("text-xs", i.active ? "text-emerald-300" : "text-red-300")}>{i.active ? "Active" : "Inactive"}</TableCell>
                  <TableCell className="text-right">
                    {!i.builtin && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" data-testid={`insurer-edit-${i.id}`} onClick={() => setForm({ id: i.id, name: i.name, keywords: i.keywords.join(", "), active: i.active })}>
                          <Pencil className="size-3.5" /> Edit
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label="Delete company" data-testid={`insurer-delete-${i.id}`} onClick={() => window.confirm(`Delete ${i.name}?`) && del.mutate(i.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <div className="h-fit space-y-3 rounded-xl border border-border bg-card p-4" data-testid="insurer-form">
        <p className="label-caps">{form.id ? "Edit insurance company" : "Add insurance company"}</p>
        <Input data-testid="insurer-name-input" placeholder="e.g. IndusInd General" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input data-testid="insurer-keywords-input" placeholder="Words on the policy, comma separated (e.g. indusind)" value={form.keywords} onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))} />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox data-testid="insurer-active-checkbox" checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: !!v }))} /> Active (shown in grid dropdowns)
        </label>
        <div className="flex gap-2">
          <Button data-testid="insurer-save-button" disabled={form.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{form.id ? "Save company" : "Add company"}</Button>
          {form.id && <Button variant="ghost" onClick={() => setForm(blank)}>Cancel</Button>}
        </div>
        <p className="text-xs text-muted-foreground">A rule for this company matches any policy whose insurer name (read by OCR) contains one of these words. The company name itself is always included.</p>
      </div>
    </div>
  );
}

const ALL_COS = "__all_companies";
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const ALL_PRODUCTS = "__all_products";
let marginUid = 0;
type MarginRow = { uid: number; insurer: string; product: string; item?: string | null; biz?: string | null; od?: string; tp?: string; flat?: string; ended?: boolean; margin: string; from: string; to: string | null; end?: string };

function GroupsTab() {
  const qc = useQueryClient();
  const groups = useAgentGroups();
  const users = useQuery({ queryKey: ["users"], queryFn: () => apiGet<User[]>("/users") });
  const agents = (users.data ?? []).filter((u) => u.role === "agent");
  const [name, setName] = useState("");
  const [managing, setManaging] = useState<{ id: string; name: string; ids: string[] } | null>(null);
  const [q, setQ] = useState("");
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["agent-groups"] });
    qc.invalidateQueries({ queryKey: ["users"] });
  };
  const add = useMutation({
    mutationFn: () => apiPost("/agent-groups", { name }),
    onSuccess: () => { inv(); toast.success(`Group ${name} added`); setName(""); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/agent-groups/${id}`),
    onSuccess: () => { inv(); toast.success("Group deleted"); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const saveMembers = useMutation({
    mutationFn: (m: { id: string; body: GroupMembersIn }) => apiPut(`/agent-groups/${m.id}/members`, m.body),
    onSuccess: () => { inv(); toast.success(`Group ${managing?.name} updated — ${managing?.ids.length ?? 0} agents`); setManaging(null); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const masters = useCommissionMasters();
  const [editingMargins, setEditingMargins] = useState<{ id: string; name: string; rows: MarginRow[] } | null>(null);
  const saveMargins = useMutation({
    mutationFn: (m: { id: string; body: GroupMarginsIn }) => apiPut<AgentGroup>(`/agent-groups/${m.id}/margins`, m.body),
    onSuccess: () => {
      inv();
      ["my-rates", "policies", "commission"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Group ${editingMargins?.name} auto grid saved`);
      setEditingMargins(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const marginRows = editingMargins?.rows ?? [];
  const setRow = (i: number, patch: Partial<MarginRow>) =>
    setEditingMargins((m) => m && { ...m, rows: m.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const okPts = (v?: string) => !v || (Number(v) >= 0 && Number(v) <= 100);
  const marginsValid = marginRows.every((r) => r.margin !== "" && Number(r.margin) >= 0 && Number(r.margin) <= 100 && okPts(r.od) && okPts(r.tp) && (!r.flat || Number(r.flat) >= 0) && (!r.end || !r.from || r.end >= r.from)) &&
    new Set(marginRows.map((r) => `${r.insurer}|${r.product}|${r.item ?? ""}|${r.biz ?? ""}|${r.from}`)).size === marginRows.length;
  const filtered = agents.filter((a) => `${a.full_name} ${a.username} ${a.branch ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Create groups (A, B, C…) and put agents into them. Set an <b className="text-foreground">auto grid</b> per company — e.g. SBI −2 means a 61% receivable becomes 59% for every agent in the group, and it follows every receivable change automatically. An agent's personal payable rule still wins.
      </p>
      <div className="flex gap-2">
        <Input data-testid="group-name-input" placeholder="Group name, e.g. A" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button data-testid="group-add-button" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
          <Plus className="size-4" /> Add group
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="groups-list">
        {(groups.data ?? []).map((g) => {
          const members = agents.filter((a) => a.agent_group === g.name);
          return (
            <div key={g.id} data-testid={`group-card-${g.name}`} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="font-heading text-lg font-semibold">Group {g.name}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" data-testid={`group-manage-${g.name}`} onClick={() => { setQ(""); setManaging({ id: g.id, name: g.name, ids: members.map((m) => m.id) }); }}>
                    <Users className="size-3.5" /> Assign agents
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete group ${g.name}`} data-testid={`group-delete-${g.name}`} onClick={() => window.confirm(`Delete group ${g.name}?`) && del.mutate(g.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground" data-testid={`group-count-${g.name}`}>{members.length} agents</p>
              <div className="mt-3 rounded-lg border border-teal-500/30 bg-teal-500/5 p-2.5" data-testid={`group-margins-${g.name}`}>
                <div className="flex items-center justify-between">
                  <span className="label-caps text-teal-300">Auto grid from receivable</span>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid={`group-margins-edit-${g.name}`}
                    onClick={() => setEditingMargins({ id: g.id, name: g.name, rows: (g.margins ?? []).map((m) => ({ uid: marginUid++, insurer: m.insurer ?? ALL_COS, product: m.product_type ?? ALL_PRODUCTS, item: m.product, biz: m.business_type, od: m.od_margin == null ? "" : String(m.od_margin), tp: m.tp_margin == null ? "" : String(m.tp_margin), flat: m.flat_margin == null ? "" : String(m.flat_margin), ended: m.ended, margin: String(m.margin), from: m.valid_from ?? "", to: m.valid_to, end: m.ended ? m.valid_to ?? "" : "" })) })}>
                    <Pencil className="size-3" /> Set
                  </Button>
                </div>
                {(g.margins ?? []).length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {g.margins.map((m) => (
                      <span key={`${m.insurer}|${m.product_type}|${m.product}|${m.business_type}|${m.valid_from}`} className={cn("rounded-md bg-background/60 px-2 py-0.5 text-[11px]", m.valid_to && m.valid_to < todayIso() && "opacity-50 line-through")}>
                        {m.insurer ?? "All other companies"} · {m.product ?? m.product_type ?? "All products"}{m.business_type ? ` · ${m.business_type}` : ""}{m.od_margin != null ? ` · OD −${m.od_margin}` : ""}{m.tp_margin != null ? ` · TP −${m.tp_margin}` : ""}{m.flat_margin ? ` · Flat −₹${m.flat_margin}` : ""}{m.ended && m.valid_to ? ` · till ${m.valid_to}` : ""} <b className="font-mono text-teal-300">{m.od_margin != null || m.tp_margin != null ? "Net " : ""}−{m.margin}%</b>
                        {(m.valid_from || m.valid_to) && <span className="ml-1 text-muted-foreground">{m.valid_from ?? "start"} → {m.valid_to ?? "now"}</span>}
                      </span>
                    ))}
                  </div>
                ) : <p className="mt-1 text-[11px] text-muted-foreground">Off — group uses manual payable rules.</p>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {members.map((m) => (
                  <span key={m.id} className="rounded-full bg-muted px-2 py-0.5 text-xs">{m.full_name} <span className="font-mono text-muted-foreground">{m.username.toUpperCase()}</span></span>
                ))}
              </div>
            </div>
          );
        })}
        {(groups.data ?? []).length === 0 && <span className="text-sm text-muted-foreground">No groups yet.</span>}
      </div>

      <Dialog open={!!editingMargins} onOpenChange={(o) => !o && setEditingMargins(null)}>
        <DialogContent data-testid="group-margins-dialog" className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle className="font-heading">Auto grid · Group {editingMargins?.name}</DialogTitle>
            <DialogDescription>
              Agent rate = receivable minus what you keep. <b>Old option (one margin):</b> fill only On Net − and it is deducted from every % (Net, OD, TP, OD+TP). <b>Separate option</b> (e.g. National Insurance: TP 51% + OD 35% → agent TP 49% + OD 30%): fill On OD − 5 and On TP − 2 — each is deducted once from its own component only, never twice. Flat − rupees from a flat-amount receivable (₹500 − ₹200 → ₹300). Risk start / end = policy risk-start dates the line applies to. Add a company more than once to keep a different margin per product (e.g. ICICI Lombard · PCV −1.5, ICICI Lombard · Private Car −4). The most specific line wins.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {marginRows.map((row, i) => (
              <div key={row.uid} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2" data-testid={`margin-row-${i}`}>
                <SimpleSelect value={row.insurer} onChange={(v) => setRow(i, { insurer: v })} placeholder="Company" testId={`margin-insurer-${i}`} className="min-w-44 flex-1" searchable
                  options={[{ value: ALL_COS, label: "All other companies" }, ...[...new Set([...(masters.data?.insurers ?? []), ...(row.insurer && row.insurer !== ALL_COS ? [row.insurer] : [])])].map((n) => ({ value: n, label: n }))]} />
                <SimpleSelect value={row.product} onChange={(v) => setRow(i, { product: v, item: null })} placeholder="Product" testId={`margin-product-${i}`} className="w-40"
                  options={[{ value: ALL_PRODUCTS, label: "All products" }, ...Object.keys(masters.data?.product_types ?? {}).map((t) => ({ value: t, label: t }))]} />
                {row.product !== ALL_PRODUCTS && (masters.data?.product_types[row.product]?.length ?? 0) > 1 && (
                  <SimpleSelect value={row.item ?? ""} onChange={(v) => setRow(i, { item: v || null })} allLabel={`All ${row.product}`} placeholder="Product" testId={`margin-item-${i}`} className="w-48"
                    options={(masters.data?.product_types[row.product] ?? []).map((p) => ({ value: p, label: p }))} />
                )}
                <SimpleSelect value={row.biz ?? ""} onChange={(v) => setRow(i, { biz: v || null })} allLabel="All business" placeholder="Business type" testId={`margin-business-${i}`} className="w-32"
                  options={(masters.data?.business_types ?? []).map((b) => ({ value: b, label: b }))} />
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">On Net −
                  <Input type="number" step="0.01" min={0} max={100} data-testid={`margin-value-${i}`} value={row.margin} onChange={(e) => setRow(i, { margin: e.target.value })} className="w-16 font-mono" title="Points kept on Net % / OD+TP %. Also used for OD and TP when those are blank (old single-margin option)" />%
                </label>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">On OD −
                  <Input type="number" step="0.01" min={0} max={100} placeholder={row.margin || "same"} data-testid={`margin-od-${i}`} value={row.od ?? ""} onChange={(e) => setRow(i, { od: e.target.value })} className="w-16 font-mono" title="Points kept on OD %. Blank = same as On Net" />%
                </label>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">On TP −
                  <Input type="number" step="0.01" min={0} max={100} placeholder={row.margin || "same"} data-testid={`margin-tp-${i}`} value={row.tp ?? ""} onChange={(e) => setRow(i, { tp: e.target.value })} className="w-16 font-mono" title="Points kept on TP %. Blank = same as On Net" />%
                </label>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">Flat −₹
                  <Input type="number" step="1" min={0} placeholder="0" data-testid={`margin-flat-${i}`} value={row.flat ?? ""} onChange={(e) => setRow(i, { flat: e.target.value })} className="w-20 font-mono" title="Rupees kept from a flat-amount receivable, e.g. 500 − 200 = agent gets 300" />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">Risk start
                  <Input type="date" title="Applicable from (policy risk start). Blank = always" data-testid={`margin-from-${i}`} value={row.from} onChange={(e) => setRow(i, { from: e.target.value })} className="w-36 text-xs" />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">Risk end
                  <Input type="date" title="Applicable till (policy risk start). Blank = open / until the next dated line" data-testid={`margin-end-${i}`} value={row.end ?? ""} onChange={(e) => setRow(i, { end: e.target.value })} className="w-36 text-xs" />
                </label>
                {row.to && !row.end && <span data-testid={`margin-ends-${i}`} className="whitespace-nowrap text-[10px] text-muted-foreground">ends {row.to}</span>}
                <Button size="icon-sm" variant="ghost" aria-label="Remove company" data-testid={`margin-remove-${i}`} onClick={() => setEditingMargins((m) => m && { ...m, rows: m.rows.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            {marginRows.length === 0 && <p className="text-xs text-muted-foreground">No companies yet — auto grid is off for this group.</p>}
            <Button size="sm" variant="outline" data-testid="margin-add-row" onClick={() => setEditingMargins((m) => m && { ...m, rows: [...m.rows, { uid: marginUid++, insurer: m.rows.length ? "" : ALL_COS, product: ALL_PRODUCTS, margin: "", from: "", to: null }] })}>
              <Plus className="size-3.5" /> Add company
            </Button>
            {!marginsValid && marginRows.length > 0 && <p className="text-xs text-amber-300">Each company + product + business type + date only once, and a margin between 0 and 100.</p>}
            <p className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-[11px] text-muted-foreground">
              <b className="text-foreground">Revised margin from a date?</b> Keep the old line and add the same company + product again with the new margin and its applicable-from date. The old margin automatically ends the day before, so policies with risk start before that date keep the old margin.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMargins(null)}>Cancel</Button>
            <Button data-testid="group-margins-save" disabled={!marginsValid || marginRows.some((r) => !r.insurer) || saveMargins.isPending}
              onClick={() => editingMargins && saveMargins.mutate({ id: editingMargins.id, body: { margins: marginRows.map((r) => ({ insurer: r.insurer === ALL_COS ? null : r.insurer, product_type: r.product === ALL_PRODUCTS ? null : r.product, product: r.item ?? null, business_type: r.biz ?? null, ended: !!r.end, margin: Number(r.margin), od_margin: r.od ? Number(r.od) : null, tp_margin: r.tp ? Number(r.tp) : null, flat_margin: r.flat ? Number(r.flat) : null, valid_from: r.from || null, valid_to: r.end || null })) } })}>
              Save auto grid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!managing} onOpenChange={(o) => !o && setManaging(null)}>
        <DialogContent data-testid="group-members-dialog" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">Agents in Group {managing?.name}</DialogTitle>
            <DialogDescription>Tick the agents for this group. An agent can be in one group — ticking moves them here.</DialogDescription>
          </DialogHeader>
          <Input data-testid="group-members-search" placeholder="Search agent name / code / branch" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {filtered.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                <Checkbox
                  data-testid={`group-member-${a.username}`}
                  checked={!!managing?.ids.includes(a.id)}
                  onCheckedChange={(v) => setManaging((m) => m && { ...m, ids: v ? [...m.ids, a.id] : m.ids.filter((x) => x !== a.id) })}
                />
                {a.full_name}
                <span className="font-mono text-xs text-muted-foreground">{a.username.toUpperCase()} · {a.branch}</span>
                {a.agent_group && a.agent_group !== managing?.name && <span className="ml-auto text-[11px] text-amber-300">now in {a.agent_group}</span>}
              </label>
            ))}
            {filtered.length === 0 && <p className="p-2 text-xs text-muted-foreground">No agents found.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManaging(null)}>Cancel</Button>
            <Button data-testid="group-members-save" disabled={saveMembers.isPending} onClick={() => managing && saveMembers.mutate({ id: managing.id, body: { agent_ids: managing.ids } })}>
              Save group ({managing?.ids.length ?? 0})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "receivable", label: "Receivable (from channel partners)" },
  { id: "payable", label: "Payable (to agents)" },
  { id: "agent-payables", label: "Agent-wise payables" },
  { id: "matrix", label: "Rate matrix" },
  { id: "margins", label: "Payable margins (groups)" },
  { id: "holds", label: "Hold" },
  { id: "declined-rtos", label: "Declined RTOs" },
  { id: "compare", label: "Compare & margin" },
  { id: "brokers", label: "Channel Partners" },
  { id: "groups", label: "Agent groups" },
  { id: "insurers", label: "Insurance companies" },
  { id: "rto-groups", label: "RTO groups" },
];

export default function Commission() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (TABS.find((t) => t.id === params.get("tab"))?.id ?? "receivable"));
  return (
    <div className="space-y-5 animate-rise">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Commission grid</h2>
        <p className="mt-1 text-sm text-muted-foreground">Admin only. Receivable and payable commission is worked out on every policy automatically and added to the MIS Excel.</p>
      </div>
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`commission-tab-${t.id}`} onClick={() => setTab(t.id)}
            className={cn("rounded-md px-3 py-1.5 text-sm transition-colors duration-150", tab === t.id ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "receivable" && <RulesTable kind="receivable" />}
      {tab === "payable" && <RulesTable kind="payable" />}
      {tab === "margins" && <MarginGridTab />}
      {tab === "holds" && <HoldsTab />}
      {tab === "declined-rtos" && <DeclinedRtosTab />}
      {tab === "compare" && <GridCompare />}
      {tab === "brokers" && <BrokersTab />}
      {tab === "groups" && <GroupsTab />}
      {tab === "insurers" && <InsurersTab />}
      {tab === "rto-groups" && <RtoGroupsTab />}
      {tab === "matrix" && <RateMatrixTab />}
      {tab === "agent-payables" && <AgentPayablesTab />}
    </div>
  );
}
