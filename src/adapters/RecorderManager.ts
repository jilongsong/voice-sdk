type RecorderOptions = {
  sampleRate?: number; // 默认 16000
  frameSize?: number; // 默认 1280 字节一帧
  vadThreshold?: number; // VAD能量门限，默认0.01
};

export class RecorderManager {
  private context: AudioContext | undefined;
  private processor!: ScriptProcessorNode;
  private input!: MediaStreamAudioSourceNode;
  private mediaStream!: MediaStream;
  private bufferData: Int16Array[] = [];
  private isRecording = false;

  public onStart: () => void = () => {};
  public onStop: () => void = () => {};
  public onFrameRecorded: (params: { isLastFrame: boolean; frameBuffer: ArrayBuffer }) => void = () => {};
  public onVAD: (isSpeech: boolean, energy: number) => void = () => {};

  private sampleRate = 16000;
  private frameSize = 1280; // 每帧发送 1280 字节 = 640 个 16bit PCM 点
  private vadThreshold = 0.01;

  constructor() {}

  async start(options: RecorderOptions = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.frameSize = options.frameSize || 1280;
    this.vadThreshold = options.vadThreshold ?? 0.01;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    this.input = this.context.createMediaStreamSource(this.mediaStream);

    const bufferSize = 4096; // 脚本处理块大小
    this.processor = this.context.createScriptProcessor(bufferSize, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isRecording) return;

      const input = e.inputBuffer.getChannelData(0); // 只取单声道
      const pcm = this.float32ToInt16(input);
      this.bufferData.push(pcm);

      // VAD: 计算能量，判断是否有人说话
      const energy = this.computeRmsEnergy(input);
      const isSpeech = energy > this.vadThreshold;
      this.onVAD(isSpeech, energy);

      const concat = this.concatBuffer(this.bufferData);
      const frameCount = Math.floor(concat.byteLength / this.frameSize);
      if (frameCount >= 1) {
        const frameBuffer = concat.slice(0, frameCount * this.frameSize);
        const leftBuffer = concat.slice(frameCount * this.frameSize);

        for (let i = 0; i < frameCount; i++) {
          const start = i * this.frameSize;
          const end = start + this.frameSize;
          const frame = frameBuffer.slice(start, end);
          this.onFrameRecorded({ isLastFrame: false, frameBuffer: frame });
        }

        // 剩余部分继续缓冲
        this.bufferData = [new Int16Array(leftBuffer)];
      }
    };

    this.input.connect(this.processor);
    this.processor.connect(this.context.destination);

    this.isRecording = true;
    this.onStart();
  }

  stop() {
    this.isRecording = false;

    this.processor.disconnect();
    this.input.disconnect();
    this.mediaStream.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== 'closed') {
      try {
        this.context.close();
      } catch (e) {
        // ignore InvalidStateError
      }
    }
    this.context = undefined;

    // 处理最后剩余 buffer
    const finalBuffer = this.concatBuffer(this.bufferData);
    if (finalBuffer.byteLength > 0) {
      this.onFrameRecorded({ isLastFrame: true, frameBuffer: finalBuffer });
    } else {
      this.onFrameRecorded({ isLastFrame: true, frameBuffer: new ArrayBuffer(0) });
    }

    this.onStop();
  }

  // 计算RMS能量
  private computeRmsEnergy(float32Arr: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < float32Arr.length; i++) {
      sum += float32Arr[i] * float32Arr[i];
    }
    return Math.sqrt(sum / float32Arr.length);
  }

  private float32ToInt16(float32Arr: Float32Array): Int16Array {
    const l = float32Arr.length;
    const int16Arr = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      let s = Math.max(-1, Math.min(1, float32Arr[i]));
      int16Arr[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Arr;
  }

  private concatBuffer(chunks: Int16Array[]): ArrayBuffer {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged.buffer;
  }
}
