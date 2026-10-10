import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { BadgePercent, ChevronDown, Landmark, Globe, FileStack, Gauge, KeyRound, LayoutDashboard, LogOut, Percent, ReceiptText, Scale, Search, ShieldCheck, UploadCloud, Users, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_LABEL, useMe } from "@/lib/auth";
import { endSession, startIdleLogout } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; roles: Role[]; testId: string }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "agent", "backoffice"], testId: "nav-dashboard" },
  { to: "/upload", label: "Upload & OCR", icon: UploadCloud, roles: ["admin", "agent", "backoffice"], testId: "nav-upload" },
  { to: "/policies", label: "Policy MIS", icon: FileStack, roles: ["admin", "agent", "backoffice"], testId: "nav-policies" },
  { to: "/portals", label: "Insurer Portals & OTP", icon: Globe, roles: ["admin", "agent", "backoffice"], testId: "nav-portals" },
  { to: "/outstanding", label: "Agent Outstanding", icon: Wallet, roles: ["admin", "agent", "backoffice"], testId: "nav-outstanding" },
  { to: "/recon", label: "Premium Recon", icon: Scale, roles: ["admin"], testId: "nav-recon" },
  { to: "/onspot", label: "On-Spot Bank Check", icon: Landmark, roles: ["admin"], testId: "nav-onspot" },
  { to: "/statements", label: "Commission Statements", icon: ReceiptText, roles: ["admin", "agent"], testId: "nav-statements" },
  { to: "/commission", label: "Commission Grid", icon: Percent, roles: ["admin"], testId: "nav-commission" },
  { to: "/my-rates", label: "My Commission Rates", icon: BadgePercent, roles: ["agent"], testId: "nav-my-rates" },
  { to: "/my-rates", label: "Agent Rate Card", icon: BadgePercent, roles: ["admin"], testId: "nav-agent-rate-card" },
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
  [/^\/commission/, "Commission Grid"],
  [/^\/statements/, "Commission Statements"],
  [/^\/recon/, "Premium Recon"],
  [/^\/portals/, "Insurer Portals & OTP"],
  [/^\/onspot/, "On-Spot Bank Check"],
  [/^\/my-rates/, "Commission Rates"],
];

export default function AppShell() {
  const { data: me, isLoading, isError } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  useEffect(() => (me?.id ? startIdleLogout() : undefined), [me?.id]); // auto sign-out after 15 min idle
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
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2" data-testid="sidebar-nav">
          {NAV.filter((n) => !me || (n.roles.includes(me.role) && !(n.to === "/portals" && me.role === "backoffice" && me.portal_access === false))).map((n) => (
            <NavLink
              key={n.testId}
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
            className="relative ml-auto mr-2 hidden w-full min-w-0 max-w-xs sm:block"
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
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto md:hidden" data-testid="mobile-nav">
            {NAV.filter((n) => !me || (n.roles.includes(me.role) && !(n.to === "/portals" && me.role === "backoffice" && me.portal_access === false))).map((n) => (
              <NavLink key={n.testId} to={n.to} end={n.to === "/"} aria-label={n.label} className="shrink-0 rounded p-2 text-muted-foreground hover:text-foreground">
                <n.icon className="size-4" />
              </NavLink>
            ))}
            <button className="shrink-0 rounded p-2 text-muted-foreground" onClick={() => setPwOpen(true)} aria-label="Change password" data-testid="mobile-change-password-button">
              <KeyRound className="size-4" />
            </button>
          </div>
          {me && (
            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="header-user-menu"
                className="ml-1 flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-2.5 text-sm transition-colors duration-150 hover:border-sky-500/50 hover:bg-card"
              >
                <span className="grid size-7 place-items-center rounded-full bg-primary font-heading text-[11px] font-bold text-white">
                  {me.full_name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden max-w-32 truncate font-medium lg:inline">{me.full_name}</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <div className="px-2 py-2">
                  <div className="truncate text-sm font-semibold">{me.full_name}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="border-sky-500/30 text-sky-300">{ROLE_LABEL[me.role]}</Badge>
                    <span className="font-mono">{me.username.toUpperCase()}</span>
                  </div>
                  {me.branch && <div className="mt-1 text-[11px] text-muted-foreground">Branch · {me.branch}</div>}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem data-testid="header-change-password" onClick={() => setPwOpen(true)}>
                  <KeyRound className="size-3.5" /> Change password
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="header-logout-button" variant="destructive" onClick={() => endSession("/login")}>
                  <LogOut className="size-3.5" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
