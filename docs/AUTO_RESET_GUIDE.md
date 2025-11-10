# 自动重置功能指南

## 🎯 问题背景

在独立模式下使用唤醒词检测器时，如果不手动调用 `reset()`，唤醒词触发一次后就无法再次触发。这是因为内部的 `triggered` 标志会保持为 `true`。

## ✨ 解决方案：自动重置机制

从 v0.3.0 开始，`WakeWordDetectorStandalone` 提供了**自动重置**功能，唤醒触发后会自动重置状态，允许连续唤醒。

### 默认行为

**自动重置默认启用**，唤醒后 2 秒自动重置：

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip'
  // autoReset 默认启用
});

detector.onWake(() => {
  console.log('唤醒了！');
  // 2秒后自动重置，可以再次唤醒
});
```

---

## ⚙️ 配置选项

### 1. 使用默认配置（推荐）

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip',
  autoReset: {
    enabled: true,        // 启用自动重置
    resetDelayMs: 2000    // 2秒后重置
  }
});
```

### 2. 自定义重置延迟

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip',
  autoReset: {
    enabled: true,
    resetDelayMs: 3000    // 改为3秒后重置
  }
});
```

### 3. 禁用自动重置（手动控制）

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip',
  autoReset: {
    enabled: false        // 禁用自动重置
  }
});

detector.onWake(() => {
  console.log('唤醒了！');
  // 需要手动重置
  setTimeout(() => {
    detector.reset();
  }, 2000);
});
```

### 4. 运行时调整配置

```typescript
// 创建时使用默认配置
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip'
});

// 运行时调整
detector.updateAutoResetConfig({
  enabled: true,
  resetDelayMs: 5000    // 改为5秒
});
```

---

## 🎨 使用场景

### 场景 1：连续唤醒（推荐配置）

**需求**：用户可以连续多次唤醒，每次唤醒后执行不同操作。

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip',
  autoReset: {
    enabled: true,
    resetDelayMs: 2000    // 2秒后可再次唤醒
  }
});

detector.onWake(() => {
  console.log('检测到唤醒词！');
  playSound('ding.mp3');
  // 2秒后自动重置，用户可以再次唤醒
});
```

### 场景 2：唤醒 + 转写（组合模式）

**需求**：唤醒后启动转写，转写结束后可以再次唤醒。

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip',
  autoReset: {
    enabled: true,
    resetDelayMs: 2000
  }
});

const transcriber = new SpeechTranscriberStandalone({
  appId: 'xxx',
  apiKey: 'xxx',
  websocketUrl: 'wss://rtasr.xfyun.cn/v1/ws',
  autoStop: {
    enabled: true,
    silenceTimeoutMs: 3000
  }
});

detector.onWake(async () => {
  console.log('唤醒了，开始转写...');
  await transcriber.start();
});

transcriber.onAutoStop(() => {
  console.log('转写结束');
  // 自动重置已经在后台进行，无需手动调用
});
```

### 场景 3：一次性唤醒

**需求**：只允许唤醒一次，之后需要手动重新启用。

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip',
  autoReset: {
    enabled: false        // 禁用自动重置
  }
});

detector.onWake(async () => {
  console.log('唤醒了！');
  await detector.stop();  // 停止检测
  
  // 执行某些操作...
  
  // 需要时手动重启
  // await detector.start();
});
```

### 场景 4：长时间会话

**需求**：唤醒后进行长时间交互，期间不希望被重置。

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip',
  autoReset: {
    enabled: true,
    resetDelayMs: 30000   // 30秒后才重置
  }
});

detector.onWake(() => {
  console.log('开始长时间会话...');
  // 30秒内不会被自动重置
});
```

---

## 🔄 工作原理

### 时序图

```
用户说唤醒词
    ↓
检测到唤醒词
    ↓
触发 onWake 回调
    ↓
启动自动重置定时器 (2秒)
    ↓
[等待 2 秒]
    ↓
自动调用 detector.reset()
    ↓
状态重置，可以再次唤醒
```

### 状态变化

```
listening (监听中)
    ↓ 检测到唤醒词
triggered (已触发)
    ↓ 2秒后自动重置
listening (监听中)
    ↓ 可以再次唤醒
...
```

---

## ⚠️ 注意事项

### 1. 重置延迟的选择

- **太短**（< 1秒）：可能导致误触发，同一次语音被识别多次
- **太长**（> 5秒）：用户需要等待较长时间才能再次唤醒
- **推荐值**：2-3秒，平衡了防误触和响应速度

### 2. 与转写器配合使用

如果唤醒后启动转写器，建议：
- 自动重置延迟 ≥ 转写器的最小响应时间
- 或者在转写器停止时手动重置

