// AudioWorklet processor for Vosk wake word detection
// This replaces the deprecated ScriptProcessorNode

// Type definitions for AudioWorklet
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor
): void;

interface AudioWorkletNodeOptions {
  processorOptions?: {
    sampleRate?: number;
    targetRate?: number;
  };
}

export class VoskAudioProcessor extends AudioWorkletProcessor {
  private sampleRate: number;
  private targetRate: number;
  private buffer: Float32Array = new Float32Array(0);
  private bufferIndex = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    this.sampleRate = options?.processorOptions?.sampleRate || 48000;
    this.targetRate = options?.processorOptions?.targetRate || 16000;
    
    // Listen for messages from the main thread
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'updateSampleRate') {
        this.sampleRate = event.data.sampleRate;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputData = input[0]; // First channel
    const resampledData = this.resampleTo16kPCM(inputData, this.sampleRate, this.targetRate);
    
    // Send resampled audio data to main thread
    this.port.postMessage({
      type: 'audioData',
      data: resampledData
    });

    return true; // Keep processor alive
  }

  private resampleTo16kPCM(input: Float32Array, inputRate: number, targetRate: number): Int16Array {
    if (inputRate === targetRate) {
      // Direct convert float [-1,1] to int16
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
}

// Register the processor
registerProcessor('vosk-audio-processor', VoskAudioProcessor);
