/// <reference types="node" />
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src/index.ts'),
      name: 'VoiceSDK',
      fileName: (format) => `voice-sdk.${format}.js`,
      formats: ['es', 'cjs', 'umd']
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {}
      }
    },
    sourcemap: true
  }
});
