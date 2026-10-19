import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';
import { db } from './local-db';

// Branding is set by admins on /admin/branding and stored here, not in the environment.
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

export type Brand = {
  name: string;
  accent: string; // #rrggbb
  loginMessage: string;
  footer: string;
  logoType: string | null; // image/png, image/jpeg or image/webp when a logo is uploaded
  updatedAt: string;
};

const defaults: Brand = {
  name: 'Promoter stats',
  accent: '#2f5bea',
  loginMessage: 'Sign in to see the tickets sold with your promo codes, your commission and your rewards.',
  footer: '',
  logoType: null,
  updatedAt: '0',
};

const logoDir = join(config.dataDir, 'brand');
const logoPath = join(logoDir, 'logo');

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
    logoType: stored.logoType && existsSync(logoPath) ? stored.logoType : null,
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

// PNG, JPEG or WebP only (an SVG could carry scripts), checked and cleaned by src/images.ts.
export const maxLogoBytes = 1024 * 1024;

export function saveLogo(bytes: Uint8Array, type: string) {
  mkdirSync(logoDir, { recursive: true });
  writeFileSync(logoPath, bytes);
  save({ logoType: type });
}

export function removeLogo() {
  rmSync(logoPath, { force: true });
  save({ logoType: null });
}

export function readLogo(): { bytes: Buffer; type: string } | null {
  const brand = getBrand();
  if (!brand.logoType) return null;
  return { bytes: readFileSync(logoPath), type: brand.logoType };
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
