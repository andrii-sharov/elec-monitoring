import { Navigate, Outlet, useLocation } from 'react-router';
import { hasStoredAppStyle } from '@/appStyles/registry';

export function RequireAppearance() {
  const location = useLocation();
  if (hasStoredAppStyle()) return <Outlet />;
  const next = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/welcome/appearance?next=${next}`} replace />;
}
