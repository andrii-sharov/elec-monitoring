import { Tag } from 'lucide-react';
import { createDeviceBodySchema } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { isApiError } from '@/api/errors';
import { createDevice } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';
import { useSession } from '@/api/session';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { DeviceSetup, type Pairing } from './DeviceSetup';

type Input = z.input<typeof createDeviceBodySchema>;
type Output = z.output<typeof createDeviceBodySchema>;
type Created = { deviceId: string; pairing: Pairing };

function NameStep({ onCreated }: { onCreated: (created: Created) => void }) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(createDeviceBodySchema),
    defaultValues: { name: '' },
  });
  const mutation = useMutation({
    mutationFn: (body: Output) => createDevice(api, body),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      onCreated({
        deviceId: created.device.id,
        pairing: { code: created.pairing_code, expiresAt: created.pairing_code_expires_at },
      });
    },
  });
  const message = !mutation.error
    ? null
    : isApiError(mutation.error, 'conflict')
      ? t('app.addDevice.limit')
      : errorMessage(t, mutation.error);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
    >
      <FormAlert message={message} />
      <TextField
        label={t('app.addDevice.nameLabel')}
        autoComplete="off"
        error={errors.name}
        {...register('name')}
      />
      <Button type="submit" disabled={mutation.isPending}>
        <Tag aria-hidden="true" />
        {t('app.addDevice.submit')}
      </Button>
    </form>
  );
}

export function AddDevicePage() {
  const { t } = useTranslation();
  const [created, setCreated] = useState<Created | null>(null);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <BackLink to="/devices" label={t('app.device.backToList')} />
      <h1 className="font-heading text-2xl font-semibold">{t('app.addDevice.title')}</h1>
      {created ? (
        <DeviceSetup deviceId={created.deviceId} initial={created.pairing} />
      ) : (
        <NameStep onCreated={setCreated} />
      )}
    </div>
  );
}
