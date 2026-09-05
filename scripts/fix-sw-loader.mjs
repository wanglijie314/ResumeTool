/**
 * 构建后修复：CRXJS 2.7.1 + Vite 8 生成的 service-worker-loader.js 会错误地
 * import 内容脚本 chunk（其中顶层代码引用 document，在 SW 环境直接抛
 * ReferenceError，导致后台逻辑从不运行）。本脚本把 SW 入口重指向真正的后台 chunk。
 *
 * 用法: node scripts/fix-sw-loader.mjs [distDir]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const assetsDir = join(dist, 'assets');

if (!existsSync(assetsDir)) {
  console.error('[fix-sw-loader] 未找到 assets 目录');
  process.exit(1);
}

const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));

// 后台 chunk 的独有特征（内容/弹窗/选项 chunk 均不含）
const MARKERS = ['unknown-message', 'GET_SETTINGS'];
const bgFiles = jsFiles.filter((f) => {
  const text = readFileSync(join(assetsDir, f), 'utf8');
  return MARKERS.every((m) => text.includes(m));
});

if (bgFiles.length !== 1) {
  console.error(`[fix-sw-loader] 后台 chunk 定位失败（命中 ${bgFiles.length} 个）: ${bgFiles.join(', ')}`);
  process.exit(1);
}

const loaderPath = join(dist, 'service-worker-loader.js');
if (!existsSync(loaderPath)) {
  console.error('[fix-sw-loader] service-worker-loader.js 不存在');
  process.exit(1);
}

const target = `assets/${bgFiles[0]}`;
writeFileSync(loaderPath, `import './${target}';\n`);
console.log(`[fix-sw-loader] service-worker-loader.js -> ${target}`);
