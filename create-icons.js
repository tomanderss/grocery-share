// create-icons.js — erzeugt icons/icon-192.png, icon-512.png & icon-1024.png
// ohne Abhängigkeiten (reiner PNG-Encoder via Node-zlib, wie coop-number-sums).
// Motiv: ein heller Kassenbon mit Zickzack-Unterkante auf dunklem Grund,
// darauf drei "Positionszeilen" und ein grüner Split-Balken (halb/halb) —
// das Aufteilen der Kosten in einem Bild.
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── CRC32 / PNG-Chunks ───────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Zeichnen ─────────────────────────────────────────────────────────────────
const BG = [11, 16, 32];       // --bg
const PAPER = [240, 243, 250]; // Bon
const LINE = [154, 166, 194];  // Positionszeilen
const GREEN = [52, 211, 153];  // --accent (Anteil Person 1)
const GREEN_D = [16, 122, 87]; // Anteil Person 2

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // Alpha-Blend über bisherigen Inhalt
    const na = a / 255;
    px[i] = Math.round(r * na + px[i] * (1 - na));
    px[i + 1] = Math.round(g * na + px[i + 1] * (1 - na));
    px[i + 2] = Math.round(b * na + px[i + 2] * (1 - na));
    px[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, col, a) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) put(x, y, col, a);
  };
  // Hintergrund mit abgerundeten Ecken (Radius ~22%)
  const rad = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(rad - x, x - (size - 1 - rad), 0);
      const dy = Math.max(rad - y, y - (size - 1 - rad), 0);
      if (Math.hypot(dx, dy) <= rad) put(x, y, BG);
    }
  }
  const s = size / 100; // Prozent-Koordinaten
  // Bon-Papier
  rect(28 * s, 16 * s, 72 * s, 70 * s, PAPER);
  // Zickzack-Unterkante
  const teeth = 6;
  const tw = (44 * s) / teeth;
  for (let t = 0; t < teeth; t++) {
    for (let yy = 0; yy < 6 * s; yy++) {
      const half = (yy / (6 * s)) * (tw / 2);
      rect(28 * s + t * tw + half, 70 * s + yy, 28 * s + (t + 1) * tw - half, 70 * s + yy + 1, PAPER);
    }
  }
  // Positionszeilen (Name links, Preis-Punkt rechts)
  [26, 36, 46].forEach((yPct) => {
    rect(34 * s, yPct * s, 54 * s, (yPct + 4) * s, LINE);
    rect(60 * s, yPct * s, 66 * s, (yPct + 4) * s, LINE);
  });
  // Split-Balken: links Person 1 (hell), rechts Person 2 (dunkel)
  rect(34 * s, 56 * s, 50 * s, 63 * s, GREEN);
  rect(50 * s, 56 * s, 66 * s, 63 * s, GREEN_D);
  // Trennstrich in der Mitte
  rect(49.4 * s, 54 * s, 50.6 * s, 65 * s, PAPER);
  return encodePNG(size, size, px);
}

mkdirSync(join(__dir, 'icons'), { recursive: true });
[192, 512, 1024].forEach((size) => {
  writeFileSync(join(__dir, 'icons', `icon-${size}.png`), render(size));
  console.log(`✓ icons/icon-${size}.png`);
});
