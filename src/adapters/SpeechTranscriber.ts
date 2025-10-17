export type TranscriptionResult = {
  transcript: string;
  isFinal: boolean;
  confidence?: number;
};

export interface SpeechTranscriberOptions {
  locale?: string; // e.g. 'en-US', 'zh-CN'
  interimResults?: boolean;
}

export interface SpeechTranscriber {
  readonly isSupported: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  onResult(cb: (result: TranscriptionResult) => void): void;
  onError(cb: (error: Error) => void): void;
}
