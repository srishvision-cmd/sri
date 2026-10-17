import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/fields";
import { cn } from "@/lib/utils";
import type { InsurerDupGroup, InsurerMergeIn, InsurerMergeResult } from "@/lib/types";

/** Every name in a group that can be kept: admin-added master entries + spellings on policies (built-in names are the code list). */
const namesOf = (g: InsurerDupGroup) => [...new Set([...g.entries.filter((e) => !e.builtin).map((e) => e.name), ...g.policy_names])];

/** Insurance company names that are the same insurer (case, punctuation, "Company Limited", cut short) — review, confirm, merge. */
export function InsurerDuplicates() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState<Record<string, string>>({}); // group key → name to keep
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [confirmed, setConfirmed] = useState(false);
  const dups = useQuery({ queryKey: ["insurer-duplicates"], queryFn: () => apiGet<InsurerDupGroup[]>("/insurers/duplicates"), enabled: open });
  const groups = dups.data ?? [];
  const keepOf = (g: InsurerDupGroup) => keep[g.key] ?? g.canonical_name;
  const chosen = groups.filter((g) => !skip[g.key]);

  const merge = useMutation({
    mutationFn: () => apiPost<InsurerMergeResult>("/insurers/merge", {
      groups: chosen.map((g) => ({ key: g.key, canonical_id: g.canonical_id, canonical_name: keepOf(g), merge_ids: [] })),
    } satisfies InsurerMergeIn),
    onSuccess: (r) => {
      for (const k of ["insurers", "insurer-duplicates", "commission-masters", "commission-rules", "policies", "meta"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(`Merged ${r.merged} duplicate name${r.merged === 1 ? "" : "s"} · ${r.policies_relinked} policies and ${r.rules_relinked} rules relinked`);
      setConfirmed(false);
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <Button variant="outline" size="sm" data-testid="insurers-find-duplicates" onClick={() => { setOpen(true); setConfirmed(false); }}>
        <Copy className="size-3.5" /> Find duplicates
      </Button>
      <Dialog open={open} onOpenChange={(o) => !merge.isPending && setOpen(o)}>
        <DialogContent data-testid="insurer-dup-dialog" className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-heading">Duplicate insurance companies</DialogTitle>
            <DialogDescription>
              Names that are the same insurer apart from capital letters, punctuation, "Company Limited" or being cut short. The most complete name is picked to keep —
              policies (and rules of removed master entries) using the other names are relinked to it. Policies are only relinked (with a history note), never deleted.
            </DialogDescription>
          </DialogHeader>
          {dups.isLoading && <p className="text-sm text-muted-foreground">Checking companies…</p>}
          {!dups.isLoading && groups.length === 0 && <p data-testid="insurer-dup-none" className="text-sm text-emerald-700">No duplicates found — every company appears once.</p>}
          <div className="space-y-3">
            {groups.map((g) => {
              const slug = g.key.replace(/\s+/g, "-");
              return (
                <div key={g.key} data-testid={`insurer-dup-group-${slug}`} className={cn("rounded-lg border border-border p-3", skip[g.key] && "opacity-50")}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold">{namesOf(g).length} names for one company</span>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox checked={!!skip[g.key]} onCheckedChange={(v) => setSkip((s) => ({ ...s, [g.key]: !!v }))} data-testid={`insurer-dup-skip-${slug}`} /> Leave as is
                    </label>
                  </div>
                  <div className="space-y-1">
                    {namesOf(g).map((n) => {
                      const e = g.entries.find((x) => x.name === n);
                      return (
                        <label key={n} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                          <input type="radio" name={`keep-${g.key}`} checked={keepOf(g) === n} disabled={!!skip[g.key]} onChange={() => setKeep((k) => ({ ...k, [g.key]: n }))} data-testid={`insurer-dup-keep-${slug}-${n.length}`} />
                          <span className="font-medium">{n}</span>
                          {e && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">Master entry</span>}
                          <span className={cn("ml-auto w-16 text-right text-xs font-semibold", keepOf(g) === n ? "text-emerald-700" : "text-amber-700")}>{keepOf(g) === n ? "Keep" : "Merge"}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {groups.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(!!v)} data-testid="insurer-dup-confirm" className="mt-0.5" />
              I have reviewed the list — merge {chosen.length} group{chosen.length === 1 ? "" : "s"} and relink their policies to the kept names.
            </label>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} data-testid="insurer-dup-cancel">Cancel</Button>
            <Button disabled={!confirmed || !chosen.length || merge.isPending} onClick={() => merge.mutate()} data-testid="insurer-dup-merge">
              <Merge className="size-4" /> Merge {chosen.length} group{chosen.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
