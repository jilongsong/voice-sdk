import { WakeWordDetector } from './WakeWordDetector';
import { createModel } from 'vosk-browser';
export interface VoskWakeWordOptions {
  modelPath?: string;
  sampleRate?: number;
  usePartial?: boolean;
}

export class VoskWakeWordDetector implements WakeWordDetector {
  private options: Required<VoskWakeWordOptions>;
  private onWakeCb?: () => void;
  private phrases: string[] = [];
  private triggered = false;
  private permissionGranted = false;
  
  // Audio processing
  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private workletNode?: ScriptProcessorNode | AudioWorkletNode;
  private stream?: MediaStream;
  
  // Vosk components
  private model: any;
  private recognizer: any;

  constructor(opts: VoskWakeWordOptions) {
    this.options = { 
      modelPath: opts.modelPath || '',
      sampleRate: 16000, 
      usePartial: true, 
      ...opts 
    };
  }

  setWakeWord(phrase: string): void {
    this.phrases = [(phrase || '').trim().toLowerCase()];
    this.triggered = false;
  }

  setWakeWords(phrases: string[]): void {
    this.phrases = phrases.map(p => (p || '').trim().toLowerCase()).filter(p => p.length > 0);
    this.triggered = false;
  }

  reset(): void {
    this.triggered = false;
  }

  inspect(_transcriptChunk: string, _isFinal: boolean): boolean {
    return false;
  }

  onWake(callback: () => void): void {
    this.onWakeCb = callback;
  }

  async init(): Promise<void> {
    if (!this.model) {
      console.log('[VoskWakeWordDetector] Loading Vosk model...');
      
      if (!this.options.modelPath) {
        throw new Error('Model path is required but not provided. Please specify voskModelPath in VoiceSDK options.');
      }
      
      try {
        this.model = await createModel(this.options.modelPath);
        console.log('[VoskWakeWordDetector] Model loaded successfully');
      } catch (error) {
        console.error('[VoskWakeWordDetector] Model loading failed:', error);
        console.error('[VoskWakeWordDetector] Make sure the model path is correct and accessible from the browser');
        console.error('[VoskWakeWordDetector] Current model path:', this.options.modelPath);
        throw new Error(`Failed to load Vosk model from "${this.options.modelPath}". ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    if (!this.recognizer) {
      console.log('[VoskWakeWordDetector] Creating Vosk recognizer...');
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
      
      this.recognizer.on('error', (err: any) => {
        console.error('[VoskWakeWordDetector] Recognizer error:', err);
      });
      
      console.log('[VoskWakeWordDetector] Recognizer created successfully');
    }
  }

  async requestMicrophonePermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      this.permissionGranted = true;
      console.log('[VoskWakeWordDetector] Microphone permission granted');
      return true;
    } catch (error) {
      console.error('[VoskWakeWordDetector] Microphone permission denied:', error);
      this.permissionGranted = false;
      return false;
    }
  }

  isMicrophonePermissionGranted(): boolean {
    return this.permissionGranted;
  }

  private maybeWake(text: string, isFinal: boolean) {
    
    if (!this.phrases.length || this.triggered) {
      if (!this.phrases.length) console.log('[VoskWakeWordDetector] No wake words set');
      if (this.triggered) console.log('[VoskWakeWordDetector] Already triggered, ignoring');
      return;
    }
    
    const lowerText = (text || '').toLowerCase();
    
    // Check if any of the wake words match
    for (const phrase of this.phrases) {
      if (lowerText.includes(phrase)) {
        this.triggered = true;
        this.onWakeCb?.();
        return;
      }
    }
  }

  private async ensureAudio(): Promise<void> {
    if (!this.permissionGranted) {
      await this.requestMicrophonePermission();
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.options.sampleRate });
      console.log(`[VoskWakeWordDetector] AudioContext created, sample rate: ${this.audioContext.sampleRate}`);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: this.options.sampleRate
        } 
      });
      console.log('[VoskWakeWordDetector] Microphone stream acquired');
    }

    if (!this.sourceNode) {
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      console.log('[VoskWakeWordDetector] Audio source node created');
    }

    if (!this.workletNode) {
      await this.setupScriptProcessor();
    }
  }

  private async setupScriptProcessor(): Promise<void> {
    if (!this.audioContext || !this.sourceNode || !this.recognizer) return;

    console.log('[VoskWakeWordDetector] Setting up ScriptProcessor...');
    
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.workletNode = processor as any; // Store as workletNode for cleanup
    
    let audioLogCounter = 0;
    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      try {
        audioLogCounter++;
        
        const channelData = event.inputBuffer.getChannelData(0);
        
        // Apply gain boost like in the React hook example
        const boostedData = new Float32Array(channelData.length);
        const gainMultiplier = 5.0;
        for (let i = 0; i < channelData.length; i++) {
          boostedData[i] = Math.min(1.0, Math.max(-1.0, channelData[i] * gainMultiplier));
        }
        
        // Check volume level
        const maxVolume = Math.max(...Array.from(boostedData).map(Math.abs));
        if (maxVolume > 0.01) {
          // Use the correct Vosk API based on the React hook example
          if (this.recognizer.acceptWaveformFloat) {
            this.recognizer.acceptWaveformFloat(boostedData, this.options.sampleRate);
          } else {
            this.recognizer.acceptWaveform(event.inputBuffer);
          }
        }
      } catch (error) {
        console.error('[VoskWakeWordDetector] Audio processing error:', error);
      }
    };
    
    this.sourceNode.connect(processor);
    processor.connect(this.audioContext.destination);
    
    console.log('[VoskWakeWordDetector] ScriptProcessor connected successfully');
  }

  async start(): Promise<void> {
    console.log('[VoskWakeWordDetector] Starting...');
    await this.init();
    await this.ensureAudio();
    console.log('[VoskWakeWordDetector] Started successfully');
  }

  async stop(): Promise<void> {
    console.log('[VoskWakeWordDetector] Stopping...');
    
    if (this.workletNode) {
      this.workletNode.disconnect();
      if ('onaudioprocess' in this.workletNode) {
        (this.workletNode as ScriptProcessorNode).onaudioprocess = null;
      }
      this.workletNode = undefined;
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = undefined;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = undefined;
    }
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
      this.audioContext = undefined;
    }
    
    this.triggered = false;
    console.log('[VoskWakeWordDetector] Stopped successfully');
  }
}