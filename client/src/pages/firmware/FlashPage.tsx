import { Usb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/BackLink';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FlashFirmware } from './FlashFirmware';

export function FlashPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <BackLink to="/devices" label={t('app.common.back')} preferHistory />
      <h1 className="font-heading text-2xl font-semibold">{t('app.flash.title')}</h1>
      <p className="text-muted-foreground">{t('app.flash.intro')}</p>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Usb aria-hidden="true" className="size-4" />
            {t('app.flash.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FlashFirmware />
        </CardContent>
      </Card>
    </div>
  );
}
