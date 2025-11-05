import CryptoJS from 'crypto-js';
import md5 from 'crypto-js/md5';

import type { SpeechTranscriber, SpeechTranscriberOptions, TranscriptionResult } from '../SpeechTranscriber';
import { RecorderManager } from '../RecorderManager';

export interface IatTranscriberOptions extends SpeechTranscriberOptions {
  appId: string;
  apiKey: string;
  websocketUrl: string;
  // Audio stream controls
  sampleRate?: number; // default 16000
  frameSize?: number; // default 1280 bytes per frame
  vadThreshold?: number; // default 0.005
  // iFlytek realtime optional params
  // lang: 语种，示例："cn" | "en" | 其它在控制台开通的方言/语种编码
  lang?: string; // e.g. "en"，未授权会返回 10110
  // transType: 翻译类型，示例："normal"（默认）
  transType?: string; // e.g. "normal"（需在控制台开通翻译）
  // transStrategy: 翻译策略，1/2/3，建议使用 2
  transStrategy?: number; // e.g. 2（需在控制台开通翻译）
}

export class IatTranscriber implements SpeechTranscriber {
  private ws: WebSocket | null = null;
  private recorder: RecorderManager | null = null;
  private resultBuf = '';
  private isSpeechRef = false;
  private closingTimer: number | null = null;
  private connectingRef = false; // Prevent duplicate connections
  private lastStartAt = 0; // Cooldown timer
  // Send pacing (avoid bursts): queue frames and send every ~40ms
  private frameQueue: Array<ArrayBuffer | string> = [];
  private sendTimer: number | null = null;
  private readonly frameIntervalMs = 40; // iFlytek 推荐：40ms/帧
  private readonly opts: IatTranscriberOptions;
  
  // Speech session management
  private speechSessionActive = false;
  private lastSpeechTime = 0;
  private speechTimeoutMs = 2000; // 2秒无语音后才结束会话
  

  private onResultCb: ((result: TranscriptionResult) => void) | null = null;
  private onErrorCb: ((error: Error) => void) | null = null;

  public readonly isSupported: boolean = typeof window !== 'undefined' && !!window.WebSocket;

  constructor(opts: IatTranscriberOptions) {
    // 默认开启翻译：lang=cn, transType=normal, transStrategy=2
    this.opts = {
      ...opts,
      lang: opts.lang ?? 'cn',
      transType: opts.transType ?? 'normal',
      transStrategy: opts.transStrategy ?? 2,
    };
  }

  private getWebSocketUrl(): string {
    // const ts = Math.floor(Date.now() / 1000);
    // const signa = md5(this.opts.appId + ts).toString();
    // const signatureSha = CryptoJS.HmacSHA1(signa, this.opts.apiKey);
    // const signature = CryptoJS.enc.Base64.stringify(signatureSha);

    // const params = new URLSearchParams();
    // params.set('appid', this.opts.appId);
    // params.set('ts', String(ts));
    // params.set('signa', signature);
    // // Optional params
    // if (this.opts.lang) params.set('lang', this.opts.lang);
    // if (this.opts.transType) params.set('transType', this.opts.transType);
    // if (typeof this.opts.transStrategy !== 'undefined') params.set('transStrategy', String(this.opts.transStrategy));

    // return `wss://rtasr.xfyun.cn/v1/ws?${params.toString()}`;
    return this.opts.websocketUrl;
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
        // iFlytek 返回的 code 非 "0" 也应视为错误
        if (jsonData.code && String(jsonData.code) !== '0') {
          this.fail(new Error(`iFlytek result error: ${JSON.stringify(jsonData)}`));
          return;
        }

        // data 可能是字符串（官方示例）或对象（某些实现）
        const data = typeof jsonData.data === 'string' ? JSON.parse(jsonData.data) : jsonData.data;

        // 翻译模式（biz = trans）
        if (data && data.biz === 'trans') {
          const srcText: string = data.src ?? '';
          const dstText: string | undefined = data.dst;

          // 累积原文识别文本，优先展示识别文本，若需要可拼接翻译
          if (srcText) {
            // 不依赖 segId，采用简单累积策略
            this.resultBuf += srcText;
          }

          const display = dstText ? `${this.resultBuf}\n${dstText}` : this.resultBuf;

          if (data.isEnd === true) {
            // 翻译结束标识
            this.emitFinal(display);
          } else {
            this.emitPartial(display);
          }
          return;
        }

        // 常规转写结果（cn.st 结构）
        if (data && data.cn && data.cn.st) {
          let textTemp = '';
          try {
            data.cn.st.rt.forEach((j: any) =>
              j.ws.forEach((k: any) => k.cw.forEach((l: any) => {
                textTemp += l.w;
              }))
            );
          } catch (_) {
            // 容错：结构异常时忽略当前片段
          }

          const resultType = Number(data.cn.st.type); // 0=最终；1=中间
          if (resultType === 0) {
            // 最终结果：累积并发出最终片段（isFinal=true）
            this.resultBuf += textTemp;
            this.emitFinal(this.resultBuf);
          } else {
            // 中间结果：展示累积 + 临时文本（isFinal=false）
            const completeResult = this.resultBuf + textTemp;
            this.emitPartial(completeResult);
          }
          return;
        }

        // 未识别的 result 结构，忽略
        return;

      } else if (jsonData.action === 'error') {
        console.error('[IatTranscriber] iFlytek error:', jsonData);
        this.fail(new Error(`iFlytek error: ${JSON.stringify(jsonData)}`));
      } else if (jsonData.action === 'started' || jsonData.action === 'connected') {
        // 握手/连接成功的提示消息，忽略
        return;
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
      // 入队，由发送节流器统一发送，避免突发发送过快
      this.frameQueue.push(frameBuffer);
      if (isLastFrame) {
        this.frameQueue.push('{"end": true}');
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
      // 启动发送节流器：每 40ms 发送一帧，符合官方建议
      if (this.sendTimer) window.clearInterval(this.sendTimer);
      this.sendTimer = window.setInterval(() => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const item = this.frameQueue.shift();
        if (item == null) return;
        try {
          if (typeof item === 'string') {
            this.ws.send(item);
            // 发送结束标记后，若服务端未主动断开，1.5s 后本地关闭
            if (this.closingTimer) window.clearTimeout(this.closingTimer);
            this.closingTimer = window.setTimeout(() => {
              try { this.ws?.close(); } catch {}
            }, 1500);
          } else {
            this.ws.send(new Int8Array(item));
          }
        } catch (err) {
          console.error('[IatTranscriber] send error:', err);
        }
      }, this.frameIntervalMs);
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
      if (this.sendTimer) {
        window.clearInterval(this.sendTimer);
        this.sendTimer = null;
      }
      // 清空未发送队列，避免下次会话污染
      this.frameQueue = [];
    };
  }

  async stop(): Promise<void> {
    try { this.recorder?.stop(); } catch {}
    try { this.ws?.close(); } catch {}
    this.ws = null;
    if (this.sendTimer) {
      window.clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
    this.frameQueue = [];
  }

  onResult(cb: (result: TranscriptionResult) => void): void {
    this.onResultCb = cb;
  }
  onError(cb: (error: Error) => void): void {
    this.onErrorCb = cb;
  }
}
