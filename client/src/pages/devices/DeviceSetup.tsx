import { KeyRound, Radio, Usb } from 'lucide-react';
import type { Device } from '@elec/shared/api';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { newPairingCode } from '@/api/endpoints';
import { useDevice } from '@/api/queries';
import { useSession } from '@/api/session';
import { StatusMark } from '@/components/device/StatusMark';
import { PairingCode } from '@/components/PairingCode';
import { buttonVariants, Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { useSecondsLeft } from '@/lib/useCountdown';
import { FlashFirmware } from '@/pages/firmware/FlashFirmware';

export type Pairing = { code: string; expiresAt: string };

const pendingPollMs = 3000;

function FlashStep() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="flex flex-col items-start gap-2">
      <span>{t('app.addDevice.stepFlash')}</span>
      <Button
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Usb aria-hidden="true" />
        {t('app.addDevice.flashFirmware')}
      </Button>
      {open ? (
        <div id={panelId} className="w-full rounded-lg border border-border p-3">
          <FlashFirmware withSetupStep={false} />
        </div>
      ) : null}
    </li>
  );
}

function DoneCard({ device }: { device: Device }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{t('app.addDevice.doneTitle')}</span>
          <StatusMark state={device.state} lastSeenAt={device.last_seen_at} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">{t('app.addDevice.doneBody')}</p>
        <Link to={`/devices/${device.id}`} className={buttonVariants()}>
          {t('app.addDevice.open')}
        </Link>
      </CardContent>
    </Card>
  );
}

type DeviceSetupProps = { deviceId: string; initial?: Pairing };

export function DeviceSetup({ deviceId, initial }: DeviceSetupProps) {
  const { t } = useTranslation();
  const { api } = useSession();
  const [pairing, setPairing] = useState<Pairing | null>(initial ?? null);
  const secondsLeft = useSecondsLeft(pairing?.expiresAt ?? null);
  const expired = secondsLeft === 0;
  const waiting = pairing !== null && !expired;
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const device = useDevice(deviceId, {
    refetchInterval: (query) => {
      const { data, status } = query.state;
      const pending = data ? data.state === 'PENDING' : status !== 'error';
      return waiting && pending ? pendingPollMs : false;
    },
  });
  const refetchDevice = device.refetch;
  useEffect(() => {
    if (!expired || !pairing) return;
    void refetchDevice().finally(() => setCheckedFor(pairing.expiresAt));
  }, [expired, pairing, refetchDevice]);
  const checkingExpiry = expired && checkedFor !== pairing?.expiresAt;
  const failed = device.isError && !device.data;
  const renew = useMutation({
    mutationFn: () => newPairingCode(api, deviceId),
    onSuccess: (next) =>
      setPairing({ code: next.pairing_code, expiresAt: next.pairing_code_expires_at }),
  });

  if (device.data && device.data.state !== 'PENDING') return <DoneCard device={device.data} />;

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
          {pairing === null ? (
            <Button className="w-fit" disabled={renew.isPending} onClick={() => renew.mutate()}>
              <KeyRound aria-hidden="true" />
              {t('app.addDevice.getCode')}
            </Button>
          ) : checkingExpiry ? null : (
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
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <FlashStep />
            <li>{t('app.addDevice.stepWifi')}</li>
            <li>{t('app.addDevice.stepWait')}</li>
          </ol>
          <FormAlert message={failed ? errorMessage(t, device.error) : null} />
          {waiting && !failed ? (
            <output className="text-sm text-muted-foreground">{t('app.addDevice.waiting')}</output>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
