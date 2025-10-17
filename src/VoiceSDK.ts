import { SpeechTranscriber, SpeechTranscriberOptions, TranscriptionResult } from './adapters/SpeechTranscriber';
import { IatTranscriber, IatTranscriberOptions } from './adapters/xunfei/IatTranscriber';
import { VoskWakeWordDetector } from './wakeword/VoskWakeWordDetector';

export type VoiceSDKEvents = {
  onWake?: () => void;
  onTranscript?: (text: string, isFinal: boolean, raw?: TranscriptionResult) => void;
  onError?: (error: Error) => void;
};

export type VoiceSDKOptions = SpeechTranscriberOptions & {
  wakeWord: string;
  voskModelPath?: string; // URL or path to Vosk model (zip/tar.gz or directory); defaults to bundled model
  xunfei: Pick<IatTranscriberOptions, 'appId' | 'apiKey' | 'sampleRate' | 'frameSize' | 'vadThreshold'>;
  autoStart?: boolean;
  emitBeforeWake?: boolean;
  requireWakeBeforeTranscribe?: boolean;
  endTimeoutMs?: number;
};

export class VoiceSDK {
  private transcriber: SpeechTranscriber;
  private wakeDetector: VoskWakeWordDetector;
  private options: Required<Pick<VoiceSDKOptions, 'emitBeforeWake'>> & VoiceSDKOptions;
  private active = false;
  private woke = false;
  private transcriberStarted = false;
  private events: VoiceSDKEvents = {};
  private endTimer: number | null = null;
  private lastActivityAt = 0;

  constructor(options: VoiceSDKOptions, events: VoiceSDKEvents = {}) {
    // Defaults
    this.options = { emitBeforeWake: false, endTimeoutMs: 1200, requireWakeBeforeTranscribe: true, ...options } as any;
    this.events = events;

    // Validate required fields
    if (!options?.xunfei?.appId || !options?.xunfei?.apiKey) {
      throw new Error('VoiceSDK: xunfei.appId and xunfei.apiKey are required');
    }
    if (!options?.wakeWord) {
      throw new Error('VoiceSDK: wakeWord is required');
    }

    // Fixed pipeline: Xunfei transcriber + Vosk wake detector
    const xfOpts: IatTranscriberOptions = {
      appId: options.xunfei.appId,
      apiKey: options.xunfei.apiKey,
      sampleRate: options.xunfei.sampleRate ?? 16000,
      frameSize: options.xunfei.frameSize ?? 1280,
      vadThreshold: options.xunfei.vadThreshold ?? 0.005,
      locale: options.locale,
      interimResults: options.interimResults ?? true,
    };
    this.transcriber = new IatTranscriber(xfOpts);

    this.wakeDetector = new VoskWakeWordDetector({ modelPath: options.voskModelPath });
    this.wakeDetector.setWakeWord(options.wakeWord);

    // Wire onWake to start ASR when required
    this.wakeDetector.onWake?.(() => {
      if (this.woke) return;
      this.woke = true;
      this.events.onWake?.();
      // Start transcriber upon wake when required
      const requireWake = this.options.requireWakeBeforeTranscribe ?? true;
      if (requireWake && this.active && !this.transcriberStarted) {
        this.transcriber.start().then(() => {
          this.transcriberStarted = true;
        }).catch((e) => this.events.onError?.(e as Error));
      }
    });

    this.transcriber.onResult(this.handleResult);
    this.transcriber.onError((e) => this.events.onError?.(e));

    if (!this.transcriber.isSupported) {
      throw new Error('No supported SpeechTranscriber available in this environment');
    }

    if (this.options.autoStart) {
      // Fire and forget; user can catch errors via onError
      this.start().catch((e) => this.events.onError?.(e as Error));
    }
  }

  private handleResult = (result: TranscriptionResult) => {
    const { transcript, isFinal } = result;

    // Note: Vosk wake detector works independently of transcript stream.

    // Emit transcripts
    if (this.options.emitBeforeWake || this.woke) {
      this.events.onTranscript?.(transcript, isFinal, result);
    }

    // Activity tracking for end-of-utterance (only when wake-gated transcription)
    const requireWake = this.options.requireWakeBeforeTranscribe ?? true;
    if (requireWake && this.woke && this.transcriberStarted) {
      const hasContent = (transcript || '').trim().length > 0;
      if (hasContent || isFinal) {
        this.lastActivityAt = Date.now();
        this.scheduleEndCheck();
      }
    }
  };

  private scheduleEndCheck() {
    if (this.endTimer) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    const timeout = this.options.endTimeoutMs ?? 1200;
    // Debounced check
    this.endTimer = window.setTimeout(() => {
      this.maybeEndUtterance();
    }, timeout);
  }

  private async maybeEndUtterance() {
    const requireWake = this.options.requireWakeBeforeTranscribe ?? Boolean(this.options.wakeWord);
    if (!requireWake) return;
    if (!this.active || !this.woke || !this.transcriberStarted) return;
    const timeout = this.options.endTimeoutMs ?? 1200;
    const now = Date.now();
    if (this.lastActivityAt && now - this.lastActivityAt >= timeout) {
      await this.finishUtterance();
    }
  }

  private async finishUtterance() {
    // Stop current transcription session
    try {
      if (this.transcriberStarted) {
        await this.transcriber.stop();
      }
    } catch (e) {
      this.events.onError?.(e as Error);
    } finally {
      this.transcriberStarted = false;
    }
    // Reset wake state and go back to wake listening
    this.woke = false;
    try {
      this.wakeDetector.reset();
      // Ensure wake detector is running if it has lifecycle
      await this.wakeDetector.start?.();
    } catch (e) {
      // non-fatal
    }
    this.lastActivityAt = 0;
    if (this.endTimer) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.woke = false;
    this.transcriberStarted = false;
    this.lastActivityAt = 0;
    if (this.endTimer) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    // Start wake detector if it provides lifecycle
    try {
      await this.wakeDetector.init?.();
      await this.wakeDetector.start?.();
    } catch (e) {
      this.events.onError?.(e as Error);
    }
    const requireWake = this.options.requireWakeBeforeTranscribe ?? true;
    if (!requireWake) {
      await this.transcriber.start();
      this.transcriberStarted = true;
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    if (this.endTimer) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    if (this.transcriberStarted) {
      await this.transcriber.stop();
      this.transcriberStarted = false;
    }
    try {
      await this.wakeDetector.stop?.();
    } catch (e) {
      // ignore
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  setWakeWord(phrase: string): void {
    this.wakeDetector.setWakeWord(phrase);
    this.woke = false;
  }

  isActive(): boolean { return this.active; }
  isWoke(): boolean { return this.woke; }

  async triggerWake(): Promise<void> {
    if (this.woke) return;
    this.woke = true;
    this.events.onWake?.();
    const requireWake = this.options.requireWakeBeforeTranscribe ?? true;
    if (requireWake && this.active && !this.transcriberStarted) {
      await this.transcriber.start();
      this.transcriberStarted = true;
    }
  }
}
