import { getBrand, textOn } from './brand';
import { config } from './config';
import { db } from './local-db';
import { lang, t, type Lang } from './i18n';

/*
 * Every email the app sends has a type with editable wording (subject, heading, text, button) and
 * one shared, branded layout. Admins change the wording on /admin/emails; the layout follows the
 * branding (name, logo, accent colour, footer). Wording uses {{placeholders}}.
 */

export type EmailType =
  | 'invite'
  | 'login'
  | 'payout_requested'
  | 'payout_paid'
  | 'payout_declined'
  | 'reward_requested'
  | 'reward_given'
  | 'reward_declined'
  | 'promoter_milestone'
  | 'new_signin';

export type Template = { subject: string; heading: string; body: string; button: string };

type Definition = {
  label: string;
  audience: 'Promoter' | 'Admins';
  placeholders: string[];
  defaults: Template;
  // Promoters' emails also come in French, sent to those whose browser is in French. Admins' are English only.
  defaultsFr?: Template;
  sample: Record<string, string>;
};

const common = ['name', 'brand'];

export const definitions: Record<EmailType, Definition> = {
  invite: {
    label: 'Invitation',
    audience: 'Promoter',
    placeholders: [...common, 'link', 'code', 'expiry'],
    defaults: {
      subject: 'Your access to {{brand}}',
      heading: 'Welcome to the team, {{name}}',
      body: 'You can now follow the tickets sold with your promo codes, your commission and your rewards, live.\n\n**Tip:** open this email on your phone and install the app after signing in, to get a notification for every payout, reward and milestone.',
      button: 'Sign in',
    },
    defaultsFr: {
      subject: 'Ton accès à {{brand}}',
      heading: 'Bienvenue dans l’équipe, {{name}}',
      body: 'Tu peux maintenant suivre en direct les billets vendus avec tes codes promo, ta commission et tes récompenses.\n\n**Astuce :** ouvre ce courriel sur ton téléphone et installe l’app après t’être connecté, pour recevoir une notification à chaque paiement, récompense et étape franchie.',
      button: 'Se connecter',
    },
    sample: { link: '#', code: '482913', expiry: '7 days' },
  },
  login: {
    label: 'Sign-in link',
    audience: 'Promoter',
    placeholders: [...common, 'link', 'code', 'expiry'],
    defaults: {
      subject: '{{brand}} sign-in code: {{code}}',
      heading: 'Sign in to {{brand}}',
      body: 'Here is the sign-in link you asked for. If you did not ask for it, you can ignore this email.',
      button: 'Sign in',
    },
    defaultsFr: {
      subject: 'Code de connexion {{brand}} : {{code}}',
      heading: 'Connecte-toi à {{brand}}',
      body: 'Voici le lien de connexion que tu as demandé. Si tu ne l’as pas demandé, tu peux ignorer ce courriel.',
      button: 'Se connecter',
    },
    sample: { link: '#', code: '482913', expiry: '30 minutes' },
  },
  payout_requested: {
    label: 'Payout requested',
    audience: 'Admins',
    placeholders: [...common, 'promoter', 'amount', 'method', 'details', 'note', 'link'],
    defaults: {
      subject: 'Payout request from {{promoter}}: {{amount}}',
      heading: '{{promoter}} asked for {{amount}}',
      body: '**Pay with:** {{method}}\n**Send to:** {{details}}\n\n{{note}}',
      button: 'Review the request',
    },
    sample: { promoter: 'DJ Max', amount: '$100.00', method: 'Interac e-Transfer', details: 'max@example.com', note: 'Thanks!', link: '#' },
  },
  payout_paid: {
    label: 'Payout sent',
    audience: 'Promoter',
    placeholders: [...common, 'amount', 'method', 'details', 'note', 'link'],
    defaults: {
      subject: 'Your payout of {{amount}} was sent',
      heading: 'Your payout is on its way',
      body: 'We sent you **{{amount}}** by {{method}} {{details}}.\n\n{{note}}\n\nThank you for promoting with us.',
      button: 'See your payouts',
    },
    defaultsFr: {
      subject: 'Ton paiement de {{amount}} a été envoyé',
      heading: 'Ton paiement s’en vient',
      body: 'On t’a envoyé **{{amount}}** par {{method}} {{details}}.\n\n{{note}}\n\nMerci de faire la promotion avec nous.',
      button: 'Voir tes paiements',
    },
    sample: { amount: '$100.00', method: 'Interac e-Transfer', details: 'to max@example.com', note: 'Reference: CA1234', link: '#' },
  },
  payout_declined: {
    label: 'Payout declined',
    audience: 'Promoter',
    placeholders: [...common, 'amount', 'note', 'link'],
    defaults: {
      subject: 'About your payout request of {{amount}}',
      heading: 'Your payout request was declined',
      body: '{{note}}\n\nThe amount is available to request again whenever you are ready.',
      button: 'See your payouts',
    },
    defaultsFr: {
      subject: 'À propos de ta demande de paiement de {{amount}}',
      heading: 'Ta demande de paiement a été refusée',
      body: '{{note}}\n\nTu peux redemander ce montant dès que tu es prêt.',
      button: 'Voir tes paiements',
    },
    sample: { amount: '$100.00', note: 'Please wait until the event is over.', link: '#' },
  },
  reward_requested: {
    label: 'Reward requested',
    audience: 'Admins',
    placeholders: [...common, 'promoter', 'reward', 'details', 'link'],
    defaults: {
      subject: 'Reward request from {{promoter}}',
      heading: '{{promoter}} asked for a reward',
      body: '**Reward:** {{reward}}\n**Details:** {{details}}',
      button: 'Review the request',
    },
    sample: { promoter: 'DJ Max', reward: '1 free ticket for Warehouse Night', details: 'Max +1', link: '#' },
  },
  reward_given: {
    label: 'Reward given',
    audience: 'Promoter',
    placeholders: [...common, 'reward', 'note', 'link'],
    defaults: {
      subject: 'Your reward is on its way: {{reward}}',
      heading: 'Good news, {{name}}',
      body: '**{{reward}}** is yours.\n\n{{note}}',
      button: 'See your rewards',
    },
    defaultsFr: {
      subject: 'Ta récompense s’en vient : {{reward}}',
      heading: 'Bonne nouvelle, {{name}}',
      body: '**{{reward}}** est à toi.\n\n{{note}}',
      button: 'Voir tes récompenses',
    },
    sample: { reward: '1 free ticket for Warehouse Night', note: 'You are on the guest list.', link: '#' },
  },
  reward_declined: {
    label: 'Reward declined',
    audience: 'Promoter',
    placeholders: [...common, 'reward', 'note', 'link'],
    defaults: {
      subject: 'About your reward request',
      heading: 'Your reward request was declined',
      body: 'Your request for **{{reward}}** was declined: {{note}}\n\nYou can request it again.',
      button: 'See your rewards',
    },
    defaultsFr: {
      subject: 'À propos de ta demande de récompense',
      heading: 'Ta demande de récompense a été refusée',
      body: 'Ta demande pour **{{reward}}** a été refusée : {{note}}\n\nTu peux la refaire.',
      button: 'Voir tes récompenses',
    },
    sample: { reward: 'Merch', note: 'That size is out of stock, pick another one.', link: '#' },
  },
  // Sent only to admins who chose email for these alerts on their Notifications page.
  promoter_milestone: {
    label: 'Promoter milestone',
    audience: 'Admins',
    placeholders: [...common, 'promoter', 'milestone', 'details', 'link'],
    defaults: {
      subject: '{{promoter}}: {{milestone}}',
      heading: '{{promoter}}: {{milestone}}',
      body: '{{details}}',
      button: 'See their page',
    },
    sample: { promoter: 'DJ Max', milestone: 'reached Gold', details: '50 tickets sold with their codes.', link: '#' },
  },
  new_signin: {
    label: 'New sign-in',
    audience: 'Admins',
    placeholders: [...common, 'device', 'link'],
    defaults: {
      subject: 'New sign-in to your {{brand}} account',
      heading: 'New sign-in on {{device}}',
      body: 'Your account was just signed in on **{{device}}**.\n\nIf that was you, there is nothing to do. If not, sign that device out under Security and turn on two-step verification.',
      button: 'Open Security',
    },
    sample: { device: 'iPhone · Safari', link: '#' },
  },
};

