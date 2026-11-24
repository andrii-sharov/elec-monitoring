import { useMemo } from 'react';
import { PickerField } from './PickerField';

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
  const options = useMemo(
    () => allZones(value).map((zone) => ({ value: zone, label: zone })),
    [value],
  );
  return (
    <PickerField
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      search={{ label: searchLabel, emptyLabel, normalize, maxShown }}
    />
  );
}
