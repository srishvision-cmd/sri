import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { AgentGroup, Broker, AgentOption, Meta, User } from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<User>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function useMeta() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: () => apiGet<Meta>("/meta"),
    staleTime: Infinity,
  });
}

export function useAgentOptions(enabled = true) {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => apiGet<AgentOption[]>("/agents"),
    enabled,
  });
}

export function useBrokers(enabled = true) {
  return useQuery({ queryKey: ["brokers"], queryFn: () => apiGet<Broker[]>("/brokers"), enabled });
}

export function useAgentGroups(enabled = true) {
  return useQuery({ queryKey: ["agent-groups"], queryFn: () => apiGet<AgentGroup[]>("/agent-groups"), enabled });
}

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  agent: "Partner",
  backoffice: "Backoffice",
};
