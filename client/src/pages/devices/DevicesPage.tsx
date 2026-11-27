import { Plus, RotateCw, Usb } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useDevices } from '@/api/queries';
import { useSession } from '@/api/session';
import { DeviceCard } from '@/components/device/DeviceCard';
import { PromoHero } from '@/components/PromoHero';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';

export function DevicesPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const navigate = useNavigate();
  const devices = useDevices();
  const verified = Boolean(me?.email_verified || me?.phone_verified);

  const addButton = (
    <Button disabled={!verified} onClick={() => void navigate('/devices/new')}>
      <Plus aria-hidden="true" />
      {t('app.devices.add')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">{t('app.devices.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/flash" viewTransition className={buttonVariants({ variant: 'outline' })}>
            <Usb aria-hidden="true" />
            {t('app.flash.title')}
          </Link>
          {addButton}
        </div>
      </div>
      {verified ? null : (
        <p className="text-sm text-muted-foreground">{t('app.devices.addNeedsVerified')}</p>
      )}
      {devices.isPending ? (
        <output
          aria-label={t('app.common.loading')}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </output>
      ) : devices.isError && !devices.data ? (
        <div role="alert" className="flex items-center gap-2 text-danger">
          <span>{errorMessage(t, devices.error)}</span>
          <Button variant="outline" size="sm" onClick={() => void devices.refetch()}>
            <RotateCw aria-hidden="true" />
            {t('app.common.retry')}
          </Button>
        </div>
      ) : devices.data.items.length === 0 ? (
        <Card data-motion="enter">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <PromoHero />
            <h2 className="font-heading text-lg font-medium">{t('app.devices.emptyTitle')}</h2>
            <p className="text-muted-foreground">{t('app.devices.emptyBody')}</p>
            {addButton}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {devices.data.items.map((device, index) => (
            <li key={device.id} data-motion="enter" style={{ '--i': index } as CSSProperties}>
              <DeviceCard device={device} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
