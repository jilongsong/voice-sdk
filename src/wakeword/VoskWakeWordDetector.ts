import { WakeWordDetector } from './WakeWordDetector';
import { createModel } from 'vosk-browser';
import { pinyin } from 'pinyin-pro';

export interface VoskWakeWordOptions {
  modelPath?: string;
  sampleRate?: number;
  usePartial?: boolean;
}

export class VoskWakeWordDetector implements WakeWordDetector {
  private options: Required<VoskWakeWordOptions>;
  private onWakeCb?: () => void;
  private phrases: string[] = [];
  // Store normalized phrases for scoring
  private phrasesNorm: string[] = [];
  private phrasesPinyin: string[] = [];
  private triggered = false;
  private permissionGranted = false;

  // Audio processing
  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private workletNode?: ScriptProcessorNode | AudioWorkletNode;
  private muteGain?: GainNode; // zero-gain node to keep graph alive without sound
  private stream?: MediaStream;
  private onDeviceChange?: () => void;

  // Vosk components
  private model: any;
  private recognizer: any;

  // Internal scoring and buffering
  private partialBuffer: string = '';
  private readonly maxBufferLen: number = 48; // number of Chinese chars to keep
  private consecutiveHits: number = 0;
  private lastTriggerTs = 0;
  private readonly refractoryMs = 1500; // avoid re-triggering too frequently
  private readonly partialThreshold = 0.72;
  private readonly finalThreshold = 0.82;
  private readonly requiredConsecutivePartialHits = 2;
  private nearMissHits: number = 0;
  private readonly nearMissSlack = 0.04; // allow small margin below threshold
  private readonly requiredNearMissHits = 3;
  private lastMaxAbs: number = 0; // recent max amplitude snapshot from audio path
  private pinyinCache = new Map<string, string>();

  // Health monitor
  private healthTimer?: number;
  private readonly healthIntervalMs = 2000;

  // Audio processing buffers to reduce allocations
  private tempBoostBuffer?: Float32Array;
  private accumBuffer?: Float32Array;
  private accumIndex: number = 0;
  private readonly accumChunkSize = 8192; // feed recognizer per ~0.5s at 16kHz
  private usingAudioWorklet = false;

  constructor(opts: VoskWakeWordOptions) {
    this.options = { 
      modelPath: opts.modelPath || '',
      sampleRate: 16000, 
      usePartial: true, 
      ...opts 
    };
  }

  setWakeWord(phrase: string): void {
    const raw = (phrase || '').trim();
    this.phrases = [raw.toLowerCase()];
    this.phrasesNorm = [this.normalizeChinese(raw)];
    this.phrasesPinyin = [this.computePinyinNormalized(raw)];
    this.pinyinCache.clear();
    this.triggered = false;
    this.consecutiveHits = 0;
    this.partialBuffer = '';
    this.nearMissHits = 0;
    this.lastMaxAbs = 0;
  }

  setWakeWords(phrases: string[]): void {
    const cleaned = phrases.map(p => (p || '').trim()).filter(p => p.length > 0);
    this.phrases = cleaned.map(p => p.toLowerCase());
    this.phrasesNorm = cleaned.map(p => this.normalizeChinese(p));
    this.phrasesPinyin = cleaned.map(p => this.computePinyinNormalized(p));
    this.pinyinCache.clear();
    this.triggered = false;
    this.consecutiveHits = 0;
    this.partialBuffer = '';
    this.nearMissHits = 0;
    this.lastMaxAbs = 0;
  }

  reset(): void {
    this.triggered = false;
    this.consecutiveHits = 0;
    this.partialBuffer = '';
    this.nearMissHits = 0;
    this.pinyinCache.clear();
    // 重置最后触发时间，允许立即再次唤醒
    this.lastTriggerTs = 0;
    console.log('[VoskWakeWordDetector] Reset complete, ready for next wake');
  }

  inspect(_transcriptChunk: string, _isFinal: boolean): boolean {
    return false;
  }

  onWake(callback: () => void): void {
    this.onWakeCb = callback;
  }

