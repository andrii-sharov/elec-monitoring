import type { Language } from '@elec/shared';
import type { i18n } from 'i18next';

export type EmailKind = 'verifyEmail' | 'resetPassword' | 'accountExists';

export type RenderedEmail = { subject: string; text: string; html: string };

type Vars = { lang: Language; name: string; link: string };

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

function paragraph(value: string): string {
  return `<p>${escapeHtml(value)}</p>`;
}

function layout(parts: { intro: string; action: string; link: string; notes: string[] }): string {
  const button = `<p><a href="${escapeHtml(parts.link)}" style="display:inline-block;padding:10px 18px;background:#1a73e8;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(parts.action)}</a></p>`;
  const notes = parts.notes.map(paragraph).join('');
  return `<div style="font-family:sans-serif;font-size:15px;color:#202124">${paragraph(parts.intro)}${button}${notes}</div>`;
}

export function renderEmail(i18n: i18n, kind: EmailKind, vars: Vars): RenderedEmail {
  const t = i18n.getFixedT(vars.lang);
  const subject = t(`email.${kind}.subject`);
  const intro = t(`email.${kind}.intro`, { name: vars.name });
  const action = t(`email.${kind}.action`);
  const footer = t('email.footer');
  const notes = kind === 'accountExists' ? [footer] : [t(`email.${kind}.expiry`), footer];
  const text = [intro, '', `${action}:`, vars.link, '', ...notes].join('\n');
  const html = layout({ intro, action, link: vars.link, notes });
  return { subject, text, html };
}
