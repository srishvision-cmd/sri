import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { FileStack, Gauge, KeyRound, LayoutDashboard, LogOut, Search, ShieldCheck, UploadCloud, Users, Wallet } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABEL, useMe } from "@/lib/auth";
import { endSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; roles: Role[]; testId: string }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "agent", "backoffice"], testId: "nav-dashboard" },
  { to: "/upload", label: "Upload & OCR", icon: UploadCloud, roles: ["admin", "agent", "backoffice"], testId: "nav-upload" },
  { to: "/policies", label: "Policy MIS", icon: FileStack, roles: ["admin", "agent", "backoffice"], testId: "nav-policies" },
  { to: "/outstanding", label: "Agent Outstanding", icon: Wallet, roles: ["admin", "agent", "backoffice"], testId: "nav-outstanding" },
  { to: "/usage", label: "Storage & OCR Usage", icon: Gauge, roles: ["admin"], testId: "nav-usage" },
  { to: "/users", label: "Users & Access", icon: Users, roles: ["admin"], testId: "nav-users" },
];

const TITLES: [RegExp, string][] = [
  [/^\/$/, "Dashboard"],
  [/^\/upload/, "Upload & OCR"],
  [/^\/policies\/.+/, "Verification"],
  [/^\/policies/, "Policy MIS"],
  [/^\/users/, "Users & Access"],
  [/^\/outstanding/, "Agent Outstanding"],
  [/^\/usage/, "Storage & OCR Usage"],
];

export default function AppShell() {
  const { data: me, isLoading, isError } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [pwOpen, setPwOpen] = useState(false);

  if (isError) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const title = TITLES.find(([rx]) => rx.test(location.pathname))?.[1] ?? "";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {me && <ChangePasswordDialog open={pwOpen || me.must_change_password} onOpenChange={setPwOpen} forced={me.must_change_password} />}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid size-8 place-items-center rounded-md bg-primary">
            <ShieldCheck className="size-4.5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="font-heading text-sm font-bold tracking-tight">GI·MIS</div>
            <div className="text-[11px] text-muted-foreground">Policy operations</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
          {NAV.filter((n) => !me || n.roles.includes(me.role)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              data-testid={n.testId}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                  isActive ? "bg-sidebar-accent text-white" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon className={cn("size-4 transition-colors duration-150", isActive && "text-sky-400")} />
                  {n.label}
                  {isActive && <span className="ml-auto h-4 w-0.5 rounded-full bg-sky-400" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          {me ? (
            <div className="space-y-3">
              <div>
                <div data-testid="sidebar-user-name" className="truncate text-sm font-medium">{me.full_name}</div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge data-testid="sidebar-user-role" variant="outline" className="border-sky-500/30 text-sky-300">
                    {ROLE_LABEL[me.role]}
                  </Badge>
                  <span className="font-mono text-[11px] text-muted-foreground">{me.username.toUpperCase()}</span>
                </div>
                {me.branch && <div className="mt-1 text-[11px] text-muted-foreground">Branch · {me.branch}</div>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                data-testid="change-password-button"
                onClick={() => setPwOpen(true)}
              >
                <KeyRound className="size-3.5" /> Change password
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                data-testid="logout-button"
                onClick={() => endSession("/login")}
              >
                <LogOut className="size-3.5" /> Sign out
              </Button>
            </div>
          ) : (
            <div className="h-16 animate-pulse rounded-md bg-muted" />
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-[#0B0F19]/80 px-6 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <span className="label-caps hidden sm:inline">General Insurance</span>
            <span className="hidden text-muted-foreground sm:inline">/</span>
            <h1 data-testid="page-title" className="font-heading text-sm font-semibold">{title}</h1>
          </div>
          <form
            data-testid="global-policy-search-form"
            className="relative ml-auto mr-2 w-full max-w-xs"
            onSubmit={(e) => {
              e.preventDefault();
              const q = search.trim();
              if (q) navigate(`/policies?q=${encodeURIComponent(q)}`);
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="global-policy-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search policy no., customer, vehicle… ↵"
              className="h-8 pl-8 text-xs"
            />
          </form>
          <div className="flex items-center gap-2 md:hidden">
            {NAV.filter((n) => !me || n.roles.includes(me.role)).map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} className="rounded p-2 text-muted-foreground hover:text-foreground">
                <n.icon className="size-4" />
              </NavLink>
            ))}
            <button className="rounded p-2 text-muted-foreground" onClick={() => setPwOpen(true)} aria-label="Change password" data-testid="mobile-change-password-button">
              <KeyRound className="size-4" />
            </button>
            <button className="rounded p-2 text-muted-foreground" onClick={() => endSession("/login")} aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          {isLoading || !me ? (
            <div className="space-y-4">
              <div className="h-8 w-64 animate-pulse rounded bg-muted" />
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            </div>
          ) : (
            <Outlet context={me} />
          )}
        </main>
      </div>
      <Toaster richColors />
    </div>
  );
}
