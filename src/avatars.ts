import { maxUploadBytes, processImage, type ImageProblem } from './images';
import { deleteFile, deliver, fileKnown, getFile, moveToBucket, newKey, putFile, storageKind, type Delivery } from './storage';
import { addColumn, db, findUser, type User } from './local-db';

/*
 * Profile photos. A photo the promoter uploads, or an admin sets for them, always wins. Otherwise it is
 * taken from their Instagram: Instagram has no API for this, so the server reads the public profile page once, keeps
 * a copy, and looks again weekly. Instagram can refuse at any time; then the initials show instead.
 */
addColumn('users', 'avatar_type', 'TEXT'); // image/png, image/jpeg or image/webp when a photo is stored
addColumn('users', 'avatar_source', 'TEXT'); // 'upload', 'admin' (set by an admin) or 'instagram'
addColumn('users', 'avatar_for', 'TEXT'); // the Instagram handle the stored photo came from
addColumn('users', 'avatar_checked_at', 'INTEGER');
// Where the photo is stored (src/storage.ts); NULL for photos saved before keys, kept on disk as avatars/<id>.
addColumn('users', 'avatar_key', 'TEXT');

const keyOf = (user: User) => user.avatar_key ?? `avatars/${user.id}`;
const WEEK = 7 * 24 * 3600;

export type AvatarInfo = { userId: number; version: number } | null;

export function avatarOf(user: User): AvatarInfo {
  return user.avatar_type && fileKnown(keyOf(user)) ? { userId: user.id, version: user.avatar_checked_at ?? 0 } : null;
}

/** The photo to send (or the CDN address to send the browser to). Callers check who may see it first. */
export async function deliverAvatar(userId: number): Promise<Delivery | null> {
  const user = findUser(userId);
  return user?.avatar_type ? deliver(keyOf(user), user.avatar_type) : null;
}

type Source = 'upload' | 'admin' | 'instagram';
/** A photo chosen by a person (the promoter or an admin): Instagram does not replace it. */
const chosen = (source: string | null | undefined) => source === 'upload' || source === 'admin';

// Each photo gets a new key, so a CDN or browser never shows an old one; the previous file is then removed.
async function store(userId: number, bytes: Uint8Array, type: string, source: Source, handle: string | null) {
  const before = findUser(userId);
  const key = newKey(`avatars/${userId}`, type);
  await putFile(key, bytes, type);
  db.query('UPDATE users SET avatar_type = ?, avatar_source = ?, avatar_for = ?, avatar_checked_at = ?, avatar_key = ? WHERE id = ?').run(
    type,
    source,
    handle,
    Math.floor(Date.now() / 1000),
    key,
    userId,
  );
  if (before?.avatar_type) await deleteFile(keyOf(before));
}

async function clear(userId: number) {
  const before = findUser(userId);
  if (before?.avatar_type || before?.avatar_key) await deleteFile(keyOf(before));
  db.query('UPDATE users SET avatar_type = NULL, avatar_source = NULL, avatar_for = NULL, avatar_key = NULL WHERE id = ?').run(userId);
}

/** Once, at startup: shrinks the photos stored before uploads were shrunk. How many were shrunk. */
export async function shrinkStoredAvatars(): Promise<number> {
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  if (db.query("SELECT 1 FROM settings WHERE key = 'photosShrunk'").get()) return 0;
  let shrunk = 0;
  for (const user of db.query<User, []>('SELECT * FROM users WHERE avatar_type IS NOT NULL').all()) {
    const bytes = await getFile(keyOf(user));
    const image = bytes ? await processImage(bytes, 'photo') : null;
    // A photo that cannot be read is left as it is.
    if (!image || typeof image === 'string') continue;
    await store(user.id, image.bytes, image.type, user.avatar_source ?? 'upload', user.avatar_for ?? null);
    shrunk++;
  }
  db.query("INSERT INTO settings (key, value) VALUES ('photosShrunk', ?)").run(new Date().toISOString());
  return shrunk;
}

/** With S3 set up: moves the photos still on disk to the bucket (at startup). */
export async function moveAvatarsToBucket(): Promise<number> {
  if (storageKind !== 's3') return 0;
  let moved = 0;
  for (const user of db.query<User, []>('SELECT * FROM users WHERE avatar_type IS NOT NULL').all()) {
    const key = newKey(`avatars/${user.id}`, user.avatar_type!);
    if (await moveToBucket(keyOf(user), key, user.avatar_type!)) {
      db.query('UPDATE users SET avatar_key = ? WHERE id = ?').run(key, user.id);
      moved++;
    }
  }
  return moved;
}

/** Stores a photo uploaded by the promoter, or by an admin for them, once checked and shrunk (src/images.ts). */
export async function saveUploadedAvatar(userId: number, bytes: Uint8Array, source: 'upload' | 'admin' = 'upload'): Promise<'ok' | ImageProblem> {
  const image = await processImage(bytes, 'photo');
  if (typeof image === 'string') return image;
  await store(userId, image.bytes, image.type, source, null);
  return 'ok';
}

/** Drops an uploaded photo and goes back to the Instagram one, if any. */
export async function useInstagramAvatar(user: User) {
  await clear(user.id);
  await refreshInstagramAvatar({ ...user, avatar_source: null, avatar_for: null }, true);
}

const handleOf = (instagram: string | null | undefined) => (instagram ?? '').replace(/^@/, '').trim().toLowerCase();

export async function refreshInstagramAvatar(user: User, force = false) {
  if (chosen(user.avatar_source)) return;
  const handle = handleOf(user.instagram);
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    if (user.avatar_source === 'instagram') await clear(user.id);
    return;
  }
  const fresh = user.avatar_for === handle && (user.avatar_checked_at ?? 0) > Date.now() / 1000 - WEEK;
  if (fresh && !force) return;
  db.query('UPDATE users SET avatar_checked_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), user.id);
  const photo = await fetchInstagramPhoto(handle);
  if (photo) await store(user.id, photo.bytes, photo.type, 'instagram', handle);
  // A changed handle whose photo cannot be fetched should not keep showing the old person's photo.
  else if (user.avatar_for && user.avatar_for !== handle) await clear(user.id);
}

async function fetchInstagramPhoto(handle: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    // No redirects: a redirect (to a login page, or anywhere else) means no photo.
    const page = await fetch(`https://www.instagram.com/${handle}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
    });
    if (!page.ok) return null;
    const html = new TextDecoder().decode((await readCapped(page, 2_000_000)) ?? new Uint8Array());
    const match = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (!match) return null;
    const url = new URL(match[1].replaceAll('&amp;', '&'));
    // Only Instagram's own image hosts, over https.
    if (url.protocol !== 'https:' || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return null;
    const image = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'manual' });
    if (!image.ok) return null;
    // Stops reading past the size limit instead of loading a huge answer into memory.
    const bytes = await readCapped(image, maxUploadBytes);
    const clean = bytes ? await processImage(bytes, 'photo') : null;
    return clean && typeof clean !== 'string' ? { bytes: clean.bytes, type: clean.type } : null;
  } catch {
    return null;
  }
}

/** The body, or null once it grows past `max` bytes (the rest is not read). */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel();
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.byteLength;
    if (size > max) return null; // leaving the loop cancels the download
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Weekly refresh for everyone who uses their Instagram photo. */
export async function refreshAllAvatars() {
  const users = db.query<User, []>("SELECT * FROM users WHERE instagram IS NOT NULL AND instagram <> '' AND coalesce(avatar_source, '') NOT IN ('upload', 'admin')").all();
  for (const user of users) await refreshInstagramAvatar(user);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
