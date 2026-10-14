/**
 * Zonadua PWA icon generator — pure Node (zero deps).
 * Draws the brand mark: the Zonadua Z-bolt (references/ZONADUA_LOGO.svg — one closed
 * path, filled with the Crimson Clean signature gradient #FF4D5E → #E8102E → #B00D24
 * on the clean light canvas #F9F9F9).
 * Outputs: public/pwa-192.png, public/pwa-512.png, public/apple-touch-icon.png
 *
 * The mark is an arbitrary bezier path, so this script carries a small SVG-path parser
 * (the M/c/l/h/s/Z subset the logo actually uses), flattens the curves to polygons and
 * rasterises them with a nonzero-winding scanline — the same fill rule SVG itself uses,
 * so the shapes the launcher gets match the favicon exactly.
 *
 * Run: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
mkdirSync(publicDir, { recursive: true });

// ---------- minimal PNG encoder ----------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- brand mark ----------
// Single path, viewBox 0 0 772.78 585.1. Kept verbatim from references/ZONADUA_LOGO.svg.
const MARK_PATH =
  'M725.79,377.5c-34.86-6.74-63.65-33.81-72.29-68.25-6.74-26.78-1.72-52.12,10.65-72.49l-.05-.05.8-1.17c1.19-1.88,2.45-3.72,3.75-5.52l12.84-18.92c19.14-28.17-1.05-66.29-35.12-66.29h-202.65c-.07,0-.15,0-.22,0-12.62.03-22.19-11.39-19.56-23.73,2.23-10.45,6.21-20.25,11.58-29.11l-.05-.05.8-1.17c1.19-1.88,2.45-3.72,3.75-5.52l12.84-18.92c19.14-28.17-1.05-66.29-35.12-66.29h-202.65c-31.5,0-61.24,14.55-80.53,39.45L18.24,189.44s-.1-.12-.1-.14h0c-5.47,7.64-11.54,14.8-18.14,21.46,14.91-5.05,31.5-6.47,48.73-3.14,34.88,6.74,63.65,33.81,72.29,68.25,6.72,26.78,1.7,52.12-10.66,72.49l.05.05-.78,1.15c-1.19,1.89-2.43,3.74-3.75,5.54l-12.84,18.9c-19.14,28.19,1.05,66.29,35.12,66.29h202.66c.07,0,.15,0,.22,0,12.61-.03,22.18,11.39,19.55,23.72-2.23,10.46-6.21,20.27-11.59,29.14l.05.05-.78,1.15c-1.19,1.89-2.43,3.74-3.75,5.54l-12.84,18.9c-19.14,28.19,1.05,66.29,35.12,66.29h202.66c31.5,0,61.22-14.55,80.53-39.45l116.31-150s.1.12.1.14c4.75-6.63,9.97-12.91,15.58-18.8.53-.56.84-1.3.84-2.08h0c-14.47,4.59-30.43,5.78-47,2.58Z';
const VIEW_W = 772.78;
const VIEW_H = 585.1;

const STOPS = [
  [0xff, 0x4d, 0x5e], // #FF4D5E
  [0xe8, 0x10, 0x2e], // #E8102E
  [0xb0, 0x0d, 0x24] // #B00D24
];

function gradient(t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = STOPS[i];
  const b = STOPS[Math.min(i + 1, STOPS.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ];
}

// ---------- path parser (M / c / l / h / s / Z, absolute + relative) ----------
function tokenize(d) {
  return d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
}

/** Flatten one path string into closed polygons of [x, y] points. */
function parsePath(d) {
  const tok = tokenize(d);
  const polys = [];
  let poly = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastC2 = null; // second control point of the previous cubic, for `s`
  let cmd = '';

  const num = () => Number(tok[i++]);
  const push = (px, py) => poly.push([px, py]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const x0 = x;
    const y0 = y;
    const N = 24; // flatten steps — well under a pixel at 512px
    for (let s = 1; s <= N; s++) {
      const t = s / N;
      const u = 1 - t;
      push(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
      );
    }
    x = x3;
    y = y3;
    lastC2 = [x2, y2];
  };

  let i = 0;
  while (i < tok.length) {
    const t = tok[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        const px = num() + (rel ? x : 0);
        const py = num() + (rel ? y : 0);
        if (poly && poly.length > 1) polys.push(poly);
        poly = [];
        push(px, py);
        x = px;
        y = py;
        startX = px;
        startY = py;
        lastC2 = null;
        cmd = rel ? 'l' : 'L'; // subsequent pairs after moveto are linetos
        break;
      }
      case 'L': {
        const px = num() + (rel ? x : 0);
        const py = num() + (rel ? y : 0);
        push(px, py);
        x = px;
        y = py;
        lastC2 = null;
        break;
      }
      case 'H': {
        const px = num() + (rel ? x : 0);
        push(px, y);
        x = px;
        lastC2 = null;
        break;
      }
      case 'V': {
        const py = num() + (rel ? y : 0);
        push(x, py);
        y = py;
        lastC2 = null;
        break;
      }
      case 'C': {
        const x1 = num() + (rel ? x : 0);
        const y1 = num() + (rel ? y : 0);
        const x2 = num() + (rel ? x : 0);
        const y2 = num() + (rel ? y : 0);
        const x3 = num() + (rel ? x : 0);
        const y3 = num() + (rel ? y : 0);
        cubic(x1, y1, x2, y2, x3, y3);
        break;
      }
      case 'S': {
        const rx = lastC2 ? 2 * x - lastC2[0] : x;
        const ry = lastC2 ? 2 * y - lastC2[1] : y;
        const x2 = num() + (rel ? x : 0);
        const y2 = num() + (rel ? y : 0);
        const x3 = num() + (rel ? x : 0);
        const y3 = num() + (rel ? y : 0);
        cubic(rx, ry, x2, y2, x3, y3);
        break;
      }
      case 'Z': {
        push(startX, startY);
        x = startX;
        y = startY;
        lastC2 = null;
        break;
      }
      default:
        throw new Error(`unsupported path command: ${cmd}`);
    }
  }
  if (poly && poly.length > 1) polys.push(poly);
  return polys;
}

