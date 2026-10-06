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
}

const ALL = "__all__";

export function SimpleSelect({ value, onChange, options, placeholder, testId, className, allLabel }: Props) {
  const opts = allLabel ? [{ value: ALL, label: allLabel }, ...options] : options;
  const labels = Object.fromEntries(opts.map((o) => [o.value, o.label]));
  const current = value === "" && allLabel ? ALL : value;
  return (
    <Select value={current || null} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger data-testid={testId} className={cn("min-w-36", className)}>
        <SelectValue placeholder={placeholder}>{(v: string | null) => (v ? labels[v] ?? v : placeholder)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {opts.map((o) => (
          <SelectItem key={o.value} value={o.value} data-testid={`${testId}-option-${o.value === ALL ? "all" : o.value.toLowerCase().replace(/\s+/g, "-")}`}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