```typescript
// 方案 1：使用足够长的自动重置延迟
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip',
  autoReset: {
    enabled: true,
    resetDelayMs: 5000    // 足够长，避免转写期间重置
  }
});

// 方案 2：转写结束时手动重置
transcriber.onAutoStop(() => {
  detector.reset();       // 立即重置，可以再次唤醒
});
```

### 3. 手动重置优先

调用 `detector.reset()` 会立即重置并清除自动重置定时器：

```typescript
detector.onWake(() => {
  // 某些情况下需要立即重置
  if (someCondition) {
    detector.reset();     // 立即重置，清除自动重置定时器
  }
});
```

### 4. 停止时自动清理

调用 `detector.stop()` 会自动清除自动重置定时器：

```typescript
await detector.stop();    // 停止检测，清除所有定时器
```

---

## 📊 对比分析

### 自动重置 vs 手动重置

| 特性 | 自动重置 | 手动重置 |
|------|---------|---------|
| 易用性 | ✅ 简单，无需额外代码 | ⚠️ 需要编写重置逻辑 |
| 灵活性 | ⚠️ 固定延迟 | ✅ 完全自定义 |
| 连续唤醒 | ✅ 自动支持 | ⚠️ 需要手动实现 |
| 误触风险 | ⚠️ 延迟太短可能误触 | ✅ 完全可控 |
| 推荐场景 | 大多数场景 | 复杂交互逻辑 |

---

## 🎯 最佳实践

### 1. 默认配置适用于大多数场景

```typescript
// 推荐：使用默认配置
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip'
  // 默认启用自动重置，2秒延迟
});
```

### 2. 根据业务调整延迟

```typescript
// 快速响应场景：1.5秒
autoReset: { enabled: true, resetDelayMs: 1500 }

// 标准场景：2-3秒
autoReset: { enabled: true, resetDelayMs: 2000 }

// 长会话场景：5-10秒
autoReset: { enabled: true, resetDelayMs: 5000 }
```

### 3. 提供用户反馈

```typescript
detector.onWake(() => {
  // 视觉反馈
  showWakeAnimation();
  
  // 音频反馈
  playSound('wake.mp3');
  
  // 提示用户
  showMessage('已唤醒，请说话...');
  
  // 2秒后自动重置（无需手动处理）
});
```

### 4. 日志和调试

```typescript
const detector = new WakeWordDetectorStandalone({
  modelPath: '/path/to/model.zip',
  autoReset: {
    enabled: true,
    resetDelayMs: 2000
  }
});

detector.onWake(() => {
  console.log('[Wake] Detected at:', new Date().toISOString());
  console.log('[Wake] Will auto-reset in 2 seconds');
});

// 手动重置时也记录
detector.reset();
console.log('[Reset] Manual reset triggered');
```

---

## 🔧 故障排查

### 问题 1：唤醒后无法再次唤醒

**原因**：自动重置被禁用或延迟太长

**解决**：
```typescript
// 检查配置
detector.updateAutoResetConfig({
  enabled: true,
  resetDelayMs: 2000
});
```

### 问题 2：同一次语音被识别多次

**原因**：自动重置延迟太短

**解决**：
```typescript
// 增加延迟
detector.updateAutoResetConfig({
  resetDelayMs: 3000    // 从2秒改为3秒
});
```

### 问题 3：转写期间被重置

**原因**：自动重置延迟小于转写时长

**解决**：
```typescript
// 方案1：增加延迟
detector.updateAutoResetConfig({
  resetDelayMs: 10000   // 增加到10秒
});

// 方案2：转写时禁用自动重置
detector.onWake(async () => {
  detector.updateAutoResetConfig({ enabled: false });
  await transcriber.start();
});

transcriber.onAutoStop(() => {
  detector.reset();
  detector.updateAutoResetConfig({ enabled: true });
});
```

---

## 📚 API 参考

### WakeWordDetectorStandaloneOptions

```typescript
interface WakeWordDetectorStandaloneOptions {
  modelPath?: string;
  sampleRate?: number;
  usePartial?: boolean;
  
  autoReset?: {
    enabled: boolean;       // 是否启用自动重置（默认：true）
    resetDelayMs?: number;  // 重置延迟（默认：2000ms）
  };
}
```

### 方法

```typescript
// 手动重置（立即生效，清除自动重置定时器）
detector.reset(): void

// 更新自动重置配置（运行时可调）
detector.updateAutoResetConfig(config: {
  enabled?: boolean;
  resetDelayMs?: number;
}): void
```

---

## 🎉 总结

自动重置功能让唤醒词检测器使用更简单：

✅ **默认启用**，开箱即用  
✅ **可配置**，适应不同场景  
✅ **运行时可调**，灵活控制  
✅ **自动清理**，无需担心资源泄漏  

大多数情况下，使用默认配置即可获得完美体验！
