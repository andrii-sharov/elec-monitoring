import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type PickerOption<T extends string> = { value: T; label: string };

type PickerSearch = {
  label: string;
  emptyLabel: string;
  normalize?: (text: string) => string;
  maxShown?: number;
};

type PickerFieldProps<T extends string> = {
  label: string;
  value: T;
  options: readonly PickerOption<T>[];
  onChange: (value: T) => void;
  search?: PickerSearch;
};

const lower = (text: string) => text.toLowerCase();

export function PickerField<T extends string>({
  label,
  value,
  options,
  onChange,
  search,
}: PickerFieldProps<T>) {
  const labelId = useId();
  const buttonId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalize = search?.normalize ?? lower;
  const needle = normalize(query.trim());
  const matches = search
    ? options
        .filter((option) => normalize(option.label).includes(needle))
        .slice(0, search.maxShown ?? options.length)
    : options;
  const current = options.find((option) => option.value === value)?.label ?? value;

  function choose(next: T) {
    onChange(next);
    setOpen(false);
    setQuery('');
  }

  return (
    <Field>
      <FieldLabel id={labelId}>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={buttonId}
              type="button"
              variant="outline"
              className="justify-between"
              aria-labelledby={`${labelId} ${buttonId}`}
            />
          }
        >
          {current}
          <ChevronDownIcon />
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-72 flex-col gap-2">
          {search ? (
            <Input
              type="search"
              aria-label={search.label}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          <ul className="flex max-h-60 flex-col overflow-y-auto">
            {matches.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  aria-pressed={option.value === value}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                  onClick={() => choose(option.value)}
                >
                  {option.label}
                  {option.value === value ? <CheckIcon className="size-4" /> : null}
                </button>
              </li>
            ))}
            {search && matches.length === 0 ? (
              <li className="px-2 py-1 text-sm text-muted-foreground">{search.emptyLabel}</li>
            ) : null}
          </ul>
        </PopoverContent>
      </Popover>
    </Field>
  );
}
