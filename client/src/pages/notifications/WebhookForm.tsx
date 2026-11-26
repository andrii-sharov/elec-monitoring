import { deliveryEvents } from '@elec/shared';
import { createWebhookSchema, MAX_WEBHOOKS, type Channel } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { createWebhook, patchChannel } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, FieldLegend, FieldSet } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { applyServerErrors } from '@/forms/zodErrors';
import { useChannelRefresh } from './useChannelRefresh';

function isHttps(value: string): boolean {
  return URL.canParse(value) && new URL(value).protocol === 'https:';
}

const formSchema = createWebhookSchema.omit({ type: true }).extend({
  url: createWebhookSchema.shape.url.refine(isHttps, { params: { reason: 'https_url' } }),
});
type Input = z.input<typeof formSchema>;
type Output = z.output<typeof formSchema>;

type Props = {
  channel?: Channel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (channel: Channel, secret: string) => void;
};

function initialValues(channel: Channel | undefined): Input {
  const config = channel && 'url' in channel.config ? channel.config : undefined;
  return {
    name: channel?.name ?? '',
    url: config?.url ?? '',
    events: config?.events ?? [...deliveryEvents],
  };
}

function Fields({ channel, onOpenChange, onCreated }: Omit<Props, 'open'>) {
  const { t } = useTranslation();
  const { api } = useSession();
  const refresh = useChannelRefresh();
  const eventsId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(formSchema),
    defaultValues: initialValues(channel),
  });
  const save = useMutation({
    mutationFn: async (values: Output) => {
      if (channel) {
        await patchChannel(api, channel.id, values);
        return;
      }
      const { secret, ...created } = await createWebhook(api, { type: 'WEBHOOK', ...values });
      onCreated?.(created, secret);
    },
    onSuccess: async () => {
      onOpenChange(false);
      if (channel) toast.success(t('app.notifications.webhook.saved'));
      await refresh();
    },
    onError: (error) => {
      if (isApiError(error, 'url_not_allowed')) {
        setError('url', { type: 'server', message: t('app.errors.url_not_allowed') });
      } else if (!channel && isApiError(error, 'conflict')) {
        setFormError(t('app.notifications.webhook.limit', { max: MAX_WEBHOOKS }));
      } else if (
        !isApiError(error, 'validation_error') ||
        !applyServerErrors(error, setError, ['name', 'url', 'events'], t)
      ) {
        setFormError(errorMessage(t, error));
      }
    },
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((values) => {
        setFormError(null);
        save.mutate(values);
      })}
    >
      <FormAlert message={formError} />
      <TextField
        label={t('app.notifications.name')}
        maxLength={64}
        autoComplete="off"
        error={errors.name}
        {...register('name')}
      />
      <TextField
        label={t('app.notifications.webhook.url')}
        type="url"
        autoComplete="off"
        placeholder="https://example.com/hook"
        error={errors.url}
        {...register('url')}
      />
      <Controller
        control={control}
        name="events"
        render={({ field }) => (
          <FieldSet className="gap-2">
            <FieldLegend variant="label">{t('app.notifications.webhook.events')}</FieldLegend>
            {deliveryEvents.map((event) => (
              <div key={event} className="flex items-center gap-2">
                <Checkbox
                  id={`${eventsId}-${event}`}
                  checked={field.value.includes(event)}
                  onCheckedChange={(checked) =>
                    field.onChange(
                      deliveryEvents.filter((value) =>
                        value === event ? checked : field.value.includes(value),
                      ),
                    )
                  }
                />
                <Label htmlFor={`${eventsId}-${event}`} className="font-mono">
                  {event}
                </Label>
              </div>
            ))}
            {errors.events ? (
              <FieldError>{t('app.notifications.webhook.eventsRequired')}</FieldError>
            ) : null}
          </FieldSet>
        )}
      />
      <Button type="submit" disabled={save.isPending}>
        {channel ? t('app.common.save') : t('app.notifications.webhook.create')}
      </Button>
    </form>
  );
}

export function WebhookForm({ open, ...props }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {props.channel
              ? t('app.notifications.webhook.editTitle')
              : t('app.notifications.webhook.addTitle')}
          </DialogTitle>
        </DialogHeader>
        <Fields {...props} />
      </DialogContent>
    </Dialog>
  );
}
