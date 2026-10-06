import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Credentials } from "@/lib/types";

export function CredentialsDialog({ creds, onClose }: { creds: Credentials | null; onClose: () => void }) {
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Copy failed — select and copy manually"),
    );
  };
  const both = creds ? `Username: ${creds.username}\nPassword: ${creds.temp_password}` : "";
  return (
    <Dialog open={!!creds} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="credentials-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading">
            <KeyRound className="size-4 text-teal-400" /> Credentials generated
          </DialogTitle>
          <DialogDescription>
            Share these with {creds?.user.full_name}. The password is shown only once.
          </DialogDescription>
        </DialogHeader>
        {creds && (
          <div className="space-y-2 rounded-lg border bg-[#0D131F] p-4 font-mono text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Username</span>
              <span data-testid="credentials-username" className="font-semibold text-foreground">{creds.username}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Password</span>
              <span data-testid="credentials-password" className="font-semibold text-teal-300">{creds.temp_password}</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" data-testid="credentials-copy-button" onClick={() => copy(both)}>
            <Copy className="size-4" /> Copy both
          </Button>
          <Button data-testid="credentials-done-button" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
