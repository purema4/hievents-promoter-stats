import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * public/app.js is linked with its own version (?v=), so a page never runs an older app.js kept by the
 * service worker with newer styles. On its own so views.tsx and static.ts can both use it without a cycle.
 */
export const jsVersion = new Bun.CryptoHasher('sha256')
  .update(readFileSync(join(import.meta.dir, '..', 'public', 'app.js')))
  .digest('hex')
  .slice(0, 10);
