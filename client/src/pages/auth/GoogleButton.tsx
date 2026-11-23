import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { startGoogle } from '@/lib/google';

export function GoogleButton({ next }: { next?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Separator className="flex-1" />
        {t('app.auth.or')}
        <Separator className="flex-1" />
      </div>
      <Button type="button" variant="outline" onClick={() => startGoogle('LOGIN', next)}>
        {t('app.auth.continueWithGoogle')}
      </Button>
    </>
  );
}
