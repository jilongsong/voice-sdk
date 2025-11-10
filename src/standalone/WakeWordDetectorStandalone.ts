import { VoskWakeWordDetector, VoskWakeWordOptions } from '../wakeword/VoskWakeWordDetector';

/**
 * 独立的唤醒词检测器
 * 完全独立运行，不依赖任何其他组件
 */
export class WakeWordDetectorStandalone {
  private detector: VoskWakeWordDetector;
  private onWakeCallback?: (wakeWord: string) => void;
  private onErrorCallback?: (error: Error) => void;
  private isRunning = false;

  constructor(options: VoskWakeWordOptions) {
    this.detector = new VoskWakeWordDetector(options);
    
    // 绑定唤醒回调
    this.detector.onWake(() => {
      this.onWakeCallback?.('wake');
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
    this.detector.reset();
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
