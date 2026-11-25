import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button';

type TelegramConfirmProps = { url: string; title: string; hint: string };

export function TelegramConfirm({ url, title, hint }: TelegramConfirmProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
      <a href={url} target="_blank" rel="noreferrer" className={buttonVariants()}>
        {t('app.auth.phone.openTelegram')}
      </a>
    </div>
  );
}
