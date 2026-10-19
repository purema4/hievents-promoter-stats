import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The app icons (public/, built by dev/build-icons.ts) are linked with a hash of their content, so a new
// icon is a new address: browsers and installed apps fetch it instead of keeping the old one.
const dir = join(import.meta.dir, '..', 'public');
const icons = readdirSync(dir)
  .filter((name) => /^(icon|badge)[\w.-]*\.(png|svg)$/.test(name))
  .sort()
  .map((name) => readFileSync(join(dir, name)));
export const iconVersion = new Bun.CryptoHasher('sha256').update(Buffer.concat(icons)).digest('hex').slice(0, 10);

/** "/icon-192.png?v=…" */
export const iconUrl = (name: string) => `/${name}?v=${iconVersion}`;
