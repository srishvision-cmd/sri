import { Routes, Route, Navigate, useOutletContext } from "react-router-dom";
import AppShell from "@/components/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Upload from "@/pages/Upload";
import Policies from "@/pages/Policies";
import PolicyDetail from "@/pages/PolicyDetail";
import Users from "@/pages/Users";
import Outstanding from "@/pages/Outstanding";
import type { User } from "@/lib/types";

function AdminOnly() {
  const me = useOutletContext<User>();
  return me.role === "admin" ? <Users /> : <Navigate to="/" replace />;
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
        <Route path="/users" element={<AdminOnly />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
