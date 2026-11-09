import type { Context } from 'hono';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The map's library (Leaflet and its heat layer), served from the app like everything else: the CSP
// allows no scripts from elsewhere. Linked with a hash of their content, so kept for good.
// leaflet.heat only exports its ES module: its plain-script build (L.heatLayer on Leaflet's global L) is
// found next to it, in dist/.
const heatDir = join(dirname(Bun.resolveSync('leaflet.heat', import.meta.dir)), '..', 'dist');
const vendorFiles: Record<string, string> = {
  'leaflet.js': Bun.resolveSync('leaflet/dist/leaflet.js', import.meta.dir),
  'leaflet.css': Bun.resolveSync('leaflet/dist/leaflet.css', import.meta.dir),
  'leaflet-heat.js': join(heatDir, 'leaflet-heat-global.js'),
};
const vendor = new Map(Object.entries(vendorFiles).map(([name, path]) => [name, readFileSync(path)]));
export const vendorVersion = new Bun.CryptoHasher('sha256').update(Buffer.concat([...vendor.values()])).digest('hex').slice(0, 10);

export function vendorAsset(c: Context, name: string) {
  const file = vendor.get(name);
  if (!file) return c.notFound();
  c.header('Content-Type', name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(file);
}
