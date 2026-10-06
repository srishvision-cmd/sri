import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import type { ChangePasswordIn, User } from "@/lib/types";

/** forced=true: first login with a temporary password — the dialog cannot be dismissed until changed. */
export function ChangePasswordDialog({ open, onOpenChange, forced }: { open: boolean; onOpenChange: (v: boolean) => void; forced: boolean }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  };

  const change = useMutation({
    mutationFn: (body: ChangePasswordIn) => apiPost<User>("/auth/change-password", body),
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
      toast.success("Password changed");
      reset();
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err, "Could not change password")),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setError("New password must be at least 8 characters");
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return setError("Use at least one letter and one number");
    if (next !== confirm) return setError("New passwords do not match");
    setError(null);
    change.mutate({ current_password: current, new_password: next });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (forced && !v) return;
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent data-testid="change-password-dialog" showCloseButton={!forced}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-sky-400" /> {forced ? "Set your own password" : "Change password"}
          </DialogTitle>
          <DialogDescription>
            {forced
              ? "You signed in with a temporary password. Choose a new password to continue."
              : "Enter your current password and choose a new one."}{" "}
            Minimum 8 characters, with at least one letter and one number.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" id="change-password-form">
          <div className="space-y-1.5">
            <Label htmlFor="cp-current">{forced ? "Temporary / current password" : "Current password"}</Label>
            <Input id="cp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="change-password-current-input" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-new">New password</Label>
            <Input id="cp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} data-testid="change-password-new-input" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">Confirm new password</Label>
            <Input id="cp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="change-password-confirm-input" required />
          </div>
          {error && (
            <p data-testid="change-password-error" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form="change-password-form" disabled={change.isPending} data-testid="change-password-submit-button">
            {change.isPending ? "Saving…" : "Update password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
