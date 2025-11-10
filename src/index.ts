// ============ 独立组件（推荐使用）============
export { WakeWordDetectorStandalone } from './standalone/WakeWordDetectorStandalone';
export { SpeechTranscriberStandalone } from './standalone/SpeechTranscriberStandalone';
export type { SpeechTranscriberStandaloneOptions, TranscriberStatus } from './standalone/SpeechTranscriberStandalone';

// ============ 集成版本（可选的便捷层）============
export { VoiceSDKIntegrated } from './VoiceSDKIntegrated';
export type { VoiceSDKIntegratedOptions, VoiceSDKIntegratedEvents } from './VoiceSDKIntegrated';

// ============ 原有版本（向后兼容，已废弃）============
export { VoiceSDK } from './VoiceSDK';
export type { VoiceSDKOptions, VoiceSDKEvents, WakeStatus, TranscriptionStatus } from './VoiceSDK';

// ============ 基础类型 ============
export type { SpeechTranscriberOptions, TranscriptionResult } from './adapters/SpeechTranscriber';
export type { VoskWakeWordOptions } from './wakeword/VoskWakeWordDetector';
export type { IatTranscriberOptions } from './adapters/xunfei/IatTranscriber';