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
      // Keep modern formats only to avoid UMD post-transform issues and reduce bundle size
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      // Bundle all dependencies for better stability
      output: {
        // Ensure proper module format
        format: 'es'
      }
    },
    sourcemap: true
  }
});
