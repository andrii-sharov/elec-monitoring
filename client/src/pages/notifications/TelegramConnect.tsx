import { Send } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { createTelegramLink } from '@/api/endpoints';
import { useChannels } from '@/api/queries';
import { useSession } from '@/api/session';
import { Button, buttonVariants } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { useFormatters } from '@/lib/format';
import { useSecondsLeft } from '@/lib/useCountdown';

const pollIntervalMs = 3000;

type Link = { url: string; groupUrl: string; expiresAt: string; knownIds: string[] };

type LinkPanelProps = { link: Link; onConnected: () => void };

function LinkPanel({ link, onConnected }: LinkPanelProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  const secondsLeft = useSecondsLeft(link.expiresAt);
  const expired = secondsLeft === 0;
  const channels = useChannels({
    refetchInterval: expired ? false : pollIntervalMs,
    refetchOnMount: false,
  });
  const found = channels.data?.items.some((item) => !link.knownIds.includes(item.id)) ?? false;

  useEffect(() => {
    if (found) onConnected();
  }, [found, onConnected]);

  if (expired) {
    return <p className="text-sm text-muted-foreground">{t('app.notifications.expired')}</p>;
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">{t('app.notifications.connectHint')}</p>
      <div className="flex flex-wrap gap-2">
        <a href={link.url} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
          {t('app.notifications.openTelegram')}
        </a>
        <a
          href={link.groupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'outline' })}
        >
          {t('app.notifications.addToGroup')}
        </a>
      </div>
      <p className="text-sm text-muted-foreground">{t('app.notifications.waiting')}</p>
      <p className="text-sm text-muted-foreground">
        {t('app.notifications.expiresIn', { time: format.duration(secondsLeft) })}
      </p>
    </div>
  );
}

export function TelegramConnect() {
  const { t } = useTranslation();
  const { api, me } = useSession();
  const channels = useChannels();
  const [link, setLink] = useState<Link | null>(null);
  const verified = Boolean(me?.email_verified || me?.phone_verified);

  const create = useMutation({
    mutationFn: (knownIds: string[]) =>
      createTelegramLink(api).then((created) => ({
        url: created.url,
        groupUrl: created.group_url,
        expiresAt: created.expires_at,
        knownIds,
      })),
    onSuccess: setLink,
  });

  const onConnected = () => {
    setLink(null);
    toast.success(t('app.notifications.connected'));
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        disabled={!verified || !channels.data || create.isPending}
        onClick={() => create.mutate(channels.data?.items.map((item) => item.id) ?? [])}
      >
        <Send aria-hidden="true" />
        {t('app.notifications.connect')}
      </Button>
      {verified ? null : (
        <p className="text-sm text-muted-foreground">
          {t('app.notifications.connectNeedsVerified')}
        </p>
      )}
      <FormAlert message={create.error ? errorMessage(t, create.error) : null} />
      {link ? <LinkPanel link={link} onConnected={onConnected} /> : null}
    </div>
  );
}