export const emailTypes = Object.keys(definitions) as EmailType[];

/** The languages an email type is written in: French only for promoters' emails. */
export function languagesOf(type: EmailType): Lang[] {
  return definitions[type].defaultsFr ? ['en', 'fr'] : ['en'];
}

// English wording keeps its original key, so templates saved before French existed still apply.
const keyOf = (type: EmailType, language: Lang) => (language === 'fr' ? `email:${type}:fr` : `email:${type}`);
const defaultsOf = (type: EmailType, language: Lang) => (language === 'fr' && definitions[type].defaultsFr) || definitions[type].defaults;
// Admins' emails have no French: always English.
const usable = (type: EmailType, language: Lang): Lang => (languagesOf(type).includes(language) ? language : 'en');

/** The wording for an email type, in the current language unless one is given. */
export function getTemplate(type: EmailType, language: Lang = lang()): Template {
  const l = usable(type, language);
  const row = db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?').get(keyOf(type, l));
  const saved = row ? (JSON.parse(row.value) as Partial<Template>) : {};
  return { ...defaultsOf(type, l), ...saved };
}

export function isCustomized(type: EmailType, language: Lang = 'en'): boolean {
  return !!db.query('SELECT 1 FROM settings WHERE key = ?').get(keyOf(type, usable(type, language)));
}

export function saveTemplate(type: EmailType, tpl: Template, language: Lang = 'en') {
  const l = usable(type, language);
  const clean: Template = {
    subject: tpl.subject.trim().slice(0, 200) || defaultsOf(type, l).subject,
    heading: tpl.heading.trim().slice(0, 200),
    body: tpl.body.replace(/\r\n/g, '\n').trim().slice(0, 4000),
    button: tpl.button.trim().slice(0, 60),
  };
  db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
    keyOf(type, l),
    JSON.stringify(clean),
  );
}

