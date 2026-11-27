import { cn } from 'cn';
import { CheckIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { selectItemClassName } from '@/components/ui/select';

export type PickerOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  detail?: string;
};

export type PickerSearch = {
  label: string;
  emptyLabel: string;
  normalize?: (text: string) => string;
  maxShown?: number;
};

type PickerListProps<T extends string> = {
  value: T;
  options: readonly PickerOption<T>[];
  onChoose: (value: T) => void;
  search?: PickerSearch | undefined;
};

const lower = (text: string) => text.toLowerCase();

export function PickerList<T extends string>({
  value,
  options,
  onChoose,
  search,
}: PickerListProps<T>) {
  const [query, setQuery] = useState('');
  const normalize = search?.normalize ?? lower;
  const needle = normalize(query.trim());
  const matches = search
    ? options
        .filter((option) => normalize(`${option.label} ${option.detail ?? ''}`).includes(needle))
        .slice(0, search.maxShown ?? options.length)
    : options;

  return (
    <>
      {search ? (
        <Input
          type="search"
          aria-label={search.label}
          placeholder={search.label}
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
              onClick={() => onChoose(option.value)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                {option.icon}
                {option.label}
                {option.detail ? (
                  <span className="text-muted-foreground">{option.detail}</span>
                ) : null}
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
    </>
  );
}
