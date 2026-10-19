/*
 * Builds the app icons in public/: the OUTKZT monogram, with the app's ticket (perforated stub, rising bars)
 * held in front of it, tilted, in white outline on black.
 *   bun dev/build-icons.ts
 * The monogram is drawn from measurements of the OUTKZT logo artwork (outkzt-monogram.png, 3000 px square):
 * a ring cut by a diagonal gap, over a K. Everything is in those pixel units, then scaled into the icon.
 */
import sharp from 'sharp';

const n = (v: number) => +v.toFixed(1);

// The ring: centre, outer and inner radius, and half the gap (in x + y units: the gap runs along x + y = c).
const ring = { x: 1524, y: 824, outer: 638, inner: 338, gap: 102 };
// Where a line of the gap (x + y = centre + k) meets a circle; side 1 is the upper right, -1 the lower left.
const meet = (k: number, radius: number, side: 1 | -1) => {
  const u = k / Math.SQRT2;
  const v = side * Math.sqrt(radius * radius - u * u);
  return `${n(ring.x + (u + v) / Math.SQRT2)} ${n(ring.y + (u - v) / Math.SQRT2)}`;
};
// The ring's lower half joins the K's top bar (y = 1449).
const join = Math.sqrt(ring.outer ** 2 - (1449 - ring.y) ** 2);
const { outer: R, inner: r, gap: g } = ring;
const monogram = [
  // Upper half of the ring.
  `M${meet(-g, R, 1)}A${R} ${R} 0 0 0 ${meet(-g, R, -1)}L${meet(-g, r, -1)}A${r} ${r} 0 0 1 ${meet(-g, r, 1)}Z`,
  // Lower half of the ring, the K's top bar and its long leg.
  `M${meet(g, R, 1)}A${R} ${R} 0 0 1 ${n(ring.x + join)} 1449H2108V1744H1568L2108 2284V2709L848 1449H${n(ring.x - join)}` +
    `A${R} ${R} 0 0 1 ${meet(g, R, -1)}L${meet(g, r, -1)}A${r} ${r} 0 0 0 ${meet(g, r, 1)}Z`,
  // The K's short leg.
  'M921 2289L1199.5 2010.5L1409.5 2220.5L921 2709Z',
].join('');
const box = { x: 848, y: 186, w: 1314, h: 2523 };

// The ticket, in a 512 square (as the previous icon had it): 288 x 176, centred, notched at both ends.
const ticket =
  'M136 168h240a24 24 0 0 1 24 24v32a32 32 0 0 0 0 64v32a24 24 0 0 1-24 24H136a24 24 0 0 1-24-24v-32a32 32 0 0 0 0-64v-32a24 24 0 0 1 24-24z';
const stub = [196, 230, 264, 298].map((y) => `<rect x="316" y="${y}" width="8" height="18" rx="4"/>`).join('');
const bars = '<rect x="164" y="270" width="24" height="46" rx="5"/><rect x="204" y="242" width="24" height="74" rx="5"/><rect x="244" y="206" width="24" height="110" rx="5"/>';

/**
 * The drawing on a 512 square, white on transparent: the monogram 384 tall, the ticket in front of it at
 * 74%, tilted 10°, with a clear margin cut out of the monogram around it. `scale` shrinks it about the centre.
 */
function art(scale: number) {
  const s = 384 / box.h;
  const mono = `translate(${n(256 - (box.w * s) / 2 - box.x * s)} ${n(64 - box.y * s)}) scale(${+s.toFixed(5)})`;
  const held = 'translate(262 292) rotate(-10) scale(0.74) translate(-256 -256)';
  const line = n(14 / 0.74), margin = n((14 + 44) / 0.74);
  return (
    `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">` +
    `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="#fff"/>` +
    `<path transform="${held}" d="${ticket}" stroke="#000" stroke-width="${margin}" stroke-linejoin="round"/></mask>` +
    `<g mask="url(#m)"><path transform="${mono}" fill="#fff" d="${monogram}"/></g>` +
    `<g transform="${held}" fill="#fff"><path d="${ticket}" fill="none" stroke="#fff" stroke-width="${line}" stroke-linejoin="round"/>${stub}${bars}</g>` +
    '</g>'
  );
}
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>\n`;
const tile = '<rect width="512" height="512" rx="112" fill="#000"/>';
const square = '<rect width="512" height="512" fill="#000"/>';

const icons: [file: string, source: string, size: number][] = [
  // Browsers and installed apps on computers: the rounded tile.
  ['icon.svg', svg(tile + art(1)), 512],
  ['icon-192.png', svg(tile + art(1)), 192],
  ['icon-512.png', svg(tile + art(1)), 512],
  // iPhone rounds the corners itself.
  ['icon-180.png', svg(square + art(1)), 180],
  // Android crops to its own shape: everything inside the middle 80% circle.
  ['icon-maskable-512.png', svg(square + art(0.8)), 512],
  // Only the shape counts (the system colours it): the status bar icon of notifications, and themed icons.
  ['icon-monochrome-512.png', svg(art(0.9)), 512],
  ['badge-96.png', svg(art(1.1)), 96],
];

for (const [file, source, size] of icons) {
  if (file.endsWith('.svg')) await Bun.write(`public/${file}`, source);
  else await sharp(Buffer.from(source), { density: (72 * size) / 512 * 2 }).resize(size, size).png({ compressionLevel: 9 }).toFile(`public/${file}`);
  console.log(`public/${file}`);
}
