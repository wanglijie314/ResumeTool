/**
 * 按 PNG 规范手写生成扩展图标（零依赖，Node 内置 zlib）。
 * 用法: node scripts/make-icons.mjs [outDir]
 * 产出 16/32/48/128 的 RGBA PNG：蓝色圆角底 + 白色"简历行"图形。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'public/icons');
const BLUE = [37, 99, 235]; // #2563eb
const WHITE = [255, 255, 255];

// CRC32（PNG 用）
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
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
function pngEncode(size, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 原始扫描行：每行前置 filter 0
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const o = rowStart + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 蓝色圆角方块 */
function roundedRect(x, y, size) {
  const inset = Math.max(1, Math.round(size * 0.05));
  const r = Math.max(1, Math.round(size * 0.22));
  const px = x - inset;
  const py = y - inset;
  const w = size - inset * 2 - 1;
  const h = size - inset * 2 - 1;
  if (px < 0 || py < 0 || px > w || py > h) return false;
  // 四角圆角判定
  const cx = px < r ? r : px > w - r ? w - r : px;
  const cy = py < r ? r : py > h - r ? h - r : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 白色"简历行"：上端粗块 + 三条文本线 */
function pixel(x, y, size) {
  if (!roundedRect(x, y, size)) return [0, 0, 0, 0];
  const m = Math.max(1, Math.round(size * 0.22)); // 内部边距
  const innerW = size - m * 2;
  const rows = Math.max(2, Math.round(size * 0.09)); // 行高
  // 顶部"标题块"
  const blockY = m + Math.round(size * 0.06);
  const blockH = Math.max(1, Math.round(size * 0.08));
  if (y >= blockY && y <= blockY + blockH) {
    if (x >= m && x <= m + Math.round(innerW * 0.62)) return [...WHITE, 255];
    return [0, 0, 0, 0];
  }
  // 三条文本线
  const lineGap = Math.max(2, Math.round(size * 0.13));
  const firstY = blockY + blockH + lineGap;
  const ends = [0.92, 0.72, 0.82]; // 各行长度的比例
  for (let i = 0; i < 3; i++) {
    const y0 = firstY + i * (rows + Math.max(1, Math.round(size * 0.055)));
    if (y >= y0 && y <= y0 + rows) {
      const maxX = m + Math.round(innerW * ends[i]);
      if (x >= m && x <= maxX) return [...WHITE, 255];
      return [0, 0, 0, 0];
    }
  }
  return [...BLUE, 255];
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, pngEncode(size, pixel));
  console.log(`生成 ${file} (${pngEncode(size, pixel).length}B)`);
}
