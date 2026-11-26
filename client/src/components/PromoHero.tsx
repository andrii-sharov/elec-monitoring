import type { Language } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import heroEn from '../../../assets/hero/hero-en.svg';
import heroRu from '../../../assets/hero/hero-ru.svg';
import heroUk from '../../../assets/hero/hero-uk.svg';

const heroes: Record<Language, string> = { en: heroEn, ru: heroRu, uk: heroUk };

export function PromoHero({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? 'uk') as Language;
  return (
    <img
      src={heroes[language] ?? heroes.uk}
      width={1000}
      height={560}
      alt={t('app.promo.label')}
      className={cn('h-auto w-full max-w-xl', className)}
    />
  );
}
