# Voice SDK

Lightweight browser voice SDK with a fixed pipeline: Vosk wake word detection + iFlytek (Xunfei) real-time speech transcription. Built with Vite and TypeScript.

Features:
- Continuous wake listening using Vosk (browser-side, requires model asset)
- Real-time transcription using iFlytek (Xunfei) WebSocket API
- Automatic end-of-utterance by inactivity (configurable `endTimeoutMs`, default 1200ms)
- ESM/CJS builds + TypeScript types

## Install

Once published to npm:
```bash
npm i web-voice-kit
# or
pnpm add web-voice-kit
# or
yarn add web-voice-kit
```

For local development in this repo, install deps and build:
```bash
npm i
npm run build
```

## Usage

Minimal example:
```ts
import { VoiceSDK } from 'web-voice-kit';

const sdk = new VoiceSDK({
  // Required: wake word phrase and Vosk model path
  wakeWord: '嘿，小智',
  voskModelPath: '/models/vosk-model-small-zh-cn-0.22.zip', // or a directory URL

  // Required: iFlytek credentials
  xunfei: {
    appId: 'YOUR_APP_ID',
    apiKey: 'YOUR_API_KEY',
    // optional:
    // sampleRate: 16000,
    // frameSize: 1280,
    // vadThreshold: 0.005,
  },

  // Optional
  interimResults: true,
  locale: 'zh-CN',
  // End-of-utterance when no transcript activity for N ms after wake
  endTimeoutMs: 1200,
  // Wake-gated transcription (default true): start ASR only after wake
  requireWakeBeforeTranscribe: true,
}, {
  onWake: () => console.log('Woke!'),
  onTranscript: (text, isFinal) => console.log('ASR:', text, isFinal),
  onError: (e) => console.error('VoiceSDK error:', e),
});

await sdk.start();
// ... later
await sdk.stop();
```

### Notes
- If you don't pass `voskModelPath`, the SDK uses a bundled small Chinese Vosk model by default.
- If you prefer your own model, set `voskModelPath` to a directory URL or an archive (zip/tar.gz). The model must be accessible from the browser (local dev server or CDN). Ensure proper CORS/HTTPS settings.
- `endTimeoutMs` controls how quickly an utterance ends after wake if the user stops speaking. Tune based on UX.
- The SDK uses a single mic source for wake and ASR; permissions are requested by the browser.

## Browser Support

Tested primarily on Chromium-based browsers (Chrome/Edge). Ensure `navigator.mediaDevices.getUserMedia` and WebAudio are available. Vosk runs in-browser via `vosk-browser`.

## Development

- `npm run dev` — Vite dev server for library playground (you can add an `index.html` demo if needed)
- `npm run build` — Produces `dist/` with ES/CJS/UMD bundles and `dist/types/` for typings

## License

MIT
