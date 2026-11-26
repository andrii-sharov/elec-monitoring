import type { Channel } from '@elec/shared/api';
import type { ChannelType } from '@elec/shared';
import { Send, Webhook, type LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';

type ChannelTypeInfo = {
  icon: LucideIcon;
  available: boolean;
  summary: (channel: Channel, t: TFunction) => string | null;
};

export const channelTypeInfo: Record<ChannelType, ChannelTypeInfo> = {
  TELEGRAM_PLATFORM: {
    icon: Send,
    available: true,
    summary: (channel, t) =>
      channel.config.chat_id ? t('app.notifications.chatId', { id: channel.config.chat_id }) : null,
  },
  WEBHOOK: { icon: Webhook, available: false, summary: () => null },
};

export const addableTypes: ChannelType[] = ['TELEGRAM_PLATFORM', 'WEBHOOK'];
