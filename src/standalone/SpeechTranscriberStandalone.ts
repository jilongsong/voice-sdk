import { IatTranscriber, IatTranscriberOptions } from '../adapters/xunfei/IatTranscriber';
import type { TranscriptionResult } from '../adapters/SpeechTranscriber';

export interface SpeechTranscriberStandaloneOptions extends IatTranscriberOptions {
  /**
   * 静音自动关闭配置
   */
  autoStop?: {
    /**
     * 是否启用自动停止（默认：false）
     */
    enabled: boolean;
    /**
     * 静音多久后自动停止（毫秒，默认：3000ms）
     */
    silenceTimeoutMs?: number;
    /**
     * 启动后多久没有语音活动就自动停止（毫秒，默认：5000ms）
     */
    noSpeechTimeoutMs?: number;
    /**
     * 最大转写时长，超过后自动停止（毫秒，默认：60000ms = 1分钟）
     */
    maxDurationMs?: number;
  };
}

export type TranscriberStatus = 'idle' | 'starting' | 'active' | 'processing' | 'stopping';

/**
 * 独立的语音转写器
 * 完全独立运行，支持智能自动停止
 */
export class SpeechTranscriberStandalone {
  private transcriber: IatTranscriber;
  private options: SpeechTranscriberStandaloneOptions;
  private status: TranscriberStatus = 'idle';
  
  // 自动停止相关
  private silenceTimer: number | null = null;
  private noSpeechTimer: number | null = null;
  private maxDurationTimer: number | null = null;
  private lastSpeechTime = 0;
  private sessionStartTime = 0;
  private hasSpeechActivity = false;
  
  // 回调
  private onResultCallback?: (result: TranscriptionResult) => void;
  private onErrorCallback?: (error: Error) => void;
  private onStatusChangeCallback?: (status: TranscriberStatus) => void;
  private onAutoStopCallback?: (reason: 'silence' | 'no-speech' | 'max-duration') => void;

  constructor(options: SpeechTranscriberStandaloneOptions) {
    this.options = {
      ...options,
      autoStop: {
        enabled: options.autoStop?.enabled ?? false,
        silenceTimeoutMs: options.autoStop?.silenceTimeoutMs ?? 3000,
        noSpeechTimeoutMs: options.autoStop?.noSpeechTimeoutMs ?? 5000,
        maxDurationMs: options.autoStop?.maxDurationMs ?? 60000,
      }
    };

    this.transcriber = new IatTranscriber(options);
    
    // 绑定转写结果回调
    this.transcriber.onResult((result) => {
      this.handleTranscriptionResult(result);
      this.onResultCallback?.(result);
    });
    
    // 绑定错误回调
    this.transcriber.onError((error) => {
      this.updateStatus('idle');
      this.clearAllTimers();
      this.onErrorCallback?.(error);
    });
  }

  /**
   * 启动语音转写
   */
  async start(): Promise<void> {
    if (this.status !== 'idle') {
      console.warn('[SpeechTranscriberStandalone] Already running or starting');
      return;
    }

    try {
      this.updateStatus('starting');
      this.sessionStartTime = Date.now();
      this.lastSpeechTime = 0;
      this.hasSpeechActivity = false;
      
      await this.transcriber.start();
      this.updateStatus('active');
      
      // 启动自动停止定时器
      if (this.options.autoStop?.enabled) {
        this.startAutoStopTimers();
      }
      
      console.log('[SpeechTranscriberStandalone] Started successfully');
    } catch (error) {
      this.updateStatus('idle');
      const err = error instanceof Error ? error : new Error(String(error));
      this.onErrorCallback?.(err);
      throw err;
    }
  }

  /**
   * 停止语音转写
   */
  async stop(): Promise<void> {
    if (this.status === 'idle' || this.status === 'stopping') {
      return;
    }

    try {
      this.updateStatus('stopping');
      this.clearAllTimers();
      await this.transcriber.stop();
      this.updateStatus('idle');
      console.log('[SpeechTranscriberStandalone] Stopped successfully');
    } catch (error) {
      console.error('[SpeechTranscriberStandalone] Stop error:', error);
      this.updateStatus('idle');
      throw error;
    }
  }

  /**
   * 获取当前状态
   */
  getStatus(): TranscriberStatus {
    return this.status;
  }

