import type { Channel } from '@elec/shared/api';

export const statuses = ['all', 'active', 'off', 'failing'] as const;
export const sorts = ['name', 'newest', 'devices'] as const;

export type ChannelStatus = Exclude<(typeof statuses)[number], 'all'>;

export type ChannelFilters = {
  query: string;
  type: string;
  device: string;
  status: (typeof statuses)[number];
  sort: (typeof sorts)[number];
};

export function channelStatus(channel: Channel): ChannelStatus {
  if (channel.enabled) return 'active';
  return channel.disabled_reason === 'TOO_MANY_FAILURES' ? 'failing' : 'off';
}

export function filterChannels(channels: Channel[], filters: ChannelFilters): Channel[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const matching = channels.filter(
    (channel) =>
      (!query || channel.name.toLocaleLowerCase().includes(query)) &&
      (filters.type === 'all' || channel.type === filters.type) &&
      (filters.device === 'all' || channel.device_ids.includes(filters.device)) &&
      (filters.status === 'all' || channelStatus(channel) === filters.status),
  );
  return matching.toSorted((a, b) => {
    if (filters.sort === 'newest') return b.created_at.localeCompare(a.created_at);
    if (filters.sort === 'devices') {
      return b.device_ids.length - a.device_ids.length || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
}

export function readFilters(params: URLSearchParams): ChannelFilters {
  return {
    query: params.get('q') ?? '',
    type: params.get('type') ?? 'all',
    device: params.get('device') ?? 'all',
    status: statuses.find((value) => value === params.get('status')) ?? 'all',
    sort: sorts.find((value) => value === params.get('sort')) ?? 'name',
  };
}

const defaults: Record<string, string> = {
  q: '',
  type: 'all',
  device: 'all',
  status: 'all',
  sort: 'name',
};

export function filterParams(changes: Partial<Record<keyof typeof defaults, string>>) {
  return Object.fromEntries(
    Object.entries(changes).map(([key, value]) => [
      key,
      value === defaults[key] ? null : (value ?? null),
    ]),
  );
}
