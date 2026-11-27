import { ArrowDownUp } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

type Option = { value: string; label: string };

type SortSelectProps = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
};

export function SortSelect({ label, value, options, onChange }: SortSelectProps) {
  return (
    <Select items={options} value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger aria-label={label} className="max-sm:w-full">
        <ArrowDownUp aria-hidden="true" className="text-muted-foreground" />
        <SelectValue widthOf={options.map((option) => option.label)} />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
