# Voice SDK 使用指南

## 🎯 新架构说明

从 v0.3.0 开始，Voice SDK 采用全新的解耦架构，提供三种使用方式：

### 1. 独立组件（推荐）⭐
完全独立的唤醒词检测器和语音转写器，使用者自由控制交互逻辑。

### 2. 集成版本
提供便捷的集成层，自动处理唤醒和转写的协调。

### 3. 原有版本（已废弃）
保留向后兼容，不推荐新项目使用。

---

## 📦 安装

```bash
npm install web-voice-kit
# or
pnpm add web-voice-kit
# or
yarn add web-voice-kit
```

---

## 🚀 使用方式

### 方式一：独立组件（推荐）

完全独立使用唤醒词检测器和语音转写器，自由控制交互逻辑。

#### 1.1 仅使用唤醒词检测

```typescript
import { WakeWordDetectorStandalone } from 'web-voice-kit';

const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/vosk-model.zip',
  sampleRate: 16000,
  usePartial: true,
  // 自动重置配置（默认启用，允许连续唤醒）
  autoReset: {
    enabled: true,        // 启用自动重置
    resetDelayMs: 2000    // 唤醒后2秒自动重置
  }
});

// 设置唤醒词
detector.setWakeWords(['小红', '小虹', '你好小红']);

// 监听唤醒事件
detector.onWake((wakeWord) => {
  console.log('检测到唤醒词:', wakeWord);
  // 在这里执行你的自定义逻辑
  // 2秒后自动重置，可以再次唤醒
});

// 监听错误
detector.onError((error) => {
  console.error('唤醒检测错误:', error);
});

// 启动检测
await detector.start();

// 停止检测
// await detector.stop();
```

#### 1.2 仅使用语音转写

```typescript
import { SpeechTranscriberStandalone } from 'web-voice-kit';

const transcriber = new SpeechTranscriberStandalone({
  appId: 'YOUR_XUNFEI_APP_ID',
  apiKey: 'YOUR_XUNFEI_API_KEY',
  websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
  sampleRate: 16000,
  
  // 自动停止配置（可选）
  autoStop: {
    enabled: true,
    silenceTimeoutMs: 3000,      // 静音3秒后自动停止
    noSpeechTimeoutMs: 5000,     // 启动后5秒无语音自动停止
    maxDurationMs: 60000         // 最长转写60秒
  }
});

// 监听转写结果
transcriber.onResult((result) => {
  console.log('转写结果:', result.transcript);
  console.log('是否最终结果:', result.isFinal);
});

// 监听状态变化
transcriber.onStatusChange((status) => {
  console.log('转写状态:', status);
  // status: 'idle' | 'starting' | 'active' | 'processing' | 'stopping'
});

// 监听自动停止事件
transcriber.onAutoStop((reason) => {
  console.log('自动停止原因:', reason);
  // reason: 'silence' | 'no-speech' | 'max-duration'
});

// 启动转写
await transcriber.start();

// 手动停止转写
// await transcriber.stop();
```

#### 1.3 组合使用（自定义交互）

```typescript
import { WakeWordDetectorStandalone, SpeechTranscriberStandalone } from 'web-voice-kit';

// 创建唤醒词检测器（启用自动重置）
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/vosk-model.zip',
  autoReset: {
    enabled: true,
    resetDelayMs: 2000    // 唤醒后2秒自动重置
  }
});
detector.setWakeWords(['小红', '小虹']);

// 创建语音转写器
const transcriber = new SpeechTranscriberStandalone({
  appId: 'YOUR_APP_ID',
  apiKey: 'YOUR_API_KEY',
  websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
  autoStop: {
    enabled: true,
    silenceTimeoutMs: 3000,
    noSpeechTimeoutMs: 5000
  }
});

// 自定义交互逻辑：唤醒后启动转写
detector.onWake(async (wakeWord) => {
  console.log('唤醒了！开始转写...');
  await transcriber.start();
});

// 转写自动停止后的处理
transcriber.onAutoStop((reason) => {
  console.log('转写结束，原因:', reason);
  // 自动重置已在后台进行，无需手动调用 detector.reset()
});

// 启动唤醒检测
await detector.start();
```

---

### 方式二：集成版本（便捷层）

适合需要标准"唤醒-转写"流程的场景。

