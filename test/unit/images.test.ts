import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { allowImageUpload, maxImageSide, maxUploadBytes, prepareImage, processImage, type CleanImage } from '../../src/images';
import { bytes, has, jpg, lossless, phoneExif, phoneJpeg, png, pngSized, u16, u32le, webp } from '../fixtures/images';

const MB = 1024 * 1024;
const clean = (b: Uint8Array) => {
  const result = prepareImage(b, 2 * MB);
  if (typeof result === 'string') throw new Error(`refused: ${result}`);
  return result as CleanImage;
};

describe('images: types and sizes', () => {
  test('PNG, JPEG and WebP (lossy and lossless) with their size in pixels', () => {
    for (const [image, type] of [[png, 'image/png'], [jpg, 'image/jpeg'], [webp, 'image/webp'], [lossless, 'image/webp']] as const) {
      expect(clean(image)).toMatchObject({ type, width: 40, height: 30 });
    }
  });

  test('anything else is refused, whatever it claims to be', () => {
    const refused = [
      bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
      bytes('GIF89a', [1, 0, 1, 0]),
      bytes('just text'),
      png.subarray(0, 8), // a PNG signature and nothing else
      jpg.subarray(0, 200), // cut off before the end of the image
      png.subarray(0, png.length - 20),
      bytes([0xff, 0xd8, 0xff, 0xe0], u16(4), [0, 0], '<html>no frame</html>'), // JPEG magic bytes only
      bytes('RIFF', u32le(4), 'WEBP'),
      new Uint8Array(0),
    ];
    for (const b of refused) expect(prepareImage(b, 2 * MB)).toBe('bad_type');
  });

  test('over the byte limit', () => {
    expect(prepareImage(png, 100)).toBe('too_big');
  });

  test('a small file that would unpack into a huge image is refused', () => {
    const sized = pngSized;
    expect(prepareImage(sized(maxImageSide + 1, 10), 2 * MB)).toBe('too_many_pixels');
    expect(prepareImage(sized(10, 100_000), 2 * MB)).toBe('too_many_pixels');
    expect(prepareImage(sized(7072, 7072), 2 * MB)).toBe('too_many_pixels'); // just over 50 megapixels
    expect(prepareImage(sized(8064, 6048), 2 * MB)).toMatchObject({ width: 8064, height: 6048 }); // a 48-megapixel phone
  });
});

describe('images: metadata removed', () => {
  test('a phone JPEG loses its GPS, XMP, comment and trailing data, and keeps its rotation', () => {
    const out = clean(phoneJpeg(6));
    expect(out).toMatchObject({ type: 'image/jpeg', width: 40, height: 30 });
    expect(has(out.bytes, 'SECRET')).toBe(false);
    expect(has(out.bytes, 'GPS')).toBe(false);
    expect(has(out.bytes, 'xap/1.0')).toBe(false);
    // A new minimal EXIF with Orientation 6 only, after JFIF.
    expect(has(out.bytes, 'Exif\0\0MM')).toBe(true);
    expect(Buffer.from(out.bytes).indexOf('Exif')).toBeGreaterThan(Buffer.from(out.bytes).indexOf('JFIF'));
    expect([...out.bytes.subarray(out.bytes.length - 2)]).toEqual([0xff, 0xd9]);
    // Cleaning again changes nothing.
    expect(clean(out.bytes).bytes).toEqual(out.bytes);
  });

  test('an upright photo gets no EXIF at all', () => {
    const out = clean(phoneJpeg(1));
    expect(has(out.bytes, 'Exif')).toBe(false);
    expect(out.bytes.length).toBe(jpg.length);
  });

  test('a PNG loses its text chunks and anything after its end', () => {
    const text = bytes('Comment\0', 'SECRET-PNG');
    const chunk = bytes([0, 0, 0, text.length], 'tEXt', text, [0, 0, 0, 0]);
    const withText = bytes(png.subarray(0, 33), chunk, png.subarray(33), 'PK\x03\x04SECRET-ZIP');
    const out = clean(withText);
    expect(has(out.bytes, 'SECRET')).toBe(false);
    expect(Buffer.from(out.bytes).equals(png)).toBe(true);
  });

  test('a WebP loses its EXIF and XMP chunks, and says so in its header', () => {
    const vp8 = webp.subarray(12);
    const vp8x = bytes('VP8X', u32le(10), [0x0c, 0, 0, 0], [39, 0, 0], [29, 0, 0]);
    const exif = bytes('EXIF', u32le(10), 'SECRET-GPS');
    const xmp = bytes('XMP ', u32le(10), 'SECRET-XMP');
    const body = bytes('WEBP', vp8x, vp8, exif, xmp);
    const withMeta = bytes('RIFF', u32le(body.length), body, 'SECRET-TRAILER');
    const out = clean(withMeta);
    expect(out).toMatchObject({ type: 'image/webp', width: 40, height: 30 });
    expect(has(out.bytes, 'SECRET')).toBe(false);
    const view = Buffer.from(out.bytes);
    expect(view.readUInt32LE(4)).toBe(view.length - 8);
    expect(view[20]! & 0x0c).toBe(0);
  });
});

