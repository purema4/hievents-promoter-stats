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
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return null;
    // The type comes from the file itself: Hi.Events' nginx labels PNG and WebP files as text/plain.
    const type = imageType(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null;
  }
}

/** The image type from a file's first bytes, for the formats a browser shows; null for anything else. */
export function imageType(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
}