export function resetTemplate(type: EmailType, language: Lang = 'en') {
  db.query('DELETE FROM settings WHERE key = ?').run(keyOf(type, usable(type, language)));
}

// Reply-To for every email, so promoters' replies reach a real inbox.
export function getReplyTo(): string {
  return db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'email:reply_to'").get()?.value ?? '';
}

export function saveReplyTo(email: string) {
  const value = email.trim().slice(0, 200);
  if (value) db.query("INSERT INTO settings (key, value) VALUES ('email:reply_to', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(value);
  else db.query("DELETE FROM settings WHERE key = 'email:reply_to'").run();
}

// --- Rendering ---------------------------------------------------------------------------------

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}

// The text supports blank lines between paragraphs, single line breaks and **bold**. Values from
// placeholders are escaped, so nothing a promoter types can turn into HTML.
function bodyHtml(body: string, vars: Record<string, string>, accent: string): string {
  const escapedVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)]));
  return escapeHtml(body)
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => escapedVars[key] ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3a3a37">${p
          .replace(/\*\*(.+?)\*\*/g, `<strong style="color:#1b1b1a">$1</strong>`)
          .replace(/\n/g, '<br>')}</p>`,
    )
    .join('')
    .replaceAll('{{accent}}', accent);
}

function bodyText(body: string, vars: Record<string, string>): string {
  return fill(body, vars)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
}

export type Rendered = { subject: string; html: string; text: string };

export function renderEmail(type: EmailType, vars: Record<string, string>, template = getTemplate(type)): Rendered {
  const brand = getBrand();
  const all = { brand: brand.name, ...vars };
  const accent = brand.accent;
  const subject = fill(template.subject, all).replace(/\s+/g, ' ').trim();
  const heading = fill(template.heading, all).trim();
  const link = vars.link && vars.link !== '#' ? vars.link : config.appUrl;
  const logo = brand.logoType
    ? `<img src="${config.appUrl}/brand/logo?v=${brand.updatedAt}" alt="${escapeHtml(brand.name)}" height="36" style="display:block;height:36px;width:auto;border:0">`
    : `<span style="font:700 20px/1.2 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1b1a">${escapeHtml(brand.name)}</span>`;
  const codeBlock = vars.code
    ? `<p style="margin:24px 0 6px;font-size:14px;color:#6b6b66">${t('Using the installed app? Enter this code instead:', 'Tu utilises l’app installée? Entre plutôt ce code :')}</p>
       <p style="margin:0 0 8px;font:700 30px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:6px;color:#1b1b1a">${escapeHtml(vars.code)}</p>`
    : '';
  const expiry = vars.expiry
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#8a8a84">${t(
        `The link and code work once and expire in ${escapeHtml(vars.expiry)}. After that, ask for a new one on the sign-in page.`,
        `Le lien et le code ne servent qu’une fois et expirent dans ${escapeHtml(vars.expiry)}. Ensuite, demandes-en un nouveau sur la page de connexion.`,
      )}</p>`
    : '';
  const button = template.button.trim()
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0"><tr><td style="border-radius:10px;background:${accent}">
         <a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;font:600 16px/1 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${textOn(accent)};text-decoration:none;border-radius:10px">${escapeHtml(fill(template.button, all))}</a>
       </td></tr></table>`
    : '';
  const preheader = bodyText(template.body, all).split('\n')[0]!.slice(0, 140);
  const html = `<!doctype html>
<html lang="${lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f3f0;-webkit-text-size-adjust:100%">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 4px 20px">${logo}</td></tr>
    <tr><td style="background:#ffffff;border-radius:16px;border-top:4px solid ${accent};padding:36px 32px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      ${heading ? `<h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;font-weight:700;color:#1b1b1a">${escapeHtml(heading)}</h1>` : ''}
      ${bodyHtml(template.body, all, accent)}
      ${button}
      ${codeBlock}
      ${expiry}
    </td></tr>
    <tr><td style="padding:20px 8px 0;font:13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#8a8a84;text-align:center">
      ${brand.footer ? `${escapeHtml(brand.footer)}<br>` : ''}
      <a href="${escapeHtml(config.appUrl)}" style="color:#8a8a84">${escapeHtml(config.appUrl.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const text = [
    heading,
    bodyText(template.body, all),
    template.button.trim() ? t(`${fill(template.button, all)}: ${link}`, `${fill(template.button, all)} : ${link}`) : '',
    vars.code ? `${t('Using the installed app? Enter this code instead:', 'Tu utilises l’app installée? Entre plutôt ce code :')} ${vars.code}` : '',
    vars.expiry ? t(`The link and code work once and expire in ${vars.expiry}.`, `Le lien et le code ne servent qu’une fois et expirent dans ${vars.expiry}.`) : '',
    brand.footer,
    config.appUrl,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { subject, html, text };
}

export function sampleVars(type: EmailType, name: string): Record<string, string> {
  return { name, ...definitions[type].sample };
}
