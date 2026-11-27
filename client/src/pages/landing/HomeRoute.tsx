import { Navigate } from 'react-router';
import { useSession } from '@/api/session';
import { LandingPage } from './LandingPage';

export function HomeRoute() {
  const { status } = useSession();
  if (status === 'loading') return null;
  if (status === 'authenticated') return <Navigate to="/devices" replace />;
  return <LandingPage />;
}
