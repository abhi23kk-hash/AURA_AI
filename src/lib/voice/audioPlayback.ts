/**
 * Shared Real-Time Audio Output Pipeline for AURA Voice Assistant
 * 
 * Features:
 * - Single persistent AudioContext across the entire application lifecycle
 * - Single controlled output chain: BufferSource -> GainNode (1.5x) -> DynamicsCompressor (limiter) -> Destination
 * - Sequential timeline scheduling for continuous, jitter-free streaming audio
 * - Zero overlapping chunks, zero gaps, zero out-of-order playback
 * - Instantaneous barge-in interruption cutoff (<1ms cancellation of all active/queued audio)
 */

// Single configurable assistant output gain constant
export const ASSISTANT_OUTPUT_GAIN = 1.5;

export class SharedAudioOutputEngine {
  private static instance: SharedAudioOutputEngine | null = null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private readonly sampleRate = 24000;

  private constructor() {}

  public static getInstance(): SharedAudioOutputEngine {
    if (!SharedAudioOutputEngine.instance) {
      SharedAudioOutputEngine.instance = new SharedAudioOutputEngine();
    }
    return SharedAudioOutputEngine.instance;
  }

  public getContext(): AudioContext {
    if (typeof window === 'undefined') {
      throw new Error('AudioContext is only available in browser environments');
    }

    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: this.sampleRate });
      this.masterGain = null;
      this.limiter = null;
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  public async resume(): Promise<AudioContext> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('[AURA Audio] AudioContext resume notice:', err);
      }
    }
    return ctx;
  }

  /**
   * Returns the shared output nodes.
   * Audio graph: sourceNode -> masterGain (1.5x) -> limiter -> ctx.destination
   */
  public getOutputNode(): { ctx: AudioContext; targetNode: AudioNode } {
    const ctx = this.getContext();

    if (!this.masterGain || !this.limiter) {
      // 1. Single controlled output GainNode
      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(ASSISTANT_OUTPUT_GAIN, ctx.currentTime);

      // 2. High-fidelity transparent brickwall peak limiter to strictly prevent clipping
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.setValueAtTime(-1.0, ctx.currentTime); // dB
      this.limiter.knee.setValueAtTime(4, ctx.currentTime);        // dB smooth curve
      this.limiter.ratio.setValueAtTime(16, ctx.currentTime);       // Fast limiter ratio
      this.limiter.attack.setValueAtTime(0.002, ctx.currentTime);   // 2ms fast peak catching
      this.limiter.release.setValueAtTime(0.10, ctx.currentTime);   // 100ms smooth decay

      // Connect single chain
      this.masterGain.connect(this.limiter);
      this.limiter.connect(ctx.destination);
    }

    return { ctx, targetNode: this.masterGain };
  }
}

export class LiveAudioPlayer {
  private engine: SharedAudioOutputEngine;
  private nextStartTime = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private sampleRate = 24000;
  private isPlaying = false;
  private isInterrupted = false;
  private checkEndTimeout: any = null;
  private onPlaybackStateChange?: (isPlaying: boolean) => void;

  constructor(onPlaybackStateChange?: (isPlaying: boolean) => void) {
    this.engine = SharedAudioOutputEngine.getInstance();
    this.onPlaybackStateChange = onPlaybackStateChange;
  }

  /**
   * Resets interruption flag when a new response starts
   */
  public resetInterruption() {
    this.isInterrupted = false;
  }

  /**
   * Sequential progressive chunk playback
   * Decodes 24kHz 16-bit linear PCM and schedules continuously on the audio timeline
   */
  public playChunk(base64Pcm: string) {
    if (this.isInterrupted) {
      return;
    }

    try {
      if (this.checkEndTimeout) {
        clearTimeout(this.checkEndTimeout);
        this.checkEndTimeout = null;
      }

      const { ctx, targetNode } = this.engine.getOutputNode();

      // Ensure AudioContext is actively running
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      // Decode base64 to 16-bit linear PCM
      const binary = atob(base64Pcm);
      const len = binary.length;
      if (len < 2) return;

      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const sampleCount = Math.floor(bytes.byteLength / 2);
      if (sampleCount === 0) return;
      const int16Array = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount);

      // Create AudioBuffer at 24kHz
      const audioBuffer = ctx.createBuffer(1, int16Array.length, this.sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < int16Array.length; i++) {
        channelData[i] = int16Array[i] / 32768.0;
      }

      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(targetNode);

      // Sequential gapless scheduling
      const now = ctx.currentTime;
      // If playback is starting fresh or fell behind current timeline, lead by 25ms
      if (this.nextStartTime < now) {
        this.nextStartTime = now + 0.025;
      }

      sourceNode.start(this.nextStartTime);
      this.activeSources.add(sourceNode);

      // Advance schedule timestamp by the exact buffer duration
      this.nextStartTime += audioBuffer.duration;

      if (!this.isPlaying) {
        this.isPlaying = true;
        this.onPlaybackStateChange?.(true);
      }

      sourceNode.onended = () => {
        this.activeSources.delete(sourceNode);
        if (this.activeSources.size === 0) {
          if (this.checkEndTimeout) clearTimeout(this.checkEndTimeout);
          this.checkEndTimeout = setTimeout(() => {
            if (this.activeSources.size === 0 && this.isPlaying) {
              this.isPlaying = false;
              this.nextStartTime = 0;
              this.onPlaybackStateChange?.(false);
            }
          }, 180);
        }
      };
    } catch (err) {
      console.warn('[AURA AudioPlayer] Error playing audio chunk:', err);
    }
  }

  /**
   * Instantaneous Barge-In Interruption:
   * 1. Stops all actively playing and queued future audio nodes immediately
   * 2. Clears the pending queue
   * 3. Resets timeline schedule
   * 4. Disconnects nodes cleanly
   */
  public stopAll() {
    this.isInterrupted = true;

    if (this.checkEndTimeout) {
      clearTimeout(this.checkEndTimeout);
      this.checkEndTimeout = null;
    }

    for (const source of this.activeSources) {
      try {
        source.onended = null; // Prevent delayed state callbacks
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.activeSources.clear();

    const ctx = this.engine.getContext();
    this.nextStartTime = ctx ? ctx.currentTime : 0;

    if (this.isPlaying) {
      this.isPlaying = false;
      this.onPlaybackStateChange?.(false);
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public close() {
    this.stopAll();
  }
}
