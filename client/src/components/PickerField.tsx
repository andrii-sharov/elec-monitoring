import { cn } from 'cn';
import { ChevronDownIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Field, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { selectPopupClassName, selectTriggerClassName } from '@/components/ui/select';
import { PickerList, type PickerOption, type PickerSearch } from './PickerList';

export type { PickerOption } from './PickerList';

type PickerFieldProps<T extends string> = {
  label: string;
  value: T;
  options: readonly PickerOption<T>[];
  onChange: (value: T) => void;
  search?: PickerSearch;
};

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
  const current = options.find((option) => option.value === value)?.label ?? value;

  function choose(next: T) {
    onChange(next);
    setOpen(false);
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
          className={cn(selectPopupClassName, 'flex flex-col gap-1')}
        >
          <PickerList value={value} options={options} onChoose={choose} search={search} />
        </PopoverContent>
      </Popover>
    </Field>
  );
}
