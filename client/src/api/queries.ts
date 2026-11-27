import type { LocalDate } from '@elec/shared';
import type { Channel, Device, Me, StatsQuery } from '@elec/shared/api';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryKey,
  type UseQueryOptions,
} from '@tanstack/react-query';
import {
  getAllOutages,
  getChannels,
  getDeliveries,
  getDevice,
  getDeviceChannels,
  getDevices,
  getInvitePreview,
  getInvites,
  getMe,
  getMembers,
  getOutages,
  getStats,
  type OutageRange,
} from './endpoints.ts';
import { containsToday, type Range } from '@/lib/period';
import { useSession } from './session.tsx';

export const queryKeys = {
  me: ['me'],
  devices: ['devices'],
  device: (id: string) => ['device', id],
  outages: (id: string) => ['outages', id],
  outageRange: (id: string, from: string, to: string) => ['outages', id, 'range', from, to],
  stats: (id: string, query: StatsQuery, timezone: string) => ['stats', id, timezone, query],
  channels: ['channels'],
  deviceChannels: (id: string) => ['deviceChannels', id],
  deliveries: (id: string) => ['deliveries', id],
  members: (id: string) => ['members', id],
  invites: (id: string) => ['invites', id],
  invitePreview: (token: string) => ['invitePreview', token],
} as const;

export const pollMs = { devices: 30_000, device: 15_000 } as const;

type Overrides<T> = Pick<
  UseQueryOptions<T, Error, T, QueryKey>,
  'refetchInterval' | 'enabled' | 'refetchOnMount'
>;

export function useMe() {
  const { api } = useSession();
  return useQuery<Me>({ queryKey: queryKeys.me, queryFn: () => getMe(api) });
}

export function useDevices() {
  const { api } = useSession();
  return useQuery({
    queryKey: queryKeys.devices,
    queryFn: () => getDevices(api),
    refetchInterval: pollMs.devices,
  });
}

export function useDevice(id: string, overrides: Overrides<Device> = {}) {
  const { api } = useSession();
  return useQuery<Device, Error, Device, QueryKey>({
    queryKey: queryKeys.device(id),
    queryFn: () => getDevice(api, id),
    refetchInterval: pollMs.device,
    ...overrides,
  });
}

export function useOutages(id: string) {
  const { api } = useSession();
  return useInfiniteQuery({
    queryKey: queryKeys.outages(id),
    queryFn: ({ pageParam }) => getOutages(api, id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: pollMs.device,
  });
}

export function useOutageRange(
  id: string,
  range: OutageRange,
  live: boolean,
  chunks: OutageRange[] = [range],
) {
  const { api } = useSession();
  return useQuery({
    queryKey: queryKeys.outageRange(id, range.from, range.to),
    queryFn: async () => {
      const pages = await Promise.all(chunks.map((chunk) => getAllOutages(api, id, chunk)));
      const unique = new Map(pages.flat().map((outage) => [outage.id, outage]));
      return [...unique.values()].toSorted((a, b) => b.started_at.localeCompare(a.started_at));
    },
    placeholderData: keepPreviousData,
    refetchInterval: live ? pollMs.device : false,
  });
}

export function statsQuery(range: Range): StatsQuery {
  const period = range.period.toUpperCase() as StatsQuery['period'];
  return range.period === 'custom'
    ? { period, from: range.from, to: range.to }
    : { period, from: range.from };
}

export function statsPollMs(range: Range, today: LocalDate): number | false {
  return containsToday(range, today) ? pollMs.device : false;
}

export function useDeviceStats(id: string, range: Range, today: LocalDate, timezone: string) {
  const { api } = useSession();
  const query = statsQuery(range);
  return useQuery({
    queryKey: queryKeys.stats(id, query, timezone),
    queryFn: () => getStats(api, id, query),
    placeholderData: keepPreviousData,
    refetchInterval: statsPollMs(range, today),
  });
}

export function useChannels(overrides: Overrides<{ items: Channel[] }> = {}) {
  const { api } = useSession();
  return useQuery<{ items: Channel[] }, Error, { items: Channel[] }, QueryKey>({
    queryKey: queryKeys.channels,
    queryFn: () => getChannels(api),
    ...overrides,
  });
}

export function useDeviceChannels(id: string) {
  const { api } = useSession();
  return useQuery({
    queryKey: queryKeys.deviceChannels(id),
    queryFn: () => getDeviceChannels(api, id),
  });
}

export function useDeliveries(id: string) {
  const { api } = useSession();
  return useInfiniteQuery({
    queryKey: queryKeys.deliveries(id),
    queryFn: ({ pageParam }) => getDeliveries(api, id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 0) > 1 ? false : pollMs.device),
  });
}

export function useMembers(id: string) {
  const { api } = useSession();
  return useQuery({ queryKey: queryKeys.members(id), queryFn: () => getMembers(api, id) });
}

export function useInvites(id: string, { enabled }: { enabled: boolean }) {
  const { api } = useSession();
  return useQuery({
    queryKey: queryKeys.invites(id),
    queryFn: () => getInvites(api, id),
    enabled,
  });
}

export function useInvitePreview(token: string | null) {
  const { api } = useSession();
  return useQuery({
    queryKey: queryKeys.invitePreview(token ?? ''),
    queryFn: () => getInvitePreview(api, token!),
    enabled: token !== null,
  });
}
