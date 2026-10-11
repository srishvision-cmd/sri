import { useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Searchable multi-select: pick any number of options; selected values show as removable chips. */
export function MultiSelect({ value, onChange, options, placeholder, testId, className }: { value: string[]; onChange: (v: string[]) => void; options: string[]; placeholder: string; testId: string; className?: string }) {
  const [q, setQ] = useState("");
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <Popover onOpenChange={(o) => !o && setQ("")}>
      <PopoverTrigger data-testid={testId}
        className={cn("flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-left text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30", className)}>
        {value.length === 0 && <span className="px-1 text-muted-foreground">{placeholder}</span>}
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-200" data-testid={`${testId}-chip-${slug(v)}`}>
            {v}
            <span role="button" tabIndex={-1} aria-label={`Remove ${v}`} onClick={(e) => { e.stopPropagation(); toggle(v); }}><X className="size-3" /></span>
          </span>
        ))}
        <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-60 gap-1.5 p-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus data-testid={`${testId}-search`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…"
            className="h-8 w-full rounded-md border border-input bg-background/60 pl-7 pr-2 text-sm outline-none focus:border-ring" />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {shown.map((o) => (
            <button key={o} type="button" data-testid={`${testId}-option-${slug(o)}`} onClick={() => toggle(o)}
              className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors duration-100 hover:bg-accent">
              <span className="truncate">{o}</span>
              {value.includes(o) && <Check className="size-3.5 shrink-0 text-sky-300" />}
            </button>
          ))}
          {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No match for "{q}"</p>}
        </div>
        {value.length > 0 && (
          <button type="button" data-testid={`${testId}-clear`} onClick={() => onChange([])} className="rounded-sm px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground">
            Clear all ({value.length})
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Pick from a searchable list, or add a new entry typed in the search box. */
export function ComboBox({ value, onChange, options, suggestion, placeholder, testId, addLabel = "Use", onAdd }: {
  value: string; onChange: (v: string) => void; options: string[]; suggestion?: string; placeholder: string; testId: string; addLabel?: string; onAdd?: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const all = [...new Set([...(suggestion ? [suggestion] : []), ...options])];
  const shown = q ? all.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : all;
  const exact = all.some((o) => o.toLowerCase() === q.trim().toLowerCase());
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger data-testid={testId}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30">
        <span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 gap-1.5 p-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus data-testid={`${testId}-search`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or type a new one…"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (shown.length && !q.trim()) pick(shown[0]); else if (q.trim()) { onAdd?.(q.trim()); pick(exact ? all.find((o) => o.toLowerCase() === q.trim().toLowerCase())! : q.trim()); } } }}
            className="h-8 w-full rounded-md border border-input bg-background/60 pl-7 pr-2 text-sm outline-none focus:border-ring" />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {q.trim() && !exact && (
            <button type="button" data-testid={`${testId}-add`} onClick={() => { onAdd?.(q.trim()); pick(q.trim()); }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-teal-300 hover:bg-accent">
              <Plus className="size-3.5" /> {addLabel} "{q.trim()}"
            </button>
          )}
          {shown.map((o) => (
            <button key={o} type="button" data-testid={`${testId}-option-${slug(o)}`} onClick={() => pick(o)}
              className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors duration-100 hover:bg-accent">
              <span className="truncate">{o}{o === suggestion && <span className="ml-2 rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] text-teal-300">Suggested</span>}</span>
              {o === value && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
          {shown.length === 0 && !q.trim() && <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nothing yet — type to add</p>}
        </div>
        {value && (
          <button type="button" data-testid={`${testId}-clear`} onClick={() => pick("")} className="rounded-sm px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground">Clear</button>
        )}
      </PopoverContent>
    </Popover>
  );
}
