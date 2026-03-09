/**
 * Generate a 32x32 PNG tray icon — purple sparkle on transparent background.
 * Run: bun scripts/gen-icon.ts
 */

import { deflateSync } from "node:zlib";
import { resolve } from "node:path";

const SIZE = 32;

// ─── RGBA pixel buffer ──────────────────────────────────────────────────────

const pixels = new Uint8Array(SIZE * SIZE * 4); // RGBA

function setPixel(x: number, y: number, r: number, g: number, b: number, a: number) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // Alpha blend over existing
  const srcA = a / 255;
  const dstA = pixels[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  pixels[i + 0] = Math.round((r * srcA + pixels[i + 0] * dstA * (1 - srcA)) / outA);
  pixels[i + 1] = Math.round((g * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA);
  pixels[i + 2] = Math.round((b * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA);
  pixels[i + 3] = Math.round(outA * 255);
}

function drawCircle(cx: number, cy: number, radius: number, r: number, g: number, b: number, a: number) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
    for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) {
        setPixel(x, y, r, g, b, a);
      } else if (d2 <= (radius + 0.8) * (radius + 0.8)) {
        // Anti-alias edge
        const edge = 1 - (Math.sqrt(d2) - radius) / 0.8;
        setPixel(x, y, r, g, b, Math.round(a * Math.max(0, edge)));
      }
    }
  }
}

function drawLine(x0: number, y0: number, x1: number, y1: number, thickness: number, r: number, g: number, b: number, a: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len * 3);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    drawCircle(cx, cy, thickness / 2, r, g, b, a);
  }
}

// ─── Draw sparkle shape ─────────────────────────────────────────────────────

// Main 4-point star (large)
const cx = 14, cy = 14;
const purple = [139, 92, 246] as const; // #8b5cf6
const white = [255, 255, 255] as const;
const lightPurple = [167, 139, 250] as const; // #a78bfa

// Draw the main 4-pointed star using lines from center
// Top
drawLine(cx, cy - 10, cx, cy, 2.2, ...purple, 255);
drawLine(cx, cy - 10, cx, cy - 5, 1.8, ...lightPurple, 255);
// Bottom
drawLine(cx, cy + 10, cx, cy, 2.2, ...purple, 255);
drawLine(cx, cy + 10, cx, cy + 5, 1.8, ...lightPurple, 255);
// Left
drawLine(cx - 10, cy, cx, cy, 2.2, ...purple, 255);
drawLine(cx - 10, cy, cx - 5, cy, 1.8, ...lightPurple, 255);
// Right
drawLine(cx + 10, cy, cx, cy, 2.2, ...purple, 255);
drawLine(cx + 10, cy, cx + 5, cy, 1.8, ...lightPurple, 255);

// Center glow
drawCircle(cx, cy, 3.2, ...white, 220);
drawCircle(cx, cy, 2.2, ...white, 255);

// Small cross sparkle (top-right)
const sx = 25, sy = 5;
drawLine(sx, sy - 3, sx, sy + 3, 1.2, ...lightPurple, 200);
drawLine(sx - 3, sy, sx + 3, sy, 1.2, ...lightPurple, 200);
drawCircle(sx, sy, 1.2, ...white, 240);

// Tiny dot sparkle (bottom-left)
drawCircle(4, 27, 1.5, ...lightPurple, 180);
drawCircle(4, 27, 0.8, ...white, 220);

// ─── Encode PNG ─────────────────────────────────────────────────────────────

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(12 + data.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, data.length);
  buf[4] = type.charCodeAt(0);
  buf[5] = type.charCodeAt(1);
  buf[6] = type.charCodeAt(2);
  buf[7] = type.charCodeAt(3);
  buf.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(buf.subarray(4, 8));
  crcData.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcData));
  return buf;
}

// IHDR
const ihdr = new Uint8Array(13);
const ihdrView = new DataView(ihdr.buffer);
ihdrView.setUint32(0, SIZE);  // width
ihdrView.setUint32(4, SIZE);  // height
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// IDAT: prepend filter byte (0 = none) to each row
const raw = new Uint8Array(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 4)] = 0; // filter: none
  raw.set(
    pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4),
    y * (1 + SIZE * 4) + 1,
  );
}
const compressed = deflateSync(Buffer.from(raw));

// Assemble PNG
const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdrChunk = makeChunk("IHDR", ihdr);
const idatChunk = makeChunk("IDAT", new Uint8Array(compressed));
const iendChunk = makeChunk("IEND", new Uint8Array(0));

const png = new Uint8Array(signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
let offset = 0;
png.set(signature, offset); offset += signature.length;
png.set(ihdrChunk, offset); offset += ihdrChunk.length;
png.set(idatChunk, offset); offset += idatChunk.length;
png.set(iendChunk, offset);

// ─── Write files ────────────────────────────────────────────────────────────

const outDir = resolve(import.meta.dir, "../assets");
const pngPath = resolve(outDir, "tray-icon.png");
await Bun.write(pngPath, png);
console.log(`Wrote ${pngPath} (${png.length} bytes)`);

// ─── Generate .ico (PNG-compressed ICO) ─────────────────────────────────────
// ICO format: ICONDIR + ICONDIRENTRY + embedded PNG data
// Windows Vista+ supports PNG-compressed ICO entries

const icoHeader = new Uint8Array(6 + 16 + png.length);
const icoView = new DataView(icoHeader.buffer);

// ICONDIR
icoView.setUint16(0, 0, true);  // reserved
icoView.setUint16(2, 1, true);  // type: 1 = icon
icoView.setUint16(4, 1, true);  // count: 1 image

// ICONDIRENTRY
icoHeader[6] = SIZE;   // width (32)
icoHeader[7] = SIZE;   // height (32)
icoHeader[8] = 0;      // palette colors (0 = no palette)
icoHeader[9] = 0;      // reserved
icoView.setUint16(10, 1, true);   // color planes
icoView.setUint16(12, 32, true);  // bits per pixel
icoView.setUint32(14, png.length, true);  // image data size
icoView.setUint32(18, 22, true);  // offset to image data (6 + 16 = 22)

// Embedded PNG data
icoHeader.set(png, 22);

const icoPath = resolve(outDir, "tray-icon.ico");
await Bun.write(icoPath, icoHeader);
console.log(`Wrote ${icoPath} (${icoHeader.length} bytes)`);
console.log("Done!");
