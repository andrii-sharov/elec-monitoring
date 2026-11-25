import { ArrowLeft } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

type BackLinkProps = { to: string; label: string; preferHistory?: boolean };

export function BackLink({ to, label, preferHistory = false }: BackLinkProps) {
  const navigate = useNavigate();
  const hasHistory = useLocation().key !== 'default';
  const goBack = (event: MouseEvent) => {
    if (!preferHistory || !hasHistory) return;
    event.preventDefault();
    void navigate(-1);
  };
  return (
    <Link
      to={to}
      viewTransition
      onClick={goBack}
      className="inline-flex w-fit items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}
