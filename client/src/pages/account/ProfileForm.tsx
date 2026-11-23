import { languages, type Language } from '@elec/shared';
import { languageSchema, nameSchema, type Me } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { isApiError } from '@/api/errors';
import { useUpdateMe } from '@/api/useUpdateMe';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { applyServerErrors } from '@/forms/zodErrors';
import { themeChoices, useTheme, type ThemeChoice } from '@/lib/theme';

const profileSchema = z.object({
  name: nameSchema,
  language: languageSchema,
  timezone: z.string().min(1),
});

type Values = z.infer<typeof profileSchema>;

const fieldNames = ['name', 'language', 'timezone'] as const;

function valuesOf(me: Me): Values {
  return { name: me.name, language: me.language, timezone: me.timezone };
}

function isTheme(value: string | null): value is ThemeChoice {
  return themeChoices.some((choice) => choice === value);
}

export function ProfileForm({ me }: { me: Me }) {
  const { t } = useTranslation();
  const updateMe = useUpdateMe();
  const [theme, setTheme] = useTheme();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<Values>({ resolver: zodResolver(profileSchema), defaultValues: valuesOf(me) });
  const languageItems = languages.map((value) => ({
    value,
    label: t(`app.common.languages.${value}`),
  }));
  const themeItems = themeChoices.map((value) => ({ value, label: t(`app.theme.${value}`) }));

  function submit(values: Values) {
    const body: Partial<Values> = {};
    if (dirtyFields.name) body.name = values.name;
    if (dirtyFields.language) body.language = values.language;
    if (dirtyFields.timezone) body.timezone = values.timezone;
    setFormError(null);
    updateMe.mutate(body, {
      onSuccess: (updated) => {
        reset(valuesOf(updated));
        toast.success(t('app.account.saved'));
      },
      onError: (error) => {
        const mapped =
          isApiError(error, 'validation_error') &&
          applyServerErrors(error, setError, fieldNames, t);
        if (!mapped) setFormError(errorMessage(t, error));
      },
    });
  }

  return (
    <section aria-labelledby="profile-title" className="flex max-w-xl flex-col gap-3">
      <h2 id="profile-title" className="font-heading text-lg font-medium">
        {t('app.account.profile')}
      </h2>
      <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit(submit)}>
        <FormAlert message={formError} />
        <TextField label={t('app.account.name')} error={errors.name} {...register('name')} />
        <Controller
          control={control}
          name="language"
          render={({ field }) => (
            <Field>
              <FieldLabel>{t('app.account.language')}</FieldLabel>
              <Select
                items={languageItems}
                value={field.value}
                onValueChange={(next: Language | null) => next && field.onChange(next)}
              >
                <SelectTrigger aria-label={t('app.account.language')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languageItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Controller
          control={control}
          name="timezone"
          render={({ field }) => (
            <TimezoneSelect
              value={field.value}
              onChange={(zone) => field.onChange(zone)}
              label={t('app.account.timezone')}
              searchLabel={t('app.account.timezoneSearch')}
              emptyLabel={t('app.account.timezoneEmpty')}
            />
          )}
        />
        <Field>
          <FieldLabel>{t('app.theme.label')}</FieldLabel>
          <Select
            items={themeItems}
            value={theme}
            onValueChange={(next: string | null) => isTheme(next) && setTheme(next)}
          >
            <SelectTrigger aria-label={t('app.theme.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button type="submit" className="self-start" disabled={updateMe.isPending || !isDirty}>
          {t('app.account.save')}
        </Button>
      </form>
    </section>
  );
}
