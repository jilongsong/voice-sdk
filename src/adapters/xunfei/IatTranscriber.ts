import CryptoJS from 'crypto-js';
import md5 from 'crypto-js/md5';

import type { SpeechTranscriber, SpeechTranscriberOptions, TranscriptionResult } from '../SpeechTranscriber';
import { RecorderManager } from '../RecorderManager';

export interface IatTranscriberOptions extends SpeechTranscriberOptions {
  appId: string;
  apiKey: string;
  // Audio stream controls
  sampleRate?: number; // default 16000
  frameSize?: number; // default 1280 bytes per frame
  vadThreshold?: number; // default 0.005
}

export class IatTranscriber implements SpeechTranscriber {
  private ws: WebSocket | null = null;
  private recorder: RecorderManager | null = null;
  private resultBuf = '';
  private isSpeechRef = false;
  private closingTimer: number | null = null;

  private onResultCb: ((result: TranscriptionResult) => void) | null = null;
  private onErrorCb: ((error: Error) => void) | null = null;

  public readonly isSupported: boolean = typeof window !== 'undefined' && !!window.WebSocket;

  constructor(private readonly opts: IatTranscriberOptions) {}

  private getWebSocketUrl(): string {
    const ts = Math.floor(Date.now() / 1000);
    const signa = md5(this.opts.appId + ts).toString();
    const signatureSha = CryptoJS.HmacSHA1(signa, this.opts.apiKey);
    const signature = encodeURIComponent(CryptoJS.enc.Base64.stringify(signatureSha));
    return `wss://rtasr.xfyun.cn/v1/ws?appid=${this.opts.appId}&ts=${ts}&signa=${signature}`;
  }

  private emitPartial(text: string) {
    this.onResultCb?.({ transcript: text, isFinal: false });
  }

  private emitFinal(text: string) {
    this.onResultCb?.({ transcript: text, isFinal: true });
  }

  private parseMessage(dataStr: string) {
    try {
      const jsonData = JSON.parse(dataStr);
      if (jsonData.action === 'result') {
        const data = JSON.parse(jsonData.data);
        let textTemp = '';
        data.cn.st.rt.forEach((j: any) =>
          j.ws.forEach((k: any) => k.cw.forEach((l: any) => {
            textTemp += l.w;
          }))
        );
        if (data.cn.st.type === 0) {
          this.resultBuf += textTemp;
        }
        // Emit both partial and final as best-effort
        this.emitPartial(this.resultBuf + textTemp);
        if (jsonData.segment_end || data.cn.st.type === 0) {
          this.emitFinal(this.resultBuf);
        }
      } else if (jsonData.action === 'error') {
        this.fail(new Error(`iFlytek error: ${JSON.stringify(jsonData)}`));
      }
    } catch (e: any) {
      this.fail(new Error(`iFlytek parse error: ${e?.message || e}`));
    }
  }

  private fail(err: Error) {
    try { this.recorder?.stop(); } catch {}
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.onErrorCb?.(err);
  }

  async start(): Promise<void> {
    if (!this.isSupported) {
      throw new Error('IatTranscriber not supported in this environment');
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return; // already connecting/connected
    }

    // reset state
    this.resultBuf = '';
    this.isSpeechRef = false;

    const url = this.getWebSocketUrl();
    const ws = new WebSocket(url);
    this.ws = ws;

    const recorder = new RecorderManager();
    this.recorder = recorder;

    recorder.onStart = () => {
      // noop
    };

    recorder.onVAD = (isSpeech, _energy) => {
      this.isSpeechRef = isSpeech;
    };

    recorder.onFrameRecorded = ({ isLastFrame, frameBuffer }) => {
      if (!this.ws) return;
      if (this.ws.readyState === WebSocket.OPEN) {
        if (this.isSpeechRef || isLastFrame) {
          this.ws.send(new Int8Array(frameBuffer));
          if (isLastFrame) {
            this.ws.send('{"end": true}');
            // graceful close if server does not close us
            if (this.closingTimer) window.clearTimeout(this.closingTimer);
            this.closingTimer = window.setTimeout(() => {
              try { this.ws?.close(); } catch {}
            }, 1500);
          }
        }
      }
    };

    recorder.onStop = () => {
      // noop; consumer controls lifecycle via start/stop
    };

    ws.onopen = () => {
      recorder.start({
        sampleRate: this.opts.sampleRate ?? 16000,
        frameSize: this.opts.frameSize ?? 1280,
        vadThreshold: this.opts.vadThreshold ?? 0.005,
      });
    };

    ws.onmessage = (e) => this.parseMessage(e.data as string);

    ws.onerror = (e) => {
      this.fail(new Error('WebSocket error'));
    };

    ws.onclose = () => {
      try { recorder.stop(); } catch {}
    };
  }

  async stop(): Promise<void> {
    try { this.recorder?.stop(); } catch {}
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }

  onResult(cb: (result: TranscriptionResult) => void): void {
    this.onResultCb = cb;
  }
  onError(cb: (error: Error) => void): void {
    this.onErrorCb = cb;
  }
}
