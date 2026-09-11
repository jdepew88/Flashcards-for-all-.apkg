// Builds the Home Screen / install icons in public/icons from the app mark.
//
// The mark is the same drawing as public/favicon.svg and the in-app LogoMark —
// two stacked cards on a moss tile — rasterised here in plain Node (no image
// library, no browser) so the PNGs are reproducible from the repository alone.
// Each pixel is 4×4 supersampled against signed-distance shapes.
//
//   icon-192.png, icon-512.png   rounded tile on transparent corners, as the
//                                favicon ("any" purpose)
//   icon-maskable-512.png        full-bleed tile, mark scaled into the maskable
//                                safe zone (a circle of 40% radius)
//   apple-touch-icon.png (180)   full-bleed: iOS applies its own rounded mask
//                                and would otherwise show the corners black
//
// Run with: npm run icons

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "public/icons");

const MOSS = [0x3d, 0x6b, 0x3f];
const PAPER = [0xff, 0xfe, 0xfb];
const WHITE = [0xff, 0xff, 0xff];

/** Signed distance to a rounded rectangle; negative inside. */
function roundRect(px, py, x, y, w, h, r) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Signed distance to a round-capped line of the given width. */
function segment(px, py, ax, ay, bx, by, width) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy)) - width / 2;
}

function rotateAbout(px, py, cx, cy, degrees) {
  const a = (degrees * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

/**
 * The mark's layers in the favicon's 32-unit space, bottom first. Each returns
 * [rgb, alpha] where the point is inside, or null.
 */
function markLayers(tileRadius) {
  return [
    (u, v) => (tileRadius === null || roundRect(u, v, 0, 0, 32, 32, tileRadius) <= 0 ? [MOSS, 1] : null),
    (u, v) => {
      // favicon: rect rotated -9° about (14, 18.5); test the point rotated back.
      const [ru, rv] = rotateAbout(u, v, 14, 18.5, 9);
      return roundRect(ru, rv, 6.5, 10, 15, 17, 3) <= 0 ? [WHITE, 0.5] : null;
    },
    (u, v) => (roundRect(u, v, 10.5, 6.5, 15, 17, 3) <= 0 ? [PAPER, 1] : null),
    (u, v) =>
      segment(u, v, 14, 12.5, 22, 12.5, 1.6) <= 0 ||
      segment(u, v, 14, 15.5, 22, 15.5, 1.6) <= 0 ||
      segment(u, v, 14, 18.5, 19, 18.5, 1.6) <= 0
        ? [MOSS, 1]
        : null,
  ];
}

/**
 * Renders one icon. `fullBleed` fills the square with the tile and scales the
 * cards (not the tile) about their own centre so they sit inside `glyphScale`.
 */
function render(size, { fullBleed, glyphScale = 1 }) {
  const layers = markLayers(fullBleed ? null : 7);
  // The cards' bounding box centre, so a scaled mark stays visually centred.
  const cx = 15.4;
  const cy = 17.2;
  const SS = 4;
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((px + (sx + 0.5) / SS) / size) * 32;
          const v = ((py + (sy + 0.5) / SS) / size) * 32;
          // The tile uses real coordinates. The cards, when scaled, are drawn
          // with their own centre (cx, cy) at the middle of the tile.
          const gu = glyphScale === 1 ? u : cx + (u - 16) / glyphScale;
          const gv = glyphScale === 1 ? v : cy + (v - 16) / glyphScale;
          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;
          layers.forEach((layer, i) => {
            const hit = i === 0 ? layer(u, v) : layer(gu, gv);
            if (!hit) return;
            const [[lr, lg, lb], la] = hit;
            const outA = la + ca * (1 - la);
            cr = (lr * la + cr * ca * (1 - la)) / outA;
            cg = (lg * la + cg * ca * (1 - la)) / outA;
            cb = (lb * la + cb * ca * (1 - la)) / outA;
            ca = outA;
          });
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const i = (py * size + px) * 4;
      const n = SS * SS;
      pixels[i + 3] = Math.round((a / n) * 255);
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
      }
    }
  }
  return encodePng(size, size, pixels);
}

/** Minimal PNG encoder: 8-bit RGBA, no interlace, filter type 0 on every row. */
function encodePng(width, height, rgba) {
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), 8 + data.length);
  return chunk;
}

// CRC-32 (IEEE). zlib.crc32 only exists from Node 22.2; this project supports 20.
function crc32(bytes) {
  let c = ~0;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const icons = [
  ["icon-192.png", 192, { fullBleed: false }],
  ["icon-512.png", 512, { fullBleed: false }],
  ["icon-maskable-512.png", 512, { fullBleed: true, glyphScale: 0.76 }],
  ["apple-touch-icon.png", 180, { fullBleed: true, glyphScale: 0.84 }],
];

await mkdir(outDir, { recursive: true });
for (const [name, size, options] of icons) {
  const png = render(size, options);
  await writeFile(resolve(outDir, name), png);
  console.log(`[make-icons] wrote public/icons/${name} (${size}×${size}, ${png.length} bytes)`);
}
