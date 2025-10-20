// Type definitions for AudioWorklet API
declare global {
  interface AudioContext {
    audioWorklet: AudioWorklet;
  }

  interface AudioWorklet {
    addModule(moduleURL: string | URL): Promise<void>;
  }

  class AudioWorkletNode extends AudioNode {
    readonly port: MessagePort;
    readonly parameters: AudioParamMap;
    
    constructor(
      context: BaseAudioContext,
      name: string,
      options?: AudioWorkletNodeOptions
    );
  }

  interface AudioWorkletNodeOptions extends AudioNodeOptions {
    numberOfInputs?: number;
    numberOfOutputs?: number;
    outputChannelCount?: number[];
    parameterData?: Record<string, number>;
    processorOptions?: any;
  }

  abstract class AudioWorkletProcessor {
    readonly port: MessagePort;
    
    abstract process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>
    ): boolean;
  }

  function registerProcessor(
    name: string,
    processorCtor: typeof AudioWorkletProcessor
  ): void;
}

export {};
