/**
 * public/logo.png → the two places the mark is used WITHOUT its wordmark.
 *
 *   public/logo-mark.png   the badge in the sidebar, the mobile bar, and login
 *   app/icon.png           the browser-tab icon
 *
 * ── Why the wordmark comes off ──────────────────────────────────────────────
 *
 * The supplied artwork is a lockup: the Pm mark above the word PRIMUS. Every
 * place this app draws it, the badge is 30–40 px and the app has ALREADY
 * written “PRIMUS” in text beside it. So the word inside the picture is
 * illegible and duplicated at the same time — at 34 px it is about five pixels
 * tall, which reads as a green smudge under the mark, next to the same word set
 * cleanly in type. That is what a mark separate from a lockup is FOR, and this
 * script is how one is obtained from the other.
 *
 * ── The three things it does ────────────────────────────────────────────────
 *
 *   CROP TO THE MARK. Found by measurement, not by fixed coordinates: the bands
 *   of the lockup are separated by blank rows, so the first run of rows with ink
 *   is the mark and the next is the word. Replace the artwork with differently
 *   proportioned art and this still finds the right part of it.
 *
 *   WHITE BECOMES TRANSPARENT, WITH THE EDGES INTACT. Every pixel in this
 *   artwork is the same green blended with white, so the blend is undone rather
 *   than thresholded: alpha comes from how far the red channel has been lifted
 *   toward white, and the colour is set back to the pure green. Thresholding
 *   would turn the anti-aliased edge into a jagged one. Transparency matters for
 *   the tab icon, where the bar is light in one theme and dark in the other, and
 *   it costs nothing on the badge.
 *
 *   BOX-FILTER DOWNSCALE, averaging every source pixel that lands in each
 *   destination pixel. Nearest-neighbour at these ratios drops most of the image
 *   on the floor and takes the thin strokes of the “m” with it.
 *
 * Run: node scripts/make-icon.js     (from the repo root, after changing the logo)
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const SRC = 'public/logo.png';
const MARGIN = 0.06;       // breathing room, as a fraction of the mark's longest side
const INK = [0, 144, 50];  // #009032, the green this logo is drawn in

/**
 * Both outputs are the same crop at different sizes, so they are one list.
 *
 * The badge is drawn at 40 px at most and the icon at 32; each file is several
 * times its largest drawn size, which is what a high-DPI screen asks for and is
 * still small enough that neither is worth thinking about again.
 */
const OUTPUTS = [
  { file: 'public/logo-mark.png', size: 256 },
  { file: 'app/icon.png', size: 128 },
];

// ── decode ──────────────────────────────────────────────────────────────────

const png = fs.readFileSync(SRC);
const W = png.readUInt32BE(16);
const H = png.readUInt32BE(20);
if (png[25] !== 3) throw new Error(`คาดว่าเป็น palette PNG แต่ color type = ${png[25]}`);

let off = 8;
let plte = null;
const idat = [];
while (off < png.length - 8) {
  const len = png.readUInt32BE(off);
  const type = png.slice(off + 4, off + 8).toString();
  const data = png.slice(off + 8, off + 8 + len);
  if (type === 'PLTE') plte = data;
  if (type === 'IDAT') idat.push(data);
  if (type === 'IEND') break;
  off += 12 + len;
}

const raw = zlib.inflateSync(Buffer.concat(idat));
const idx = Buffer.alloc(W * H);
for (let y = 0; y < H; y += 1) {
  const filter = raw[y * (W + 1)];
  const line = raw.slice(y * (W + 1) + 1, y * (W + 1) + 1 + W);
  for (let x = 0; x < W; x += 1) {
    const a = x > 0 ? idx[y * W + x - 1] : 0;
    const b = y > 0 ? idx[(y - 1) * W + x] : 0;
    const c = x > 0 && y > 0 ? idx[(y - 1) * W + x - 1] : 0;
    let v = line[x];
    if (filter === 1) v += a;
    else if (filter === 2) v += b;
    else if (filter === 3) v += (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
    }
    idx[y * W + x] = v & 255;
  }
}

