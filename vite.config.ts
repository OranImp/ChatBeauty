import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2021',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const normalized = id.replace(/\\/g, '/');
          if (!normalized.includes('/node_modules/')) return undefined;
          if (
            /\/node_modules\/(react|react-dom|scheduler|zustand|dexie|dompurify|lucide-react)\//.test(
              normalized
            )
          ) {
            return 'vendor-core';
          }
          if (/\/node_modules\/katex\//.test(normalized)) {
            return 'katex';
          }
          if (
            /\/node_modules\/(react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|unist-)/.test(
              normalized
            )
          ) {
            return 'markdown';
          }
          if (
            /\/node_modules\/(@shikijs\/core|@shikijs\/engine-javascript)\//.test(normalized) ||
            /\/node_modules\/shiki\/dist\/core\./.test(normalized)
          ) {
            return 'shiki-core';
          }
          return undefined;
        },
      },
    },
  },
});
