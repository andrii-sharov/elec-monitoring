import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/queries';

export function useChannelRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.channels }),
      queryClient.invalidateQueries({ queryKey: ['deviceChannels'] }),
    ]);
}