  async init(): Promise<void> {
    if (!this.model) {
      console.log('[VoskWakeWordDetector] Loading Vosk model...');
      
      if (!this.options.modelPath) {
        throw new Error('Model path is required but not provided. Please specify voskModelPath in VoiceSDK options.');
      }
      
      try {
        this.model = await createModel(this.options.modelPath);
        console.log('[VoskWakeWordDetector] Model loaded successfully');
      } catch (error) {
        console.error('[VoskWakeWordDetector] Model loading failed:', error);
        console.error('[VoskWakeWordDetector] Make sure the model path is correct and accessible from the browser');
        console.error('[VoskWakeWordDetector] Current model path:', this.options.modelPath);
        throw new Error(`Failed to load Vosk model from "${this.options.modelPath}". ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    if (!this.recognizer) {
      console.log('[VoskWakeWordDetector] Creating Vosk recognizer...');
      this.recognizer = new this.model.KaldiRecognizer(this.options.sampleRate);
      
      // Wire events
      this.recognizer.on('result', (msg: any) => {
        const text: string = msg?.result?.text || '';
        this.maybeWake(text, true);
      });
      
      this.recognizer.on('partialresult', (msg: any) => {
        if (!this.options.usePartial) return;
        const text: string = msg?.partial || '';
        this.maybeWake(text, false);
      });
      
      this.recognizer.on('error', (err: any) => {
        console.error('[VoskWakeWordDetector] Recognizer error:', err);
      });
      
      console.log('[VoskWakeWordDetector] Recognizer created successfully');
    }
  }

  async requestMicrophonePermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      this.permissionGranted = true;
      console.log('[VoskWakeWordDetector] Microphone permission granted');
      return true;
    } catch (error) {
      console.error('[VoskWakeWordDetector] Microphone permission denied:', error);
      this.permissionGranted = false;
      return false;
    }
  }

  isMicrophonePermissionGranted(): boolean {
    return this.permissionGranted;
  }

  private maybeWake(text: string, isFinal: boolean) {
    
    if (!this.phrases.length) {
      console.log('[VoskWakeWordDetector] No wake words set');
      return;
    }
    
    if (this.triggered) {
      // 已触发，但不打印过多日志（避免刷屏）
      return;
    }
    
    // Refractory to avoid repeated triggers
    const now = Date.now();
    if (this.lastTriggerTs > 0 && now - this.lastTriggerTs < this.refractoryMs) {
      return;
    }

    const normIncoming = this.normalizeChinese(text || '');

    // Maintain a short rolling buffer for partials to stabilize scoring
    if (!isFinal) {
      this.partialBuffer = (this.partialBuffer + normIncoming).slice(-this.maxBufferLen);
    }

    // Decide which text to score: for final results use the current normIncoming,
    // for partials use the accumulated buffer
    const candidate = isFinal ? normIncoming : this.partialBuffer;

    if (!candidate) return;

    let maxScore = 0;
    for (let i = 0; i < this.phrasesNorm.length; i++) {
      const score = this.scoreCandidate(candidate, this.phrasesNorm[i], this.phrasesPinyin[i]);
      if (score > maxScore) maxScore = score;
    }

    // Dynamic threshold adaptation based on recent loudness
    // Louder speech usually yields more stable ASR; allow a modest relaxation
    const baseThreshold = isFinal ? this.finalThreshold : this.partialThreshold;
    const loud = Math.min(1, Math.max(0, this.lastMaxAbs));
    const adapt = (loud >= 0.2 ? 0.02 : 0) + (loud >= 0.35 ? 0.02 : 0); // up to -0.04
    const threshold = Math.max(0.6, baseThreshold - adapt);

    if (maxScore >= threshold) {
      if (isFinal) {
        this.triggered = true;
        this.lastTriggerTs = now;
        this.onWakeCb?.();
        return;
      }
      // Partial results: require stability across consecutive frames
      this.consecutiveHits += 1;
      if (this.consecutiveHits >= this.requiredConsecutivePartialHits) {
        this.triggered = true;
        this.lastTriggerTs = now;
        this.onWakeCb?.();
      }
      // reset near-miss when actual hit occurs
      this.nearMissHits = 0;
    } else if (!isFinal) {
      // near-miss support: if very close to threshold across multiple frames, still trigger
      if (maxScore >= Math.max(0, threshold - this.nearMissSlack)) {
        this.nearMissHits += 1;
        if (this.nearMissHits >= this.requiredNearMissHits) {
          this.triggered = true;
          this.lastTriggerTs = now;
          this.onWakeCb?.();
        }
      } else {
        this.nearMissHits = Math.max(0, this.nearMissHits - 1);
      }
      // decay stability counter when not meeting threshold on partials
      this.consecutiveHits = Math.max(0, this.consecutiveHits - 1);
    }
  }

  private async ensureAudio(): Promise<void> {
    if (!this.permissionGranted) {
      await this.requestMicrophonePermission();
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.options.sampleRate });
      console.log(`[VoskWakeWordDetector] AudioContext created, sample rate: ${this.audioContext.sampleRate}`);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: this.options.sampleRate
        } 
      });
      console.log('[VoskWakeWordDetector] Microphone stream acquired');
      // Watch for track end to auto-recover
      this.stream.getTracks().forEach(track => {
        track.onended = () => {
          console.warn('[VoskWakeWordDetector] MediaStreamTrack ended, scheduling recovery');
          // Let health monitor pick it up or do immediate recovery
          setTimeout(() => this.startHealthMonitor(), 100);
        };
      });
    }

    if (!this.sourceNode) {
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      console.log('[VoskWakeWordDetector] Audio source node created');
    }

    if (!this.workletNode) {
      const ok = await this.setupAudioWorklet();
      if (!ok) {
        await this.setupScriptProcessor();
      }
    }
  }

  private async setupScriptProcessor(): Promise<void> {
    if (!this.audioContext || !this.sourceNode || !this.recognizer) return;

    console.log('[VoskWakeWordDetector] Setting up ScriptProcessor...');
    
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.workletNode = processor as any; // Store as workletNode for cleanup
    
    let audioLogCounter = 0;
    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      try {
        audioLogCounter++;

        const channelData = event.inputBuffer.getChannelData(0);

        // Prepare reusable buffers
        if (!this.tempBoostBuffer || this.tempBoostBuffer.length !== channelData.length) {
          this.tempBoostBuffer = new Float32Array(channelData.length);
        }
        if (!this.accumBuffer) {
          this.accumBuffer = new Float32Array(this.accumChunkSize);
          this.accumIndex = 0;
        }

        // Gain + max abs in one pass
        const gainMultiplier = 5.0;
        let maxAbs = 0;
        const len = channelData.length;
        for (let i = 0; i < len; i++) {
          const v = channelData[i] * gainMultiplier;
          const clamped = v > 1 ? 1 : (v < -1 ? -1 : v);
          this.tempBoostBuffer[i] = clamped;
          const a = clamped < 0 ? -clamped : clamped;
          if (a > maxAbs) maxAbs = a;
        }

        // Update recent loudness snapshot
        this.lastMaxAbs = maxAbs;
        // Skip feeding if too quiet to reduce CPU + internal logs
        if (maxAbs <= 0.01) return;

        // Accumulate and feed in larger chunks to reduce recognizer call frequency/logs
        let srcOff = 0;
        while (srcOff < len) {
          const space = this.accumChunkSize - this.accumIndex;
          const copyLen = Math.min(space, len - srcOff);
          this.accumBuffer.set(this.tempBoostBuffer.subarray(srcOff, srcOff + copyLen), this.accumIndex);
          this.accumIndex += copyLen;
          srcOff += copyLen;

          if (this.accumIndex >= this.accumChunkSize) {
            if (this.recognizer.acceptWaveformFloat) {
              this.recognizer.acceptWaveformFloat(this.accumBuffer, this.options.sampleRate);
            } else {
              // As a fallback, wrap the buffer into an AudioBuffer (rare path)
              const abuf = this.audioContext!.createBuffer(1, this.accumChunkSize, this.options.sampleRate);
              const ch0 = abuf.getChannelData(0);
              ch0.set(this.accumBuffer, 0);
              this.recognizer.acceptWaveform(abuf);
            }
            this.accumIndex = 0; // reset buffer
          }
        }
      } catch (error) {
        console.error('[VoskWakeWordDetector] Audio processing error:', error);
      }
    };
    // Build a silent chain: source -> processor -> muteGain(0) -> destination
    this.muteGain = this.audioContext.createGain();
    this.muteGain.gain.value = 0;
    this.sourceNode.connect(processor);
    processor.connect(this.muteGain);
    this.muteGain.connect(this.audioContext.destination);
    
    console.log('[VoskWakeWordDetector] ScriptProcessor connected successfully');
  }

  private async setupAudioWorklet(): Promise<boolean> {
    if (!this.audioContext || !this.sourceNode || !this.recognizer) return false;
    if (!('audioWorklet' in this.audioContext)) return false;

    try {
      // Dynamically create a minimal worklet processor module
      const moduleCode = `
        class VoskAudioProcessor extends AudioWorkletProcessor {
          constructor(options) {
            super();
            const opts = (options && options.processorOptions) || {};
            this.inputRate = opts.sampleRate || 48000;
            this.targetRate = opts.targetRate || 16000;
            this._ratio = this.inputRate / this.targetRate;
            this._acc = 0;
          }
          process(inputs, outputs, parameters) {
            const input = inputs[0];
            const output = outputs[0];
            if (input && input[0]) {
              const chIn = input[0];
              // Pass-through to output to keep graph alive
              if (output && output[0]) {
                const chOut = output[0];
                const n = Math.min(chOut.length, chIn.length);
                for (let i = 0; i < n; i++) chOut[i] = chIn[i];
              }
              // Downsample to targetRate and post Float32Array
              const ratio = this._ratio;
              const outLen = Math.floor(chIn.length / ratio);
              if (outLen > 0) {
                const data = new Float32Array(outLen);
                let pos = 0;
                let i = 0;
                while (i < outLen) {
                  const nextPos = (i + 1) * ratio;
                  let sum = 0, count = 0;
                  while (pos < nextPos && pos < chIn.length) { sum += chIn[pos++]; count++; }
                  data[i++] = count ? (sum / count) : 0;
                }
                // Transfer buffer to main thread to minimize copy cost
                this.port.postMessage({ type: 'audioData', data }, [data.buffer]);
              }
            }
            return true;
          }
        }
        registerProcessor('vosk-audio-processor', VoskAudioProcessor);
      `;
      const blobUrl = URL.createObjectURL(new Blob([moduleCode], { type: 'application/javascript' }));
      await this.audioContext.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const node = new AudioWorkletNode(this.audioContext, 'vosk-audio-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { sampleRate: this.audioContext.sampleRate, targetRate: this.options.sampleRate }
      } as any);
      this.workletNode = node;
      this.usingAudioWorklet = true;

      // Accumulate chunks from worklet messages and feed recognizer
      node.port.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || msg.type !== 'audioData') return;
        const data: Float32Array = msg.data as Float32Array; // already 16kHz
        // Update recent loudness snapshot based on this chunk
        let maxAbs = 0;
        for (let i = 0; i < data.length; i++) {
          const v = data[i];
          const a = v < 0 ? -v : v;
          if (a > maxAbs) maxAbs = a;
        }
        this.lastMaxAbs = maxAbs;
        if (!this.accumBuffer) {
          this.accumBuffer = new Float32Array(this.accumChunkSize);
          this.accumIndex = 0;
        }
        let srcOff = 0;
        const len = data.length;
        while (srcOff < len) {
          const space = this.accumChunkSize - this.accumIndex;
          const copyLen = Math.min(space, len - srcOff);
          this.accumBuffer.set(data.subarray(srcOff, srcOff + copyLen), this.accumIndex);
          this.accumIndex += copyLen;
          srcOff += copyLen;
          if (this.accumIndex >= this.accumChunkSize) {
            if (this.recognizer.acceptWaveformFloat) {
              this.recognizer.acceptWaveformFloat(this.accumBuffer, this.options.sampleRate);
            } else {
              const abuf = this.audioContext!.createBuffer(1, this.accumChunkSize, this.options.sampleRate);
              const ch0 = abuf.getChannelData(0);
              ch0.set(this.accumBuffer, 0);
              this.recognizer.acceptWaveform(abuf);
            }
            this.accumIndex = 0;
          }
        }
      };

      // Build a silent chain: source -> worklet -> mute -> destination
      this.muteGain = this.audioContext.createGain();
      this.muteGain.gain.value = 0;
      this.sourceNode.connect(node);
      node.connect(this.muteGain);
      this.muteGain.connect(this.audioContext.destination);

      console.log('[VoskWakeWordDetector] AudioWorkletNode connected successfully');
      return true;
    } catch (err) {
      console.warn('[VoskWakeWordDetector] Failed to setup AudioWorklet, falling back to ScriptProcessor:', err);
      this.usingAudioWorklet = false;
      return false;
    }
  }

  async start(): Promise<void> {
    console.log('[VoskWakeWordDetector] Starting...');
    await this.init();
    await this.ensureAudio();
    // Listen for device changes to reacquire input
    if (!this.onDeviceChange) {
      this.onDeviceChange = () => {
        console.log('[VoskWakeWordDetector] Device change detected, triggering health check');
        this.startHealthMonitor();
      };
      try { navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange); } catch {}
    }
    this.startHealthMonitor();
    console.log('[VoskWakeWordDetector] Started successfully');
  }

  async stop(): Promise<void> {
    console.log('[VoskWakeWordDetector] Stopping...');
    
    if (this.workletNode) {
      this.workletNode.disconnect();
      if ('onaudioprocess' in this.workletNode) {
        (this.workletNode as ScriptProcessorNode).onaudioprocess = null;
      }
      this.workletNode = undefined;
    }
    if (this.muteGain) {
      try { this.muteGain.disconnect(); } catch {}
      this.muteGain = undefined;
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = undefined;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = undefined;
    }
    if (this.onDeviceChange) {
      try { navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange); } catch {}
      this.onDeviceChange = undefined;
    }
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
      this.audioContext = undefined;
    }
    
    this.triggered = false;
    this.consecutiveHits = 0;
    this.partialBuffer = '';
    this.stopHealthMonitor();
    console.log('[VoskWakeWordDetector] Stopped successfully');
  }

  private startHealthMonitor() {
    if (this.healthTimer) return;
    const fn = async () => {
      try {
        // Ensure audio context is running
        if (this.audioContext) {
          if (this.audioContext.state === 'suspended') {
            try {
              await this.audioContext.resume();
              console.log('[VoskWakeWordDetector] AudioContext resumed by health monitor');
            } catch (e) {
              // Some browsers require user gesture; just log and retry later
              // console.warn('[VoskWakeWordDetector] Resume failed:', e);
            }
          }
        }

        // Ensure stream is alive
        const hasDeadTrack = !!this.stream && this.stream.getTracks().some(t => t.readyState !== 'live');
        if (!this.stream || hasDeadTrack) {
          console.log('[VoskWakeWordDetector] Reacquiring microphone stream...');
          // Recreate stream and graph
          try {
            if (this.stream) this.stream.getTracks().forEach(t => t.stop());
          } catch {}
          this.stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              channelCount: 1,
              sampleRate: this.options.sampleRate
            } 
          });
          if (this.audioContext) {
            // Rebuild nodes
            if (this.sourceNode) try { this.sourceNode.disconnect(); } catch {}
            this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
            if (!this.workletNode) {
              const ok = await this.setupAudioWorklet();
              if (!ok) await this.setupScriptProcessor();
            } else {
              try { (this.workletNode as AudioNode).disconnect(); } catch {}
              if (this.muteGain) try { this.muteGain.disconnect(); } catch {}
              // Reconnect chain: source -> node -> mute -> destination
              this.muteGain = this.audioContext.createGain();
              this.muteGain.gain.value = 0;
              this.sourceNode.connect(this.workletNode as AudioNode);
              (this.workletNode as AudioNode).connect(this.muteGain);
              this.muteGain.connect(this.audioContext.destination);
            }
          }
        }
      } catch (err) {
        console.error('[VoskWakeWordDetector] Health monitor error:', err);
      }
    };
    // @ts-ignore - setInterval returns number in browsers
    this.healthTimer = setInterval(fn, this.healthIntervalMs) as any as number;
  }

  private stopHealthMonitor() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
  }

  // ========= Internal helpers for Chinese-friendly scoring =========
  private toHalfWidth(input: string): string {
    // Convert full-width to half-width for consistency
    return input.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
                .replace(/\u3000/g, ' ');
  }

  private normalizeChinese(input: string): string {
    const s = this.toHalfWidth((input || '').toLowerCase());
    // Remove whitespace and punctuation, keep CJK chars and basic ASCII letters/numbers
    // Also strip common filler particles that ASR often inserts: 啊 呀 呢 吧 嘛 的 了 地 得 哦 喔 啊哈 哈 哎 哟 哇
    return s.replace(/[\s`~!@#$%^&*()\-_=+\[\]{};:'",.<>/?、，。？！￥…（）【】《》·：；——]/g, '')
            .replace(/[啊呀呢吧嘛的了地得哦喔哈哎哟哇]/g, '')
            .replace(/\p{Z}+/gu, '')
            .trim();
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = i - 1;
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[j] = Math.min(
          dp[j] + 1,      // deletion
          dp[j - 1] + 1,  // insertion
          prev + cost     // substitution
        );
        prev = tmp;
      }
    }
    return dp[n];
  }

  private lcsLen(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0 || n === 0) return 0;
    const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  }

