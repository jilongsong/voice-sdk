import { SpeechTranscriber, SpeechTranscriberOptions, TranscriptionResult } from './adapters/SpeechTranscriber';
import { IatTranscriber, IatTranscriberOptions } from './adapters/xunfei/IatTranscriber';
import { VoskWakeWordDetector } from './wakeword/VoskWakeWordDetector';

export type VoiceSDKEvents = {
  onWake?: () => void;
  onTranscript?: (text: string, isFinal: boolean, raw?: TranscriptionResult) => void;
  onError?: (error: Error) => void;
};

export type VoiceSDKOptions = SpeechTranscriberOptions & {
  wakeWord: string | string[];
  xunfei: Pick<IatTranscriberOptions, 'appId' | 'apiKey' | 'sampleRate' | 'frameSize' | 'vadThreshold'>;
  autoStart?: boolean;
  emitBeforeWake?: boolean;
  requireWakeBeforeTranscribe?: boolean;
  endTimeoutMs?: number;
  continuousMode?: boolean; // 连续对话模式
  maxContinuousTimeMs?: number; // 连续对话最大时长
  silenceTimeoutMs?: number; // 静音超时时间
  noSpeechTimeoutMs?: number; // 唤醒后无语音超时时间
};

export class VoiceSDK {
  private transcriber: SpeechTranscriber;
  private wakeDetector: VoskWakeWordDetector;
  private options: Required<Pick<VoiceSDKOptions, 'emitBeforeWake'>> & VoiceSDKOptions;
  private active = false;
  private woke = false;
  private transcriberStarted = false;
  private events: VoiceSDKEvents = {};
  private endTimer: number | null = null;
  private lastActivityAt = 0;
  private continuousStartTime = 0;
  private lastSpeechActivity = 0;
  private hasSpeechActivity = false;
  private noSpeechTimer: number | null = null; // 唤醒后无语音超时定时器

  constructor(options: VoiceSDKOptions, events: VoiceSDKEvents = {}) {
    // Defaults with optimized timeouts for better UX
    this.options = { 
      emitBeforeWake: false, 
      endTimeoutMs: 3000, // 增加到3秒
      silenceTimeoutMs: 2000, // 静音2秒后结束
      continuousMode: true, // 默认开启连续对话
      maxContinuousTimeMs: 30000, // 连续对话最长30秒
      noSpeechTimeoutMs: 5000, // 唤醒后5秒无语音自动返回唤醒监听
      requireWakeBeforeTranscribe: true, 
      ...options 
    } as any;
    this.events = events;

    // Validate required fields
    if (!options?.xunfei?.appId || !options?.xunfei?.apiKey) {
      throw new Error('VoiceSDK: xunfei.appId and xunfei.apiKey are required');
    }
    if (!options?.wakeWord) {
      throw new Error('VoiceSDK: wakeWord is required');
    }

    // Fixed pipeline: Xunfei transcriber + Vosk wake detector
    const xfOpts: IatTranscriberOptions = {
      appId: options.xunfei.appId,
      apiKey: options.xunfei.apiKey,
      sampleRate: options.xunfei.sampleRate ?? 16000,
      frameSize: options.xunfei.frameSize ?? 1280,
      vadThreshold: options.xunfei.vadThreshold ?? 0.002, // 降低VAD阈值，更敏感
      locale: options.locale,
      interimResults: options.interimResults ?? true,
    };
    this.transcriber = new IatTranscriber(xfOpts);

    this.wakeDetector = new VoskWakeWordDetector({});
    if (Array.isArray(options.wakeWord)) {
      this.wakeDetector.setWakeWords(options.wakeWord);
    } else {
      this.wakeDetector.setWakeWord(options.wakeWord);
    }

      // Wire onWake to start ASR when required
    this.wakeDetector.onWake(() => {
      if (this.woke) return;
      this.woke = true;
      this.continuousStartTime = Date.now();
      this.lastSpeechActivity = Date.now();
      this.hasSpeechActivity = false;
      this.events.onWake?.();
      
      // 启动无语音超时定时器
      this.scheduleNoSpeechTimeout();
      
      // Start transcriber upon wake when required
      const requireWake = this.options.requireWakeBeforeTranscribe ?? true;
      if (requireWake && this.active && !this.transcriberStarted) {
        this.transcriber.start().then(() => {
          this.transcriberStarted = true;
        }).catch((e) => this.events.onError?.(e as Error));
      }
    });

    this.transcriber.onResult(this.handleResult);
    this.transcriber.onError((e) => this.events.onError?.(e));

    if (!this.transcriber.isSupported) {
      throw new Error('No supported SpeechTranscriber available in this environment');
    }

    if (this.options.autoStart) {
      // Fire and forget; user can catch errors via onError
      this.start().catch((e) => this.events.onError?.(e as Error));
    }
  }

