import type { Language } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import heroEn from '../../../assets/hero/hero-en.mp4';
import posterEn from '../../../assets/hero/hero-en-poster.webp';
import heroRu from '../../../assets/hero/hero-ru.mp4';
import posterRu from '../../../assets/hero/hero-ru-poster.webp';
import heroUk from '../../../assets/hero/hero-uk.mp4';
import posterUk from '../../../assets/hero/hero-uk-poster.webp';

const media: Record<Language, { video: string; poster: string }> = {
  en: { video: heroEn, poster: posterEn },
  ru: { video: heroRu, poster: posterRu },
  uk: { video: heroUk, poster: posterUk },
};

export function PromoVideo({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const language = (i18n.resolvedLanguage ?? 'uk') as Language;
  const { video, poster } = media[language] ?? media.uk;
  return (
    <figure
      data-motion="enter"
      className={cn(
        'overflow-hidden rounded-2xl border border-border bg-card shadow-sm',
        className,
      )}
    >
      <video
        key={video}
        src={video}
        poster={poster}
        width={1920}
        height={1080}
        autoPlay={!reduceMotion}
        controls={reduceMotion}
        muted
        loop
        playsInline
        preload={reduceMotion ? 'none' : 'auto'}
        aria-label={t('app.promo.label')}
        className="block aspect-video h-auto w-full"
      />
      <figcaption className="px-4 py-3 text-sm text-muted-foreground">
        {t('app.promo.caption')}
      </figcaption>
    </figure>
  );
}
