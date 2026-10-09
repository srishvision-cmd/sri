import { useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder: string;
  testId: string;
  className?: string;
  allLabel?: string; // when set, adds an "all" option that maps to ""
  searchable?: boolean; // defaults to on for long lists (> 8 options)
}

const ALL = "__all__";
const slug = (v: string) => (v === ALL ? "all" : v.toLowerCase().replace(/\s+/g, "-"));

function SearchSelect({ value, onChange, opts, placeholder, testId, className }: { value: string; onChange: (v: string) => void; opts: Option[]; placeholder: string; testId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = opts.find((o) => o.value === value);
  const shown = q ? opts.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : opts;
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger
        data-testid={testId}
        className={cn(
          "flex h-9 min-w-36 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm whitespace-nowrap shadow-xs transition-[border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30",
          className,
        )}
      >
        <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.label ?? placeholder}</span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-60 gap-1.5 p-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            data-testid={`${testId}-search`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && shown.length) { e.preventDefault(); pick(shown[0].value); } }}
            placeholder="Type to search…"
            className="h-8 w-full rounded-md border border-input bg-background/60 pl-7 pr-2 text-sm outline-none focus:border-ring"
          />
        </div>
        <div className="max-h-64 overflow-y-auto" role="listbox">
          {shown.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              data-testid={`${testId}-option-${slug(o.value)}`}
              onClick={() => pick(o.value)}
              className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
          {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No match for "{q}"</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SimpleSelect({ value, onChange, options, placeholder, testId, className, allLabel, searchable }: Props) {
  const opts = allLabel ? [{ value: ALL, label: allLabel }, ...options] : options;
  const current = value === "" && allLabel ? ALL : value;
  const change = (v: string) => onChange(v === ALL ? "" : v);
  if (searchable ?? opts.length > 8) {
    return <SearchSelect value={current} onChange={change} opts={opts} placeholder={placeholder} testId={testId} className={className} />;
  }
  const labels = Object.fromEntries(opts.map((o) => [o.value, o.label]));
  return (
    <Select value={current || null} onValueChange={(v) => change(v as string)}>
      <SelectTrigger data-testid={testId} className={cn("min-w-36", className)}>
        <SelectValue placeholder={placeholder}>{(v: string | null) => (v ? labels[v] ?? v : placeholder)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {opts.map((o) => (
          <SelectItem key={o.value} value={o.value} data-testid={`${testId}-option-${slug(o.value)}`}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
