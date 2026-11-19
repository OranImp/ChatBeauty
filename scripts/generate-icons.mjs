import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const buildDir = path.join(root, 'build');
const publicDir = path.join(root, 'public');

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#141416"/>
      <stop offset="100%" stop-color="#050506"/>
    </linearGradient>
    <linearGradient id="accent" x1="0.15" y1="0.15" x2="0.85" y2="0.85">
      <stop offset="0%" stop-color="#f4f4f5"/>
      <stop offset="55%" stop-color="#d4d4d8"/>
      <stop offset="100%" stop-color="#a1a1aa"/>
    </linearGradient>
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#bg)" stroke="rgba(255,255,255,0.12)" stroke-width="8"/>
  <path d="M168 156 h176 a36 36 0 0 1 36 36 v108 a36 36 0 0 1 -36 36 h-112 l-56 44 v-44 h-8 a36 36 0 0 1 -36 -36 v-108 a36 36 0 0 1 36 -36 z"
        fill="none" stroke="url(#accent)" stroke-width="24" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M214 216 h84 m-58 0 l30 62 m-4 -62 l-32 62"
        fill="none" stroke="#f8fafc" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="332" cy="196" r="11" fill="#f4f4f5"/>
</svg>
`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf8');

// Pure Node RGBA PNG encoder (no external deps)
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - hw + r;
  const dy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function sdSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const lenSq = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function renderIconRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 512;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;

      const dBg = sdRoundedBox(px, py, 256, 256, 232, 232, 112);
      const bgAlpha = 1 - smoothstep(-1.2, 1.2, dBg);

      // Subtle background gradient
      const gT = (px + py) / 1024;
      let r = mix(14, 4, gT);
      let g = mix(17, 6, gT);
      let b = mix(24, 10, gT);

      // Outer border glow
      const borderMask = 1 - smoothstep(0, 2.2, Math.abs(dBg + 2) - 2.5);
      r = mix(r, 255, borderMask * 0.14);
      g = mix(g, 255, borderMask * 0.14);
      b = mix(b, 255, borderMask * 0.18);

      // Chat bubble outline (rounded rectangle + tail)
      const dBubbleOuter = sdRoundedBox(px, py, 256, 246, 124, 90, 34);
      const dBubbleRing = Math.abs(dBubbleOuter) - 11.5;
      const dTail1 = sdSegment(px, py, 198, 336, 174, 378) - 11.5;
      const dTail2 = sdSegment(px, py, 174, 378, 242, 336) - 11.5;
      const dAccent = Math.min(dBubbleRing, dTail1, dTail2);
      const accentMask = 1 - smoothstep(-1.2, 1.2, dAccent);

      const acT = Math.max(0, Math.min(1, (px - 130) / 252));
      const ar = mix(244, 168, acT);
      const ag = mix(244, 168, acT);
      const ab = mix(245, 174, acT);

      r = mix(r, ar, accentMask);
      g = mix(g, ag, accentMask);
      b = mix(b, ab, accentMask);

      // Crisp inner Pi / Lambda scholarly glyph
      const dTopBar = sdSegment(px, py, 210, 214, 298, 214) - 9.5;
      const dLeftLeg = sdSegment(px, py, 236, 214, 224, 282) - 9.5;
      const dRightLeg = sdSegment(px, py, 274, 214, 284, 282) - 9.5;
      const dGlyph = Math.min(dTopBar, dLeftLeg, dRightLeg);
      const glyphMask = 1 - smoothstep(-1.2, 1.2, dGlyph);

      r = mix(r, 248, glyphMask);
      g = mix(g, 250, glyphMask);
      b = mix(b, 252, glyphMask);

      // Monochrome accent dot
      const dDot = Math.hypot(px - 332, py - 196) - 12;
      const dotMask = 1 - smoothstep(-1.2, 1.2, dDot);
      r = mix(r, 244, dotMask);
      g = mix(g, 244, dotMask);
      b = mix(b, 245, dotMask);

      const idx = (y * size + x) * 4;
      buf[idx] = Math.round(Math.max(0, Math.min(255, r)));
      buf[idx + 1] = Math.round(Math.max(0, Math.min(255, g)));
      buf[idx + 2] = Math.round(Math.max(0, Math.min(255, b)));
      buf[idx + 3] = Math.round(bgAlpha * 255);
    }
  }
  return buf;
}

function createIcoFromPngBuffers(entries) {
  // entries: Array<{ size: number, png: Buffer }>
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;
  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = entry.size >= 256 ? 0 : entry.size;
    dir[1] = entry.size >= 256 ? 0 : entry.size;
    dir[2] = 0; // color palette
    dir[3] = 0; // reserved
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bpp
    dir.writeUInt32LE(entry.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirEntries.push(dir);
    offset += entry.png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.png)]);
}

const png512 = encodePng(512, 512, renderIconRgba(512));
const png256 = encodePng(256, 256, renderIconRgba(256));
const png64 = encodePng(64, 64, renderIconRgba(64));
const png32 = encodePng(32, 32, renderIconRgba(32));

fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), png512);
fs.writeFileSync(
  path.join(buildDir, 'icon.ico'),
  createIcoFromPngBuffers([
    { size: 256, png: png256 },
    { size: 64, png: png64 },
    { size: 32, png: png32 },
  ])
);

console.log('Generated build/icon.png, build/icon.ico, public/icon.svg, public/icon-512.png');