  private similarity(a: string, b: string): number {
    if (!a.length || !b.length) return 0;
    const lev = this.levenshtein(a, b);
    const lcs = this.lcsLen(a, b);
    const maxLen = Math.max(a.length, b.length);
    const levScore = 1 - lev / maxLen; // 0..1
    const lcsScore = lcs / maxLen;     // 0..1
    // Add bigram Jaccard similarity for Chinese robustness
    const ngramScore = this.jaccardBigrams(a, b);
    // Blend for robustness: emphasize edit distance, keep subsequence and n-gram overlap
    return Math.max(0, Math.min(1, 0.5 * levScore + 0.3 * lcsScore + 0.2 * ngramScore));
  }

  private scoreCandidate(candidate: string, phraseNorm: string, phrasePinyin?: string): number {
    if (!candidate || !phraseNorm) return 0;
    // Sliding window around phrase length ±2 to catch minor insertions/deletions
    const targetLen = phraseNorm.length;
    const minLen = Math.max(1, targetLen - 3);
    const maxLen = targetLen + 3;
    let best = 0;
    for (let win = minLen; win <= maxLen; win++) {
      for (let i = 0; i + win <= candidate.length; i++) {
        const sub = candidate.slice(i, i + win);
        const s = this.similarity(sub, phraseNorm);
        let combined = s;
        if (phrasePinyin && phrasePinyin.length > 0) {
          const subPinyin = this.getPinyinCached(sub);
          if (subPinyin.length > 0) {
            const pyScore = this.similarity(subPinyin, phrasePinyin);
            if (pyScore >= 0.9) {
              combined = Math.max(combined, pyScore * 0.9 + s * 0.1);
            } else if (pyScore >= 0.75) {
              const blended = s * 0.55 + pyScore * 0.45;
              combined = Math.max(combined, blended);
            }
          }
        }
        if (combined > best) best = combined;
        if (best >= 0.999) return best;
      }
    }
    return best;
  }

