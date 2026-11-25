import { languageSchema } from '@elec/shared/api';
import type { i18n } from 'i18next';
import { sendInBackground } from '../../email/sender.ts';
import { renderEmail, type EmailKind } from '../../email/templates.ts';
import type { AppDeps } from '../app.ts';

type Recipient = { email: string | null; name: string; language: string };

export function authEmails(deps: Pick<AppDeps, 'email' | 'logger' | 'config'>, i18n: i18n) {
  function send(kind: EmailKind, user: Recipient, path: string) {
    if (!user.email) return;
    const lang = languageSchema.catch('uk').parse(user.language);
    const link = `${deps.config.urls.client}${path}`;
    const rendered = renderEmail(i18n, kind, { lang, name: user.name, link });
    sendInBackground(deps.email, deps.logger, { to: user.email, ...rendered });
  }
  return {
    verifyEmail: (user: Recipient, token: string) =>
      send('verifyEmail', user, `/verify-email?token=${token}`),
    resetPassword: (user: Recipient, token: string) =>
      send('resetPassword', user, `/reset-password?token=${token}`),
    accountExists: (user: Recipient) => send('accountExists', user, '/login'),
  };
}
