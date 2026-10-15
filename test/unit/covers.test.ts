import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageType } from '../../src/covers';

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((ch) => ch.charCodeAt(0)) : p)));

describe('imageType', () => {
  test('reads the type from the file, not from what the server says', () => {
    expect(imageType(readFileSync(join(import.meta.dir, '../../dev/covers/event_cover/warehouse.png')))).toBe('image/png');
    expect(imageType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageType(bytes('GIF89a', [0, 0]))).toBe('image/gif');
    expect(imageType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
    expect(imageType(bytes([0, 0, 0, 0x1c], 'ftypavif'))).toBe('image/avif');
  });

  test('anything else is not an image', () => {
    expect(imageType(bytes('<!doctype html><html>'))).toBeNull();
    expect(imageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(imageType(bytes([0x89, 0x50]))).toBeNull();
    expect(imageType(new Uint8Array())).toBeNull();
  });
});