```typescript
import { VoiceSDKIntegrated } from 'web-voice-kit';

const sdk = new VoiceSDKIntegrated({
  // 唤醒词配置
  wakeWord: ['小红', '小虹', '你好小红'],
  voskModelPath: '/path/to/vosk-model.zip',
  
  // 讯飞转写配置
  xunfei: {
    appId: 'YOUR_APP_ID',
    apiKey: 'YOUR_API_KEY',
    websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
    sampleRate: 16000,
    
    // 自动停止配置
    autoStop: {
      enabled: true,
      silenceTimeoutMs: 3000,
      noSpeechTimeoutMs: 5000,
      maxDurationMs: 60000
    }
  },
  
  // 是否自动启动唤醒检测
  autoStartWakeDetector: false,
  
  // 唤醒后是否自动启动转写
  autoStartTranscriberOnWake: true
}, {
  // 事件回调
  onWake: (wakeWord) => {
    console.log('检测到唤醒词:', wakeWord);
  },
  
  onTranscript: (text, isFinal) => {
    console.log('转写:', text, isFinal ? '[最终]' : '[中间]');
  },
  
  onWakeStatusChange: (status) => {
    console.log('唤醒状态:', status);
    // status: 'idle' | 'listening' | 'woke'
  },
  
  onTranscriptionStatusChange: (status) => {
    console.log('转写状态:', status);
  },
  
  onAutoStop: (reason) => {
    console.log('自动停止:', reason);
  },
  
  onError: (error) => {
    console.error('错误:', error);
  }
});

// 启动唤醒检测
await sdk.start();

// 高级控制：获取底层实例
const detector = sdk.getWakeDetector();
const transcriber = sdk.getTranscriber();

// 运行时更新自动停止配置
transcriber.updateAutoStopConfig({
  silenceTimeoutMs: 5000 // 改为5秒
});

// 停止
// await sdk.stop();
```

---

## ⚙️ 自动停止配置详解

`SpeechTranscriberStandalone` 提供三种自动停止机制：

### 1. 静音超时 (silenceTimeoutMs)
检测到语音活动后，如果静音超过指定时间，自动停止。

**适用场景**：用户说完话后自动结束
**推荐值**：2000-5000ms

```typescript
autoStop: {
  enabled: true,
  silenceTimeoutMs: 3000 // 静音3秒后停止
}
```

### 2. 无语音超时 (noSpeechTimeoutMs)
启动后如果一直没有检测到语音活动，自动停止。

**适用场景**：防止误触发或用户没有说话
**推荐值**：3000-8000ms

```typescript
autoStop: {
  enabled: true,
  noSpeechTimeoutMs: 5000 // 启动后5秒内无语音则停止
}
```

### 3. 最大时长 (maxDurationMs)
无论什么情况，超过最大时长后强制停止。

**适用场景**：防止长时间占用资源
**推荐值**：30000-120000ms

```typescript
autoStop: {
  enabled: true,
  maxDurationMs: 60000 // 最长转写60秒
}
```

### 组合使用（推荐）

```typescript
autoStop: {
  enabled: true,
  silenceTimeoutMs: 3000,      // 静音3秒停止
  noSpeechTimeoutMs: 5000,     // 5秒无语音停止
  maxDurationMs: 60000         // 最长60秒
}
```

### 运行时调整

```typescript
// 创建转写器后，可以动态调整配置
transcriber.updateAutoStopConfig({
  silenceTimeoutMs: 5000,
  enabled: true
});
```

---

## 🎨 完整示例

### 示例1：智能语音助手

```typescript
import { WakeWordDetectorStandalone, SpeechTranscriberStandalone } from 'web-voice-kit';

class VoiceAssistant {
  private detector: WakeWordDetectorStandalone;
  private transcriber: SpeechTranscriberStandalone;
  private conversationText = '';

  constructor() {
    // 初始化唤醒检测
    this.detector = new WakeWordDetectorStandalone({
      modelPath: '/models/vosk-model-small-cn-0.22.zip'
    });
    this.detector.setWakeWords(['小红', '小虹', '你好小红']);
    
    // 初始化转写
    this.transcriber = new SpeechTranscriberStandalone({
      appId: 'YOUR_APP_ID',
      apiKey: 'YOUR_API_KEY',
      websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
      autoStop: {
        enabled: true,
        silenceTimeoutMs: 3000,
        noSpeechTimeoutMs: 5000,
        maxDurationMs: 30000
      }
    });
    
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // 唤醒后启动转写
    this.detector.onWake(async () => {
      console.log('🎤 已唤醒，请说话...');
      this.conversationText = '';
      await this.transcriber.start();
    });
    
    // 处理转写结果
    this.transcriber.onResult((result) => {
      if (result.isFinal) {
        this.conversationText = result.transcript;
        console.log('✅ 最终结果:', this.conversationText);
      } else {
        console.log('⏳ 识别中:', result.transcript);
      }
    });
    
    // 转写结束后处理
    this.transcriber.onAutoStop((reason) => {
      console.log('🛑 转写结束:', reason);
      if (this.conversationText) {
        this.processUserInput(this.conversationText);
      }
      this.detector.reset();
    });
    
    // 错误处理
    this.detector.onError((err) => console.error('唤醒错误:', err));
    this.transcriber.onError((err) => console.error('转写错误:', err));
  }

  async start() {
    await this.detector.start();
    console.log('🚀 语音助手已启动，等待唤醒词...');
  }

  async stop() {
    await this.transcriber.stop();
    await this.detector.stop();
  }

  private processUserInput(text: string) {
    // 处理用户输入，调用AI接口等
    console.log('处理用户输入:', text);
  }
}

// 使用
const assistant = new VoiceAssistant();
await assistant.start();
```

