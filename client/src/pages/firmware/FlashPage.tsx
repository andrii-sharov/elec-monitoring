import { Usb } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiUrl } from '@/lib/config';
import { loadInstallButton } from './loadInstallButton';

function hasWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function FlashPage() {
  const { t } = useTranslation();
  const supported = hasWebSerial();

  useEffect(() => {
    if (supported) void loadInstallButton();
  }, [supported]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold">{t('app.flash.title')}</h1>
      <p className="text-muted-foreground">{t('app.flash.intro')}</p>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Usb aria-hidden="true" className="size-4" />
            {t('app.flash.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            <li>{t('app.flash.stepPlug')}</li>
            <li>{t('app.flash.stepInstall')}</li>
            <li>{t('app.flash.stepWifi')}</li>
          </ol>
          {supported ? (
            <esp-web-install-button manifest={`${apiUrl()}/api/v1/firmware/manifest.json`}>
              <Button slot="activate">{t('app.flash.install')}</Button>
              <span slot="unsupported">{t('app.flash.unsupported')}</span>
              <span slot="not-allowed">{t('app.flash.notAllowed')}</span>
            </esp-web-install-button>
          ) : (
            <output className="text-sm">{t('app.flash.unsupported')}</output>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
