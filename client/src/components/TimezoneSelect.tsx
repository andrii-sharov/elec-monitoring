import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const renamedZones: Record<string, string> = { 'Europe/Kiev': 'Europe/Kyiv' };
const maxShown = 100;

function allZones(current: string): string[] {
  const zones = new Set(
    Intl.supportedValuesOf('timeZone').map((zone) => renamedZones[zone] ?? zone),
  );
  zones.add(current);
  return [...zones].toSorted();
}

function normalize(text: string): string {
  return text.toLowerCase().replaceAll('_', ' ');
}

type TimezoneSelectProps = {
  value: string;
  onChange: (zone: string) => void;
  label: string;
  searchLabel: string;
  emptyLabel: string;
};

export function TimezoneSelect({
  value,
  onChange,
  label,
  searchLabel,
  emptyLabel,
}: TimezoneSelectProps) {
  const labelId = useId();
  const buttonId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const zones = useMemo(() => allZones(value), [value]);
  const needle = normalize(query.trim());
  const matches = zones.filter((zone) => normalize(zone).includes(needle)).slice(0, maxShown);

  function choose(zone: string) {
    onChange(zone);
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
          {value}
          <ChevronDownIcon />
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-72 flex-col gap-2">
          <Input
            type="search"
            aria-label={searchLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="flex max-h-60 flex-col overflow-y-auto">
            {matches.map((zone) => (
              <li key={zone}>
                <button
                  type="button"
                  aria-pressed={zone === value}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-secondary"
                  onClick={() => choose(zone)}
                >
                  {zone}
                  {zone === value ? <CheckIcon className="size-4" /> : null}
                </button>
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="px-2 py-1 text-sm text-muted-foreground">{emptyLabel}</li>
            ) : null}
          </ul>
        </PopoverContent>
      </Popover>
    </Field>
  );
}
