import type { Channel } from '@elec/shared/api';
import { Ellipsis, KeyRound, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  channel: Channel;
  onRename: () => void;
  onRotate: () => void;
  onRemove: () => void;
};

export function ChannelActionsMenu({ channel, onRename, onRotate, onRemove }: Props) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<'rotate' | 'remove' | null>(null);
  const webhook = channel.type === 'WEBHOOK';
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('app.notifications.moreActions', { name: channel.name })}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={onRename}>
            <Pencil aria-hidden="true" />
            {t('app.notifications.rename')}
          </DropdownMenuItem>
          {webhook ? (
            <DropdownMenuItem onClick={() => setConfirm('rotate')}>
              <KeyRound aria-hidden="true" />
              {t('app.notifications.webhook.rotate')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm('remove')}>
            <Trash2 aria-hidden="true" />
            {t('app.notifications.remove')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm === 'rotate'}
        onOpenChange={(open) => setConfirm(open ? 'rotate' : null)}
        title={t('app.notifications.webhook.rotateTitle')}
        body={t('app.notifications.webhook.rotateBody')}
        confirmLabel={t('app.notifications.webhook.rotate')}
        onConfirm={onRotate}
      />
      <ConfirmDialog
        open={confirm === 'remove'}
        onOpenChange={(open) => setConfirm(open ? 'remove' : null)}
        title={t('app.notifications.removeTitle')}
        body={t('app.notifications.removeBody')}
        confirmLabel={t('app.notifications.remove')}
        destructive
        onConfirm={onRemove}
      />
    </>
  );
}
