import type { mePatchSchema } from '@elec/shared/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { rememberLanguage } from '@/lib/i18n';
import { patchMe } from './endpoints.ts';
import { queryKeys } from './queries.ts';
import { useSession } from './session.tsx';

type Patch = z.input<typeof mePatchSchema>;

export function useUpdateMe() {
  const { api } = useSession();
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Patch) => patchMe(api, body),
    onSuccess: (me, body) => {
      queryClient.setQueryData(queryKeys.me, me);
      if (body.language !== undefined) {
        rememberLanguage(me.language);
        void i18n.changeLanguage(me.language);
      }
    },
  });
}
