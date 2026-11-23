import type { DeviceListItem } from '@elec/shared/api';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useDevices } from '@/api/queries';
import { useSession } from '@/api/session';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { useFormatters } from '@/lib/format';

function DeviceCard({ device }: { device: DeviceListItem }) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <Link
      to={`/devices/${device.id}`}
      className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Card className="h-full hover:bg-secondary/40">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{device.name}</span>
            <StatusBadge state={device.state} />
            {device.role === 'VIEWER' ? (
              <Badge variant="secondary">{t('app.devices.shared')}</Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span>{t('app.devices.since', { moment: format.since(device.state_since) })}</span>
          <span>
            {device.last_seen_at
              ? t('app.devices.lastSeen', { moment: format.moment(device.last_seen_at) })
              : t('app.devices.never')}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

export function DevicesPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const navigate = useNavigate();
  const devices = useDevices();
  const verified = me?.email_verified ?? false;

  const addButton = (
    <Button disabled={!verified} onClick={() => void navigate('/devices/new')}>
      {t('app.devices.add')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">{t('app.devices.title')}</h1>
        {addButton}
      </div>
      {verified ? null : (
        <p className="text-sm text-muted-foreground">{t('app.devices.addNeedsVerified')}</p>
      )}
      {devices.isPending ? (
        <output aria-label={t('app.common.loading')} className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </output>
      ) : devices.isError ? (
        <div role="alert" className="flex items-center gap-2 text-danger">
          <span>{errorMessage(t, devices.error)}</span>
          <Button variant="outline" size="sm" onClick={() => void devices.refetch()}>
            {t('app.common.retry')}
          </Button>
        </div>
      ) : devices.data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <h2 className="font-heading text-lg font-medium">{t('app.devices.emptyTitle')}</h2>
            <p className="text-muted-foreground">{t('app.devices.emptyBody')}</p>
            {addButton}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {devices.data.items.map((device) => (
            <li key={device.id}>
              <DeviceCard device={device} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
