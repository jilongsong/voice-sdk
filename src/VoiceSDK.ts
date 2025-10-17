import { SpeechTranscriber, SpeechTranscriberOptions, TranscriptionResult } from './adapters/SpeechTranscriber';
import { WebSpeechTranscriber } from './adapters/webSpeech/WebSpeechTranscriber';
import { IatTranscriber, IatTranscriberOptions } from './adapters/xunfei/IatTranscriber';
import { WakeWordDetector } from './wakeword/WakeWordDetector';
import { TranscriptWakeWordDetector } from './wakeword/TranscriptWakeWordDetector';

export type VoiceSDKEvents = {
  onWake?: () => void;
  onTranscript?: (text: string, isFinal: boolean, raw?: TranscriptionResult) => void;
  onError?: (error: Error) => void;
};

export type VoiceSDKOptions = SpeechTranscriberOptions & {
  wakeWord?: string; // e.g., 'hey voice'
  autoStart?: boolean; // auto start listening on init
  transcriber?: SpeechTranscriber; // custom adapter
  wakeDetector?: WakeWordDetector; // custom wake word detector
  emitBeforeWake?: boolean; // emit transcripts before wake is detected
  // Provide iFlytek (讯飞) credentials to use IatTranscriber automatically
  xunfei?: Pick<IatTranscriberOptions, 'appId' | 'apiKey' | 'sampleRate' | 'frameSize' | 'vadThreshold'>;
  // If true, do NOT start transcriber until wake is detected. Defaults to true when wakeWord is provided.
  requireWakeBeforeTranscribe?: boolean;
};

export class VoiceSDK {
  private transcriber: SpeechTranscriber;
  private wakeDetector: WakeWordDetector;
  private options: Required<Pick<VoiceSDKOptions, 'emitBeforeWake'>> & VoiceSDKOptions;
  private active = false;
  private woke = false;
  private transcriberStarted = false;
  private events: VoiceSDKEvents = {};

  constructor(options: VoiceSDKOptions = {}, events: VoiceSDKEvents = {}) {
    this.options = { emitBeforeWake: false, ...options };
    this.events = events;

    // Auto-pick Xunfei transcriber if credentials provided, otherwise fall back to WebSpeech
    if (options.transcriber) {
      this.transcriber = options.transcriber;
    } else if (options.xunfei?.appId && options.xunfei?.apiKey) {
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
    } else {
      this.transcriber = new WebSpeechTranscriber({
        locale: options.locale,
        interimResults: options.interimResults ?? true,
      });
    }

    this.wakeDetector = options.wakeDetector || new TranscriptWakeWordDetector();
    if (options.wakeWord) this.wakeDetector.setWakeWord(options.wakeWord);

    // If detector supports onWake, wire it to SDK event
    this.wakeDetector.onWake?.(() => {
      if (this.woke) return;
      this.woke = true;
      this.events.onWake?.();
      // If configured to require wake before starting ASR, start transcriber upon wake
      const requireWake = this.options.requireWakeBeforeTranscribe ?? Boolean(this.options.wakeWord);
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

    // Wake word detection
    if (!this.woke && this.options.wakeWord) {
      // For passive detectors, still allow text-based inspect
      const hit = this.wakeDetector.inspect(transcript, isFinal);
      if (hit) {
        this.woke = true;
        this.events.onWake?.();
        const requireWake = this.options.requireWakeBeforeTranscribe ?? Boolean(this.options.wakeWord);
        if (requireWake && this.active && !this.transcriberStarted) {
          this.transcriber.start().then(() => {
            this.transcriberStarted = true;
          }).catch((e) => this.events.onError?.(e as Error));
        }
      }
    }

    // Emit transcripts
    if (this.options.emitBeforeWake || this.woke || !this.options.wakeWord) {
      this.events.onTranscript?.(transcript, isFinal, result);
    }
  };

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.woke = false;
    this.transcriberStarted = false;
    // Start wake detector if it provides lifecycle
    try {
      await this.wakeDetector.init?.();
      await this.wakeDetector.start?.();
    } catch (e) {
      this.events.onError?.(e as Error);
    }
    const requireWake = this.options.requireWakeBeforeTranscribe ?? Boolean(this.options.wakeWord);
    if (!requireWake) {
      await this.transcriber.start();
      this.transcriberStarted = true;
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
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

  // Programmatically trigger wake from external detector/button.
  // Useful when requireWakeBeforeTranscribe=true and no transcript-based detector is used.
  async triggerWake(): Promise<void> {
    if (this.woke) return;
    this.woke = true;
    this.events.onWake?.();
    const requireWake = this.options.requireWakeBeforeTranscribe ?? Boolean(this.options.wakeWord);
    if (requireWake && this.active && !this.transcriberStarted) {
      await this.transcriber.start();
      this.transcriberStarted = true;
    }
  }
}
