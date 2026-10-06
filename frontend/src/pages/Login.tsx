import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileScan, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api";
import { beginSession } from "@/lib/session";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/types";

const MATRIX: [string, string, string, string][] = [
  ["Agent onboarding & credentials", "Full", "—", "—"],
  ["Upload policy documents", "Full", "Full", "Full"],
  ["Real-time AI OCR extraction", "Auto", "Auto", "Auto"],
  ["Correction & verification", "Full", "Limited", "Full"],
  ["User-wise policy MIS", "Full", "Own data", "Assigned"],
  ["Overall MIS (CSV / Excel)", "Full", "—", "Branch / team"],
];

// Usernames only — passwords are never shipped in the bundle (seeded from backend/.env).
const MATRIX_ROLES = ["admin", "agent", "backoffice"];

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const login = useMutation({
    mutationFn: () => apiPost<User>("/auth/login", { username, password }),
    onSuccess: (user) => {
      beginSession();
      qc.setQueryData(["me"], user);
      navigate("/", { replace: true });
    },
    onError: (err) => setError(errorMessage(err, "Unable to sign in")),
  });

  return (
    <div className="dark grid min-h-screen bg-background text-foreground lg:grid-cols-[1.15fr_1fr]">
      <section className="grid-bg relative hidden flex-col justify-between overflow-hidden border-r border-border bg-[#0D131F] p-12 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-md bg-primary">
            <ShieldCheck className="size-5 text-white" />
          </div>
          <span className="font-heading text-base font-bold tracking-tight">GI·MIS</span>
        </div>
        <div className="max-w-xl animate-rise">
          <p className="label-caps mb-4 text-sky-400">General insurance · MIS operations</p>
          <h2 className="font-heading text-4xl font-bold leading-[1.1] tracking-tight text-slate-100">
            From policy PDF to verified MIS row — in seconds.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Upload schedules, let AI OCR read every field, correct what it missed, and export branch-ready MIS in CSV or Excel.
          </p>
          <div className="mt-10 overflow-hidden rounded-xl border border-border bg-[#111827]/80 backdrop-blur">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-slate-400">
                  <th className="px-4 py-2.5 font-semibold">Capability</th>
                  <th className="px-3 py-2.5 font-semibold">Admin</th>
                  <th className="px-3 py-2.5 font-semibold">Agent</th>
                  <th className="px-3 py-2.5 font-semibold">Backoffice</th>
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((row) => (
                  <tr key={row[0]} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2 text-slate-300">{row[0]}</td>
                    {row.slice(1).map((c, i) => (
                      <td key={MATRIX_ROLES[i]} className={cn("px-3 py-2 font-mono", c === "—" ? "text-slate-600" : "text-teal-300")}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <FileScan className="size-3.5" /> AI OCR reads PDF, JPG, PNG & WEBP policy documents
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-rise">
          <h1 className="font-heading text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use the credentials issued by your administrator.</p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              login.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                data-testid="login-username-input"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                data-testid="login-password-input"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p data-testid="login-error" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" className="h-10 w-full" disabled={login.isPending} data-testid="login-submit-button">
              {login.isPending ? "Signing in…" : "Sign in"} <ArrowRight className="size-4" />
            </Button>
          </form>

        </div>
      </section>
    </div>
  );
}