### 示例2：按钮触发转写（无唤醒词）

```typescript
import { SpeechTranscriberStandalone } from 'web-voice-kit';

const transcriber = new SpeechTranscriberStandalone({
  appId: 'YOUR_APP_ID',
  apiKey: 'YOUR_API_KEY',
  websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
  autoStop: {
    enabled: true,
    silenceTimeoutMs: 2000,
    maxDurationMs: 30000
  }
});

transcriber.onResult((result) => {
  document.getElementById('transcript').textContent = result.transcript;
});

transcriber.onStatusChange((status) => {
  document.getElementById('status').textContent = status;
});

// 按钮点击启动
document.getElementById('startBtn').addEventListener('click', async () => {
  await transcriber.start();
});

// 按钮点击停止
document.getElementById('stopBtn').addEventListener('click', async () => {
  await transcriber.stop();
});
```

---

## 🔧 API 参考

### WakeWordDetectorStandalone

#### 构造函数
```typescript
new WakeWordDetectorStandalone(options: WakeWordDetectorStandaloneOptions)

interface WakeWordDetectorStandaloneOptions {
  modelPath?: string;
  sampleRate?: number;
  usePartial?: boolean;
  autoReset?: {
    enabled: boolean;       // 是否启用自动重置（默认：true）
    resetDelayMs?: number;  // 唤醒后多久自动重置（默认：2000ms）
  };
}
```

#### 方法
- `setWakeWord(phrase: string): void` - 设置单个唤醒词
- `setWakeWords(phrases: string[]): void` - 设置多个唤醒词
- `start(): Promise<void>` - 启动检测
- `stop(): Promise<void>` - 停止检测
- `reset(): void` - 手动重置状态（立即生效，清除自动重置定时器）
- `updateAutoResetConfig(config): void` - 更新自动重置配置
- `isActive(): boolean` - 是否运行中
- `isMicrophonePermissionGranted(): boolean` - 麦克风权限状态

#### 事件
- `onWake(callback: (wakeWord: string) => void)` - 唤醒回调
- `onError(callback: (error: Error) => void)` - 错误回调

#### 自动重置功能
默认启用自动重置，唤醒后自动恢复监听状态，允许连续唤醒。详见 [自动重置指南](./docs/AUTO_RESET_GUIDE.md)

### SpeechTranscriberStandalone

#### 构造函数
```typescript
new SpeechTranscriberStandalone(options: SpeechTranscriberStandaloneOptions)
```

#### 方法
- `start(): Promise<void>` - 启动转写
- `stop(): Promise<void>` - 停止转写
- `getStatus(): TranscriberStatus` - 获取状态
- `isActive(): boolean` - 是否运行中
- `updateAutoStopConfig(config)` - 更新自动停止配置

#### 事件
- `onResult(callback: (result: TranscriptionResult) => void)` - 转写结果
- `onStatusChange(callback: (status: TranscriberStatus) => void)` - 状态变化
- `onAutoStop(callback: (reason) => void)` - 自动停止
- `onError(callback: (error: Error) => void)` - 错误回调

---

## 📝 注意事项

1. **模型文件**：Vosk 模型必须可从浏览器访问，注意 CORS 配置
2. **麦克风权限**：首次使用需要用户授权麦克风权限
3. **HTTPS**：生产环境必须使用 HTTPS
4. **浏览器兼容性**：推荐 Chrome/Edge，需要支持 WebAudio API
5. **资源管理**：使用完毕后记得调用 `stop()` 释放资源

---

## 🆚 新旧架构对比

| 特性 | 新架构（独立组件） | 旧架构（VoiceSDK） |
|------|-------------------|-------------------|
| 解耦程度 | ✅ 完全独立 | ❌ 强耦合 |
| 灵活性 | ✅ 自由组合 | ❌ 固定流程 |
| 自动停止 | ✅ 三种机制 | ⚠️ 简单超时 |
| 状态管理 | ✅ 细粒度 | ⚠️ 粗粒度 |
| 学习曲线 | ⚠️ 稍高 | ✅ 简单 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 📚 更多资源

- [GitHub Repository](https://github.com/your-repo)
- [API Documentation](https://your-docs-site.com)
- [Examples](https://github.com/your-repo/examples)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
