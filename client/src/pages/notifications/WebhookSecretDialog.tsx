import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { GuideLink } from './WebhookGuideLink';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function Secret({ secret, onClose }: { secret: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      toast.error(t('app.notifications.webhook.copyFailed'));
    }
  };
  return (
    <>
      <code className="rounded-lg bg-secondary p-3 font-mono text-sm break-all select-all">
        {secret}
      </code>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => void copy()}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? t('app.notifications.webhook.copied') : t('app.notifications.webhook.copy')}
        </Button>
        <Button onClick={onClose}>{t('app.notifications.webhook.done')}</Button>
      </div>
    </>
  );
}

type Props = { secret: string | null; onClose: () => void };

export function WebhookSecretDialog({ secret, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={secret !== null}
      onOpenChange={(open) => !open && onClose()}
      disablePointerDismissal
    >
      {secret !== null ? (
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('app.notifications.webhook.secretTitle')}</DialogTitle>
            <DialogDescription>{t('app.notifications.webhook.secretOnce')}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('app.notifications.webhook.secretUse')}
          </p>
          <GuideLink newTab />
          <Secret key={secret} secret={secret} onClose={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
