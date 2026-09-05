import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import manifest from './src/manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    crx({ manifest }),
    // pdfjs worker 需作为独立文件提供（GlobalWorkerOptions.workerSrc 指向）
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/pdfjs-dist/build/pdf.worker.mjs',
          dest: 'assets',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    // 扩展页面（chrome-extension:// 世界）里关闭 modulepreload 注入：
    // 预加载的共享 chunk 同时被内容脚本经 web_accessible_resources 暴露，
    // 会触发 Chrome "cross-world extension resource mismatch" 告警，且本地加载并无收益。
    modulePreload: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