/**
 * Rasterise polygons with a nonzero-winding scanline at SS×SS supersampling.
 * Returns a Float32Array of coverage (0..1) per pixel.
 */
function rasterize(polys, size, SS = 4) {
  const cov = new Float32Array(size * size);
  const hi = size * SS; // subpixel resolution
  for (let row = 0; row < hi; row++) {
    const sy = (row + 0.5) / SS;
    // gather crossings: x at the row + winding direction
    const xs = [];
    const dirs = [];
    for (const poly of polys) {
      for (let e = 0; e < poly.length - 1; e++) {
        const [ax, ay] = poly[e];
        const [bx, by] = poly[e + 1];
        if (ay === by) continue;
        if (sy < Math.min(ay, by) || sy >= Math.max(ay, by)) continue;
        xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        dirs.push(by > ay ? 1 : -1);
      }
    }
    if (xs.length === 0) continue;
    const order = xs.map((_, k) => k).sort((a, b) => xs[a] - xs[b]);
    let winding = 0;
    for (let k = 0; k < order.length - 1; k++) {
      winding += dirs[order[k]];
      if (winding === 0) continue;
      const xa = Math.max(0, Math.round(xs[order[k]] * SS));
      const xb = Math.min(hi, Math.round(xs[order[k + 1]] * SS));
      const py = Math.floor(row / SS);
      for (let c = xa; c < xb; c++) cov[py * size + Math.floor(c / SS)] += 1;
    }
  }
  const per = SS * SS;
  for (let p = 0; p < cov.length; p++) cov[p] = Math.min(1, cov[p] / per);
  return cov;
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cornerR = size * 0.2; // rounded-corner mask

  // Fit the mark into 66% of the square, centred — inside the maskable safe zone.
  const scale = ((size * 0.66) / VIEW_W);
  const offX = (size - VIEW_W * scale) / 2;
  const offY = (size - VIEW_H * scale) / 2;

  const polys = parsePath(MARK_PATH).map((poly) => poly.map(([px, py]) => [px * scale + offX, py * scale + offY]));
  const cov = rasterize(polys, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // rounded-corner alpha mask
      const dxCorner = Math.max(cornerR - x, x - (size - 1 - cornerR), 0);
      const dyCorner = Math.max(cornerR - y, y - (size - 1 - cornerR), 0);
      if (dxCorner > 0 && dyCorner > 0 && Math.hypot(dxCorner, dyCorner) > cornerR) continue;

      const a = cov[y * size + x];
      // diagonal sweep of the Crimson Clean gradient across the tile
      const [r, g, b] = gradient((x / size + y / size) / 2);
      rgba[idx] = Math.round(0xf9 * (1 - a) + r * a);
      rgba[idx + 1] = Math.round(0xf9 * (1 - a) + g * a);
      rgba[idx + 2] = Math.round(0xf9 * (1 - a) + b * a);
      rgba[idx + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

for (const [name, size] of [
  ['pwa-192.png', 192],
  ['pwa-512.png', 512],
  ['apple-touch-icon.png', 180]
]) {
  writeFileSync(join(publicDir, name), drawIcon(size));
  console.log(`✓ public/${name} (${size}×${size})`);
}
console.log('Icons generated — Crimson Clean Z-bolt.');
