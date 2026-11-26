import type { Language } from '@elec/shared';
import type { i18n } from 'i18next';

export type EmailKind = 'verifyEmail' | 'resetPassword' | 'accountExists' | 'webhookDisabled';

export type RenderedEmail = { subject: string; text: string; html: string };

type Vars = { lang: Language; name: string; link: string; channelName?: string };

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

const FONT = "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

const DARK_STYLES = `@media (prefers-color-scheme: dark){.em-page{background:#101d24!important}.em-card{background:#192c36!important;border-color:#405965!important}.em-text{color:#e6f1f5!important}.em-muted{color:#b2c8d1!important}.em-brand{color:#92cbe6!important}.em-button{background:#92cbe6!important}.em-button a{color:#102530!important}.em-link{color:#92cbe6!important}}@media (max-width:620px){.em-card td{padding-left:24px!important;padding-right:24px!important}}`;

type LayoutParts = {
  lang: Language;
  subject: string;
  appName: string;
  intro: string;
  action: string;
  link: string;
  notes: string[];
  linkHint: string;
  footer: string;
};

export function emailLogoUrl(link: string): string {
  return `${new URL(link).origin}/email-logo.png`;
}

function layout(parts: LayoutParts): string {
  const e = escapeHtml;
  const link = e(parts.link);
  const notes = parts.notes.map((note) => `<p style="margin:0 0 12px">${e(note)}</p>`).join('');
  return `<!doctype html><html lang="${parts.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${e(parts.subject)}</title><style>${DARK_STYLES}</style></head><body style="margin:0;padding:0;background:#dbe9ee"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(parts.intro)}</div><table role="presentation" class="em-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#dbe9ee"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px"><tr><td style="padding:0 4px 20px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:12px"><img src="${e(emailLogoUrl(parts.link))}" width="40" height="40" alt="" style="display:block;border:0;border-radius:9px"></td><td class="em-brand" style="${FONT};font-size:17px;font-weight:600;color:#166088">${e(parts.appName)}</td></tr></table></td></tr><tr><td><table role="presentation" class="em-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #b6cbd4;border-radius:16px"><tr><td class="em-text" style="padding:32px 40px 8px;${FONT};font-size:16px;line-height:24px;color:#203844"><p style="margin:0 0 24px">${e(parts.intro)}</p></td></tr><tr><td style="padding:0 40px 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-button" style="background:#166088;border-radius:10px"><a href="${link}" style="display:inline-block;padding:12px 22px;${FONT};font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px">${e(parts.action)}</a></td></tr></table></td></tr><tr><td class="em-muted" style="padding:0 40px 32px;${FONT};font-size:14px;line-height:21px;color:#476471">${notes}<p style="margin:16px 0 0;word-break:break-all">${e(parts.linkHint)}<br><a class="em-link" href="${link}" style="color:#166088">${link}</a></p></td></tr></table></td></tr><tr><td class="em-muted" align="center" style="padding:20px 12px 0;${FONT};font-size:12px;line-height:18px;color:#476471">${e(parts.footer)}</td></tr></table></td></tr></table></body></html>`;
}

export function renderEmail(i18n: i18n, kind: EmailKind, vars: Vars): RenderedEmail {
  const t = i18n.getFixedT(vars.lang);
  const subject = t(`email.${kind}.subject`);
  const intro = t(`email.${kind}.intro`, { name: vars.name, channelName: vars.channelName });
  const action = t(`email.${kind}.action`);
  const footer = t('email.footer');
  const notes =
    kind === 'accountExists' || kind === 'webhookDisabled' ? [] : [t(`email.${kind}.expiry`)];
  const text = [intro, '', `${action}:`, vars.link, '', ...notes, footer].join('\n');
  const html = layout({
    lang: vars.lang,
    subject,
    appName: t('common.appName'),
    intro,
    action,
    link: vars.link,
    notes,
    linkHint: t('email.linkHint'),
    footer,
  });
  return { subject, text, html };
}

export function renderInviteEmail(
  i18n: i18n,
  vars: { lang: Language; inviter: string; device: string; link: string },
): RenderedEmail {
  const t = i18n.getFixedT(vars.lang);
  const names = { inviter: vars.inviter, device: vars.device };
  const subject = t('email.deviceInvite.subject', names);
  const intro = t('email.deviceInvite.intro', names);
  const action = t('email.deviceInvite.action');
  const footer = t('email.footer');
  const notes = [t('email.deviceInvite.expiry')];
  const text = [intro, '', `${action}:`, vars.link, '', ...notes, footer].join('\n');
  const html = layout({
    lang: vars.lang,
    subject,
    appName: t('common.appName'),
    intro,
    action,
    link: vars.link,
    notes,
    linkHint: t('email.linkHint'),
    footer,
  });
  return { subject, text, html };
}
