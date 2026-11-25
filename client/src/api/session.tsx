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
import { CloudOff, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiUrl } from '@/lib/config';
import { rememberLanguage } from '@/lib/i18n';
import { safeNext } from '@/lib/safeNext';
import { createApiClient, type ApiClient } from './client.ts';
import { getMe, logout } from './endpoints.ts';
import { queryKeys } from './queries.ts';

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated' | 'unreachable';

export type SessionValue = {
  status: SessionStatus;
  me: Me | null;
  signedIn(session: Session): void;
  signOut(): Promise<void>;
  endSession(): void;
  departed: boolean;
  retryConnection(): void;
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

const startupRetryDelaysMs = [1000, 3000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshWithRetry(api: ApiClient, isActive: () => boolean): Promise<Session | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.refresh();
    } catch (error) {
      const delay = startupRetryDelaysMs[attempt];
      if (delay === undefined || !isActive()) throw error;
      await wait(delay);
    }
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [departed, setDeparted] = useState(false);
  const connection = useRef(0);
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

  const connect = useCallback(() => {
    connection.current += 1;
    const id = connection.current;
    const isActive = () => connection.current === id;
    refreshWithRetry(api, isActive).then(
      (session) => {
        if (!isActive()) return;
        if (session) queryClient.setQueryData(queryKeys.me, session.user);
        setStatus(session ? 'authenticated' : 'anonymous');
      },
      () => {
        if (isActive()) setStatus('unreachable');
      },
    );
  }, [api, queryClient]);

  useEffect(() => {
    connect();
    return () => {
      connection.current += 1;
    };
  }, [connect]);

  const retryConnection = useCallback(() => {
    setStatus('loading');
    connect();
  }, [connect]);

  const signedIn = useCallback(
    (session: Session) => {
      api.setSession(session);
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, session.user);
      setDeparted(false);
      setStatus('authenticated');
    },
    [api, queryClient],
  );

  const endSession = useCallback(() => {
    api.setSession(null);
    queryClient.clear();
    setDeparted(true);
    setStatus('anonymous');
  }, [api, queryClient]);

  const signOut = useCallback(async () => {
    await logout(api).catch(() => {});
    endSession();
  }, [api, endSession]);

  const { data: me } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => getMe(api),
    enabled: status === 'authenticated',
    staleTime: Infinity,
    refetchOnWindowFocus: (query) => (query.state.data?.phone_verified ? false : 'always'),
  });

  const { i18n } = useTranslation();
  const accountLanguage = me?.language;
  useEffect(() => {
    if (!accountLanguage || accountLanguage === i18n.resolvedLanguage) return;
    rememberLanguage(accountLanguage);
    void i18n.changeLanguage(accountLanguage);
  }, [accountLanguage, i18n]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me: status === 'authenticated' ? (me ?? null) : null,
      signedIn,
      signOut,
      endSession,
      departed,
      retryConnection,
      api,
    }),
    [status, me, signedIn, signOut, endSession, departed, retryConnection, api],
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

function SessionUnreachable() {
  const { t } = useTranslation();
  const { retryConnection } = useSession();
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-md flex-col items-center gap-3 p-6 pt-16 text-center"
    >
      <CloudOff aria-hidden="true" className="size-8 text-muted-foreground" />
      <h1 className="font-heading text-xl font-semibold">{t('app.common.unreachableTitle')}</h1>
      <p className="text-muted-foreground">{t('app.common.unreachableBody')}</p>
      <Button onClick={retryConnection}>
        <RotateCw aria-hidden="true" />
        {t('app.common.retry')}
      </Button>
    </div>
  );
}

export function RequireAuth() {
  const { status, departed } = useSession();
  const location = useLocation();
  if (status === 'loading') return <SessionLoading />;
  if (status === 'unreachable') return <SessionUnreachable />;
  if (status === 'anonymous') {
    if (departed) return <Redirect to="/login" />;
    return <Redirect to={loginPath(location.pathname + location.search)} />;
  }
  return <Outlet />;
}

export function RequireAnon() {
  const { status } = useSession();
  const [params] = useSearchParams();
  if (status === 'loading') return <SessionLoading />;
  if (status === 'unreachable') return <SessionUnreachable />;
  if (status === 'authenticated') return <Redirect to={safeNext(params.get('next'))} />;
  return <Outlet />;
}
