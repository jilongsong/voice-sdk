# 架构设计文档

## 📐 新架构概览 (v0.3.0+)

### 设计理念

**完全解耦 + 自由组合**

新架构将唤醒词检测和语音转写完全分离，使用者可以：
- 单独使用唤醒词检测
- 单独使用语音转写
- 自由组合两者，自定义交互逻辑
- 使用集成版本获得开箱即用的体验

---

## 🏗️ 架构层次

```
┌─────────────────────────────────────────────────────┐
│  应用层 (Application Layer)                          │
│  - 使用者自定义的业务逻辑                              │
│  - 自由决定如何组合和交互                              │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  集成层 (Integration Layer) - 可选                   │
│  VoiceSDKIntegrated                                 │
│  - 提供便捷的集成体验                                 │
│  - 自动协调唤醒和转写                                 │
└─────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────┐    ┌──────────────────────┐
│  独立组件层           │    │  独立组件层           │
│  (Standalone Layer)  │    │  (Standalone Layer)  │
│                      │    │                      │
│  WakeWordDetector    │    │  SpeechTranscriber   │
│  Standalone          │    │  Standalone          │
│                      │    │                      │
│  - 唤醒词检测         │    │  - 语音转写           │
│  - 完全独立运行       │    │  - 完全独立运行       │
│  - 不依赖转写器       │    │  - 不依赖唤醒检测     │
└──────────────────────┘    └──────────────────────┘
         ↓                           ↓
┌──────────────────────┐    ┌──────────────────────┐
│  核心实现层           │    │  核心实现层           │
│  (Core Layer)        │    │  (Core Layer)        │
│                      │    │                      │
│  VoskWakeWord        │    │  IatTranscriber      │
│  Detector            │    │  (Xunfei)            │
│                      │    │                      │
│  - Vosk 模型加载      │    │  - WebSocket 连接    │
│  - 音频处理           │    │  - 音频采集          │
│  - 相似度匹配         │    │  - VAD 检测          │
└──────────────────────┘    └──────────────────────┘
```

---

## 🔑 核心组件

### 1. WakeWordDetectorStandalone

**职责**：
- 持续监听麦克风音频
- 检测预设的唤醒词
- 触发唤醒回调

**特点**：
- ✅ 完全独立，不依赖任何其他组件
- ✅ 支持多个唤醒词
- ✅ 基于 Vosk 本地模型，无需网络
- ✅ 智能相似度匹配（拼音 + 编辑距离）

**状态管理**：
- 内部管理运行状态
- 提供 `isActive()` 查询
- 提供 `reset()` 重置

**API 设计**：
```typescript
class WakeWordDetectorStandalone {
  constructor(options: VoskWakeWordOptions)
  
  // 配置
  setWakeWord(phrase: string): void
  setWakeWords(phrases: string[]): void
  
  // 控制
  async start(): Promise<void>
  async stop(): Promise<void>
  reset(): void
  
  // 查询
  isActive(): boolean
  isMicrophonePermissionGranted(): boolean
  
  // 事件
  onWake(callback: (wakeWord: string) => void): void
  onError(callback: (error: Error) => void): void
}
```

---

### 2. SpeechTranscriberStandalone

**职责**：
- 采集麦克风音频
- 实时语音转写
- 智能自动停止

**特点**：
- ✅ 完全独立，不依赖唤醒检测
- ✅ 三种自动停止机制
- ✅ 运行时可调整配置
- ✅ 细粒度状态管理

**状态管理**：
```
idle → starting → active → processing → stopping → idle
                     ↓
                  (自动停止)
```

**自动停止机制**：

1. **静音超时** (silenceTimeoutMs)
   - 检测到语音后，静音超过指定时间自动停止
   - 适用场景：用户说完话后自动结束
   - 推荐值：2000-5000ms

2. **无语音超时** (noSpeechTimeoutMs)
   - 启动后一直没有语音活动，自动停止
   - 适用场景：防止误触发或用户没有说话
   - 推荐值：3000-8000ms

