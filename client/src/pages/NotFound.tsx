import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { buttonVariants } from '@/components/ui/button';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <h1 className="font-heading text-2xl font-semibold">{t('app.notFound.title')}</h1>
      <p className="text-muted-foreground">{t('app.notFound.body')}</p>
      <Link to="/" className={buttonVariants()}>
        {t('app.notFound.home')}
      </Link>
    </main>
  );
}
