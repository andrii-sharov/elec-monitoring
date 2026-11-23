import { QueryClient } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from './app/providers.tsx';
import { routes } from './app/router.tsx';
import { createClientI18n, detectLanguage } from './lib/i18n.ts';
import './styles.css';

const i18n = createClientI18n(detectLanguage(localStorage, navigator.languages));

function syncDocument(language: string) {
  document.documentElement.lang = language;
  document.title = i18n.t('common.appName');
}

syncDocument(i18n.language);
i18n.on('languageChanged', syncDocument);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <AppProviders i18n={i18n} queryClient={new QueryClient()}>
      <RouterProvider router={createBrowserRouter(routes)} />
    </AppProviders>
  </StrictMode>,
);
