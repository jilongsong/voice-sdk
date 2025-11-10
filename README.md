# Voice SDK

🎙️ **完全解耦的浏览器语音 SDK**：独立的唤醒词检测 + 语音转写，自由组合使用。

## ✨ 新架构特性 (v0.3.0+)

- 🔓 **完全解耦**：唤醒词检测和语音转写完全独立，可单独使用
- 🎯 **灵活组合**：使用者自由决定如何组合和交互
- ⏱️ **智能超时**：三种自动停止机制（静音/无语音/最大时长）
- 🎨 **多种用法**：独立组件、集成版本、原有版本（向后兼容）
- 📦 **TypeScript**：完整的类型定义
- 🚀 **现代构建**：Vite + ESM/CJS 输出

## 核心组件

### 1. WakeWordDetectorStandalone
独立的唤醒词检测器，基于 Vosk 本地模型。

### 2. SpeechTranscriberStandalone  
独立的语音转写器，基于讯飞实时转写 API，支持智能自动停止。

### 3. VoiceSDKIntegrated
可选的便捷集成层，自动协调唤醒和转写。

## Install

Once published to npm:
```bash
npm i web-voice-kit
# or
pnpm add web-voice-kit
# or
yarn add web-voice-kit
```

For local development in this repo, install deps and build:
```bash
npm i
npm run build
```

## 快速开始

### 方式一：独立组件（推荐）⭐

```typescript
import { WakeWordDetectorStandalone, SpeechTranscriberStandalone } from 'web-voice-kit';

// 1. 创建唤醒词检测器
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/vosk-model.zip'
});
detector.setWakeWords(['小红', '小虹']);

// 2. 创建语音转写器（带智能自动停止）
const transcriber = new SpeechTranscriberStandalone({
  appId: 'YOUR_APP_ID',
  apiKey: 'YOUR_API_KEY',
  websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
  autoStop: {
    enabled: true,
    silenceTimeoutMs: 3000,      // 静音3秒后停止
    noSpeechTimeoutMs: 5000,     // 5秒无语音停止
    maxDurationMs: 60000         // 最长60秒
  }
});

// 3. 自定义交互逻辑
detector.onWake(async () => {
  console.log('唤醒了！');
  await transcriber.start();
});

transcriber.onResult((result) => {
  console.log('转写:', result.transcript);
});

transcriber.onAutoStop((reason) => {
  console.log('自动停止:', reason);
  detector.reset();
});

// 4. 启动
await detector.start();
```

### 方式二：集成版本

```typescript
import { VoiceSDKIntegrated } from 'web-voice-kit';

const sdk = new VoiceSDKIntegrated({
  wakeWord: ['小红', '小虹'],
  voskModelPath: '/path/to/vosk-model.zip',
  xunfei: {
    appId: 'YOUR_APP_ID',
    apiKey: 'YOUR_API_KEY',
    websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
    autoStop: {
      enabled: true,
      silenceTimeoutMs: 3000
    }
  },
  autoStartTranscriberOnWake: true
}, {
  onWake: () => console.log('唤醒！'),
  onTranscript: (text, isFinal) => console.log('转写:', text),
  onAutoStop: (reason) => console.log('停止:', reason)
});

await sdk.start();
```

### 方式三：仅使用转写（无唤醒词）

```typescript
import { SpeechTranscriberStandalone } from 'web-voice-kit';

const transcriber = new SpeechTranscriberStandalone({
  appId: 'YOUR_APP_ID',
  apiKey: 'YOUR_API_KEY',
  websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
  autoStop: { enabled: true, silenceTimeoutMs: 2000 }
});

transcriber.onResult((result) => {
  console.log(result.transcript);
});

// 按钮触发
button.onclick = () => transcriber.start();
```

## 🎯 智能自动停止

`SpeechTranscriberStandalone` 提供三种自动停止机制：

### 1. 静音超时 (silenceTimeoutMs)
检测到语音后，静音超过指定时间自动停止。
- **适用场景**：用户说完话后自动结束
- **推荐值**：2000-5000ms

### 2. 无语音超时 (noSpeechTimeoutMs)  
启动后一直没有语音活动，自动停止。
- **适用场景**：防止误触发
- **推荐值**：3000-8000ms

### 3. 最大时长 (maxDurationMs)
超过最大时长强制停止。
- **适用场景**：防止长时间占用
- **推荐值**：30000-120000ms

```typescript
autoStop: {
  enabled: true,
  silenceTimeoutMs: 3000,      // 静音3秒停止
  noSpeechTimeoutMs: 5000,     // 5秒无语音停止  
  maxDurationMs: 60000         // 最长60秒
}
```

运行时可动态调整：
```typescript
transcriber.updateAutoStopConfig({
  silenceTimeoutMs: 5000
});
```

## 📚 详细文档

完整的使用指南和 API 文档请查看：
- [USAGE.md](./USAGE.md) - 详细使用指南
- [demo-standalone.html](./demo-standalone.html) - 新架构演示
- [demo.html](./demo.html) - 原有版本演示

## 🔧 模型配置

使用唤醒词检测时，需要提供 Vosk 模型：

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/vosk-model.zip'  // 必需！
});
```

**模型获取：**
1. 从 [Vosk Models](https://alphacephei.com/vosk/models) 下载
2. 托管到你的服务器或 CDN
3. 确保浏览器可访问（注意 CORS）

**推荐模型：**
- 中文：`vosk-model-small-cn-0.22` (约 42MB)
- 英文：`vosk-model-small-en-us-0.15` (约 40MB)

## 🆚 架构对比

| 特性 | 新架构（独立组件） | 旧架构 |
|------|-------------------|--------|
| 解耦程度 | ✅ 完全独立 | ❌ 强耦合 |
| 灵活性 | ✅ 自由组合 | ❌ 固定流程 |
| 自动停止 | ✅ 三种机制 | ⚠️ 简单超时 |
| 状态管理 | ✅ 细粒度 | ⚠️ 粗粒度 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

## 🌐 浏览器支持

- ✅ Chrome/Edge (推荐)
- ✅ Firefox
- ⚠️ Safari (部分功能)
- ❌ IE (不支持)

需要支持：
- `navigator.mediaDevices.getUserMedia`
- Web Audio API
- WebSocket

## 🛠️ 开发

```bash
npm install          # 安装依赖
npm run dev          # 开发服务器
npm run build        # 构建生产版本
npm run preview      # 预览构建结果
```

## 📄 License

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
