import { contrast, getBrand, isHex, textOn } from './brand';
import { db, listUsers, type User } from './local-db';
import { deleteFile, deliver, fileKnown, newKey, putFile, type Delivery } from './storage';

/*
 * The list of every promoter's page, /p, like a link-in-bio page for the whole team. Admins arrange it
 * on Promoter pages → Index page: who is on it and in what order, their own links and section titles,
 * the title, the tagline and the background. A promoter who hides their own page leaves it too.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS directory_items (
    id       INTEGER PRIMARY KEY,
    kind     TEXT NOT NULL CHECK (kind IN ('promoter', 'link', 'heading')),
    user_id  INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    title    TEXT NOT NULL DEFAULT '',
    url      TEXT,
    position INTEGER NOT NULL,
    hidden   INTEGER NOT NULL DEFAULT 0
  );
`);

export type Background = 'brand' | 'color' | 'gradient' | 'image';

export type DirectorySettings = {
  title: string;
  tagline: string;
  background: Background;
  color: string; // #rrggbb: the colour, or the top of the gradient
  color2: string; // the bottom of the gradient
  imageKey: string | null;
  imageType: string | null;
  // Whether promoters who get a page are put on the list straight away, or wait for an admin.
  newPromoters: 'show' | 'hide';
  updatedAt: number;
};

const defaults: DirectorySettings = {
  title: 'Promoters',
  tagline: 'Pick your promoter to get your tickets with their code.',
  background: 'brand',
  color: '#1c1c1a',
  color2: '#000000',
  imageKey: null,
  imageType: null,
  newPromoters: 'show',
  updatedAt: 0,
};

const backgrounds: Background[] = ['brand', 'color', 'gradient', 'image'];
let cached: DirectorySettings | null = null;

export function directorySettings(): DirectorySettings {
  if (cached) return cached;
  const row = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'directory'").get();
  let stored: Partial<DirectorySettings> = {};
  try {
    stored = row ? JSON.parse(row.value) : {};
  } catch {}
  const s = { ...defaults, ...stored };
  cached = {
    ...s,
    background: backgrounds.includes(s.background) ? s.background : 'brand',
    color: isHex(s.color) ? s.color : defaults.color,
    color2: isHex(s.color2) ? s.color2 : defaults.color2,
    newPromoters: s.newPromoters === 'hide' ? 'hide' : 'show',
  };
  // An image whose file is gone: back to the brand colour.
  if (cached.background === 'image' && !(cached.imageKey && fileKnown(cached.imageKey))) cached.background = 'brand';
  return cached;
}

function save(values: Partial<DirectorySettings>) {
  const next = { ...directorySettings(), ...values, updatedAt: Date.now() };
  db.query("INSERT INTO settings (key, value) VALUES ('directory', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  cached = null;
}

export function saveDirectorySettings(input: { title: string; tagline: string; background: string; color: string; color2: string; newPromoters: string }): 'ok' | 'bad_color' | 'no_image' {
  if (!isHex(input.color) || !isHex(input.color2)) return 'bad_color';
  const background = backgrounds.includes(input.background as Background) ? (input.background as Background) : 'brand';
  if (background === 'image' && !directorySettings().imageKey) return 'no_image';
  save({
    title: input.title.trim().slice(0, 60) || defaults.title,
    tagline: input.tagline.trim().slice(0, 200),
    background,
    color: input.color.toLowerCase(),
    color2: input.color2.toLowerCase(),
    newPromoters: input.newPromoters === 'hide' ? 'hide' : 'show',
  });
  return 'ok';
}

// Each image gets a new key (a CDN never shows an old one); the previous file is then removed.
export async function saveBackgroundImage(bytes: Uint8Array, type: string) {
  const before = directorySettings().imageKey;
  const key = newKey('directory/background', type);
  await putFile(key, bytes, type);
  save({ imageKey: key, imageType: type, background: 'image' });
  if (before) await deleteFile(before);
}

export async function removeBackgroundImage() {
  const { imageKey, background } = directorySettings();
  save({ imageKey: null, imageType: null, background: background === 'image' ? 'brand' : background });
  if (imageKey) await deleteFile(imageKey);
}

export async function deliverBackgroundImage(): Promise<Delivery | null> {
  const { imageKey, imageType } = directorySettings();
  return imageKey && imageType ? deliver(imageKey, imageType) : null;
}

/** The background as a stylesheet (/directory.css), so the CSP can stay strict. */
export function directoryCss(): string {
  const s = directorySettings();
  // Text on the background (title, tagline, section titles, footer); the rows are cards and keep theirs.
  const text = (color: string) => `.lp-dir .lp-name, .lp-dir .lp-tagline, .lp-dir .lp-section, .lp-dir .lp-footer { color: ${color}; }`;
  if (s.background === 'color') return `.lp-dir .lp-backdrop { background: ${s.color}; }\n${text(textOn(s.color))}\n`;
  if (s.background === 'gradient') {
    // The text sits near the top, but must also read lower down where the section titles are.
    const pick = contrast(s.color, '#ffffff') + contrast(s.color2, '#ffffff') >= contrast(s.color, '#0b0b0a') + contrast(s.color2, '#0b0b0a') ? '#ffffff' : '#0b0b0a';
    return `.lp-dir .lp-backdrop { background: linear-gradient(170deg, ${s.color}, ${s.color2}); }\n${text(pick)}\n`;
  }
  if (s.background === 'image') {
    // Darkened so white text reads on any photo.
    return `.lp-dir .lp-backdrop { background: #000 url("/directory/background?v=${s.updatedAt}") center / cover no-repeat; }
.lp-dir .lp-backdrop::after { display: block; background: linear-gradient(180deg, rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.6)); }
${text('#ffffff')}
`;
  }
  return '';
}

