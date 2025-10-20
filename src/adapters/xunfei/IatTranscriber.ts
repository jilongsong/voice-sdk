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
  private connectingRef = false; // Prevent duplicate connections
  private lastStartAt = 0; // Cooldown timer
  
  // Speech session management
  private speechSessionActive = false;
  private lastSpeechTime = 0;
  private speechTimeoutMs = 2000; // 2秒无语音后才结束会话
  

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
        
        // 关键修复：讯飞API在诗句停顿时会重置segment，导致覆盖
        // 改为简单累积模式，确保所有最终结果都被保留
        if (data.cn.st.type === 0) {
          // Final result - 直接累积到buffer，不依赖segment
          this.resultBuf += textTemp;
          this.emitPartial(this.resultBuf);
        } else {
          // Partial result - 显示累积结果 + 当前临时文本
          const completeResult = this.resultBuf + textTemp;
          this.emitPartial(completeResult);
        }
        
      } else if (jsonData.action === 'error') {
        console.error('[IatTranscriber] iFlytek error:', jsonData);
        this.fail(new Error(`iFlytek error: ${JSON.stringify(jsonData)}`));
      }
    } catch (e: any) {
      console.error('[IatTranscriber] Parse error:', e);
      this.fail(new Error(`iFlytek parse error: ${e?.message || e}`));
    }
  }

  private fail(err: Error) {
    try { this.recorder?.stop(); } catch {}
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.connectingRef = false;
    this.onErrorCb?.(err);
  }

  async start(): Promise<void> {
    if (!this.isSupported) {
      throw new Error('IatTranscriber not supported in this environment');
    }
    
    // Prevent duplicate connections like in working React implementation
    if (this.connectingRef) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Cooldown: avoid multiple starts in short time (prevent 10800 over max connect limit)
    const now = Date.now();
    if (now - this.lastStartAt < 1500) {
      return;
    }
    this.lastStartAt = now;

    // reset state
    this.resultBuf = '';
    this.isSpeechRef = false;
    this.speechSessionActive = false;
    this.lastSpeechTime = 0;

    const url = this.getWebSocketUrl();
    const ws = new WebSocket(url);
    this.ws = ws;
    this.connectingRef = true;

    const recorder = new RecorderManager();
    this.recorder = recorder;

    recorder.onStart = () => {
      // noop
    };

    recorder.onVAD = (isSpeech, energy) => {
      this.isSpeechRef = isSpeech;
      const now = Date.now();
      
      if (isSpeech) {
        // 检测到语音，激活会话并更新时间
        if (!this.speechSessionActive) {
          this.speechSessionActive = true;
          console.log('[IatTranscriber] Speech session started');
        }
        this.lastSpeechTime = now;
      }
    };

    recorder.onFrameRecorded = ({ isLastFrame, frameBuffer }) => {
      if (!this.ws) return;
      if (this.ws.readyState === WebSocket.OPEN) {
        // 修复：始终发送音频帧，确保连续转写不中断
        // 移除会话状态判断，避免停顿时丢失音频数据
        const shouldSendFrame = true;
        
        if (shouldSendFrame) {
          this.ws.send(new Int8Array(frameBuffer));
          if (isLastFrame) {
            this.ws.send('{"end": true}');
            // graceful close if server does not close us
            if (this.closingTimer) window.clearTimeout(this.closingTimer);
            this.closingTimer = window.setTimeout(() => {
              try { this.ws?.close(); } catch {}
            }, 1500);
          }
        } else {
          console.log('[IatTranscriber] Skipping frame (no active speech session)');
        }
      }
    };

    recorder.onStop = () => {
      // noop; consumer controls lifecycle via start/stop
    };

    ws.onopen = () => {
      this.connectingRef = false;
      recorder.start({
        sampleRate: this.opts.sampleRate ?? 16000,
        frameSize: this.opts.frameSize ?? 1280,
        vadThreshold: this.opts.vadThreshold ?? 0.005,
      });
    };

    ws.onmessage = (e) => this.parseMessage(e.data as string);

    ws.onerror = (e) => {
      console.error('WebSocket error', e);
      recorder.stop();
      this.connectingRef = false;
      this.ws = null;
      this.fail(new Error('WebSocket error'));
    };

    ws.onclose = () => {
      recorder.stop();
      this.connectingRef = false;
      this.ws = null;
      if (this.closingTimer) {
        clearTimeout(this.closingTimer);
        this.closingTimer = null;
      }
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
