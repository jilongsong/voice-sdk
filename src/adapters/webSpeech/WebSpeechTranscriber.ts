import { SpeechTranscriber, SpeechTranscriberOptions, TranscriptionResult } from '../SpeechTranscriber';

// Types provided by @types/dom-speech-recognition
const SpeechRecognitionImpl: typeof window extends { webkitSpeechRecognition: any } ? any : any =
  (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;

export class WebSpeechTranscriber implements SpeechTranscriber {
  private recognition?: SpeechRecognition;
  private resultCb?: (result: TranscriptionResult) => void;
  private errorCb?: (error: Error) => void;
  private options: SpeechTranscriberOptions;

  public readonly isSupported: boolean = typeof SpeechRecognitionImpl !== 'undefined';

  constructor(options: SpeechTranscriberOptions = {}) {
    this.options = { interimResults: true, ...options };

    if (this.isSupported) {
      this.recognition = new SpeechRecognitionImpl();
      if (!this.recognition) return;
      this.recognition.lang = this.options.locale || 'en-US';
      this.recognition.interimResults = !!this.options.interimResults;
      this.recognition.continuous = true;

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const transcript = res[0]?.transcript ?? '';
          const confidence = res[0]?.confidence;
          const isFinal = res.isFinal;
          this.resultCb?.({ transcript, isFinal, confidence });
        }
      };

      this.recognition.onerror = (event: any) => {
        const err = new Error(event?.error || 'Speech recognition error');
        this.errorCb?.(err);
      };

      this.recognition.onend = () => {
        // Auto-restart to keep continuous transcription running
        try {
          this.recognition?.start();
        } catch (_) {
          // ignore if already started
        }
      };
    }
  }

  async start(): Promise<void> {
    if (!this.isSupported || !this.recognition) throw new Error('Web Speech API is not supported in this browser');
    try {
      this.recognition.start();
    } catch (e) {
      // Some browsers throw if already started; ignore
    }
  }

  async stop(): Promise<void> {
    if (!this.isSupported || !this.recognition) return;
    this.recognition.onend = null as any; // prevent auto-restart on manual stop
    this.recognition.stop();
  }

  onResult(cb: (result: TranscriptionResult) => void): void {
    this.resultCb = cb;
  }

  onError(cb: (error: Error) => void): void {
    this.errorCb = cb;
  }
}
