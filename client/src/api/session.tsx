import type { Me, Session } from '@elec/shared/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { apiUrl } from '@/lib/config';
import { safeNext } from '@/lib/safeNext';
import { createApiClient, type ApiClient } from './client.ts';
import { getMe, logout } from './endpoints.ts';
import { queryKeys } from './queries.ts';

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

export type SessionValue = {
  status: SessionStatus;
  me: Me | null;
  signedIn(session: Session): void;
  signOut(): Promise<void>;
  api: ApiClient;
};

const SessionContext = createContext<SessionValue | null>(null);

function Redirect({ to }: { to: string }) {
  const navigate = useNavigate();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}

const sessionLostEvent = 'session-lost';

function loginPath(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [lost, setLost] = useState<{ key: string; from: string } | null>(null);
  const [{ api, events }] = useState(() => {
    const target = new EventTarget();
    const client = createApiClient({
      baseUrl: apiUrl(),
      onSessionLost: () => target.dispatchEvent(new Event(sessionLostEvent)),
    });
    return { api: client, events: target };
  });
  const currentPath = location.pathname + location.search;
  const redirectTo = lost?.key === location.key ? loginPath(lost.from) : null;

  useEffect(() => {
    const onLost = () => {
      setStatus('anonymous');
      setLost({ key: location.key, from: currentPath });
    };
    events.addEventListener(sessionLostEvent, onLost);
    return () => events.removeEventListener(sessionLostEvent, onLost);
  }, [events, location.key, currentPath]);

  useEffect(() => {
    let active = true;
    api.refresh().then(
      (session) => {
        if (!active) return;
        if (session) queryClient.setQueryData(queryKeys.me, session.user);
        setStatus(session ? 'authenticated' : 'anonymous');
      },
      () => {
        if (active) setStatus('anonymous');
      },
    );
    return () => {
      active = false;
    };
  }, [api, queryClient]);

  const signedIn = useCallback(
    (session: Session) => {
      api.setSession(session);
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, session.user);
      setStatus('authenticated');
    },
    [api, queryClient],
  );

  const signOut = useCallback(async () => {
    await logout(api).catch(() => {});
    api.setSession(null);
    queryClient.clear();
    setStatus('anonymous');
  }, [api, queryClient]);

  const { data: me } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => getMe(api),
    enabled: status === 'authenticated',
    staleTime: Infinity,
  });

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me: status === 'authenticated' ? (me ?? null) : null,
      signedIn,
      signOut,
      api,
    }),
    [status, me, signedIn, signOut, api],
  );

  return (
    <SessionContext value={value}>
      {redirectTo === null ? children : <Redirect to={redirectTo} />}
    </SessionContext>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

function SessionLoading() {
  const { t } = useTranslation();
  return (
    <output
      aria-label={t('app.common.loading')}
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6"
    >
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </output>
  );
}

export function RequireAuth() {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return <SessionLoading />;
  if (status === 'anonymous') {
    return <Redirect to={loginPath(location.pathname + location.search)} />;
  }
  return <Outlet />;
}

export function RequireAnon() {
  const { status } = useSession();
  const [params] = useSearchParams();
  if (status === 'loading') return <SessionLoading />;
  if (status === 'authenticated') return <Redirect to={safeNext(params.get('next'))} />;
  return <Outlet />;
}
