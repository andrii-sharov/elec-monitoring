import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { i18n } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AppStyleProvider } from '@/appStyles/AppStyleProvider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

type AppProvidersProps = {
  i18n: i18n;
  queryClient: QueryClient;
  children: ReactNode;
};

export function AppProviders({ i18n, queryClient, children }: AppProvidersProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AppStyleProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </AppStyleProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