3. **最大时长** (maxDurationMs)
   - 无论什么情况，超过最大时长强制停止
   - 适用场景：防止长时间占用资源
   - 推荐值：30000-120000ms

**API 设计**：
```typescript
class SpeechTranscriberStandalone {
  constructor(options: SpeechTranscriberStandaloneOptions)
  
  // 控制
  async start(): Promise<void>
  async stop(): Promise<void>
  
  // 查询
  getStatus(): TranscriberStatus
  isActive(): boolean
  
  // 配置
  updateAutoStopConfig(config: Partial<AutoStopConfig>): void
  
  // 事件
  onResult(callback: (result: TranscriptionResult) => void): void
  onStatusChange(callback: (status: TranscriberStatus) => void): void
  onAutoStop(callback: (reason: string) => void): void
  onError(callback: (error: Error) => void): void
}
```

---

### 3. VoiceSDKIntegrated

**职责**：
- 集成唤醒和转写
- 自动协调交互
- 提供便捷 API

**特点**：
- ✅ 开箱即用
- ✅ 自动处理唤醒后启动转写
- ✅ 自动处理转写结束后重置唤醒
- ✅ 提供底层实例访问（高级控制）

**API 设计**：
```typescript
class VoiceSDKIntegrated {
  constructor(
    options: VoiceSDKIntegratedOptions,
    events: VoiceSDKIntegratedEvents
  )
  
  // 控制
  async start(): Promise<void>
  async stop(): Promise<void>
  async startWakeDetector(): Promise<void>
  async stopWakeDetector(): Promise<void>
  async startTranscriber(): Promise<void>
  async stopTranscriber(): Promise<void>
  
  // 查询
  getWakeStatus(): WakeStatus
  getTranscriberStatus(): TranscriberStatus
  isWakeDetectorActive(): boolean
  isTranscriberActive(): boolean
  
  // 高级控制
  getWakeDetector(): WakeWordDetectorStandalone
  getTranscriber(): SpeechTranscriberStandalone
}
```

---

## 🔄 交互流程

### 独立组件模式

```
用户代码
  ↓
创建 WakeWordDetectorStandalone
  ↓
创建 SpeechTranscriberStandalone
  ↓
自定义交互逻辑：
  detector.onWake(() => {
    transcriber.start();
  });
  
  transcriber.onAutoStop(() => {
    detector.reset();
  });
  ↓
启动 detector
  ↓
[等待唤醒]
  ↓
检测到唤醒词
  ↓
触发 onWake 回调
  ↓
用户代码启动 transcriber
  ↓
[语音转写中]
  ↓
检测到静音/无语音/超时
  ↓
自动停止 transcriber
  ↓
触发 onAutoStop 回调
  ↓
用户代码重置 detector
  ↓
[回到等待唤醒状态]
```

### 集成模式

```
用户代码
  ↓
创建 VoiceSDKIntegrated
  ↓
启动 sdk.start()
  ↓
[自动启动唤醒检测]
  ↓
检测到唤醒词
  ↓
[自动启动转写]
  ↓
[语音转写中]
  ↓
自动停止
  ↓
[自动重置唤醒检测]
  ↓
[回到等待唤醒状态]
```

---

## 🎯 设计优势

### 1. 完全解耦
- 唤醒和转写互不依赖
- 可以单独使用任一组件
- 便于测试和维护

### 2. 灵活组合
- 使用者自由控制交互逻辑
- 可以实现复杂的业务流程
- 支持多种使用场景

### 3. 智能自动停止
- 三种机制可组合使用
- 运行时可动态调整
- 提供停止原因回调

### 4. 向后兼容
- 保留原有 VoiceSDK
- 现有代码无需修改
- 平滑迁移路径

### 5. 类型安全
- 完整的 TypeScript 类型定义
- 编译时类型检查
- 更好的 IDE 支持

---

## 📊 对比分析

### 旧架构 (VoiceSDK)

**优点**：
- 简单易用
- 开箱即用
- 学习曲线低

