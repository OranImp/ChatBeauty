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
        manualChunks: {
          katex: ['katex', 'katex/contrib/mhchem'],
          markdown: ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex'],
          mermaid: ['mermaid'],
          echarts: ['echarts'],
          shiki: ['shiki'],
        },
      },
    },
  },
});
