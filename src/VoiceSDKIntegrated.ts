import { WakeWordDetectorStandalone, WakeWordDetectorStandaloneOptions } from './standalone/WakeWordDetectorStandalone';
import { SpeechTranscriberStandalone, SpeechTranscriberStandaloneOptions, TranscriberStatus } from './standalone/SpeechTranscriberStandalone';
import type { TranscriptionResult } from './adapters/SpeechTranscriber';

export type WakeStatus = 'listening' | 'woke' | 'idle';

export type VoiceSDKIntegratedEvents = {
  onWake?: (wakeWord: string) => void;
  onTranscript?: (text: string, isFinal: boolean, raw?: TranscriptionResult) => void;
  onError?: (error: Error) => void;
  onWakeStatusChange?: (status: WakeStatus) => void;
  onTranscriptionStatusChange?: (status: TranscriberStatus) => void;
  onAutoStop?: (reason: 'silence' | 'no-speech' | 'max-duration') => void;
};

export type VoiceSDKIntegratedOptions = {
  /**
   * 唤醒词配置
   */
  wakeWord: string | string[];
  voskModelPath?: string;
  
  /**
   * 唤醒词检测器配置（可选）
   */
  wakeDetectorOptions?: Omit<WakeWordDetectorStandaloneOptions, 'modelPath'>;
  
  /**
   * 讯飞转写配置
   */
  xunfei: SpeechTranscriberStandaloneOptions;
  
  /**
   * 是否自动启动唤醒词检测（默认：false）
   */
  autoStartWakeDetector?: boolean;
  
  /**
   * 唤醒后是否自动启动转写（默认：true）
   */
  autoStartTranscriberOnWake?: boolean;
};

/**
 * VoiceSDK 集成版（可选的便捷层）
 * 提供唤醒词检测 + 语音转写的集成体验
 * 使用者也可以选择直接使用独立的 WakeWordDetectorStandalone 和 SpeechTranscriberStandalone
 */
export class VoiceSDKIntegrated {
  private wakeDetector: WakeWordDetectorStandalone;
  private transcriber: SpeechTranscriberStandalone;
  private options: VoiceSDKIntegratedOptions;
  private events: VoiceSDKIntegratedEvents;
  private currentWakeStatus: WakeStatus = 'idle';

  constructor(options: VoiceSDKIntegratedOptions, events: VoiceSDKIntegratedEvents = {}) {
    this.options = {
      autoStartWakeDetector: false,
      autoStartTranscriberOnWake: true,
      ...options
    };
    this.events = events;

    // 创建唤醒词检测器（默认启用自动重置）
    this.wakeDetector = new WakeWordDetectorStandalone({
      modelPath: options.voskModelPath,
      sampleRate: 16000,
      usePartial: true,
      autoReset: {
        enabled: true,
        resetDelayMs: 2000
      },
      ...options.wakeDetectorOptions
    });

    // 设置唤醒词
    if (Array.isArray(options.wakeWord)) {
      this.wakeDetector.setWakeWords(options.wakeWord);
    } else {
      this.wakeDetector.setWakeWord(options.wakeWord);
    }

    // 绑定唤醒回调
    this.wakeDetector.onWake((wakeWord) => {
      this.updateWakeStatus('woke');
      this.events.onWake?.(wakeWord);
      
      // 如果配置了自动启动转写，则启动
      if (this.options.autoStartTranscriberOnWake) {
        this.startTranscriber().catch(err => {
          this.events.onError?.(err);
        });
      }
    });

    this.wakeDetector.onError((error) => {
      this.events.onError?.(error);
    });

    // 创建转写器
    this.transcriber = new SpeechTranscriberStandalone(options.xunfei);

    // 绑定转写回调
    this.transcriber.onResult((result) => {
      this.events.onTranscript?.(result.transcript, result.isFinal, result);
    });

    this.transcriber.onError((error) => {
      this.events.onError?.(error);
    });

    this.transcriber.onStatusChange((status) => {
      this.events.onTranscriptionStatusChange?.(status);
      
      // 当转写结束时，重置唤醒检测器
      if (status === 'idle' && this.currentWakeStatus === 'woke') {
        this.wakeDetector.reset();
        this.updateWakeStatus('listening');
      }
    });

    this.transcriber.onAutoStop((reason) => {
      this.events.onAutoStop?.(reason);
      // 自动停止后，重置唤醒检测器
      this.wakeDetector.reset();
      this.updateWakeStatus('listening');
    });

    // 自动启动唤醒检测
    if (this.options.autoStartWakeDetector) {
      this.startWakeDetector().catch(err => {
        this.events.onError?.(err);
      });
    }
  }

  /**
   * 启动唤醒词检测
   */
  async startWakeDetector(): Promise<void> {
    await this.wakeDetector.start();
    this.updateWakeStatus('listening');
  }

  /**
   * 停止唤醒词检测
   */
  async stopWakeDetector(): Promise<void> {
    await this.wakeDetector.stop();
    this.updateWakeStatus('idle');
  }

  /**
   * 启动语音转写
   */
  async startTranscriber(): Promise<void> {
    await this.transcriber.start();
  }

  /**
   * 停止语音转写
   */
  async stopTranscriber(): Promise<void> {
    await this.transcriber.stop();
  }

  /**
   * 启动全部（唤醒检测 + 转写准备）
   */
  async start(): Promise<void> {
    await this.startWakeDetector();
  }

  /**
   * 停止全部
   */
  async stop(): Promise<void> {
    await this.stopTranscriber();
    await this.stopWakeDetector();
  }

  /**
   * 获取唤醒词检测器实例（用于高级控制）
   */
  getWakeDetector(): WakeWordDetectorStandalone {
    return this.wakeDetector;
  }

  /**
   * 获取转写器实例（用于高级控制）
   */
  getTranscriber(): SpeechTranscriberStandalone {
    return this.transcriber;
  }

  /**
   * 获取唤醒状态
   */
  getWakeStatus(): WakeStatus {
    return this.currentWakeStatus;
  }

  /**
   * 获取转写状态
   */
  getTranscriberStatus(): TranscriberStatus {
    return this.transcriber.getStatus();
  }

  /**
   * 检查唤醒检测器是否运行
   */
  isWakeDetectorActive(): boolean {
    return this.wakeDetector.isActive();
  }

  /**
   * 检查转写器是否运行
   */
  isTranscriberActive(): boolean {
    return this.transcriber.isActive();
  }

  /**
   * 更新唤醒状态
   */
  private updateWakeStatus(status: WakeStatus): void {
    if (this.currentWakeStatus !== status) {
      this.currentWakeStatus = status;
      this.events.onWakeStatusChange?.(status);
    }
  }
}
