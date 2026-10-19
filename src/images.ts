/*
 * Every image people upload (profile photos, the logo) or the server fetches (Instagram photos) goes
 * through here before it is stored:
 *  - the type comes from the bytes, never the file name or the browser: PNG, JPEG or WebP only;
 *  - the file is parsed, so a broken or disguised file is refused;
 *  - its size in pixels is limited, so a small file cannot unpack into a huge image in viewers' browsers;
 *  - metadata is removed (EXIF with the phone's GPS position, XMP, comments, text chunks), keeping only a
 *    photo's rotation so phone pictures stay upright;
 *  - anything after the end of the image (a hidden second file) is dropped.
 * Pixels are not re-encoded: the image data is kept as it is.
 */

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';
export type CleanImage = { bytes: Uint8Array; type: ImageType; width: number; height: number };
export type ImageProblem = 'too_big' | 'bad_type' | 'too_many_pixels';

export const maxImageSide = 6000;
export const maxImagePixels = 25_000_000;

/** Checks and cleans an image; the reason when it is refused. */
export function prepareImage(bytes: Uint8Array, maxBytes: number): CleanImage | ImageProblem {
  if (bytes.byteLength > maxBytes) return 'too_big';
  let image: CleanImage | null;
  try {
    image = parse(bytes);
  } catch {
    image = null; // a read past the end: a truncated or malformed file
  }
  if (!image || image.width < 1 || image.height < 1) return 'bad_type';
  if (image.width > maxImageSide || image.height > maxImageSide || image.width * image.height > maxImagePixels) return 'too_many_pixels';
  return image;
}

function parse(bytes: Uint8Array): CleanImage | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return png(bytes);
  if (starts(0xff, 0xd8, 0xff)) return jpeg(bytes);
  if (starts(0x52, 0x49, 0x46, 0x46) && ascii(bytes, 8, 4) === 'WEBP') return webp(bytes);
  return null;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16be = (b: Uint8Array, at: number) => (need(b, at + 2), (b[at]! << 8) | b[at + 1]!);
const u32be = (b: Uint8Array, at: number) => (need(b, at + 4), ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0);
const u24le = (b: Uint8Array, at: number) => (need(b, at + 3), b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16));
const u32le = (b: Uint8Array, at: number) => (need(b, at + 4), (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0);
const u16le = (b: Uint8Array, at: number) => (need(b, at + 2), b[at]! | (b[at + 1]! << 8));

/** Throws when the file ends before `end`: a truncated or malformed image. */
function need(b: Uint8Array, end: number) {
  if (end > b.byteLength) throw new RangeError('truncated');
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

// --- PNG: chunks up to IEND; text, EXIF and time chunks dropped. ---------------------------------

const pngDropped = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function png(b: Uint8Array): CleanImage | null {
  const kept: Uint8Array[] = [b.subarray(0, 8)];
  let at = 8;
  let width = 0;
  let height = 0;
  for (;;) {
    const length = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + length;
    need(b, end);
    if (at === 8) {
      if (type !== 'IHDR' || length !== 13) return null;
      width = u32be(b, at + 8);
      height = u32be(b, at + 12);
    }
    if (!pngDropped.has(type)) kept.push(b.subarray(at, end));
    at = end;
    if (type === 'IEND') break;
  }
  return { bytes: concat(kept), type: 'image/png', width, height };
}

// --- JPEG: segments up to the image data; only JFIF, ICC colour profile and Adobe segments kept, plus
// a new minimal EXIF holding the rotation alone. Cut after the last end-of-image marker. -------------

function jpeg(b: Uint8Array): CleanImage | null {
  const kept: Uint8Array[] = [];
  let at = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;
  let afterApp0 = 0; // where a new EXIF segment goes: after JFIF when there is one
  for (;;) {
    need(b, at + 2);
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at++; // fill byte
      continue;
    }
    if (marker === 0xda) break; // start of scan: the image data follows
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) return null;
    const length = u16be(b, at + 2);
    const end = at + 2 + length;
    if (length < 2) return null;
    need(b, end);
    const segment = b.subarray(at, end);
    // Start of frame (not DHT 0xc4, JPG 0xc8, DAC 0xcc): height then width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = u16be(b, at + 5);
      width = u16be(b, at + 7);
    }
    if (marker === 0xe1 && ascii(b, at + 4, 6) === 'Exif\0\0') orientation = exifOrientation(b.subarray(at + 10, end)) ?? orientation;
    const keep = !(marker >= 0xe0 && marker <= 0xef) || marker === 0xe0 || (marker === 0xe2 && ascii(b, at + 4, 12) === 'ICC_PROFILE\0') || marker === 0xee;
    if (marker !== 0xfe && keep) {
      kept.push(segment);
      if (marker === 0xe0 && kept.length === 1) afterApp0 = 1;
    }
    at = end;
  }
  if (!width || !height) return null;
  // The image data ends at the last end-of-image marker; anything after it is dropped.
  let last = b.byteLength - 2;
  while (last > at && !(b[last] === 0xff && b[last + 1] === 0xd9)) last--;
  if (last <= at) return null;
  if (orientation !== 1) kept.splice(afterApp0, 0, orientationExif(orientation));
  return { bytes: concat([b.subarray(0, 2), ...kept, b.subarray(at, last + 2)]), type: 'image/jpeg', width, height };
}

