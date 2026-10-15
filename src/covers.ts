import { config } from './config';
import { eventCoverPath } from './hievents';

type Cover = { bytes: Uint8Array; type: string };

// A small in-memory cache: covers rarely change and every dashboard shows several. A missing cover
// is only remembered briefly, so one uploaded (or fixed) in Hi.Events shows up within minutes.
const cache = new Map<number, { cover: Cover | null; at: number }>();
const TTL = 60 * 60 * 1000;
const MISS_TTL = 5 * 60 * 1000;
const MAX_ENTRIES = 200;
const MAX_BYTES = 5 * 1024 * 1024;

// Returned when there is no cover or it cannot be fetched, so pages never show a broken image.
export const blankPng = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='),
  (ch) => ch.charCodeAt(0),
);

export async function eventCover(eventId: number): Promise<Cover | null> {
  const hit = cache.get(eventId);
  if (hit && Date.now() - hit.at < (hit.cover ? TTL : MISS_TTL)) return hit.cover;
  const cover = await fetchCover(eventId);
  cache.delete(eventId);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(eventId, { cover, at: Date.now() });
  return cover;
}

async function fetchCover(eventId: number): Promise<Cover | null> {
  if (!config.imageBaseUrl) return null;
  const path = await eventCoverPath(eventId);
  // The path comes from Hi.Events; only plain relative file paths are fetched, always from the configured host.
  if (!path || !/^[A-Za-z0-9_\-./]+$/.test(path) || path.includes('..') || path.startsWith('/')) return null;
  try {
    const res = await fetch(`${config.imageBaseUrl}/${path}`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(png|jpeg|webp|gif|avif)$/.test(type.split(';')[0])) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return null;
    return { bytes, type: type.split(';')[0] };
  } catch {
    return null;
  }
}
