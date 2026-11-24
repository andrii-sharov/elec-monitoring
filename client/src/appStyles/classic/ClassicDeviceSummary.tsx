import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFormatters } from '@/lib/format';
import { ClassicStatusMark } from './ClassicStatusMark';
import type { DeviceSummaryProps } from '../slots';

export function ClassicDeviceSummary({ device }: DeviceSummaryProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <Link
      to={`/devices/${device.id}`}
      data-app-style-slot="classic"
      className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Card className="h-full hover:bg-secondary/40">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{device.name}</span>
            <ClassicStatusMark state={device.state} />
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
