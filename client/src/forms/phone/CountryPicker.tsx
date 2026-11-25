import { cn } from 'cn';
import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PickerList, type PickerOption } from '@/components/PickerList';
import { InputGroupButton } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { selectPopupClassName } from '@/components/ui/select';
import { countries } from './countries';
import { Flag } from './Flag';
import type { CountryCode } from './phoneText';

type CountryPickerProps = {
  country: CountryCode;
  onChange: (country: CountryCode) => void;
  disabled?: boolean | undefined;
};

export function CountryPicker({ country, onChange, disabled }: CountryPickerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const language = i18n.resolvedLanguage ?? 'uk';
  const list = countries(language);
  const current = list.find((item) => item.code === country);
  const options: PickerOption<CountryCode>[] = list.map((item) => ({
    value: item.code,
    label: item.name,
    detail: item.callingCode,
    icon: <Flag code={item.code} />,
  }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <InputGroupButton
            size="xs"
            aria-label={t('app.phone.country', {
              country: current?.name ?? country,
              code: current?.callingCode ?? '',
            })}
          />
        }
      >
        <Flag code={country} />
        <span className="text-foreground tabular-nums">{current?.callingCode}</span>
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        data-look="select-content"
        className={cn(selectPopupClassName, 'flex w-80 flex-col gap-1 p-1')}
        onClick={(event) => event.stopPropagation()}
      >
        <PickerList
          value={country}
          options={options}
          onChoose={(next) => {
            onChange(next);
            setOpen(false);
          }}
          search={{ label: t('app.phone.search'), emptyLabel: t('app.phone.empty') }}
        />
      </PopoverContent>
    </Popover>
  );
}