export function directoryVersion(): string {
  return `${directorySettings().updatedAt}-${getBrand().updatedAt}`;
}

// --- What is on it -----------------------------------------------------------------------------

type Row = { id: number; kind: 'promoter' | 'link' | 'heading'; user_id: number | null; title: string; url: string | null; position: number; hidden: number };

export type DirectoryItem =
  | { id: number; kind: 'promoter'; hidden: boolean; user: User }
  | { id: number; kind: 'link'; hidden: boolean; title: string; url: string }
  | { id: number; kind: 'heading'; hidden: boolean; title: string };

/** Promoters who have a page (admins only when they have codes, like on Promoter pages). */
const withPage = (u: User & { codes: string[] }) => !!u.alias && (!u.is_admin || u.codes.length > 0);

const nextPosition = () => (db.query<{ p: number | null }, []>('SELECT max(position) AS p FROM directory_items').get()?.p ?? -1) + 1;

/** Every item in order, promoters with a page who are not on it yet added at the end. */
export function directoryItems(): DirectoryItem[] {
  const users = new Map(listUsers().filter(withPage).map((u) => [u.id, u]));
  const known = new Set(db.query<{ user_id: number }, []>('SELECT user_id FROM directory_items WHERE user_id IS NOT NULL').all().map((r) => r.user_id));
  const missing = [...users.values()].filter((u) => !known.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (missing.length) {
    const hidden = directorySettings().newPromoters === 'hide' ? 1 : 0;
    db.transaction(() => {
      let position = nextPosition();
      for (const u of missing) db.query("INSERT INTO directory_items (kind, user_id, position, hidden) VALUES ('promoter', ?, ?, ?)").run(u.id, position++, hidden);
    })();
  }
  const rows = db.query<Row, []>('SELECT * FROM directory_items ORDER BY position, id').all();
  const items: DirectoryItem[] = [];
  for (const r of rows) {
    if (r.kind === 'promoter') {
      // A promoter without a page any more (no alias, or an admin without codes) stays out of sight.
      const user = users.get(r.user_id!);
      if (user) items.push({ id: r.id, kind: 'promoter', hidden: !!r.hidden, user });
    } else if (r.kind === 'link') items.push({ id: r.id, kind: 'link', hidden: !!r.hidden, title: r.title, url: r.url ?? '' });
    else items.push({ id: r.id, kind: 'heading', hidden: !!r.hidden, title: r.title });
  }
  return items;
}

/** What visitors see: shown items, without promoters whose page is hidden, and no heading with nothing under it. */
export function publicDirectoryItems(): DirectoryItem[] {
  const shown = directoryItems().filter((i) => !i.hidden && (i.kind !== 'promoter' || !i.user.page_hidden_at));
  return shown.filter((item, index) => item.kind !== 'heading' || (shown[index + 1] !== undefined && shown[index + 1]!.kind !== 'heading'));
}

/** https, http, mailto and tel links; a bare address like instagram.com/outkzt gets https://. Null when refused. */
export function parseItemUrl(raw: unknown): string | null {
  let text = String(raw ?? '').trim();
  if (!text || text.length > 2000) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') return url.href;
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.') && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

const cleanTitle = (raw: unknown) => String(raw ?? '').trim().slice(0, 80);

export function addItem(kind: 'link' | 'heading', rawTitle: unknown, rawUrl?: unknown): 'ok' | 'no_title' | 'bad_url' {
  const title = cleanTitle(rawTitle);
  if (!title) return 'no_title';
  const url = kind === 'link' ? parseItemUrl(rawUrl) : null;
  if (kind === 'link' && !url) return 'bad_url';
  db.query('INSERT INTO directory_items (kind, title, url, position) VALUES (?, ?, ?, ?)').run(kind, title, url, nextPosition());
  return 'ok';
}

const findRow = (id: number) => db.query<Row, [number]>('SELECT * FROM directory_items WHERE id = ?').get(id);

export function updateItem(id: number, rawTitle: unknown, rawUrl?: unknown): 'ok' | 'missing' | 'no_title' | 'bad_url' {
  const row = findRow(id);
  if (!row || row.kind === 'promoter') return 'missing';
  const title = cleanTitle(rawTitle);
  if (!title) return 'no_title';
  const url = row.kind === 'link' ? parseItemUrl(rawUrl) : null;
  if (row.kind === 'link' && !url) return 'bad_url';
  db.query('UPDATE directory_items SET title = ?, url = ? WHERE id = ?').run(title, url, id);
  return 'ok';
}

/** Removes a link or a section title; promoters can only be hidden. */
export function removeItem(id: number): boolean {
  return db.query("DELETE FROM directory_items WHERE id = ? AND kind <> 'promoter'").run(id).changes > 0;
}

export function setItemHidden(id: number, hidden: boolean): boolean {
  return db.query('UPDATE directory_items SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id).changes > 0;
}

/** Puts the items in this order; ids it leaves out keep their order, after the others. */
export function reorderItems(ids: number[]) {
  const all = db.query<{ id: number }, []>('SELECT id FROM directory_items ORDER BY position, id').all().map((r) => r.id);
  const exists = new Set(all);
  const listed = [...new Set(ids.filter((id) => exists.has(id)))];
  const rest = all.filter((id) => !listed.includes(id));
  db.transaction(() => {
    [...listed, ...rest].forEach((id, position) => db.query('UPDATE directory_items SET position = ? WHERE id = ?').run(position, id));
  })();
}
