import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import { avatarBytes, avatarOf } from './avatars';
import { getBrand } from './brand';
import { directorySettings, directoryVersion } from './directory';
import type { User } from './local-db';
import { getFile } from './storage';

/*
 * The picture shown when the index page's link is pasted in a message or a post: the page's background,
 * the logo, and a row of the promoters' photos. No text is drawn (the server has no fonts); the title
 * and description go with it as text.
 */
const WIDTH = 1200;
const HEIGHT = 630;
const AVATAR = 150;
const RING = 8;
const OVERLAP = 22;
const MAX_AVATARS = 7;

const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${body}</svg>`);

async function background(): Promise<Sharp> {
  const s = directorySettings();
  if (s.background === 'image' && s.imageKey) {
    const bytes = await getFile(s.imageKey);
    if (bytes) {
      const photo = await sharp(bytes).resize(WIDTH, HEIGHT, { fit: 'cover' }).toBuffer();
      return sharp(photo).composite([{ input: svg(`<rect width="100%" height="100%" fill="#000" fill-opacity="0.45"/>`) }]);
    }
  }
  if (s.background === 'color') return sharp(svg(`<rect width="100%" height="100%" fill="${s.color}"/>`));
  if (s.background === 'gradient') {
    // About the same angle as the page's 170deg gradient.
    return sharp(
      svg(`<defs><linearGradient id="g" x1="0.4" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${s.color}"/><stop offset="1" stop-color="${s.color2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`),
    );
  }
  // The brand colour glowing from the top, like the page.
  return sharp(
    svg(`<defs><radialGradient id="g" cx="0.5" cy="0" r="0.9"><stop offset="0" stop-color="${getBrand().accent}"/><stop offset="1" stop-color="#121211"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`),
  );
}

const circle = (size: number, fill: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${fill}"/></svg>`);

/** A round photo with a white ring around it. */
async function roundAvatar(bytes: Uint8Array): Promise<Buffer | null> {
  try {
    const photo = await sharp(bytes)
      .resize(AVATAR, AVATAR, { fit: 'cover' })
      .composite([{ input: circle(AVATAR, '#000'), blend: 'dest-in' }])
      .png()
      .toBuffer();
    const size = AVATAR + RING * 2;
    return await sharp(circle(size, '#ffffff'))
      .composite([{ input: photo, left: RING, top: RING }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

async function build(users: User[]): Promise<Uint8Array> {
  const layers: OverlayOptions[] = [];
  const brand = getBrand();
  const logoBytes = brand.logoType && brand.logoKey ? await getFile(brand.logoKey) : null;
  const logo = logoBytes ? await sharp(logoBytes).resize(420, 140, { fit: 'inside', withoutEnlargement: true }).png().toBuffer().catch(() => null) : null;

  const photos: Buffer[] = [];
  for (const user of users) {
    if (photos.length >= MAX_AVATARS) break;
    const bytes = await avatarBytes(user);
    const round = bytes ? await roundAvatar(bytes) : null;
    if (round) photos.push(round);
  }

  const size = AVATAR + RING * 2;
  const rowWidth = photos.length ? photos.length * size - (photos.length - 1) * OVERLAP : 0;
  const logoMeta = logo ? await sharp(logo).metadata() : null;
  // The logo above the photos, both centred; either alone sits in the middle.
  const gap = 56;
  const total = (logoMeta?.height ?? 0) + (logo && photos.length ? gap : 0) + (photos.length ? size : 0);
  let top = Math.round((HEIGHT - total) / 2);
  if (logo && logoMeta) {
    layers.push({ input: logo, left: Math.round((WIDTH - logoMeta.width!) / 2), top });
    top += logoMeta.height! + (photos.length ? gap : 0);
  }
  photos.forEach((photo, i) => layers.push({ input: photo, left: Math.round((WIDTH - rowWidth) / 2 + i * (size - OVERLAP)), top }));

  const out = await (await background()).composite(layers).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return new Uint8Array(out);
}

let cached: { key: string; bytes: Uint8Array } | null = null;

/** Changes when the picture would: the look, the logo, or who is shown first and their photos. */
export function previewVersion(users: User[]): string {
  const faces = users
    .filter((u) => avatarOf(u))
    .slice(0, MAX_AVATARS)
    // Every upload is stored under a new key.
    .map((u) => `${u.id}.${u.avatar_key ?? avatarOf(u)!.version}`)
    .join('-');
  return new Bun.CryptoHasher('sha256').update(`${directoryVersion()}|${faces}`).digest('hex').slice(0, 12);
}

export async function directoryPreview(users: User[]): Promise<Uint8Array> {
  const key = previewVersion(users);
  if (cached?.key === key) return cached.bytes;
  const bytes = await build(users);
  cached = { key, bytes };
  return bytes;
}
