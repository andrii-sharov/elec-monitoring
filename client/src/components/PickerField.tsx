import { cn } from 'cn';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  selectItemClassName,
  selectPopupClassName,
  selectTriggerClassName,
} from '@/components/ui/select';

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
            <button
              id={buttonId}
              type="button"
              data-slot="select-trigger"
              data-size="default"
              className={cn(selectTriggerClassName, 'w-full')}
              aria-labelledby={`${labelId} ${buttonId}`}
            />
          }
        >
          <span data-slot="select-value" className="flex flex-1 text-left">
            {current}
          </span>
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          data-look="select-content"
          className={cn(selectPopupClassName, 'flex flex-col gap-1 p-1')}
        >
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
                  data-slot="select-item"
                  aria-pressed={option.value === value}
                  className={cn(
                    selectItemClassName,
                    'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
                  )}
                  onClick={() => choose(option.value)}
                >
                  <span className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
                    {option.label}
                  </span>
                  {option.value === value ? (
                    <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                      <CheckIcon className="pointer-events-none" />
                    </span>
                  ) : null}
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
