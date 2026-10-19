// Small real images, and phone-like versions of them carrying metadata, for the image tests.
// 40 × 30 images made with ImageMagick (-strip, so no metadata of their own).
export const jpg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAeACgDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAQG/8QAFRABAQAAAAAAAAAAAAAAAAAAABL/xAAWAQEBAQAAAAAAAAAAAAAAAAAABgH/xAAXEQADAQAAAAAAAAAAAAAAAAAAARRh/9oADAMBAAIRAxEAPwDOWWnstsGFnbpRZaeyyDBbpRYnsIMFuk9lp6KWkKJGxlFlp6KIULGUWJ6CFCxn/9k=',
  'base64',
);
export const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeEAIAAACBLxfJAAAAc0lEQVRYw+2ZwQ3AIBDDjNQHzEK7/yBlF/qjW4CUxBPEOsmfK2thRZkd6jg9Yx/XvKFZCT/Q3tMzdgrbXdhN+LsTLWkMhVNpbfyEU2lxDIVTaW38hFNpcQyFU2lt/IRTaXEMhc0qXeqA2U/P2CgM4PRQ+wHBdDxl8XAutAAAAABJRU5ErkJggg==',
  'base64',
);
export const webp = Buffer.from(
  'UklGRnwAAABXRUJQVlA4IHAAAADwBACdASooAB4APpE8mki3M6KhKrgMAuASCWgAdwXwDeAjAL//ucgFd9yCF2VqOAAA/vA8v5truJf+MpHpxv//sot/Si2udJ2pcHf9T0H1mvogV4/vm2u4ZE+Z/IberSlUY/C3XDUK0Cow0JI94QAA',
  'base64',
);
export const lossless = Buffer.from('UklGRkYAAABXRUJQVlA4TDkAAAAvJ0AHAJmM6H9sIqL/AbVt2zD8//T0bEICwv/DNEKCFBI1lLZtwKRosX5hECVeDlXP3G+yx7/fnQAA', 'base64');

export const bytes = (...parts: (Uint8Array | number[] | string)[]) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
export const u16 = (n: number) => [n >> 8, n & 0xff];
export const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
export const has = (b: Uint8Array, text: string) => Buffer.from(b).includes(Buffer.from(text, 'latin1'));

/** An EXIF block like a phone's: rotation, then a GPS section. */
export function phoneExif(orientation: number) {
  const tiff = bytes('MM', [0, 42], [0, 0, 0, 8], u16(2), [0x01, 0x12, 0, 3, 0, 0, 0, 1], u16(orientation), [0, 0],
    [0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 38], [0, 0, 0, 0], 'GPS 45.5017N 73.5673W SECRET-GPS');
  const body = bytes('Exif\0\0', tiff);
  return bytes([0xff, 0xe1], u16(body.length + 2), body);
}

export function phoneJpeg(orientation: number) {
  const xmp = bytes('http://ns.adobe.com/xap/1.0/\0', '<x:xmpmeta>SECRET-XMP</x:xmpmeta>');
  return bytes(
    jpg.subarray(0, 2),
    phoneExif(orientation),
    [0xff, 0xe1], u16(xmp.length + 2), xmp,
    [0xff, 0xfe], u16(16), 'SECRET-COMMENT',
    jpg.subarray(2),
    '<html><script>SECRET-TRAILER</script></html>',
  );
}

/** The PNG above, claiming another size in pixels (to test the limits without a huge file). */
export function pngSized(width: number, height: number) {
  const b = Buffer.from(png);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
