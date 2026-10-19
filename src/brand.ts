import { db } from './local-db';
import { processImage } from './images';
import { deleteFile, deliver, fileKnown, getFile, moveToBucket, newKey, putFile, storageKind, type Delivery } from './storage';

// Branding is set by admins on /admin/branding and stored here, not in the environment.
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

export type Brand = {
  name: string;
  accent: string; // #rrggbb
  loginMessage: string;
  footer: string;
  logoType: string | null; // image/png, image/jpeg or image/webp when a logo is uploaded
  logoKey: string | null; // where it is stored (src/storage.ts)
  updatedAt: string;
};

const defaults: Brand = {
  name: 'Promoter stats',
  accent: '#2f5bea',
  loginMessage: 'Sign in to see the tickets sold with your promo codes, your commission and your rewards.',
  footer: '',
  logoType: null,
  logoKey: null,
  updatedAt: '0',
};

// Logos saved before keys are on disk at brand/logo.
const legacyLogoKey = 'brand/logo';

let cached: Brand | null = null;

export function getBrand(): Brand {
  if (cached) return cached;
  const rows = db.query<{ key: string; value: string }, []>('SELECT key, value FROM settings').all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Record<keyof Brand, string>>;
  cached = {
    name: stored.name || defaults.name,
    accent: stored.accent && isHex(stored.accent) ? stored.accent : defaults.accent,
    loginMessage: stored.loginMessage ?? defaults.loginMessage,
    footer: stored.footer ?? defaults.footer,
    logoType: stored.logoType && fileKnown(stored.logoKey || legacyLogoKey) ? stored.logoType : null,
    logoKey: stored.logoType ? stored.logoKey || legacyLogoKey : null,
    updatedAt: stored.updatedAt ?? defaults.updatedAt,
  };
  return cached;
}

function save(values: Partial<Record<keyof Brand, string | null>>) {
  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      if (value === null) db.query('DELETE FROM settings WHERE key = ?').run(key);
      else db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
    }
    db.query("INSERT INTO settings (key, value) VALUES ('updatedAt', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
      String(Date.now()),
    );
  })();
  cached = null;
}

export function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function updateBrand(input: { name: string; accent: string; loginMessage: string; footer: string }) {
  save({
    name: input.name.trim().slice(0, 40) || defaults.name,
    accent: input.accent.toLowerCase(),
    loginMessage: input.loginMessage.trim().slice(0, 300),
    footer: input.footer.trim().slice(0, 200),
  });
}

// Each logo gets a new key (a CDN never shows an old one); the previous file is then removed.
export async function saveLogo(bytes: Uint8Array, type: string) {
  const before = getBrand().logoKey;
  const key = newKey('brand/logo', type);
  await putFile(key, bytes, type);
  save({ logoType: type, logoKey: key });
  if (before) await deleteFile(before);
}

export async function removeLogo() {
  const before = getBrand().logoKey;
  save({ logoType: null, logoKey: null });
  if (before) await deleteFile(before);
}

/** The logo to send, or the CDN address to send the browser to. */
export async function deliverLogo(): Promise<Delivery | null> {
  const brand = getBrand();
  return brand.logoType && brand.logoKey ? deliver(brand.logoKey, brand.logoType) : null;
}

/** Once, at startup: shrinks a logo stored before uploads were shrunk. True when it was. */
export async function shrinkStoredLogo(): Promise<boolean> {
  if (db.query("SELECT 1 FROM settings WHERE key = 'logoShrunk'").get()) return false;
  const brand = getBrand();
  const bytes = brand.logoKey && brand.logoType ? await getFile(brand.logoKey) : null;
  const image = bytes ? await processImage(bytes, 'logo') : null;
  if (image && typeof image !== 'string') await saveLogo(image.bytes, image.type);
  db.query("INSERT INTO settings (key, value) VALUES ('logoShrunk', ?)").run(new Date().toISOString());
  return !!image && typeof image !== 'string';
}

/** With S3 set up: moves a logo still on disk to the bucket (at startup). */
export async function moveLogoToBucket(): Promise<boolean> {
  const brand = getBrand();
  if (storageKind !== 's3' || !brand.logoType || !brand.logoKey) return false;
  const key = newKey('brand/logo', brand.logoType);
  if (!(await moveToBucket(brand.logoKey, key, brand.logoType))) return false;
  save({ logoKey: key });
  return true;
}

// --- Colour ------------------------------------------------------------------------------------

function toRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const lin = toRgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(hex: string, with_: string, amount: number): string {
  const a = toRgb(hex);
  const b = toRgb(with_);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as [number, number, number]);
}

const surfaces = { light: '#ffffff', dark: '#1c1c1a' };

/** The accent for dark mode: lightened step by step until it reads on the dark surface. */
export function darkAccent(accent: string): string {
  let color = accent;
  for (let step = 0; step < 10 && contrast(color, surfaces.dark) < 4.5; step++) color = mix(color, '#ffffff', 0.12);
  return color;
}

/** White or near-black, whichever reads better on the accent (button labels). */
export function textOn(color: string): string {
  return contrast(color, '#ffffff') >= contrast(color, '#0b0b0a') ? '#ffffff' : '#0b0b0a';
}

export function accentWarnings(accent: string): string[] {
  const warnings: string[] = [];
  if (contrast(accent, surfaces.light) < 3) {
    warnings.push(`It is hard to read on white (contrast ${contrast(accent, surfaces.light).toFixed(1)}:1, aim for 3:1 or more). Pick a darker shade.`);
  }
  if (contrast(accent, textOn(accent)) < 4.5) warnings.push('Button labels on it will be hard to read.');
  return warnings;
}

/** Overrides the default colour tokens; served as /brand.css so the CSP can stay strict. */
export function brandCss(): string {
  const { accent } = getBrand();
  const dark = darkAccent(accent);
  const light = `--accent: ${accent}; --accent-text: ${textOn(accent)}; --chart: ${accent};`;
  const darkTokens = `--accent: ${dark}; --accent-text: ${textOn(dark)}; --chart: ${dark};`;
  // The dark shade is also exposed on its own, for the preview on the branding page.
  return `:root { ${light} --accent-dark: ${dark}; --accent-dark-text: ${textOn(dark)}; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${darkTokens} } }
:root[data-theme="dark"] { ${darkTokens} }
`;
}

export function brandVersion(): string {
  return getBrand().updatedAt;
}