describe('images: upload limit', () => {
  test('20 uploads per person per hour', () => {
    const id = 900_000 + Math.floor(Math.random() * 1000);
    for (let i = 0; i < 20; i++) expect(allowImageUpload(id)).toBe(true);
    expect(allowImageUpload(id)).toBe(false);
    expect(allowImageUpload(id + 1)).toBe(true);
  });
});

describe('images: shrunk and rebuilt for storage', () => {
  const made = (width: number, height: number, channels: 3 | 4 = 3) =>
    sharp({ create: { width, height, channels, background: channels === 4 ? { r: 200, g: 30, b: 30, alpha: 0.5 } : '#c81e1e' } });
  // A JPEG straight from a "phone": its EXIF (rotation 6, GPS) right after the start.
  const fromPhone = async (width: number, height: number) => {
    const plain = await made(width, height).jpeg().toBuffer();
    return bytes(plain.subarray(0, 2), phoneExif(6), plain.subarray(2));
  };
  const ok = async (input: Uint8Array, kind: 'photo' | 'logo') => {
    const out = await processImage(input, kind);
    if (typeof out === 'string') throw new Error(`refused: ${out}`);
    return { ...out, meta: await sharp(out.bytes).metadata() };
  };

  test('a big phone photo becomes a 512 × 512 JPEG with no metadata', async () => {
    const input = await fromPhone(4032, 3024);
    const out = await ok(input, 'photo');
    expect(out.type).toBe('image/jpeg');
    expect(out.meta).toMatchObject({ format: 'jpeg', width: 512, height: 512 });
    expect(out.meta.exif).toBeUndefined();
    expect(has(out.bytes, 'SECRET')).toBe(false);
    expect(out.bytes.length).toBeLessThan(input.length);
  });

  test('photos are turned upright from their rotation', async () => {
    // 300 wide × 200 high, rotation 6 (90°): upright it is 200 × 300, so the logo (which keeps its shape) is portrait.
    const out = await ok(await fromPhone(300, 200), 'logo');
    expect(out.meta).toMatchObject({ width: 200, height: 300 });
  });

  test('the logo stays a PNG with its transparency, at most 600 × 300', async () => {
    const out = await ok(await made(1800, 600, 4).png().toBuffer(), 'logo');
    expect(out.type).toBe('image/png');
    expect(out.meta).toMatchObject({ format: 'png', width: 600, height: 200, hasAlpha: true });
  });

  test('a transparent photo gets a white background', async () => {
    const out = await ok(await made(600, 600, 4).png().toBuffer(), 'photo');
    expect(out.meta).toMatchObject({ format: 'jpeg', hasAlpha: false });
  });

  test('small images are not enlarged, and WebP becomes JPEG', async () => {
    const out = await ok(webp, 'photo');
    expect(out.meta.format).toBe('jpeg');
    expect(out.meta.width).toBeLessThanOrEqual(40);
  });

  test('an image whose header is fine but whose data is broken is refused', async () => {
    const broken = Buffer.from(png);
    broken.fill(0x41, 45, 80); // inside the image data
    expect(await processImage(broken, 'photo')).toBe('bad_type');
  });

  test('still refused before decoding: too big, too many pixels, not an image', async () => {
    expect(await processImage(new Uint8Array(maxUploadBytes + 1), 'photo')).toBe('too_big');
    expect(await processImage(pngSized(20_000, 20_000), 'photo')).toBe('too_many_pixels');
    expect(await processImage(bytes('<svg/>'), 'logo')).toBe('bad_type');
  });
});
