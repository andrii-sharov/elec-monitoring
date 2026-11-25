import type { Channel, Device, Me } from '@elec/shared/api';
import {
  useInfiniteQuery,
  useQuery,
  type QueryKey,
  type UseQueryOptions,
} from '@tanstack/react-query';
import {
  getChannels,
  getDevice,
  getDeviceChannels,
  getDevices,
  getInvitePreview,
  getInvites,
  getMe,
  getMembers,
  getOutages,
} from './endpoints.ts';
import { useSession } from './session.tsx';

export const queryKeys = {
  me: ['me'],
  devices: ['devices'],
  device: (id: string) => ['device', id],
  outages: (id: string) => ['outages', id],
  channels: ['channels'],
  deviceChannels: (id: string) => ['deviceChannels', id],
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
