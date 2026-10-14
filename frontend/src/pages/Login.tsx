import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bike, Car, FileScan, HeartPulse, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api";
import { beginSession } from "@/lib/session";
import { errorMessage } from "@/lib/fields";
import type { User } from "@/lib/types";

const PRODUCTS = [
  { icon: Car, label: "Private Car", sub: "Package · TP · SAOD" },
  { icon: Bike, label: "Two Wheeler", sub: "Comprehensive · TP" },
  { icon: Truck, label: "Commercial", sub: "GCV · PCV · GVW rules" },
  { icon: HeartPulse, label: "Health", sub: "Individual · Floater" },
];

const STATS = [
  { value: "34", label: "column MIS export" },
  { value: "AI", label: "OCR on every policy" },
  { value: "₹", label: "agent outstanding tracked" },
];

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("reason") === "idle" ? "You were signed out after 15 minutes of no activity. Please sign in again." : null,
  );
  const navigate = useNavigate();
  const qc = useQueryClient();

  const login = useMutation({
    mutationFn: (creds: { username: string; password: string }) => apiPost<User>("/auth/login", creds),
    onSuccess: (user) => {
      beginSession();
      qc.setQueryData(["me"], user);
      navigate("/", { replace: true });
    },
    onError: (err) => setError(errorMessage(err, "Unable to sign in")),
  });

  return (
    <div className="dark grid min-h-screen bg-background text-foreground lg:grid-cols-[1.15fr_1fr]">
      <section
        data-testid="login-hero"
        className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-[#102A43] p-12 lg:flex"
      >
        <img
          src="/insurance-hero.jpg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-[56%] object-cover object-bottom opacity-90 [mask-image:linear-gradient(to_left,black_60%,transparent)]"
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_30%,rgba(59,130,246,0.14),transparent_55%)]" />

        <div className="relative flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-md bg-primary shadow-[0_0_24px_rgba(59,130,246,0.45)]">
            <ShieldCheck className="size-5 text-white" />
          </div>
          <span className="font-heading text-base font-bold tracking-tight">GI·MIS</span>
          <span className="ml-2 rounded-full border border-border bg-white/5 px-2.5 py-0.5 text-[11px] text-slate-400">General Insurance</span>
        </div>

        <div className="relative max-w-[25rem] animate-rise">
          <p className="label-caps mb-4 text-sky-400">Motor · Health · Commercial</p>
          <h2 className="font-heading text-[2.6rem] font-bold leading-[1.05] tracking-tight text-slate-100">
            Every policy insured. <span className="text-sky-400">Every rupee tracked.</span>
          </h2>
          <p className="mt-4 max-w-[22rem] text-sm leading-relaxed text-slate-400">
            Upload policy schedules, let AI read the insured, vehicle and premium details, verify, and send branch-ready MIS to your insurers.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-3">
            {PRODUCTS.map(({ icon: Icon, label, sub }, i) => (
              <div
                key={label}
                data-testid={`login-product-${label.toLowerCase().replace(/\s+/g, "-")}`}
                style={{ animationDelay: `${120 + i * 80}ms` }}
                className="animate-rise rounded-xl border border-white/10 bg-[#111827]/70 p-3.5 backdrop-blur-md transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-sky-500/40"
              >
                <Icon className="size-5 text-sky-400" />
                <div className="mt-2 text-sm font-semibold text-slate-100">{label}</div>
                <div className="text-[11px] text-slate-500">{sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex gap-8">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="font-mono text-xl font-semibold text-teal-300">{s.value}</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">{s.label}</div>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2 self-end text-xs text-slate-500">
            <FileScan className="size-3.5" /> PDF · JPG · PNG · WEBP
          </div>
        </div>
      </section>

      <section className="relative flex items-center justify-center overflow-hidden px-6 py-12">
        <div className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-10 size-80 rounded-full bg-teal-500/5 blur-3xl" />
        <div className="relative w-full max-w-sm animate-rise rounded-2xl border border-white/10 bg-[#111827]/60 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <div className="grid size-8 place-items-center rounded-md bg-primary">
              <ShieldCheck className="size-4 text-white" />
            </div>
            <span className="font-heading font-bold">GI·MIS</span>
          </div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use the credentials issued by your administrator.</p>
          <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="size-3.5 text-teal-400" /> Secure access for Admin, Backoffice & Agents
          </div>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              // Chrome on iOS / Android autofills without firing onChange → read what is actually in the inputs
              const fd = new FormData(e.currentTarget);
              const creds = { username: String(fd.get("username") ?? username).trim(), password: String(fd.get("password") ?? password) };
              if (!creds.username || !creds.password) return setError("Enter your username and password");
              setUsername(creds.username);
              setPassword(creds.password);
              login.mutate(creds);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
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
                name="password"
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
