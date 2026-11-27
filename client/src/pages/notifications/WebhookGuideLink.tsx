import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function GuideLink({ newTab = false }: { newTab?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/notifications/webhooks/guide"
      viewTransition={!newTab}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noreferrer' : undefined}
      className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none compact:min-h-0"
    >
      <BookOpen aria-hidden="true" className="size-4" />
      {t('app.webhookGuide.link')}
    </Link>
  );
}
