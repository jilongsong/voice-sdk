export interface WakeWordDetector {
  setWakeWord(phrase: string): void;
  reset(): void;
  inspect(transcriptChunk: string, isFinal: boolean): boolean; // returns true if wake word detected
  // Optional lifecycle for active detectors (e.g., Vosk)
  init?(): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  onWake?(cb: () => void): void;
}
