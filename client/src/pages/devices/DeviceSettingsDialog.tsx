import type { Device } from '@elec/shared/api';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DeviceDangerZone } from './DeviceDangerZone';
import { DeviceSettingsForm } from './DeviceSettingsForm';

export function DeviceSettingsDialog({ device }: { device: Device }) {
  const { t } = useTranslation();
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Settings aria-hidden="true" />
            {t('app.settings.title')}
          </Button>
        }
      />
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto p-5 sm:max-w-xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg">{t('app.settings.title')}</DialogTitle>
          <DialogDescription>{device.name}</DialogDescription>
        </DialogHeader>
        <DeviceSettingsForm device={device} />
        <div className="border-t border-border pt-5">
          <DeviceDangerZone deviceId={device.id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
