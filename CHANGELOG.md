# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2025-11-10

### 🎉 重大架构升级 - 完全解耦设计

这是一个重大版本更新，引入了全新的解耦架构，同时保持向后兼容。

### ✨ 新增

#### 独立组件（推荐使用）
- **`WakeWordDetectorStandalone`** - 独立的唤醒词检测器
  - 完全独立运行，不依赖转写器
  - 支持多个唤醒词
  - 麦克风权限管理
  - 状态重置功能

- **`SpeechTranscriberStandalone`** - 独立的语音转写器
  - 完全独立运行，不依赖唤醒检测
  - **智能自动停止机制**：
    - `silenceTimeoutMs` - 静音超时自动停止
    - `noSpeechTimeoutMs` - 无语音超时自动停止
    - `maxDurationMs` - 最大时长限制
  - 运行时可动态调整配置
  - 细粒度状态管理（idle/starting/active/processing/stopping）
  - 自动停止原因回调

#### 集成版本（可选便捷层）
- **`VoiceSDKIntegrated`** - 新的集成层
  - 自动协调唤醒和转写
  - 支持自动启动配置
  - 提供底层实例访问
  - 保留便捷的事件回调

### 🔧 改进

- **完全解耦**：唤醒和转写可以完全独立使用
- **灵活组合**：使用者自由控制交互逻辑
- **更好的类型定义**：所有组件都有完整的 TypeScript 类型
- **更细粒度的状态管理**：每个组件独立管理自己的状态
- **更强大的自动停止**：三种机制可组合使用

### 📚 文档

- 新增 `USAGE.md` - 详细的使用指南和 API 文档
- 新增 `demo-standalone.html` - 展示新架构的交互式演示
- 更新 `README.md` - 反映新架构和使用方式
- 新增 `CHANGELOG.md` - 版本变更记录

### 🔄 向后兼容

- 保留原有的 `VoiceSDK` 类（标记为已废弃）
- 所有原有 API 继续可用
- 现有代码无需修改即可升级

### 📦 导出变更

新的导出结构：
```typescript
// 独立组件（推荐）
export { WakeWordDetectorStandalone } from './standalone/WakeWordDetectorStandalone';
export { SpeechTranscriberStandalone } from './standalone/SpeechTranscriberStandalone';

// 集成版本
export { VoiceSDKIntegrated } from './VoiceSDKIntegrated';

// 原有版本（向后兼容）
export { VoiceSDK } from './VoiceSDK';
```

### 🎯 使用示例

#### 独立组件
```typescript
import { WakeWordDetectorStandalone, SpeechTranscriberStandalone } from 'web-voice-kit';

const detector = new WakeWordDetectorStandalone({ modelPath: '/model.zip' });
const transcriber = new SpeechTranscriberStandalone({
  appId: 'xxx',
  apiKey: 'xxx',
  websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
  autoStop: {
    enabled: true,
    silenceTimeoutMs: 3000,
    noSpeechTimeoutMs: 5000,
    maxDurationMs: 60000
  }
});

detector.onWake(() => transcriber.start());
transcriber.onAutoStop(() => detector.reset());
```

### ⚠️ 废弃警告

- `VoiceSDK` 类已废弃，建议迁移到新架构
- 旧版本将继续维护，但不会添加新功能

---

## [0.2.1] - 2025-10-20

### 🐛 修复

- 修复自动启动失败问题（浏览器自动播放策略）
- 增强麦克风权限处理
- 修复 AudioContext 恢复失败
- 改进错误提示和用户引导
- 添加清理和恢复机制

### ✨ 改进

- 更好的错误分类（权限、模型、自动播放策略）
- 更友好的错误消息
- 初始化失败时的正确清理
- 优雅的自动启动降级
- 麦克风权限状态验证

---

## [0.2.0] - 2025-10-15

### ✨ 新增

- 连续对话模式
- 智能超时管理
- 状态变化事件
- 无语音超时检测

### 🔧 改进

- 优化 VAD 阈值
- 改进静音检测
- 更好的会话管理

---

## [0.1.2] - 2025-10-10

### 🐛 修复

- 修复 WebSocket 连接问题
- 修复模型加载错误处理

---

## [0.1.0] - 2025-10-01

### 🎉 首次发布

- Vosk 唤醒词检测
- 讯飞实时语音转写
- 基础的唤醒-转写流程
- TypeScript 支持
- ESM/CJS 构建
