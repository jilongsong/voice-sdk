# Voice SDK

A lightweight browser voice SDK with wake word and transcription, built with Vite and TypeScript. Suitable for publishing on GitHub and consumption by other projects.

Features:
- Wake word detection (default: simple phrase match in transcript)
- Speech-to-text transcription (default: Web Speech API)
- Pluggable adapters for transcribers and wake word detectors
- ESM/CJS/UMD builds + TypeScript types

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

Basic usage with built-in Web Speech API transcriber:
```ts
import { VoiceSDK } from 'web-voice-kit';

const sdk = new VoiceSDK({
  wakeWord: 'hey voice',
  locale: 'zh-CN',
  interimResults: true,
  autoStart: true,
}, {
  onWake: () => console.log('Wake word detected'),
  onTranscript: (text, isFinal) => console.log('Transcript:', text, isFinal),
  onError: (e) => console.error('VoiceSDK error:', e),
});
```

### Use iFlytek (讯飞) real-time transcription with minimal config
```ts
import { VoiceSDK } from 'web-voice-kit';

const sdk = new VoiceSDK({
  // Only appId and apiKey are required to enable Xunfei adapter automatically
  xunfei: {
    appId: 'YOUR_APP_ID',
    apiKey: 'YOUR_API_KEY',
    // optional overrides:
    // sampleRate: 16000,
    // frameSize: 1280,
    // vadThreshold: 0.005,
  },
  interimResults: true,
  locale: 'zh-CN',
}, {
  onTranscript: (text, isFinal) => console.log('ASR:', text, isFinal),
  onError: (e) => console.error('VoiceSDK error:', e),
});

await sdk.start();
// ...
await sdk.stop();
```

Advanced: direct access to the adapter
```ts
import { IatTranscriber, VoiceSDK } from 'web-voice-kit';
const transcriber = new IatTranscriber({ appId: '...', apiKey: '...' });
const sdk = new VoiceSDK({ transcriber });
```

## Browser Support

The default transcriber uses the Web Speech API (SpeechRecognition), which is supported in Chromium-based browsers and some versions of Edge/Chrome. Safari supports a prefixed version. Firefox does not currently support it.

You can provide your own transcriber adapter if you need broader support (e.g., server-side Whisper or WebAssembly-based STT).

## Development

- `npm run dev` — Vite dev server for library playground (you can add an `index.html` demo if needed)
- `npm run build` — Produces `dist/` with ES/CJS/UMD bundles and `dist/types/` for typings

## License

MIT
