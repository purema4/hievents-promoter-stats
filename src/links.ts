import { config } from './config';
import { addColumn, db, type User } from './local-db';

/*
 * Promoter links to Hi.Events event pages. Hi.Events reads ?promo_code= to apply the code and
 * ?aff= for its affiliate tracking; the aff value is the promoter's alias. The site address and
 * the link format are set by admins on /admin/links.
 */
addColumn('users', 'alias', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_alias ON users (lower(alias))');

export const defaultTemplate = '{event_url}?promo_code={code}&aff={alias}';

const setting = (key: string) => db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?').get(key)?.value;

export function linkSettings(): { baseUrl: string; template: string } {
  return {
    baseUrl: (setting('links:base_url') ?? config.hieventsPublicUrl).replace(/\/$/, ''),
    template: setting('links:template') || defaultTemplate,
  };
}

export function saveLinkSettings(baseUrl: string, template: string) {
  const put = (key: string, value: string) =>
    db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  put('links:base_url', baseUrl.trim().replace(/\/$/, ''));
  put('links:template', template.trim() || defaultTemplate);
}

/** Hi.Events' event slug: Laravel's Str::slug of the title. */
export function slugify(text: string): string {
  // Letters that do not decompose into a base letter plus an accent.
  const ascii: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', þ: 'th' };
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/@/g, ' at ')
    .toLowerCase()
    .replace(/[ßæœøłđþ]/g, (ch) => ascii[ch]!)
    // Like Str::slug: dashes, underscores and spaces separate words; other punctuation is removed ("d'été" → "dete").
    .replace(/[\s_\u2010-\u2015-]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function eventLink(event: { id: number; title: string }, code: string, alias: string | null | undefined): string | null {
  const { baseUrl, template } = linkSettings();
  if (!baseUrl) return null;
  const eventUrl = `${baseUrl}/event/${event.id}/${slugify(event.title) || 'event'}`;
  let link = template
    .replaceAll('{event_url}', eventUrl)
    .replaceAll('{code}', encodeURIComponent(code))
    .replaceAll('{alias}', encodeURIComponent(alias ?? ''));
  // A template written with a second "?" (…?promo_code=X?aff=Y) still produces a valid address.
  const [head, ...rest] = link.split('?');
  if (rest.length > 1) link = `${head}?${rest.join('&')}`;
  // Without an alias, drop an empty aff= rather than sending it.
  // Keeps the "?" when aff= came first (…?aff=&promo_code=X → …?promo_code=X).
  return link.replace(/([?&])aff=(&|$)/, (_, sep: string, next: string) => (next ? sep : '')).replace(/\?&/, '?');
}

export const aliasPattern = /^[a-z0-9][a-z0-9_-]{1,29}$/;

export function aliasTaken(alias: string, exceptUserId: number): boolean {
  return !!db.query('SELECT 1 FROM users WHERE lower(alias) = lower(?) AND id <> ?').get(alias, exceptUserId);
}

export function setAlias(userId: number, alias: string) {
  db.query('UPDATE users SET alias = ? WHERE id = ?').run(alias.toLowerCase(), userId);
}

/** A free alias made from the name: "DJ Max" → "dj-max", then "dj-max-2"… */
export function suggestAlias(name: string, userId: number): string {
  const base = (slugify(name) || 'promoter').slice(0, 24).replace(/-+$/, '') || 'promoter';
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? (base.length >= 2 ? base : `${base}-1`) : `${base}-${n}`;
    if (!aliasTaken(candidate, userId)) return candidate;
  }
  return `promoter-${userId}`;
}

// Everyone gets an alias, so every link carries aff=.
export function ensureAliases() {
  const missing = db.query<User, []>("SELECT * FROM users WHERE alias IS NULL OR alias = ''").all();
  for (const user of missing) setAlias(user.id, suggestAlias(user.name, user.id));
}