  /**
   * 检查是否正在运行
   */
  isActive(): boolean {
    return this.status === 'active' || this.status === 'processing';
  }

  /**
   * 更新自动停止配置（运行时可调整）
   */
  updateAutoStopConfig(config: Partial<NonNullable<SpeechTranscriberStandaloneOptions['autoStop']>>): void {
    this.options.autoStop = {
      ...this.options.autoStop!,
      ...config
    };
    
    // 如果正在运行，重新启动定时器
    if (this.isActive() && this.options.autoStop.enabled) {
      this.clearAllTimers();
      this.startAutoStopTimers();
    }
  }

  /**
   * 处理转写结果
   */
  private handleTranscriptionResult(result: TranscriptionResult): void {
    const { transcript, isFinal } = result;
    const hasContent = (transcript || '').trim().length > 0;

    if (hasContent) {
      this.hasSpeechActivity = true;
      this.lastSpeechTime = Date.now();
      this.updateStatus('processing');
      
      // 检测到语音，取消无语音超时
      this.clearNoSpeechTimer();
      
      // 重置静音定时器
      if (this.options.autoStop?.enabled) {
        this.resetSilenceTimer();
      }
    }

    // 如果是最终结果且启用了自动停止，重置静音定时器
    if (isFinal && this.options.autoStop?.enabled) {
      this.resetSilenceTimer();
    }
  }

  /**
   * 启动自动停止定时器
   */
  private startAutoStopTimers(): void {
    const config = this.options.autoStop!;
    
    // 1. 无语音超时定时器（启动后一直没有语音活动）
    if (config.noSpeechTimeoutMs && config.noSpeechTimeoutMs > 0) {
      this.noSpeechTimer = window.setTimeout(() => {
        if (!this.hasSpeechActivity) {
          console.log('[SpeechTranscriberStandalone] No speech detected, auto-stopping');
          this.onAutoStopCallback?.('no-speech');
          this.stop();
        }
      }, config.noSpeechTimeoutMs);
    }
    
    // 2. 最大时长定时器
    if (config.maxDurationMs && config.maxDurationMs > 0) {
      this.maxDurationTimer = window.setTimeout(() => {
        console.log('[SpeechTranscriberStandalone] Max duration reached, auto-stopping');
        this.onAutoStopCallback?.('max-duration');
        this.stop();
      }, config.maxDurationMs);
    }
    
    // 3. 静音定时器（有语音活动后的静音检测）
    this.resetSilenceTimer();
  }

  /**
   * 重置静音定时器
   */
  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    
    const silenceTimeout = this.options.autoStop?.silenceTimeoutMs ?? 3000;
    if (silenceTimeout > 0 && this.hasSpeechActivity) {
      this.silenceTimer = window.setTimeout(() => {
        const now = Date.now();
        const timeSinceLastSpeech = now - this.lastSpeechTime;
        
        if (timeSinceLastSpeech >= silenceTimeout) {
          console.log('[SpeechTranscriberStandalone] Silence timeout, auto-stopping');
          this.onAutoStopCallback?.('silence');
          this.stop();
        }
      }, silenceTimeout);
    }
  }

  /**
   * 清除所有定时器
   */
  private clearAllTimers(): void {
    this.clearSilenceTimer();
    this.clearNoSpeechTimer();
    this.clearMaxDurationTimer();
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearNoSpeechTimer(): void {
    if (this.noSpeechTimer) {
      window.clearTimeout(this.noSpeechTimer);
      this.noSpeechTimer = null;
    }
  }

  private clearMaxDurationTimer(): void {
    if (this.maxDurationTimer) {
      window.clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  /**
   * 更新状态
   */
  private updateStatus(status: TranscriberStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.onStatusChangeCallback?.(status);
    }
  }

  /**
   * 设置转写结果回调
   */
  onResult(callback: (result: TranscriptionResult) => void): void {
    this.onResultCallback = callback;
  }

  /**
   * 设置错误回调
   */
  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * 设置状态变化回调
   */
  onStatusChange(callback: (status: TranscriberStatus) => void): void {
    this.onStatusChangeCallback = callback;
  }

  /**
   * 设置自动停止回调
   */
  onAutoStop(callback: (reason: 'silence' | 'no-speech' | 'max-duration') => void): void {
    this.onAutoStopCallback = callback;
  }
}
