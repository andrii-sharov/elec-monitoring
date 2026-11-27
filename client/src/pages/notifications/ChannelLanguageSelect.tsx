import { languages, type Language } from '@elec/shared';
import type { Channel } from '@elec/shared/api';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { patchChannel } from '@/api/endpoints';
import { useSession } from '@/api/session';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/forms/errorMessage';
import { useChannelRefresh } from './useChannelRefresh';

const ACCOUNT = 'account';

export function ChannelLanguageSelect({ channel, id }: { channel: Channel; id: string }) {
  const { t } = useTranslation();
  const { api, me } = useSession();
  const refresh = useChannelRefresh();
  const save = useMutation({
    mutationFn: (language: Language | null) => patchChannel(api, channel.id, { language }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(t, error)),
  });
  const accountLanguage = me ? t(`app.common.languages.${me.language}`) : '';
  const items = [
    {
      value: ACCOUNT,
      label: t('app.notifications.sameAsAccount', { language: accountLanguage }),
    },
    ...languages.map((value) => ({ value, label: t(`app.common.languages.${value}`) })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Label htmlFor={id}>{t('app.notifications.language')}</Label>
      <Select
        items={items}
        value={channel.language ?? ACCOUNT}
        disabled={save.isPending}
        onValueChange={(next) => {
          if (!next) return;
          save.mutate(next === ACCOUNT ? null : (next as Language));
        }}
      >
        <SelectTrigger id={id} className="max-sm:w-full">
          <SelectValue widthOf={items.map((item) => item.label)} />
        </SelectTrigger>
        <SelectContent align="start">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
