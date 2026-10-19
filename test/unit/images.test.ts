import { describe, expect, test } from 'bun:test';
import { allowImageUpload, maxImageSide, prepareImage, type CleanImage } from '../../src/images';
import { bytes, has, jpg, lossless, phoneJpeg, png, pngSized, u16, u32le, webp } from '../fixtures/images';

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
    expect(prepareImage(sized(5001, 5001), 2 * MB)).toBe('too_many_pixels');
    expect(prepareImage(sized(5000, 5000), 2 * MB)).toMatchObject({ width: 5000, height: 5000 });
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
