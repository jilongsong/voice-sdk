/*
  Vosk-based wake word detector for the browser.
  Requirements:
  - Provide a model path (e.g., './src/model' or './src/model.tar.gz').
  - Browser context with getUserMedia and WebAudio.
*/

import type { WakeWordDetector } from './WakeWordDetector';

// Import as any to avoid type frictions if no types installed
// eslint-disable-next-line @typescript-eslint/no-var-requires
// import * as Vosk from 'vosk-browser';
// Use dynamic import to avoid bundling issues when not used.

export interface VoskWakeWordOptions {
  modelPath?: string; // directory, tar.gz, or zip; if omitted, use built-in model asset
  sampleRate?: number; // target sample rate for recognizer, default 16000
  usePartial?: boolean; // match wake word on partial results too
}

export class VoskWakeWordDetector implements WakeWordDetector {
  private phrase: string = '';
  private triggered = false;
  private onWakeCb?: () => void;

  private options: Required<Pick<VoskWakeWordOptions, 'sampleRate' | 'usePartial'>> & VoskWakeWordOptions;
  private audioContext?: AudioContext;
  private micStream?: MediaStream;
  private sourceNode?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;

  private Vosk: any;
  private model: any;
  private recognizer: any;

  constructor(opts: VoskWakeWordOptions) {
    this.options = { sampleRate: 16000, usePartial: true, ...opts };
  }

  setWakeWord(phrase: string): void {
    this.phrase = (phrase || '').trim().toLowerCase();
    this.triggered = false;
  }

  reset(): void {
    this.triggered = false;
  }

  inspect(_transcriptChunk: string, _isFinal: boolean): boolean {
    // Vosk detector works independently of transcript stream; return false here.
    return false;
  }

  onWake(cb: () => void): void {
    this.onWakeCb = cb;
  }

  async init(): Promise<void> {
    if (!this.Vosk) {
      this.Vosk = await import('vosk-browser');
    }
    if (!this.model) {
      let modelPath = this.options.modelPath;
      if (!modelPath) {
        // Fallback to built-in model bundled as asset
        // Note: ensure the model file exists at src/vosk-model-small-cn-0.22.zip
        const mod: any = await import('../vosk-model-small-cn-0.22.zip?url');
        modelPath = mod.default as string;
      }
      this.model = await this.Vosk.createModel(modelPath);
    }
    if (!this.recognizer) {
      this.recognizer = new this.model.KaldiRecognizer();
      // Wire events
      this.recognizer.on('result', (msg: any) => {
        const text: string = msg?.result?.text || '';
        this.maybeWake(text, true);
      });
      this.recognizer.on('partialresult', (msg: any) => {
        if (!this.options.usePartial) return;
        const text: string = msg?.partial || '';
        this.maybeWake(text, false);
      });
    }
  }

  private maybeWake(text: string, _isFinal: boolean) {
    if (!this.phrase || this.triggered) return;
    if ((text || '').toLowerCase().includes(this.phrase)) {
      this.triggered = true;
      this.onWakeCb?.();
    }
  }

  private async ensureAudio(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (!this.micStream) {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (!this.sourceNode) {
      this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
    }
    if (!this.processor) {
      const bufferSize = 4096; // trade-off latency/cpu
      this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      this.sourceNode.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      const inputRate = this.audioContext.sampleRate;
      const targetRate = this.options.sampleRate;

      this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0); // Float32 [-1,1]
        const floatMono = input.slice(0); // copy
        const pcm16 = this.resampleTo16kPCM(floatMono, inputRate, targetRate);
        try {
          this.recognizer?.acceptWaveform(pcm16);
        } catch (_) {
          // swallow, recognizer may not be ready
        }
      };
    }
  }

  private resampleTo16kPCM(input: Float32Array, inputRate: number, targetRate: number): Int16Array {
    if (inputRate === targetRate) {
      // direct convert float [-1,1] to int16
      const out = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        let s = Math.max(-1, Math.min(1, input[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return out;
    }
    const ratio = inputRate / targetRate;
    const newLen = Math.floor(input.length / ratio);
    const out = new Int16Array(newLen);
    let i = 0;
    let pos = 0;
    while (i < newLen) {
      const nextPos = (i + 1) * ratio;
      // Simple average for downsampling window
      let sum = 0;
      let count = 0;
      while (pos < nextPos && pos < input.length) {
        sum += input[pos] || 0;
        pos++;
        count++;
      }
      const sample = count ? (sum / count) : 0;
      const s = Math.max(-1, Math.min(1, sample));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      i++;
    }
    return out;
  }

  async start(): Promise<void> {
    await this.init();
    await this.ensureAudio();
  }

  async stop(): Promise<void> {
    try {
      if (this.processor) {
        this.processor.disconnect();
        this.processor.onaudioprocess = null as any;
        this.processor = undefined;
      }
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = undefined;
      }
      if (this.micStream) {
        this.micStream.getTracks().forEach(t => t.stop());
        this.micStream = undefined;
      }
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = undefined;
      }
    } finally {
      // keep model and recognizer for reuse; they are heavy to init
    }
  }
}
