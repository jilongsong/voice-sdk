import { WakeWordDetector } from './WakeWordDetector';

/**
 * A simple wake word detector that checks if the configured phrase
 * appears in any transcript chunk (case-insensitive).
 */
export class TranscriptWakeWordDetector implements WakeWordDetector {
  private phrase: string = '';
  private triggered = false;

  setWakeWord(phrase: string): void {
    this.phrase = (phrase || '').trim().toLowerCase();
    this.triggered = false;
  }

  reset(): void {
    this.triggered = false;
  }

  inspect(transcriptChunk: string, _isFinal: boolean): boolean {
    if (!this.phrase) return false;
    if (this.triggered) return false;
    const found = (transcriptChunk || '').toLowerCase().includes(this.phrase);
    if (found) {
      this.triggered = true;
      return true;
    }
    return false;
  }
}
