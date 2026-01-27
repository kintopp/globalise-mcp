import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

export default defineConfig({
  plugins: [viteSingleFile()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, '../../dist/apps'),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    // Inline all assets to create a single file
    assetsInlineLimit: 100000000, // 100MB - inline everything
    cssCodeSplit: false,
  },
  // Resolve the ext-apps package from CDN to avoid bundling issues
  resolve: {
    alias: {
      '@modelcontextprotocol/ext-apps': 'https://unpkg.com/@modelcontextprotocol/ext-apps@1.0.1/app-with-deps',
    },
  },
});
