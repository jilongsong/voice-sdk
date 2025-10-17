import { SpeechTranscriber, SpeechTranscriberOptions, TranscriptionResult } from './adapters/SpeechTranscriber';
import { WebSpeechTranscriber } from './adapters/webSpeech/WebSpeechTranscriber';
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
};

export class VoiceSDK {
  private transcriber: SpeechTranscriber;
  private wakeDetector: WakeWordDetector;
  private options: Required<Pick<VoiceSDKOptions, 'emitBeforeWake'>> & VoiceSDKOptions;
  private active = false;
  private woke = false;
  private events: VoiceSDKEvents = {};

  constructor(options: VoiceSDKOptions = {}, events: VoiceSDKEvents = {}) {
    this.options = { emitBeforeWake: false, ...options };
    this.events = events;

    this.transcriber = options.transcriber || new WebSpeechTranscriber({
      locale: options.locale,
      interimResults: options.interimResults ?? true,
    });

    this.wakeDetector = options.wakeDetector || new TranscriptWakeWordDetector();
    if (options.wakeWord) this.wakeDetector.setWakeWord(options.wakeWord);

    // If detector supports onWake, wire it to SDK event
    this.wakeDetector.onWake?.(() => {
      if (this.woke) return;
      this.woke = true;
      this.events.onWake?.();
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
    // Start wake detector if it provides lifecycle
    try {
      await this.wakeDetector.init?.();
      await this.wakeDetector.start?.();
    } catch (e) {
      this.events.onError?.(e as Error);
    }
    await this.transcriber.start();
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    await this.transcriber.stop();
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
}
