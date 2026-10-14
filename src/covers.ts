import { config } from './config';
import { eventCoverPath } from './hievents';

type Cover = { bytes: Uint8Array; type: string; at: number };

// A small in-memory cache: covers rarely change and every dashboard shows several.
const cache = new Map<number, Cover | null>();
const TTL = 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const MAX_BYTES = 5 * 1024 * 1024;

// Returned when there is no cover or it cannot be fetched, so pages never show a broken image.
export const blankPng = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='),
  (ch) => ch.charCodeAt(0),
);

export async function eventCover(eventId: number): Promise<Cover | null> {
  const hit = cache.get(eventId);
  if (hit !== undefined && (hit === null || Date.now() - hit.at < TTL)) return hit;
  const cover = await fetchCover(eventId);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(eventId, cover);
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
    return { bytes, type: type.split(';')[0], at: Date.now() };
  } catch {
    return null;
  }
}