const red = (i) => plte[idx[i] * 3];
const isInk = (i) => {
  const p = idx[i] * 3;
  return !(plte[p] > 246 && plte[p + 1] > 246 && plte[p + 2] > 246);
};

// ── find the mark: the first band of ink, top-down ───────────────────────────
//
// Measured rather than hard-coded. The bands are separated by fully blank rows,
// so "the first run of rows that has ink" is the mark and the next one is the
// wordmark — and if somebody replaces the artwork with a differently
// proportioned version, this still finds the right part of it.

const rowHasInk = [];
for (let y = 0; y < H; y += 1) {
  let has = false;
  for (let x = 0; x < W; x += 1) if (isInk(y * W + x)) { has = true; break; }
  rowHasInk.push(has);
}

const top = rowHasInk.indexOf(true);
let bottom = top;
while (bottom + 1 < H && rowHasInk[bottom + 1]) bottom += 1;

let left = W; let right = -1;
for (let y = top; y <= bottom; y += 1) {
  for (let x = 0; x < W; x += 1) {
    if (isInk(y * W + x)) { if (x < left) left = x; if (x > right) right = x; }
  }
}

const markW = right - left + 1;
const markH = bottom - top + 1;
console.log(`ตัว Pm อยู่ที่แถว ${top}–${bottom} คอลัมน์ ${left}–${right}  (${markW}×${markH})`);

// Square box around the mark, centred, with margin — so the icon is not
// distorted and does not touch its own edges.
const side = Math.round(Math.max(markW, markH) * (1 + MARGIN * 2));
const boxX = left + markW / 2 - side / 2;
const boxY = top + markH / 2 - side / 2;

// ── box-filter downscale, undoing the white blend as it goes ────────────────

function render(SIZE) {
const out = Buffer.alloc(SIZE * SIZE * 4);
const step = side / SIZE;

for (let dy = 0; dy < SIZE; dy += 1) {
  for (let dx = 0; dx < SIZE; dx += 1) {
    const sx0 = Math.floor(boxX + dx * step);
    const sy0 = Math.floor(boxY + dy * step);
    const sx1 = Math.max(sx0 + 1, Math.floor(boxX + (dx + 1) * step));
    const sy1 = Math.max(sy0 + 1, Math.floor(boxY + (dy + 1) * step));

    let sum = 0; let n = 0;
    for (let sy = sy0; sy < sy1; sy += 1) {
      for (let sx = sx0; sx < sx1; sx += 1) {
        /**
         * Clamped to the MARK'S box, not to the image.
         *
         * The mark is wider than it is tall (441×316), so the square drawn
         * around it reaches 75 px past the mark on each side — and 60 of those
         * rows below are the top of the word PRIMUS. Sampling the image there
         * put the tips of the letters back into an icon whose entire purpose
         * was to leave them out. Everything outside the mark is empty, whatever
         * the artwork happens to have there.
         */
        const inside = sx >= left && sx <= right && sy >= top && sy <= bottom;
        sum += inside ? (255 - red(sy * W + sx)) / 255 : 0;
        n += 1;
      }
    }

    const alpha = Math.round((sum / n) * 255);
    const p = (dy * SIZE + dx) * 4;
    out[p] = INK[0]; out[p + 1] = INK[1]; out[p + 2] = INK[2]; out[p + 3] = alpha;
  }
}
return out;
}

// ── encode ──────────────────────────────────────────────────────────────────

const crcTable = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

for (const { file, size: SIZE } of OUTPUTS) {
  const out = render(SIZE);

  const scan = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    scan[y * (SIZE * 4 + 1)] = 0;
    out.copy(scan, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scan, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));

  const opaque = out.filter((_, i) => i % 4 === 3 && out[i] > 8).length;
  console.log(
    `เขียน ${file} — ${SIZE}×${SIZE} RGBA, ${fs.statSync(file).size} ไบต์`
    + `, มีหมึก ${(opaque / (SIZE * SIZE) * 100).toFixed(1)}%`,
  );
}
