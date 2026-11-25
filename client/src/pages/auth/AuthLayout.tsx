import { Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

type AuthLayoutProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
};

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <span className="flex items-center gap-2 font-heading text-lg font-semibold">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Zap aria-hidden="true" className="size-5" />
        </span>
        Elec
      </span>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="font-heading text-xl font-semibold">{title}</h1>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
      {footer ? <div className="text-sm text-muted-foreground">{footer}</div> : null}
    </main>
  );
}
