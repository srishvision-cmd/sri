import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, ExternalLink, KeyRound, Mail, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api";
import { errorMessage, fmtDateTime } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { MailboxIn, MailboxSettings, MailboxTest, OtpClaim, OtpFeed, OtpRequestIn, Portal, PortalIn, PortalSecret, PortalView, User } from "@/lib/types";

const copy = (v: string, what: string) => navigator.clipboard.writeText(v).then(() => toast.success(`${what} copied`), () => toast.error("Copy failed"));
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`;
};

const left = (iso: string | null, now: number) => Math.max(0, Math.round(((iso ? new Date(iso).getTime() : now) - now) / 1000));
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

function OtpFeed() {
  const qc = useQueryClient();
  const otp = useQuery({
    queryKey: ["otp-messages"],
    queryFn: () => apiGet<OtpFeed>("/otp/messages"),
    // poll only while I am waiting for / looking at an OTP
    refetchInterval: (q) => ((q.state.data?.waiting.length || q.state.data?.messages.length) && !(q.state.error instanceof ApiError && q.state.error.status === 409) ? 4000 : false),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const d = otp.data;
  const busy = !!(d?.waiting.length || d?.messages.length);
  const now = useNow(busy);
  const cancel = useMutation({
    mutationFn: (portalId: string) => apiDelete<{ ok: boolean }>(`/otp/request/${portalId}`),
    onSuccess: (_r, portalId) => {
      qc.setQueryData<OtpFeed>(["otp-messages"], (old) => (old ? { ...old, waiting: old.waiting.filter((w) => w.portal_id !== portalId) } : old));
      void qc.invalidateQueries({ queryKey: ["otp-messages"] });
    },
  });
  const msgs = (d?.messages ?? []).filter((m) => left(m.expires_at, now) > 0);
  const waiting = (d?.waiting ?? []).filter((c) => left(c.expires_at, now) > 0);
  return (
    <section data-testid="otp-feed" className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="label-caps flex items-center gap-1.5"><Mail className="size-3" /> My insurer OTPs</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Press <b>Get OTP</b> on a portal, then trigger the OTP on the insurer site. Only you see it, for 1 minute.</p>
        </div>
        {busy && <span className={cn("flex items-center gap-1.5 text-xs", otp.isFetching ? "text-sky-300" : "text-muted-foreground")}>
          <RefreshCw className={cn("size-3.5", otp.isFetching && "animate-spin")} /> {otp.isFetching ? "Checking…" : "Live"}
        </span>}
      </div>
      {(d?.errors ?? []).map((e) => (
        <p key={e.insurers.join()} data-testid="otp-mailbox-error" className="mb-2 text-xs text-amber-300">{e.insurers.join(", ")}: {e.message}</p>
      ))}
      {(d?.others_waiting ?? []).length > 0 && (
        <p data-testid="otp-others-waiting" className="mb-2 text-xs text-amber-200">Also waiting for an OTP on the same portal: {d!.others_waiting.join(", ")} — the OTP goes to whoever pressed Get OTP last.</p>
      )}
      {otp.isError && <p data-testid="otp-error" className="mb-2 text-sm text-amber-300">{errorMessage(otp.error, `Mailbox check failed — retrying`)}</p>}
      {waiting.map((c) => (
        <div key={c.id} data-testid={`otp-waiting-${c.portal_id}`} className="mb-2 flex items-center gap-3 rounded-lg border border-sky-400/40 bg-card px-3 py-2 text-sm">
          <RefreshCw className="size-4 animate-spin text-sky-300" />
          <span>Waiting for <b>{c.insurer}</b> OTP… trigger it on the insurer site now</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground">{mmss(left(c.expires_at, now))}</span>
          <Button size="sm" variant="ghost" data-testid={`otp-cancel-${c.portal_id}`} onClick={() => cancel.mutate(c.portal_id)}>Cancel</Button>
        </div>
      ))}
      {msgs.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {msgs.map((m, i) => (
            <div key={m.uid} data-testid={`otp-message-${m.uid}`} className={cn("rounded-lg border bg-card p-3", i === 0 ? "border-sky-400/60" : "border-border")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{m.insurer}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.subject}</div>
                </div>
                <span data-testid={`otp-expires-${m.uid}`} className="shrink-0 font-mono text-xs text-amber-200">disappears in {left(m.expires_at, now)}s</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span data-testid={`otp-code-${m.uid}`} className="font-mono text-3xl font-bold tracking-[0.25em] text-sky-200">{m.otp ?? "—"}</span>
                {m.otp && <Button size="sm" variant="outline" data-testid={`otp-copy-${m.uid}`} onClick={() => copy(m.otp!, "OTP")}><Copy className="size-4" /> Copy</Button>}
              </div>
              {!m.otp && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.snippet}</p>}
            </div>
          ))}
        </div>
      )}
      {!waiting.length && !msgs.length && !otp.isError && (
        <p data-testid="otp-empty" className="py-3 text-center text-sm text-muted-foreground">No OTP request running. Press <b>Get OTP</b> on the insurer portal you are logging in to.</p>
      )}
    </section>
  );
}

function PortalCard({ p, isAdmin, onEdit }: { p: Portal; isAdmin: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const [pw, setPw] = useState<string | null>(null);
  const reveal = useMutation({ mutationFn: () => apiPost<PortalSecret>(`/portals/${p.id}/reveal`, {}), onError: (e) => toast.error(errorMessage(e)) });
  const del = useMutation({
    mutationFn: () => apiDelete<{ ok: boolean }>(`/portals/${p.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portals"] }); toast.success("Portal removed"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const getOtp = useMutation({
    mutationFn: () => apiPost<OtpClaim>("/otp/request", { portal_id: p.id } satisfies OtpRequestIn),
    onSuccess: (c) => {
      // show "waiting" at once — the mailbox read can take a few seconds
      qc.setQueryData<OtpFeed>(["otp-messages"], (old) => ({ messages: old?.messages ?? [], errors: old?.errors ?? [], others_waiting: old?.others_waiting ?? [],
        waiting: [...(old?.waiting ?? []).filter((w) => w.portal_id !== c.portal_id), c] }));
      void qc.invalidateQueries({ queryKey: ["otp-messages"] });
      toast.success(`Waiting for ${p.insurer} OTP — trigger it on the insurer site now`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const show = async () => {
    if (pw) return setPw(null);
    const r = await reveal.mutateAsync();
    setPw(r.password);
  };
  const copyPw = async () => copy(pw ?? (await reveal.mutateAsync()).password, "Password");
  return (
    <div data-testid={`portal-card-${p.id}`} className={cn("space-y-3 rounded-xl border border-border bg-card p-4 transition-[border-color] duration-150 hover:border-sky-500/40", !p.active && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-heading text-base font-semibold">{p.insurer}{!p.active && <span className="ml-2 text-xs text-muted-foreground">(hidden from agents)</span>}</div>
          <a href={p.url} target="_blank" rel="noreferrer" className="break-all text-xs text-sky-300 hover:underline" data-testid={`portal-url-${p.id}`}>{p.url}</a>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" data-testid={`portal-get-otp-${p.id}`} disabled={getOtp.isPending} onClick={() => getOtp.mutate()}><Mail className="size-4" /> Get OTP</Button>
          <a href={p.url} target="_blank" rel="noreferrer"><Button size="sm" data-testid={`portal-open-${p.id}`}><ExternalLink className="size-4" /> Open</Button></a>
        </div>
      </div>
      <div className="grid gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-20 text-xs text-muted-foreground">User ID</span>
          <span data-testid={`portal-username-${p.id}`} className="flex-1 truncate font-mono">{p.username}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Copy user ID" data-testid={`portal-copy-user-${p.id}`} onClick={() => copy(p.username, "User ID")}><Copy className="size-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-xs text-muted-foreground">Password</span>
          <span data-testid={`portal-password-${p.id}`} className="flex-1 truncate font-mono">{p.has_password ? pw ?? "••••••••" : "—"}</span>
          {p.has_password && <>
            <Button size="icon-sm" variant="ghost" aria-label="Show password" data-testid={`portal-show-${p.id}`} disabled={reveal.isPending} onClick={show}>{pw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
            <Button size="icon-sm" variant="ghost" aria-label="Copy password" data-testid={`portal-copy-password-${p.id}`} disabled={reveal.isPending} onClick={copyPw}><Copy className="size-4" /></Button>
          </>}
        </div>
      </div>
      {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
      {isAdmin && (
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-xs text-muted-foreground">
            <span data-testid={`portal-visibility-label-${p.id}`}>{p.all_agents ? "All agents & backoffice" : p.agent_ids.length ? `${p.agent_ids.length} selected user(s)` : "Hidden from everyone"}</span> · OTP: <span data-testid={`portal-mailbox-label-${p.id}`}>{p.mailbox_email ?? "default mailbox"}</span> · filter: {p.otp_filters.length ? p.otp_filters.join(", ") : p.insurer}
          </span>
          <div className="flex gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Edit" data-testid={`portal-edit-${p.id}`} onClick={onEdit}><Pencil className="size-4" /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Delete" data-testid={`portal-delete-${p.id}`} onClick={() => window.confirm(`Remove ${p.insurer} portal?`) && del.mutate()}><Trash2 className="size-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PortalDialog({ editing, onClose }: { editing: Portal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ insurer: editing?.insurer ?? "", url: editing?.url ?? "", username: editing?.username ?? "", password: "",
    otp: (editing?.otp_filters ?? []).join(", "), notes: editing?.notes ?? "", active: editing?.active ?? true,
    allAgents: editing?.all_agents ?? true, agentIds: editing?.agent_ids ?? [], pickMode: !!editing?.agent_ids.length,
    mbHost: editing?.mailbox_host ?? "", mbPort: String(editing?.mailbox_port ?? 993), mbEmail: editing?.mailbox_email ?? "", mbPassword: "" });
  const gmail = /@gmail\.com$/i.test(f.mbEmail.trim());
  const mbTest = useMutation({
    mutationFn: () => apiPost<MailboxTest>(`/portals/${editing!.id}/mailbox-test`, {}),
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const users = useQuery({ queryKey: ["users"], queryFn: () => apiGet<User[]>("/users") });
  const people = useMemo(() => (users.data ?? []).filter((u) => (u.role === "agent" || u.role === "backoffice") && u.active !== false), [users.data]);
  const vis: "all" | "selected" | "none" = f.allAgents ? "all" : f.agentIds.length ? "selected" : f.pickMode ? "selected" : "none";
  const [agentQ, setAgentQ] = useState("");
  const shownPeople = useMemo(() => people.filter((a) => `${a.full_name} ${a.username}`.toLowerCase().includes(agentQ.toLowerCase())), [people, agentQ]);
  const toggleAgent = (id: string, on: boolean) => setF((s) => ({ ...s, agentIds: on ? [...s.agentIds, id] : s.agentIds.filter((x) => x !== id) }));
  const set = (k: "insurer" | "url" | "username" | "password" | "otp" | "notes" | "mbHost" | "mbPort" | "mbEmail" | "mbPassword") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body: PortalIn = { insurer: f.insurer.trim(), url: f.url.trim(), username: f.username.trim(), password: f.password || null,
        otp_filters: f.otp.split(",").map((x) => x.trim()).filter(Boolean), notes: f.notes.trim() || null, active: f.active,
        all_agents: f.allAgents, agent_ids: f.allAgents ? [] : f.agentIds,
        mailbox_host: f.mbEmail.trim() ? (f.mbHost.trim() || (gmail ? "imap.gmail.com" : "")) : null, mailbox_port: Number(f.mbPort) || 993,
        mailbox_email: f.mbEmail.trim() || null, mailbox_password: f.mbPassword || null };
      return editing ? apiPut<Portal>(`/portals/${editing.id}`, body) : apiPost<Portal>("/portals", body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portals"] }); toast.success("Portal saved"); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="portal-dialog" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit insurer portal" : "Add insurer portal"}</DialogTitle>
          <DialogDescription>Agents see the URL and user ID; the password only on Show/Copy (every view is logged).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1"><Label>Insurance company</Label><Input data-testid="portal-insurer-input" value={f.insurer} onChange={set("insurer")} placeholder="TATA AIG" /></div>
          <div className="space-y-1"><Label>Portal URL</Label><Input data-testid="portal-url-input" value={f.url} onChange={set("url")} placeholder="https://…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>User ID</Label><Input data-testid="portal-username-input" value={f.username} onChange={set("username")} /></div>
            <div className="space-y-1"><Label>Password{editing?.has_password ? " (blank = keep)" : ""}</Label><Input data-testid="portal-password-input" type="password" value={f.password} onChange={set("password")} autoComplete="new-password" /></div>
          </div>
          <div className="space-y-1">
            <Label>OTP mail filter</Label>
            <Input data-testid="portal-otp-input" value={f.otp} onChange={set("otp")} placeholder="tataaig.com, TATA AIG OTP" />
            <p className="text-xs text-muted-foreground">Sender email / domain or words in the OTP mail subject, comma separated. Blank = match the insurer name. Only matching mails reach agents.</p>
          </div>
          <div data-testid="portal-mailbox-section" className="space-y-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
            <Label>OTP mailbox (IMAP) for this login</Label>
            <p className="text-xs text-muted-foreground">The mailbox where this insurer sends the OTP for this user ID. Leave all blank to use the Default OTP mailbox (bottom of the page).</p>
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <div className="space-y-1"><Label className="text-xs">IMAP host</Label>
                <Input data-testid="portal-mb-host-input" value={f.mbHost} onChange={set("mbHost")} placeholder={gmail ? "imap.gmail.com" : "e.g. glory.herosite.pro"} /></div>
              <div className="space-y-1"><Label className="text-xs">Port</Label>
                <Input data-testid="portal-mb-port-input" value={f.mbPort} onChange={set("mbPort")} placeholder="993" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">Email</Label>
                <Input data-testid="portal-mb-email-input" value={f.mbEmail} onChange={set("mbEmail")} placeholder="otp-email@gmail.com" />
                <p className="text-[11px] text-muted-foreground">Gmail → host imap.gmail.com · herosite → glory.herosite.pro. Type only one host.</p></div>
              <div className="space-y-1"><Label className="text-xs">Password{editing?.has_mailbox_password ? " (blank = keep)" : ""}</Label>
                <Input data-testid="portal-mb-password-input" type="password" autoComplete="new-password" value={f.mbPassword} onChange={set("mbPassword")}
                  placeholder={gmail ? "16-letter App Password" : "Mailbox password"} /></div>
            </div>
            {gmail && <p className="text-xs text-amber-200">Gmail: use the 16-letter App Password (myaccount.google.com/apppasswords) and enable IMAP in Gmail settings — your normal Gmail password will be rejected.</p>}
            {editing?.mailbox_email && <Button size="sm" variant="outline" data-testid="portal-mb-test-button" disabled={mbTest.isPending} onClick={() => mbTest.mutate()}>{mbTest.isPending ? "Testing…" : "Test saved mailbox"}</Button>}
          </div>
          <div className="space-y-1"><Label>Notes</Label><Textarea data-testid="portal-notes-input" value={f.notes} onChange={set("notes")} rows={1} className="min-h-9" /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox data-testid="portal-active-checkbox" checked={f.active} onCheckedChange={(v) => setF((s) => ({ ...s, active: !!v }))} /> Active (shown to agents / backoffice)</label>
          <div className="space-y-2 rounded-md border border-border p-3">
            <Label>Who can see this login?</Label>
            <div className="flex flex-wrap gap-2">
              {([["all", "All agents & backoffice"], ["selected", "Selected users"], ["none", "No one (hidden)"]] as const).map(([v, l]) => (
                <button key={v} type="button" data-testid={`portal-visibility-${v}`}
                  onClick={() => setF((s) => ({ ...s, allAgents: v === "all", pickMode: v === "selected", agentIds: v === "none" ? [] : s.agentIds }))}
                  className={cn("rounded-md border px-3 py-1.5 text-sm transition-[border-color,background-color,color] duration-150",
                    vis === v ? "border-primary bg-primary font-semibold text-white" : "border-border text-muted-foreground hover:text-foreground")}>{l}</button>
              ))}
            </div>
            {vis === "none" && <p className="text-xs text-amber-200">Hidden from every agent and backoffice user — only admin sees it.</p>}
            {vis === "selected" && (
              <>
                <Input data-testid="portal-agent-search" placeholder="Search agent / backoffice…" value={agentQ} onChange={(e) => setAgentQ(e.target.value)} className="h-8" />
                <div data-testid="portal-agent-list" className="max-h-40 space-y-1 overflow-y-auto">
                  {shownPeople.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <Checkbox data-testid={`portal-agent-${a.username}`} checked={f.agentIds.includes(a.id)} onCheckedChange={(v) => toggleAgent(a.id, !!v)} />
                      {a.full_name} <span className="text-xs text-muted-foreground">{a.username} · {a.role === "backoffice" ? "Backoffice" : "Agent"}{a.branch ? ` · ${a.branch}` : ""}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{f.agentIds.length} user(s) selected{f.agentIds.length ? "" : " — none ticked = hidden from everyone"}</p>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button data-testid="portal-save-button" disabled={!f.insurer || !f.url || !f.username || (!editing && !f.password) || (!!f.mbEmail.trim() && !editing?.has_mailbox_password && !f.mbPassword) || save.isPending} onClick={() => save.mutate()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MailboxCard() {
  const qc = useQueryClient();
  const mb = useQuery({ queryKey: ["otp-mailbox"], queryFn: () => apiGet<MailboxSettings>("/otp/mailbox") });
  const [f, setF] = useState<{ host: string; port: string; email: string; password: string } | null>(null);
  const v = f ?? { host: mb.data?.host || "glory.herosite.pro", port: String(mb.data?.port ?? 993), email: mb.data?.email ?? "", password: "" };
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...v, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => apiPut<MailboxSettings>("/otp/mailbox", { host: v.host.trim(), port: Number(v.port) || 993, email: v.email.trim(), password: v.password || null } satisfies MailboxIn),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["otp-mailbox"] }); qc.invalidateQueries({ queryKey: ["otp-messages"] }); setF(null); toast.success("Mailbox saved"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => apiPost<MailboxTest>("/otp/mailbox/test", {}),
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <section data-testid="mailbox-card" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="label-caps flex items-center gap-1.5"><KeyRound className="size-3" /> Default OTP mailbox (IMAP) · admin only</p>
        <span data-testid="mailbox-status" className={cn("text-xs", mb.data?.configured ? "text-emerald-300" : "text-amber-300")}>{mb.data?.configured ? "Configured" : "Not set up"}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-[1.4fr_0.5fr_1.4fr_1.2fr_auto_auto] md:items-end">
        <div className="space-y-1"><Label className="text-xs">IMAP host</Label><Input data-testid="mailbox-host-input" value={v.host} onChange={set("host")} /></div>
        <div className="space-y-1"><Label className="text-xs">Port</Label><Input data-testid="mailbox-port-input" value={v.port} onChange={set("port")} /></div>
        <div className="space-y-1"><Label className="text-xs">Email</Label><Input data-testid="mailbox-email-input" value={v.email} onChange={set("email")} placeholder="otp@yourdomain" /></div>
        <div className="space-y-1"><Label className="text-xs">Password{mb.data?.has_password ? " (blank = keep)" : ""}</Label><Input data-testid="mailbox-password-input" type="password" value={v.password} onChange={set("password")} autoComplete="new-password" /></div>
        <Button data-testid="mailbox-save-button" disabled={!v.host || !v.email || (!mb.data?.has_password && !v.password) || save.isPending} onClick={() => save.mutate()}>Save</Button>
        <Button variant="outline" data-testid="mailbox-test-button" disabled={!mb.data?.configured || test.isPending} onClick={() => test.mutate()}>{test.isPending ? "Testing…" : "Test"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Used by portals that have no mailbox of their own. herosite: glory.herosite.pro + Roundcube login · Gmail: imap.gmail.com + 16-letter App Password. Stored encrypted; agents never see the mailbox — only matching insurer OTPs.</p>
    </section>
  );
}

function ViewLog() {
  const views = useQuery({ queryKey: ["portals", "views"], queryFn: () => apiGet<PortalView[]>("/portals/views") });
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="label-caps mb-2">Password views (latest 200)</p>
      <Table data-testid="portal-views-table">
        <TableHeader><TableRow><TableHead>When</TableHead><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Portal</TableHead></TableRow></TableHeader>
        <TableBody>
          {(views.data ?? []).slice(0, 30).map((v) => (
            <TableRow key={v.id}><TableCell className="text-xs">{fmtDateTime(v.at)}</TableCell><TableCell>{v.user_name}</TableCell><TableCell className="text-xs capitalize">{v.user_role}</TableCell><TableCell>{v.insurer}</TableCell></TableRow>
          ))}
          {(views.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="py-4 text-center text-xs text-muted-foreground">No views yet.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </section>
  );
}

export default function Portals() {
  const me = useOutletContext<User>();
  const isAdmin = me.role === "admin";
  const portals = useQuery({ queryKey: ["portals"], queryFn: () => apiGet<Portal[]>("/portals") });
  const [dialog, setDialog] = useState<{ editing: Portal | null; key: number } | null>(null);
  const [q, setQ] = useState("");
  const list = (portals.data ?? []).filter((p) => p.insurer.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-5 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Insurer portals</h2>
          <p className="mt-1 text-sm text-muted-foreground">Log in to the insurance company portal and issue the policy without waiting. OTPs arrive below.</p>
        </div>
        <div className="flex gap-2">
          <Input data-testid="portal-search-input" placeholder="Search insurer…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
          {isAdmin && <Button data-testid="portal-add-button" onClick={() => setDialog({ editing: null, key: Date.now() })}><Plus className="size-4" /> Add portal</Button>}
        </div>
      </div>
      <OtpFeed />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => <PortalCard key={p.id} p={p} isAdmin={isAdmin} onEdit={() => setDialog({ editing: p, key: Date.now() })} />)}
        {!portals.isLoading && list.length === 0 && <p data-testid="portal-empty" className="col-span-full py-8 text-center text-sm text-muted-foreground">No insurer portals yet{isAdmin ? " — click Add portal." : "."}</p>}
      </div>
      {isAdmin && <MailboxCard />}
      {isAdmin && <ViewLog />}
      {dialog && <PortalDialog key={dialog.key} editing={dialog.editing} onClose={() => setDialog(null)} />}
    </div>
  );
}