**缺点**：
- 强耦合设计
- 固定交互流程
- 灵活性差
- 状态管理粗糙
- 自动停止机制简单

### 新架构 (Standalone Components)

**优点**：
- 完全解耦
- 高度灵活
- 细粒度控制
- 智能自动停止
- 易于扩展

**缺点**：
- 学习曲线稍高
- 需要编写更多代码

**解决方案**：
- 提供 VoiceSDKIntegrated 作为便捷层
- 详细的文档和示例
- 交互式演示页面

---

## 🚀 使用建议

### 场景 1：标准唤醒-转写流程
**推荐**：VoiceSDKIntegrated
```typescript
const sdk = new VoiceSDKIntegrated({...}, {...});
await sdk.start();
```

### 场景 2：自定义交互逻辑
**推荐**：独立组件
```typescript
const detector = new WakeWordDetectorStandalone({...});
const transcriber = new SpeechTranscriberStandalone({...});
// 自定义交互
```

### 场景 3：仅需要唤醒词检测
**推荐**：WakeWordDetectorStandalone
```typescript
const detector = new WakeWordDetectorStandalone({...});
detector.onWake(() => {
  // 执行自定义操作
});
```

### 场景 4：仅需要语音转写
**推荐**：SpeechTranscriberStandalone
```typescript
const transcriber = new SpeechTranscriberStandalone({...});
button.onclick = () => transcriber.start();
```

---

## 🔮 未来扩展

新架构为未来扩展提供了良好的基础：

1. **支持更多唤醒引擎**
   - 可以创建其他 WakeWordDetector 实现
   - 保持相同的接口

2. **支持更多转写服务**
   - 可以创建其他 SpeechTranscriber 实现
   - 保持相同的接口

3. **插件系统**
   - 可以添加中间件
   - 可以添加自定义处理器

4. **更多自动停止策略**
   - 基于内容的停止
   - 基于情感的停止
   - 基于意图的停止

---

## 📝 迁移指南

### 从旧版本迁移

**旧代码**：
```typescript
import { VoiceSDK } from 'web-voice-kit';

const sdk = new VoiceSDK({
  wakeWord: '小红',
  voskModelPath: '/model.zip',
  xunfei: { appId: 'xxx', apiKey: 'xxx' }
}, {
  onWake: () => console.log('wake'),
  onTranscript: (text) => console.log(text)
});

await sdk.start();
```

**新代码（集成版本）**：
```typescript
import { VoiceSDKIntegrated } from 'web-voice-kit';

const sdk = new VoiceSDKIntegrated({
  wakeWord: '小红',
  voskModelPath: '/model.zip',
  xunfei: {
    appId: 'xxx',
    apiKey: 'xxx',
    websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
    autoStop: { enabled: true, silenceTimeoutMs: 3000 }
  }
}, {
  onWake: () => console.log('wake'),
  onTranscript: (text) => console.log(text)
});

await sdk.start();
```

**新代码（独立组件）**：
```typescript
import { WakeWordDetectorStandalone, SpeechTranscriberStandalone } from 'web-voice-kit';

const detector = new WakeWordDetectorStandalone({
  modelPath: '/model.zip'
});
detector.setWakeWord('小红');

const transcriber = new SpeechTranscriberStandalone({
  appId: 'xxx',
  apiKey: 'xxx',
  websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
  autoStop: { enabled: true, silenceTimeoutMs: 3000 }
});

detector.onWake(() => {
  console.log('wake');
  transcriber.start();
});

transcriber.onResult((result) => {
  console.log(result.transcript);
});

transcriber.onAutoStop(() => {
  detector.reset();
});

await detector.start();
```

---

## 📖 总结

新架构通过完全解耦的设计，提供了：
- ✅ 更高的灵活性
- ✅ 更好的可维护性
- ✅ 更强的扩展性
- ✅ 更智能的自动停止
- ✅ 向后兼容性

同时保持了简单易用的特点（通过集成层），是一次成功的架构升级。
