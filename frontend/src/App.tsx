import { Routes, Route, Navigate, useOutletContext } from "react-router-dom";
import AppShell from "@/components/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Upload from "@/pages/Upload";
import Policies from "@/pages/Policies";
import PolicyDetail from "@/pages/PolicyDetail";
import Users from "@/pages/Users";
import Outstanding from "@/pages/Outstanding";
import UsagePage from "@/pages/Usage";
import Commission from "@/pages/Commission";
import Statements from "@/pages/Statements";
import Recon from "@/pages/Recon";
import Portals from "@/pages/Portals";
import MyRates from "@/pages/MyRates";
import OnSpot from "@/pages/OnSpot";
import type { ReactNode } from "react";
import type { User } from "@/lib/types";

function NotBackoffice({ children }: { children: ReactNode }) {
  const me = useOutletContext<User>();
  return me.role !== "backoffice" ? <>{children}</> : <Navigate to="/" replace />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const me = useOutletContext<User>();
  return me.role === "admin" ? <>{children}</> : <Navigate to="/" replace />;
}

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/policies" element={<Policies />} />
        <Route path="/policies/:id" element={<PolicyDetail />} />
        <Route path="/outstanding" element={<Outstanding />} />
        <Route path="/users" element={<AdminOnly><Users /></AdminOnly>} />
        <Route path="/usage" element={<AdminOnly><UsagePage /></AdminOnly>} />
        <Route path="/portals" element={<Portals />} />
        <Route path="/recon" element={<AdminOnly><Recon /></AdminOnly>} />
        <Route path="/onspot" element={<AdminOnly><OnSpot /></AdminOnly>} />
        <Route path="/statements" element={<NotBackoffice><Statements /></NotBackoffice>} />
        <Route path="/commission" element={<AdminOnly><Commission /></AdminOnly>} />
        <Route path="/my-rates" element={<NotBackoffice><MyRates /></NotBackoffice>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
