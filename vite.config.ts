/// <reference types="node" />
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

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
  },
  plugins: [
    {
      name: 'copy-vosk-model',
      writeBundle() {
        const srcModel = path.resolve(__dirname, 'src/vosk-model-small-cn-0.22.zip');
        const distDir = path.resolve(__dirname, 'dist');
        const distModel = path.resolve(distDir, 'vosk-model-small-cn-0.22.zip');
        
        if (!existsSync(distDir)) {
          mkdirSync(distDir, { recursive: true });
        }
        
        if (existsSync(srcModel)) {
          copyFileSync(srcModel, distModel);
          console.log('✓ Copied Vosk model to dist/');
        }
      }
    }
  ]
});
