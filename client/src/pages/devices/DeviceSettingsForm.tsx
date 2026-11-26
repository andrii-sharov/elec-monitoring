import {
  deviceNameSchema,
  type Device,
  type devicePatchSchema,
  type ErrorDetail,
} from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError, isApiError } from '@/api/errors';
import { patchDevice } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { applyServerErrors } from '@/forms/zodErrors';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const deviceSettingsFormSchema = z
  .object({
    name: deviceNameSchema,
    ping_interval_s: z.number().int().min(5).max(600),
    offline_timeout_s: z.number().int().min(10).max(3600),
    short_outage_threshold_min: z.number().int().min(1).max(1440),
    notify_short_outages: z.boolean(),
    notify_network_outages: z.boolean(),
    quiet_hours_enabled: z.boolean(),
    quiet_hours_start: timeOfDay,
    quiet_hours_end: timeOfDay,
  })
  .superRefine((values, ctx) => {
    const minimum = 2 * values.ping_interval_s;
    if (values.offline_timeout_s < minimum) {
      ctx.addIssue({
        code: 'too_small',
        origin: 'number',
        minimum,
        inclusive: true,
        input: values.offline_timeout_s,
        path: ['offline_timeout_s'],
      });
    }
    if (values.quiet_hours_enabled && values.quiet_hours_start === values.quiet_hours_end) {
      ctx.addIssue({
        code: 'custom',
        path: ['quiet_hours_end'],
        params: { reason: 'same_time' },
        input: values.quiet_hours_end,
      });
    }
  });

type Values = z.input<typeof deviceSettingsFormSchema>;
type PatchBody = z.input<typeof devicePatchSchema>;

const fieldNames = [
  'name',
  'ping_interval_s',
  'offline_timeout_s',
  'short_outage_threshold_min',
  'quiet_hours_start',
  'quiet_hours_end',
] as const;

const quietFields = ['quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end'] as const;

function valuesOf(device: Device): Values {
  const { settings } = device;
  return {
    name: device.name,
    ping_interval_s: settings.ping_interval_s,
    offline_timeout_s: settings.offline_timeout_s,
    short_outage_threshold_min: Math.round(settings.short_outage_threshold_s / 60),
    notify_short_outages: settings.notify_short_outages,
    notify_network_outages: settings.notify_network_outages,
    quiet_hours_enabled: settings.quiet_hours !== null,
    quiet_hours_start: settings.quiet_hours?.start ?? '23:00',
    quiet_hours_end: settings.quiet_hours?.end ?? '07:00',
  };
}

function toPatch(values: Values, dirty: Partial<Record<keyof Values, boolean>>) {
  const settings: NonNullable<PatchBody['settings']> = {};
  const body: PatchBody = {};
  if (dirty.name) body.name = values.name;
  if (dirty.ping_interval_s) settings.ping_interval_s = values.ping_interval_s;
  if (dirty.offline_timeout_s) settings.offline_timeout_s = values.offline_timeout_s;
  if (dirty.short_outage_threshold_min) {
    settings.short_outage_threshold_s = values.short_outage_threshold_min * 60;
  }
  if (dirty.notify_short_outages) settings.notify_short_outages = values.notify_short_outages;
  if (dirty.notify_network_outages) {
    settings.notify_network_outages = values.notify_network_outages;
  }
  if (quietFields.some((field) => dirty[field])) {
    settings.quiet_hours = values.quiet_hours_enabled
      ? { start: values.quiet_hours_start, end: values.quiet_hours_end }
      : null;
  }
  if (Object.keys(settings).length > 0) body.settings = settings;
  return body;
}

function formDetail(detail: ErrorDetail): ErrorDetail {
  const path = detail.path.replace(/^settings\./, '');
  if (path === 'short_outage_threshold_s') {
    return {
      ...detail,
      path: 'short_outage_threshold_min',
      ...(detail.min === undefined ? {} : { min: Math.ceil(detail.min / 60) }),
      ...(detail.max === undefined ? {} : { max: Math.floor(detail.max / 60) }),
    };
  }
  if (path === 'quiet_hours.start') return { ...detail, path: 'quiet_hours_start' };
  if (path === 'quiet_hours.end' || path === 'quiet_hours') {
    return { ...detail, path: 'quiet_hours_end' };
  }
  return detail;
}

export function DeviceSettingsForm({ device }: { device: Device }) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(deviceSettingsFormSchema),
    defaultValues: valuesOf(device),
  });
  const [formError, setFormError] = useState<string | null>(null);
  const quietEnabled = useWatch({ control, name: 'quiet_hours_enabled' });
  const mutation = useMutation({
    mutationFn: (body: PatchBody) => patchDevice(api, device.id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.device(device.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      reset(valuesOf(updated));
      toast.success(t('app.settings.saved'));
    },
    onMutate: () => setFormError(null),
    onError: (error) => {
      const mapped =
        isApiError(error, 'validation_error') &&
        applyServerErrors(
          new ApiError({
            status: error.status,
            code: error.code,
            details: error.details.map(formDetail),
          }),
          setError,
          fieldNames,
          t,
        );
      if (!mapped) setFormError(errorMessage(t, error));
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {device.settings_sync.pending ? (
        <output className="text-sm text-warning">{t('app.settings.pending')}</output>
      ) : null}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) =>
          mutation.mutate(toPatch(values, dirtyFields as Partial<Record<keyof Values, boolean>>)),
        )}
      >
        <FormAlert message={formError} />
        <TextField
          label={t('app.settings.name')}
          placeholder={t('app.placeholders.deviceName')}
          error={errors.name}
          {...register('name')}
        />
        <TextField
          label={t('app.settings.pingInterval')}
          type="number"
          inputMode="numeric"
          error={errors.ping_interval_s}
          {...register('ping_interval_s', { valueAsNumber: true })}
        />
        <TextField
          label={t('app.settings.offlineTimeout')}
          type="number"
          inputMode="numeric"
          error={errors.offline_timeout_s}
          {...register('offline_timeout_s', { valueAsNumber: true })}
        />
        <TextField
          label={t('app.settings.shortThreshold')}
          type="number"
          inputMode="numeric"
          error={errors.short_outage_threshold_min}
          {...register('short_outage_threshold_min', { valueAsNumber: true })}
        />
        <SwitchField
          control={control}
          name="notify_short_outages"
          label={t('app.settings.notifyShort')}
        />
        <SwitchField
          control={control}
          name="notify_network_outages"
          label={t('app.settings.notifyNetwork')}
        />
        <SwitchField
          control={control}
          name="quiet_hours_enabled"
          label={t('app.settings.quietHours')}
        />
        {quietEnabled ? (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('app.settings.quietStart')}
              type="time"
              error={errors.quiet_hours_start}
              {...register('quiet_hours_start')}
            />
            <TextField
              label={t('app.settings.quietEnd')}
              type="time"
              error={errors.quiet_hours_end}
              {...register('quiet_hours_end')}
            />
          </div>
        ) : null}
        <Button type="submit" className="self-start" disabled={mutation.isPending || !isDirty}>
          {t('app.settings.save')}
        </Button>
      </form>
    </div>
  );
}

type SwitchName = 'notify_short_outages' | 'notify_network_outages' | 'quiet_hours_enabled';

function SwitchField({
  control,
  name,
  label,
}: {
  control: ReturnType<typeof useForm<Values>>['control'];
  name: SwitchName;
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field orientation="horizontal">
          <Switch aria-label={label} checked={field.value} onCheckedChange={field.onChange} />
          <FieldLabel>{label}</FieldLabel>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