  private handleResult = (result: TranscriptionResult) => {
    const { transcript, isFinal } = result;

    // Note: Vosk wake detector works independently of transcript stream.

    // Emit transcripts
    if (this.options.emitBeforeWake || this.woke) {
      this.events.onTranscript?.(transcript, isFinal, result);
    }

    // Enhanced activity tracking for continuous conversation
    const requireWake = this.options.requireWakeBeforeTranscribe ?? true;
    if (requireWake && this.woke && this.transcriberStarted) {
      const hasContent = (transcript || '').trim().length > 0;
      
      if (hasContent) {
        this.hasSpeechActivity = true;
        this.lastSpeechActivity = Date.now();
        this.lastActivityAt = Date.now();
        
        // 检测到语音内容，取消无语音超时
        this.clearNoSpeechTimeout();
      }
      
      if (hasContent || isFinal) {
        this.scheduleEndCheck();
      }
    }
  };

  private scheduleNoSpeechTimeout() {
    this.clearNoSpeechTimeout();
    const timeout = this.options.noSpeechTimeoutMs ?? 5000;
    
    this.noSpeechTimer = window.setTimeout(() => {
      console.log('[VoiceSDK] No speech detected after wake, returning to wake listening');
      this.finishUtterance();
    }, timeout);
  }

  private clearNoSpeechTimeout() {
    if (this.noSpeechTimer) {
      window.clearTimeout(this.noSpeechTimer);
      this.noSpeechTimer = null;
    }
  }

  private scheduleEndCheck() {
    if (this.endTimer) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    
    // 智能超时：根据是否有语音活动和连续模式调整
    const continuousMode = this.options.continuousMode ?? true;
    let timeout: number;
    
    if (continuousMode && this.hasSpeechActivity) {
      // 连续模式下，有语音活动时使用静音超时
      timeout = this.options.silenceTimeoutMs ?? 2000;
    } else {
      // 默认超时
      timeout = this.options.endTimeoutMs ?? 3000;
    }
    
    // Debounced check
    this.endTimer = window.setTimeout(() => {
      this.maybeEndUtterance();
    }, timeout);
  }

  private async maybeEndUtterance() {
    const requireWake = this.options.requireWakeBeforeTranscribe ?? Boolean(this.options.wakeWord);
    if (!requireWake) return;
    if (!this.active || !this.woke || !this.transcriberStarted) return;
    
    const now = Date.now();
    const continuousMode = this.options.continuousMode ?? true;
    const maxContinuousTime = this.options.maxContinuousTimeMs ?? 30000;
    
    // 检查是否超过最大连续时间
    if (continuousMode && this.continuousStartTime && now - this.continuousStartTime >= maxContinuousTime) {
      console.log('[VoiceSDK] Maximum continuous time reached, ending session');
      await this.finishUtterance();
      return;
    }
    
    // 智能结束判断
    let shouldEnd = false;
    
    if (continuousMode && this.hasSpeechActivity) {
      // 连续模式：检查静音时间
      const silenceTimeout = this.options.silenceTimeoutMs ?? 2000;
      const timeSinceLastSpeech = now - this.lastSpeechActivity;
      if (timeSinceLastSpeech >= silenceTimeout) {
        console.log('[VoiceSDK] Silence timeout reached in continuous mode');
        shouldEnd = true;
      }
    } else {
      // 普通模式：使用原有逻辑
      const timeout = this.options.endTimeoutMs ?? 3000;
      if (this.lastActivityAt && now - this.lastActivityAt >= timeout) {
        console.log('[VoiceSDK] Activity timeout reached');
        shouldEnd = true;
      }
    }
    
    if (shouldEnd) {
      await this.finishUtterance();
    }
  }

