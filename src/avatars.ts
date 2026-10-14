import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sniffImage } from './brand';
import { config } from './config';
import { addColumn, db, findUser, type User } from './local-db';

/*
 * Profile photos. A photo the promoter uploads always wins. Otherwise it is taken from their
 * Instagram: Instagram has no API for this, so the server reads the public profile page once, keeps
 * a copy, and looks again weekly. Instagram can refuse at any time; then the initials show instead.
 */
addColumn('users', 'avatar_type', 'TEXT'); // image/png, image/jpeg or image/webp when a photo is stored
addColumn('users', 'avatar_source', 'TEXT'); // 'upload' or 'instagram'
addColumn('users', 'avatar_for', 'TEXT'); // the Instagram handle the stored photo came from
addColumn('users', 'avatar_checked_at', 'INTEGER');

const dir = join(config.dataDir, 'avatars');
const fileFor = (userId: number) => join(dir, String(userId));
export const maxAvatarBytes = 2 * 1024 * 1024;
const WEEK = 7 * 24 * 3600;

export type AvatarInfo = { userId: number; version: number } | null;

export function avatarOf(user: User): AvatarInfo {
  return user.avatar_type && existsSync(fileFor(user.id)) ? { userId: user.id, version: user.avatar_checked_at ?? 0 } : null;
}

export function readAvatar(userId: number): { bytes: Buffer; type: string } | null {
  const user = findUser(userId);
  if (!user?.avatar_type || !existsSync(fileFor(userId))) return null;
  return { bytes: readFileSync(fileFor(userId)), type: user.avatar_type };
}

function store(userId: number, bytes: Uint8Array, type: string, source: 'upload' | 'instagram', handle: string | null) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileFor(userId), bytes);
  db.query('UPDATE users SET avatar_type = ?, avatar_source = ?, avatar_for = ?, avatar_checked_at = ? WHERE id = ?').run(
    type,
    source,
    handle,
    Math.floor(Date.now() / 1000),
    userId,
  );
}

function clear(userId: number) {
  rmSync(fileFor(userId), { force: true });
  db.query('UPDATE users SET avatar_type = NULL, avatar_source = NULL, avatar_for = NULL WHERE id = ?').run(userId);
}

export function saveUploadedAvatar(userId: number, bytes: Uint8Array): 'ok' | 'too_big' | 'bad_type' {
  if (bytes.byteLength > maxAvatarBytes) return 'too_big';
  const type = sniffImage(bytes);
  if (!type) return 'bad_type';
  store(userId, bytes, type, 'upload', null);
  return 'ok';
}

/** Drops an uploaded photo and goes back to the Instagram one, if any. */
export async function useInstagramAvatar(user: User) {
  clear(user.id);
  await refreshInstagramAvatar({ ...user, avatar_source: null, avatar_for: null }, true);
}

const handleOf = (instagram: string | null | undefined) => (instagram ?? '').replace(/^@/, '').trim().toLowerCase();

export async function refreshInstagramAvatar(user: User, force = false) {
  if (user.avatar_source === 'upload') return;
  const handle = handleOf(user.instagram);
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    if (user.avatar_source === 'instagram') clear(user.id);
    return;
  }
  const fresh = user.avatar_for === handle && (user.avatar_checked_at ?? 0) > Date.now() / 1000 - WEEK;
  if (fresh && !force) return;
  db.query('UPDATE users SET avatar_checked_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), user.id);
  const photo = await fetchInstagramPhoto(handle);
  if (photo) store(user.id, photo.bytes, photo.type, 'instagram', handle);
  // A changed handle whose photo cannot be fetched should not keep showing the old person's photo.
  else if (user.avatar_for && user.avatar_for !== handle) clear(user.id);
}

async function fetchInstagramPhoto(handle: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const page = await fetch(`https://www.instagram.com/${handle}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
      signal: AbortSignal.timeout(8000),
    });
    if (!page.ok) return null;
    const html = (await page.text()).slice(0, 2_000_000);
    const match = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (!match) return null;
    const url = new URL(match[1].replaceAll('&amp;', '&'));
    // Only Instagram's own image hosts, over https.
    if (url.protocol !== 'https:' || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return null;
    const image = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!image.ok) return null;
    const bytes = new Uint8Array(await image.arrayBuffer());
    const type = bytes.byteLength <= maxAvatarBytes ? sniffImage(bytes) : null;
    return type ? { bytes, type } : null;
  } catch {
    return null;
  }
}

/** Weekly refresh for everyone who uses their Instagram photo. */
export async function refreshAllAvatars() {
  const users = db.query<User, []>("SELECT * FROM users WHERE instagram IS NOT NULL AND instagram <> '' AND coalesce(avatar_source, '') <> 'upload'").all();
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
