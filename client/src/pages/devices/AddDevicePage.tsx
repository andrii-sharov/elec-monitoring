import { KeyRound, Radio, Tag } from 'lucide-react';
import { createDeviceBodySchema } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { z } from 'zod';
import { isApiError } from '@/api/errors';
import { createDevice, newPairingCode } from '@/api/endpoints';
import { queryKeys, useDevice } from '@/api/queries';
import { useSession } from '@/api/session';
import { PairingCode } from '@/components/PairingCode';
import { useAppStyle } from '@/appStyles/AppStyleProvider';
import { buttonVariants, Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { useSecondsLeft } from '@/lib/useCountdown';

type Input = z.input<typeof createDeviceBodySchema>;
type Output = z.output<typeof createDeviceBodySchema>;
type Pairing = { deviceId: string; code: string; expiresAt: string };

const pendingPollMs = 3000;

function NameStep({ onCreated }: { onCreated: (pairing: Pairing) => void }) {
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
        code: created.pairing_code,
        expiresAt: created.pairing_code_expires_at,
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

function PairingStep({ initial }: { initial: Pairing }) {
  const { StatusMark } = useAppStyle().slots;
  const { t } = useTranslation();
  const { api } = useSession();
  const [pairing, setPairing] = useState(initial);
  const secondsLeft = useSecondsLeft(pairing.expiresAt);
  const expired = secondsLeft === 0;
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const device = useDevice(pairing.deviceId, {
    refetchInterval: (query) => {
      const { data, status } = query.state;
      const waiting = data ? data.state === 'PENDING' : status !== 'error';
      return !expired && waiting ? pendingPollMs : false;
    },
  });
  const refetchDevice = device.refetch;
  useEffect(() => {
    if (!expired) return;
    void refetchDevice().finally(() => setCheckedFor(pairing.expiresAt));
  }, [expired, pairing.expiresAt, refetchDevice]);
  const checkingExpiry = expired && checkedFor !== pairing.expiresAt;
  const failed = device.isError && !device.data;
  const renew = useMutation({
    mutationFn: () => newPairingCode(api, pairing.deviceId),
    onSuccess: (next) =>
      setPairing({
        deviceId: pairing.deviceId,
        code: next.pairing_code,
        expiresAt: next.pairing_code_expires_at,
      }),
  });

  if (device.data && device.data.state !== 'PENDING') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{t('app.addDevice.doneTitle')}</span>
            <StatusMark state={device.data.state} lastSeenAt={device.data.last_seen_at} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground">{t('app.addDevice.doneBody')}</p>
          <Link to={`/devices/${pairing.deviceId}`} className={buttonVariants()}>
            {t('app.addDevice.open')}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound aria-hidden="true" className="size-4" />
            {t('app.addDevice.codeTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FormAlert message={renew.error ? errorMessage(t, renew.error) : null} />
          {checkingExpiry ? null : (
            <PairingCode
              code={pairing.code}
              expiresAt={pairing.expiresAt}
              onRenew={() => renew.mutate()}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio aria-hidden="true" className="size-4" />
            {t('app.addDevice.stepsTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            <li>
              {t('app.addDevice.stepFlash')}{' '}
              <Link to="/flash" target="_blank" rel="noopener" className="underline">
                {t('app.addDevice.flashLink')}
              </Link>
            </li>
            <li>{t('app.addDevice.stepWifi')}</li>
            <li>{t('app.addDevice.stepWait')}</li>
          </ol>
          <FormAlert message={failed ? errorMessage(t, device.error) : null} />
          {!expired && !failed ? (
            <output className="text-sm text-muted-foreground">{t('app.addDevice.waiting')}</output>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function AddDevicePage() {
  const { t } = useTranslation();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">{t('app.addDevice.title')}</h1>
      {pairing ? <PairingStep initial={pairing} /> : <NameStep onCreated={setPairing} />}
    </div>
  );
}