  private async finishUtterance() {
    console.log('[VoiceSDK] Finishing utterance and returning to wake listening');
    
    // Stop current transcription session
    try {
      if (this.transcriberStarted) {
        await this.transcriber.stop();
      }
    } catch (e) {
      this.events.onError?.(e as Error);
    } finally {
      this.transcriberStarted = false;
    }
    
    // Reset all state for next wake cycle
    this.woke = false;
    this.continuousStartTime = 0;
    this.lastSpeechActivity = 0;
    this.hasSpeechActivity = false;
    this.lastActivityAt = 0;
    
    // 清理所有定时器
    if (this.endTimer) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.clearNoSpeechTimeout();
    
    // Return to wake listening
    try {
      this.wakeDetector.reset();
      await this.wakeDetector.start?.();
    } catch (e) {
      console.warn('[VoiceSDK] Error restarting wake detector:', e);
    }
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.woke = false;
    this.transcriberStarted = false;
    this.lastActivityAt = 0;
    if (this.endTimer) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    
    // Start wake detector (which will automatically handle microphone permission)
    try {
      await this.wakeDetector.init?.();
      await this.wakeDetector.start?.();
    } catch (e) {
      const error = e as Error;
      // Provide more user-friendly error messages
      if (error.message.includes('permission')) {
        this.events.onError?.(new Error('Microphone permission is required. Please allow microphone access in your browser and try again.'));
      } else if (error.message.includes('model')) {
        this.events.onError?.(new Error('Failed to load voice recognition model. Please check your internet connection.'));
      } else {
        this.events.onError?.(new Error(`Failed to start wake word detector: ${error.message}`));
      }
      throw error;
    }
    
    const requireWake = this.options.requireWakeBeforeTranscribe ?? true;
    if (!requireWake) {
      try {
        await this.transcriber.start();
        this.transcriberStarted = true;
      } catch (e) {
        const error = e as Error;
        this.events.onError?.(new Error(`Failed to start transcriber: ${error.message}`));
        throw error;
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    
    // 清理所有定时器
    if (this.endTimer) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.clearNoSpeechTimeout();
    
    // Stop transcriber first
    if (this.transcriberStarted) {
      try {
        await this.transcriber.stop();
      } catch (e) {
        console.warn('Error stopping transcriber:', e);
      } finally {
        this.transcriberStarted = false;
      }
    }
    
    // Stop wake detector
    try {
      await this.wakeDetector.stop?.();
    } catch (e) {
      console.warn('Error stopping wake detector:', e);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  setWakeWord(phrase: string): void {
    this.wakeDetector.setWakeWord(phrase);
    this.woke = false;
  }

  isActive(): boolean { return this.active; }
  isWoke(): boolean { return this.woke; }
  
  /**
   * Check if microphone permission is granted
   */
  isMicrophonePermissionGranted(): boolean {
    return this.wakeDetector.isMicrophonePermissionGranted?.() ?? false;
  }

  async triggerWake(): Promise<void> {
    if (this.woke) return;
    this.woke = true;
    this.events.onWake?.();
    const requireWake = this.options.requireWakeBeforeTranscribe ?? true;
    if (requireWake && this.active && !this.transcriberStarted) {
      await this.transcriber.start();
      this.transcriberStarted = true;
    }
  }
}
