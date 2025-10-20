/*
  Vosk-based wake word detector for the browser.
  Requirements:
  - Provide a model path (e.g., './src/model' or './src/model.tar.gz').
  - Browser context with getUserMedia and WebAudio.
*/

import type { WakeWordDetector } from './WakeWordDetector';
import { ModelLoader } from '../utils/ModelLoader';
import * as Vosk from 'vosk-browser';

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
  private workletNode?: AudioWorkletNode;
  private permissionGranted = false;

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
    if (!this.model) {
      this.model = await ModelLoader.loadModel(Vosk, this.options.modelPath);
    }
    if (!this.recognizer) {
      // KaldiRecognizer requires sample rate parameter
      this.recognizer = new this.model.KaldiRecognizer(this.options.sampleRate);
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


  async requestMicrophonePermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Stop immediately, just testing permission
      this.permissionGranted = true;
      return true;
    } catch (error) {
      this.permissionGranted = false;
      throw new Error(`Microphone permission denied. Please allow microphone access in your browser settings. Details: ${error}`);
    }
  }

  /**
   * Check if microphone permission is already granted
   */
  isMicrophonePermissionGranted(): boolean {
    return this.permissionGranted;
  }

  private maybeWake(text: string, _isFinal: boolean) {
    if (!this.phrase || this.triggered) return;
    if ((text || '').toLowerCase().includes(this.phrase)) {
      this.triggered = true;
      this.onWakeCb?.();
    }
  }

  private async ensureAudio(): Promise<void> {
    // Automatically request permission if not granted
    if (!this.permissionGranted) {
      await this.requestMicrophonePermission();
    }

    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      try { await this.audioContext.resume(); } catch (_) { /* ignore */ }
    }
    
    if (!this.micStream) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            sampleRate: this.options.sampleRate,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (e) {
        throw new Error(`Failed to access microphone: ${e}`);
      }
    }
    
    if (!this.sourceNode) {
      this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
    }
    
    if (!this.workletNode) {
      try {
        // Try to load AudioWorklet processor
        // Create a blob URL for the processor code since we can't use import.meta.url in demo
        const processorCode = `
          class VoskAudioProcessor extends AudioWorkletProcessor {
            constructor(options) {
              super();
              this.sampleRate = options?.processorOptions?.sampleRate || 48000;
              this.targetRate = options?.processorOptions?.targetRate || 16000;
              
              this.port.onmessage = (event) => {
                if (event.data.type === 'updateSampleRate') {
                  this.sampleRate = event.data.sampleRate;
                }
              };
            }

            process(inputs, outputs, parameters) {
              const input = inputs[0];
              if (!input || !input[0]) return true;

              const inputData = input[0];
              const resampledData = this.resampleTo16kPCM(inputData, this.sampleRate, this.targetRate);
              
              this.port.postMessage({
                type: 'audioData',
                data: resampledData
              });

              return true;
            }

            resampleTo16kPCM(input, inputRate, targetRate) {
              if (inputRate === targetRate) {
                const out = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) {
                  const s = Math.max(-1, Math.min(1, input[i]));
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
          }

          registerProcessor('vosk-audio-processor', VoskAudioProcessor);
        `;
        
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const processorUrl = URL.createObjectURL(blob);
        
        await this.audioContext.audioWorklet.addModule(processorUrl);
        
        this.workletNode = new AudioWorkletNode(this.audioContext, 'vosk-audio-processor', {
          processorOptions: {
            sampleRate: this.audioContext.sampleRate,
            targetRate: this.options.sampleRate
          }
        });
        
        // Handle audio data from worklet
        this.workletNode.port.onmessage = (event) => {
          if (event.data.type === 'audioData') {
            try {
              this.recognizer?.acceptWaveform(event.data.data);
            } catch (_) {
              // swallow, recognizer may not be ready
            }
          }
        };
        
        this.sourceNode.connect(this.workletNode);
        
        // Clean up the blob URL
        URL.revokeObjectURL(processorUrl);
      } catch (error) {
        // Fallback to ScriptProcessorNode for older browsers
        console.warn('AudioWorklet not supported, falling back to ScriptProcessorNode:', error);
        await this.setupScriptProcessorFallback();
      }
    }
  }

  private async setupScriptProcessorFallback(): Promise<void> {
    if (!this.audioContext || !this.sourceNode) return;
    
    const bufferSize = 4096;
    const processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    this.sourceNode.connect(processor);
    processor.connect(this.audioContext.destination);

    const inputRate = this.audioContext.sampleRate;
    const targetRate = this.options.sampleRate;

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0);
      const floatMono = input.slice(0);
      const pcm16 = this.resampleTo16kPCM(floatMono, inputRate, targetRate);
      try {
        this.recognizer?.acceptWaveform(pcm16);
      } catch (_) {
        // swallow, recognizer may not be ready
      }
    };
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
      if (this.workletNode) {
        this.workletNode.disconnect();
        this.workletNode = undefined;
      }
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = undefined;
      }
      if (this.micStream) {
        this.micStream.getTracks().forEach(t => t.stop());
        this.micStream = undefined;
      }
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close();
        this.audioContext = undefined;
      }
    } finally {
      // keep model and recognizer for reuse; they are heavy to init
    }
  }
}
