import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PromoVideo } from '@/components/PromoVideo';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { useMediaQuery } from '@/lib/useMediaQuery';

type AuthLayoutProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
};

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 64rem)');
  return (
    <main className="flex min-h-svh items-center justify-center gap-12 p-6">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <span className="flex items-center gap-2 font-heading text-lg font-semibold">
          <BrandMark className="size-9" />
          {t('common.appName')}
        </span>
        <Card className="w-full">
          <CardHeader>
            <h1 className="font-heading text-xl font-semibold">{title}</h1>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
        </Card>
        {footer ? <div className="text-sm text-muted-foreground">{footer}</div> : null}
      </div>
      {wide ? <PromoVideo className="w-full max-w-2xl" /> : null}
    </main>
  );
}
