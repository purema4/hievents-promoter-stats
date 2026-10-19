import type { Context } from 'hono';
import { readFileSync } from 'node:fs';

// The map's library (Leaflet and its heat layer), served from the app like everything else: the CSP
// allows no scripts from elsewhere. Linked with a hash of their content, so kept for good.
const vendorFiles: Record<string, string> = {
  'leaflet.js': 'leaflet/dist/leaflet.js',
  'leaflet.css': 'leaflet/dist/leaflet.css',
  'leaflet-heat.js': 'leaflet.heat/dist/leaflet-heat.js',
};
const vendor = new Map(Object.entries(vendorFiles).map(([name, path]) => [name, readFileSync(Bun.resolveSync(path, import.meta.dir))]));
export const vendorVersion = new Bun.CryptoHasher('sha256').update(Buffer.concat([...vendor.values()])).digest('hex').slice(0, 10);

export function vendorAsset(c: Context, name: string) {
  const file = vendor.get(name);
  if (!file) return c.notFound();
  c.header('Content-Type', name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(file);
}
