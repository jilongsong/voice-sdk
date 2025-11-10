import { VoskWakeWordDetector, VoskWakeWordOptions } from '../wakeword/VoskWakeWordDetector';

export interface WakeWordDetectorStandaloneOptions extends VoskWakeWordOptions {
  /**
   * 自动重置配置
   */
  autoReset?: {
    /**
     * 是否启用自动重置（默认：true）
     * 启用后，唤醒触发一段时间后会自动重置，允许再次唤醒
     */
    enabled: boolean;
    /**
     * 唤醒后多久自动重置（毫秒，默认：2000ms）
     */
    resetDelayMs?: number;
  };
}

/**
 * 独立的唤醒词检测器
 * 完全独立运行，不依赖任何其他组件
 */
export class WakeWordDetectorStandalone {
  private detector: VoskWakeWordDetector;
  private options: WakeWordDetectorStandaloneOptions;
  private onWakeCallback?: (wakeWord: string) => void;
  private onErrorCallback?: (error: Error) => void;
  private isRunning = false;
  private autoResetTimer: number | null = null;

  constructor(options: WakeWordDetectorStandaloneOptions) {
    this.options = {
      ...options,
      autoReset: {
        enabled: options.autoReset?.enabled ?? true,
        resetDelayMs: options.autoReset?.resetDelayMs ?? 2000,
      }
    };
    
    this.detector = new VoskWakeWordDetector(options);
    
    // 绑定唤醒回调
    this.detector.onWake(() => {
      this.onWakeCallback?.('wake');
      
      // 自动重置机制
      if (this.options.autoReset?.enabled) {
        this.scheduleAutoReset();
      }
    });
  }

  /**
   * 设置单个唤醒词
   */
  setWakeWord(phrase: string): void {
    this.detector.setWakeWord(phrase);
  }

  /**
   * 设置多个唤醒词
   */
  setWakeWords(phrases: string[]): void {
    this.detector.setWakeWords(phrases);
  }

  /**
   * 启动唤醒词检测
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[WakeWordDetectorStandalone] Already running');
      return;
    }

    try {
      await this.detector.init?.();
      await this.detector.start?.();
      this.isRunning = true;
      console.log('[WakeWordDetectorStandalone] Started successfully');
    } catch (error) {
      this.isRunning = false;
      const err = error instanceof Error ? error : new Error(String(error));
      this.onErrorCallback?.(err);
      throw err;
    }
  }

  /**
   * 停止唤醒词检测
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.clearAutoResetTimer();
      await this.detector.stop?.();
      this.isRunning = false;
      console.log('[WakeWordDetectorStandalone] Stopped successfully');
    } catch (error) {
      console.error('[WakeWordDetectorStandalone] Stop error:', error);
      throw error;
    }
  }

  /**
   * 重置检测器状态
   */
  reset(): void {
    this.clearAutoResetTimer();
    this.detector.reset();
  }

  /**
   * 调度自动重置
   */
  private scheduleAutoReset(): void {
    this.clearAutoResetTimer();
    
    const delay = this.options.autoReset?.resetDelayMs ?? 2000;
    this.autoResetTimer = window.setTimeout(() => {
      console.log('[WakeWordDetectorStandalone] Auto-resetting after wake');
      this.detector.reset();
      this.autoResetTimer = null;
    }, delay);
  }

  /**
   * 清除自动重置定时器
   */
  private clearAutoResetTimer(): void {
    if (this.autoResetTimer) {
      window.clearTimeout(this.autoResetTimer);
      this.autoResetTimer = null;
    }
  }

  /**
   * 更新自动重置配置
   */
  updateAutoResetConfig(config: Partial<NonNullable<WakeWordDetectorStandaloneOptions['autoReset']>>): void {
    this.options.autoReset = {
      ...this.options.autoReset!,
      ...config
    };
  }

  /**
   * 检查是否正在运行
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * 检查麦克风权限是否已授予
   */
  isMicrophonePermissionGranted(): boolean {
    return this.detector.isMicrophonePermissionGranted?.() ?? false;
  }

  /**
   * 请求麦克风权限
   */
  async requestMicrophonePermission(): Promise<boolean> {
    return this.detector.requestMicrophonePermission?.() ?? false;
  }

  /**
   * 设置唤醒回调
   */
  onWake(callback: (wakeWord: string) => void): void {
    this.onWakeCallback = callback;
  }

  /**
   * 设置错误回调
   */
  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }
}