/** The rotation (EXIF tag 0x0112, 1 to 8) from an EXIF block's TIFF data, if present. */
function exifOrientation(tiff: Uint8Array): number | null {
  try {
    const little = ascii(tiff, 0, 2) === 'II';
    if (!little && ascii(tiff, 0, 2) !== 'MM') return null;
    const u16 = (at: number) => (need(tiff, at + 2), little ? tiff[at]! | (tiff[at + 1]! << 8) : (tiff[at]! << 8) | tiff[at + 1]!);
    const u32 = (at: number) => (need(tiff, at + 4), little ? u32le(tiff, at) : u32be(tiff, at));
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : null;
      }
    }
  } catch {
    // unreadable EXIF: no rotation
  }
  return null;
}

/** A minimal EXIF segment with the rotation and nothing else. */
function orientationExif(orientation: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

// --- WebP: RIFF chunks; EXIF and XMP chunks dropped and their flags cleared. ------------------------

function webp(b: Uint8Array): CleanImage | null {
  const riffEnd = 8 + u32le(b, 4);
  need(b, riffEnd);
  const kept: Uint8Array[] = [];
  let at = 12;
  let width = 0;
  let height = 0;
  while (at < riffEnd) {
    const fourcc = ascii(b, at, 4);
    const size = u32le(b, at + 4);
    const end = at + 8 + size + (size % 2);
    if (end > riffEnd) return null;
    const data = at + 8;
    if (fourcc === 'VP8X') {
      width ||= u24le(b, data + 4) + 1;
      height ||= u24le(b, data + 7) + 1;
      const chunk = b.slice(at, end);
      chunk[8] = chunk[8]! & ~0x0c; // no EXIF (0x08) or XMP (0x04) any more
      kept.push(chunk);
    } else if (fourcc === 'VP8 ') {
      if (u24le(b, data + 3) !== 0x2a019d) return null;
      width ||= u16le(b, data + 6) & 0x3fff;
      height ||= u16le(b, data + 8) & 0x3fff;
      kept.push(b.subarray(at, end));
    } else if (fourcc === 'VP8L') {
      if (b[data] !== 0x2f) return null;
      const bits = u32le(b, data + 1);
      width ||= (bits & 0x3fff) + 1;
      height ||= ((bits >>> 14) & 0x3fff) + 1;
      kept.push(b.subarray(at, end));
    } else if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      kept.push(b.subarray(at, end));
    }
    at = end;
  }
  if (!width || !height) return null;
  const body = concat(kept);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 4));
  new DataView(header.buffer).setUint32(4, body.byteLength + 4, true);
  header.set(b.subarray(8, 12), 8);
  return { bytes: concat([header, body]), type: 'image/webp', width, height };
}


// --- Rate limit: at most 20 image uploads per person per hour (in memory, like sign-in links). -----

const HOUR = 60 * 60 * 1000;
const uploads = new Map<number, number[]>();

export function allowImageUpload(actorId: number): boolean {
  const recent = (uploads.get(actorId) ?? []).filter((t) => t > Date.now() - HOUR);
  if (recent.length >= 20) {
    uploads.set(actorId, recent);
    return false;
  }
  uploads.set(actorId, [...recent, Date.now()]);
  return true;
}

export function purgeUploadCounts() {
  for (const [id, times] of uploads) if (!times.some((t) => t > Date.now() - HOUR)) uploads.delete(id);
}
