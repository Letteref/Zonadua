/**
 * GowsLab PWA icon generator — pure Node (zero deps).
 * Draws the brand mark: a chainring with the Crimson Clean signature gradient
 * (#FF4D5E → #E8102E → #B00D24) on the clean light canvas (#F9F9F9).
 * Outputs: public/pwa-192.png, public/pwa-512.png, public/apple-touch-icon.png
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

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const cornerR = size * 0.2; // rounded-corner mask
  const ringOuter = size * 0.36;
  const ringInner = size * 0.27;
  const hub = size * 0.1;
  const spokeHalf = (6 * Math.PI) / 180;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // rounded-corner alpha mask
      const dxCorner = Math.max(cornerR - x, x - (size - 1 - cornerR), 0);
      const dyCorner = Math.max(cornerR - y, y - (size - 1 - cornerR), 0);
      if (dxCorner > 0 && dyCorner > 0 && Math.hypot(dxCorner, dyCorner) > cornerR) continue;

      const dx = x - c;
      const dy = y - c;
      const dist = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI); // 0..1 sweep

      const onRing = dist <= ringOuter && dist >= ringInner;
      const onHub = dist <= hub;
      const spokeAngle = (angle * 360) % 45;
      const delta = Math.min(spokeAngle, 45 - spokeAngle) * (Math.PI / 180);
      const onSpoke = dist > hub && dist < ringInner && delta < spokeHalf;

      if (onRing || onHub || onSpoke) {
        const [r, g, b] = gradient(angle);
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = 255;
      } else {
        rgba[idx] = 0xf9;
        rgba[idx + 1] = 0xf9;
        rgba[idx + 2] = 0xf9;
        rgba[idx + 3] = 255;
      }
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
console.log('Icons generated — Crimson Clean chainring.');
