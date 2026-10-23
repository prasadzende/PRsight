import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Strict CSP for packaged builds (file:// pages don't get the header set in main). Dev uses the header from main.
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'" />`;
const cspInBuild = { name: 'csp-in-build', apply: 'build' as const, transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n    ${CSP_META}`) };

const alias = { '@shared': resolve('src/shared'), '@analysis': resolve('src/analysis') };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), worker: resolve('src/worker/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { ...alias, '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), cspInBuild],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
});
