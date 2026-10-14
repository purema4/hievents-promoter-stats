import type { Context } from 'hono';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cssVersion } from './views';

const types: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webmanifest: 'application/manifest+json',
};

// The few files in public/ are read once at startup; only names found there can be served.
const dir = join(import.meta.dir, '..', 'public');
const files = new Map(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name))]));

// Changes with every release, so installed apps drop their old cached files.
const version = new Bun.CryptoHasher('sha256')
  .update(cssVersion)
  .update(Buffer.concat([...files.values()]))
  .digest('hex')
  .slice(0, 10);

export function publicText(name: string): string {
  return files.get(name)!.toString();
}

export function publicAsset(c: Context, name: string) {
  const file = files.get(name);
  if (!file || name === 'sw.js') return c.notFound();
  c.header('Content-Type', types[name.split('.').pop()!] ?? 'application/octet-stream');
  c.header('Cache-Control', name.endsWith('.png') || name.endsWith('.svg') ? 'public, max-age=86400' : 'no-cache');
  return c.body(file);
}

export function serviceWorker(c: Context) {
  const source = files
    .get('sw.js')!
    .toString()
    .replaceAll('__VERSION__', version)
    .replaceAll('__CSS_VERSION__', cssVersion);
  c.header('Content-Type', types.js);
  c.header('Cache-Control', 'no-cache');
  return c.body(source);
}