  private jaccardBigrams(a: string, b: string): number {
    const setA = new Set<string>();
    const setB = new Set<string>();
    for (let i = 0; i < a.length - 1; i++) setA.add(a.slice(i, i + 2));
    for (let i = 0; i < b.length - 1; i++) setB.add(b.slice(i, i + 2));
    if (setA.size === 0 || setB.size === 0) return 0;
    let inter = 0;
    for (const g of setA) if (setB.has(g)) inter++;
    const union = setA.size + setB.size - inter;
    return union > 0 ? inter / union : 0;
  }

  private computePinyinNormalized(input: string): string {
    if (!input) return '';
    const normalized = this.normalizeChinese(input);
    if (!normalized) return '';
    if (!/[\u4e00-\u9fff]/.test(normalized)) {
      return normalized;
    }
    try {
      return pinyin(normalized, { toneType: 'none', type: 'string' })
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase();
    } catch (error) {
      console.warn('[VoskWakeWordDetector] Failed to convert to pinyin:', error);
      return normalized;
    }
  }

  private getPinyinCached(input: string): string {
    if (!input) return '';
    const cached = this.pinyinCache.get(input);
    if (cached !== undefined) {
      return cached;
    }
    const computed = this.computePinyinNormalized(input);
    if (this.pinyinCache.size >= 512) {
      this.pinyinCache.clear();
    }
    this.pinyinCache.set(input, computed);
    return computed;
  }
}