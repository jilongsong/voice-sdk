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
  // Required: wake word phrase
  wakeWord: '嘿，小智',
  
  // Required: Vosk model path - MUST be provided when using as npm package
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
  onWakeStatusChange: (status) => console.log('Wake status:', status),
  onTranscriptionStatusChange: (status) => console.log('Transcription status:', status),
});

await sdk.start();
// ... later
await sdk.stop();
```

## Status Events

The SDK provides two status tracking events to monitor the current state:

### Wake Status
- `listening` - SDK is actively listening for wake words
- `woke` - Wake word detected, transcription session started
- `timeout` - No speech detected after wake, returning to listening mode

### Transcription Status  
- `idle` - No active transcription session
- `active` - Transcription session started, waiting for speech
- `processing` - Actively processing speech input

```ts
const sdk = new VoiceSDK(options, {
  onWakeStatusChange: (status) => {
    switch(status) {
      case 'listening':
        console.log('Ready for wake word');
        break;
      case 'woke':
        console.log('Wake word detected!');
        break;
      case 'timeout':
        console.log('No speech detected, back to listening');
        break;
    }
  },
  onTranscriptionStatusChange: (status) => {
    switch(status) {
      case 'idle':
        console.log('Transcription inactive');
        break;
      case 'active':
        console.log('Ready for speech input');
        break;
      case 'processing':
        console.log('Processing speech...');
        break;
    }
  }
});

// Get current status
console.log('Wake status:', sdk.getWakeStatus());
console.log('Transcription status:', sdk.getTranscriptionStatus());
```

### Model Setup

**IMPORTANT**: When using this SDK as an npm package, you **MUST** provide the `voskModelPath` option:

```ts
const sdk = new VoiceSDK({
  wakeWord: '嘿，小智',
  voskModelPath: '/path/to/vosk-model.zip', // Required!
  xunfei: { /* ... */ }
});
```

**Model Options:**
1. **Download a Vosk model** from [Vosk Models](https://alphacephei.com/vosk/models) 
2. **Host the model file** on your web server or CDN
3. **Set the correct path** - can be:
   - A zip archive: `/models/vosk-model-small-zh-cn-0.22.zip`
   - A directory URL: `/models/vosk-model-small-zh-cn-0.22/`
   - A CDN URL: `https://cdn.example.com/vosk-model.zip`

**Common Issues:**
- ❌ "Unrecognized archive format" - Model path is incorrect or file not accessible
- ❌ CORS errors - Ensure proper CORS headers if loading from different domain
- ❌ 404 errors - Model file not found at specified path

### Notes
- The model must be accessible from the browser with proper CORS/HTTPS settings
- `endTimeoutMs` controls how quickly an utterance ends after wake if the user stops speaking
- The SDK uses a single mic source for wake and ASR; permissions are requested by the browser

## Browser Support

Tested primarily on Chromium-based browsers (Chrome/Edge). Ensure `navigator.mediaDevices.getUserMedia` and WebAudio are available. Vosk runs in-browser via `vosk-browser`.

## Development

- `npm run dev` — Vite dev server for library playground (you can add an `index.html` demo if needed)
- `npm run build` — Produces `dist/` with ES/CJS/UMD bundles and `dist/types/` for typings

## License

MIT
