import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CredentialsDialog } from "@/components/CredentialsDialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { ROLE_LABEL, useMeta } from "@/lib/auth";
import { errorMessage, fmtDate } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { Credentials, User, UserCreate } from "@/lib/types";

interface FormState {
  full_name: string;
  role: "agent" | "backoffice";
  branch: string;
  email: string;
  mobile: string;
  assigned_agent_ids: string[];
  active: boolean;
}

const BLANK: FormState = { full_name: "", role: "agent", branch: "", email: "", mobile: "", assigned_agent_ids: [], active: true };

function UserFormDialog({
  open,
  editing,
  agents,
  onClose,
  onCreated,
}: {
  open: boolean;
  editing: User | null;
  agents: User[];
  onClose: () => void;
  onCreated: (c: Credentials) => void;
}) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          full_name: editing.full_name,
          role: editing.role === "backoffice" ? "backoffice" : "agent",
          branch: editing.branch ?? "",
          email: editing.email ?? "",
          mobile: editing.mobile ?? "",
          assigned_agent_ids: editing.assigned_agent_ids,
          active: editing.active,
        }
      : BLANK,
  );
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await apiPatch<User>(`/users/${editing.id}`, {
          full_name: form.full_name,
          branch: form.branch,
          email: form.email || null,
          mobile: form.mobile || null,
          assigned_agent_ids: form.assigned_agent_ids,
          active: form.active,
        });
        return null;
      }
      const body: UserCreate = {
        full_name: form.full_name,
        role: form.role,
        branch: form.branch,
        email: form.email || null,
        mobile: form.mobile || null,
        assigned_agent_ids: form.role === "backoffice" ? form.assigned_agent_ids : [],
      };
      return apiPost<Credentials>("/users", body);
    },
    onSuccess: (creds) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      onClose();
      if (creds) onCreated(creds);
      else toast.success("User updated");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const isBackoffice = editing ? editing.role === "backoffice" : form.role === "backoffice";
  const isAdminUser = editing?.role === "admin";
  const valid = form.full_name.trim().length >= 2 && form.branch;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="user-form-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">{editing ? `Edit ${editing.full_name}` : "Onboard user"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update branch, team mapping or access." : "A username and temporary password are generated automatically."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Full name</Label>
            <Input data-testid="user-form-name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </div>
          {!editing && (
            <div className="space-y-1.5">
              <Label>Role</Label>
              <SimpleSelect
                value={form.role}
                onChange={(v) => set("role", v === "backoffice" ? "backoffice" : "agent")}
                placeholder="Role"
                testId="user-form-role"
                className="w-full"
                options={[
                  { value: "agent", label: "Agent" },
                  { value: "backoffice", label: "Backoffice" },
                ]}
              />
            </div>
          )}
          <div className={cn("space-y-1.5", editing && "sm:col-span-2")}>
            <Label>Branch</Label>
            <SimpleSelect
              value={form.branch}
              onChange={(v) => set("branch", v)}
              placeholder="Select branch"
              testId="user-form-branch"
              className="w-full"
              options={(meta.data?.branches ?? []).map((b) => ({ value: b, label: b }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input data-testid="user-form-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Mobile</Label>
            <Input data-testid="user-form-mobile" value={form.mobile} onChange={(e) => set("mobile", e.target.value)} />
          </div>
          {isBackoffice && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Team mapping — extra agents outside the branch</Label>
              <div data-testid="user-form-agent-mapping" className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-3">
                {agents.filter((a) => a.branch !== form.branch).length === 0 && (
                  <p className="text-xs text-muted-foreground">No agents outside this branch.</p>
                )}
                {agents
                  .filter((a) => a.branch !== form.branch)
                  .map((a) => (
                    <label key={a.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        data-testid={`user-form-map-agent-${a.username}`}
                        checked={form.assigned_agent_ids.includes(a.id)}
                        onCheckedChange={(c) =>
                          set(
                            "assigned_agent_ids",
                            c ? [...form.assigned_agent_ids, a.id] : form.assigned_agent_ids.filter((x) => x !== a.id),
                          )
                        }
                      />
                      {a.full_name}
                      <span className="font-mono text-xs text-muted-foreground">{a.username.toUpperCase()} · {a.branch}</span>
                    </label>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground">Backoffice automatically sees every agent in its own branch.</p>
            </div>
          )}
          {editing && !isAdminUser && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox data-testid="user-form-active" checked={form.active} onCheckedChange={(c) => set("active", !!c)} />
              Account active
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="user-form-cancel">Cancel</Button>
          <Button data-testid="user-form-submit" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : editing ? "Save changes" : "Create & generate credentials"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const users = useQuery({ queryKey: ["users"], queryFn: () => apiGet<User[]>("/users") });
  const [dialog, setDialog] = useState<{ open: boolean; editing: User | null; key: number }>({ open: false, editing: null, key: 0 });
  const [creds, setCreds] = useState<Credentials | null>(null);
  const list = users.isError ? [] : users.data ?? [];
  const agents = list.filter((u) => u.role === "agent");
  const byId = Object.fromEntries(list.map((u) => [u.id, u]));

  const reset = useMutation({
    mutationFn: (id: string) => apiPost<Credentials>(`/users/${id}/reset-password`),
    onSuccess: setCreds,
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Users & access</h2>
          <p className="mt-1 text-sm text-muted-foreground">Onboard agents and backoffice staff, issue credentials, and map teams to branches.</p>
        </div>
        <Button data-testid="onboard-user-button" onClick={() => setDialog((d) => ({ open: true, editing: null, key: d.key + 1 }))}>
          <UserPlus className="size-4" /> Onboard user
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Team mapping</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody data-testid="users-table-body">
            {list.map((u) => (
              <TableRow key={u.id} data-testid={`user-row-${u.username}`}>
                <TableCell>
                  <div className="font-medium">{u.full_name}</div>
                  <div className="text-xs text-muted-foreground">{u.email ?? u.mobile ?? ""}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{u.username.toUpperCase()}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(u.role === "admin" ? "text-sky-300" : u.role === "backoffice" ? "text-teal-300" : "text-slate-300")}>
                    {ROLE_LABEL[u.role]}
                  </Badge>
                </TableCell>
                <TableCell>{u.branch ?? "—"}</TableCell>
                <TableCell className="max-w-56 text-xs text-muted-foreground">
                  {u.role === "backoffice"
                    ? [`All ${u.branch} agents`, ...u.assigned_agent_ids.map((id) => byId[id]?.full_name).filter(Boolean)].join(", ")
                    : "—"}
                </TableCell>
                <TableCell>
                  <span className={cn("text-xs", u.active ? "text-emerald-300" : "text-red-300")}>{u.active ? "Active" : "Inactive"}</span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(u.created_at)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Edit user"
                      data-testid={`user-edit-${u.username}`}
                      onClick={() => setDialog((d) => ({ open: true, editing: u, key: d.key + 1 }))}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Reset password"
                      data-testid={`user-reset-password-${u.username}`}
                      onClick={() => window.confirm(`Generate a new password for ${u.full_name}?`) && reset.mutate(u.id)}
                    >
                      <KeyRound className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <UserFormDialog
        key={dialog.key}
        open={dialog.open}
        editing={dialog.editing}
        agents={agents}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onCreated={setCreds}
      />
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />
    </div>
  );
}
