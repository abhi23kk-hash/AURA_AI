/**
 * Audio capture and real-time DSP preprocessing for Gemini Live API
 * 
 * Features:
 * - Hardware & browser-level echo cancellation and noise suppression
 * - Multi-stage DSP filtering:
 *   - 85Hz High-pass filter: removes fan rumble, AC hum, desk vibration
 *   - 2.2kHz Presence filter: enhances speech formant intelligibility
 *   - 7.5kHz Low-pass filter: strips high-frequency static and electronic hiss
 *   - Dynamics compressor: balances quiet and loud speech without clipping or distortion
 * - Adaptive Noise Floor Tracking & Intelligent Voice Activity Detection (VAD)
 * - Hangover timing to protect natural conversational pauses from being cut off
 * - Acoustic isolation sink: prevents microphone audio from bleeding into output speakers
 * - Streams 16-bit linear PCM at 16,000 Hz in small low-latency chunks
 */

export interface AudioCaptureCallbacks {
  onAudioChunk: (base64Pcm: string) => void;
  onAudioLevel: (level: number) => void;
  onUserVoiceDetected?: () => void;
  onVoiceActivity?: (isActive: boolean, rms: number) => void;
}

export class LiveAudioCapture {
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private highPassFilter: BiquadFilterNode | null = null;
  private clarityFilter: BiquadFilterNode | null = null;
  private antiHissFilter: BiquadFilterNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentSinkNode: GainNode | null = null;

  private isCapturing = false;
  private isSpeaking = false; // Whether the assistant is currently speaking (for client barge-in detection)
  private assistantEchoGuardUntil = 0;
  private bargeInFrames = 0;
  private callbacks: AudioCaptureCallbacks | null = null;
  private sampleRate = 16000;
  private targetChunkSamples = 512; // ~32ms at 16kHz
  private pcmBuffer: Int16Array = new Int16Array(512);
  private pcmBufferOffset = 0;

  // Adaptive VAD & Noise Gate State
  private ambientNoiseFloor = 0.015;
  private isVoiceDetected = false;
  private hangoverFrames = 0;
  private readonly HANGOVER_FRAMES_TOTAL = 15; // ~300ms natural pause protection

  // High-fidelity PCM buffer for universal WAV generation & server transcription
  private recordedChunks: Float32Array[] = [];
  private totalRecordedSamples = 0;
  private voiceFramesCaptured = 0;
  private maxPeakCaptured = 0;
  private readonly MAX_RECORDED_SAMPLES = 16000 * 20; // 20 seconds maximum buffer

  public setAssistantSpeaking(speaking: boolean, immediateBargeIn: boolean = false) {
    this.isSpeaking = speaking;
    this.bargeInFrames = 0;
    if (speaking || immediateBargeIn) {
      this.assistantEchoGuardUntil = 0;
    } else {
      // Protect against room reverb tail right after speakers stop
      this.assistantEchoGuardUntil = Date.now() + 400;
    }
  }

  public isAssistantOutputActive(): boolean {
    return this.isSpeaking || Date.now() < this.assistantEchoGuardUntil;
  }

  public start(stream: MediaStream, callbacks: AudioCaptureCallbacks) {
    if (this.isCapturing) {
      this.stop();
    }

    this.callbacks = callbacks;
    this.isCapturing = true;
    this.ambientNoiseFloor = 0.015;
    this.isVoiceDetected = false;
    this.hangoverFrames = 0;
    this.recordedChunks = [];
    this.totalRecordedSamples = 0;
    this.voiceFramesCaptured = 0;
    this.maxPeakCaptured = 0;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      try {
        this.audioContext = new AudioCtx({ sampleRate: this.sampleRate });
      } catch {
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);

      // Stage 1: 85 Hz High-pass filter to eliminate fan rumble, HVAC hum, and physical vibrations
      this.highPassFilter = this.audioContext.createBiquadFilter();
      this.highPassFilter.type = 'highpass';
      this.highPassFilter.frequency.value = 85;
      this.highPassFilter.Q.value = 0.707;

      // Stage 2: 2.2 kHz Vocal clarity peaking filter to focus speech intelligibility
      this.clarityFilter = this.audioContext.createBiquadFilter();
      this.clarityFilter.type = 'peaking';
      this.clarityFilter.frequency.value = 2200;
      this.clarityFilter.Q.value = 0.9;
      this.clarityFilter.gain.value = 1.5;

      // Stage 3: 7.5 kHz Anti-hiss filter to eliminate high-frequency static and prevent aliasing
      this.antiHissFilter = this.audioContext.createBiquadFilter();
      this.antiHissFilter.type = 'lowpass';
      this.antiHissFilter.frequency.value = 7500;
      this.antiHissFilter.Q.value = 0.707;

      // Stage 4: Hardware dynamics compressor for voice leveling (smooths quiet and loud speech)
      this.compressorNode = this.audioContext.createDynamicsCompressor();
      this.compressorNode.threshold.value = -24; // dB
      this.compressorNode.knee.value = 12; // dB soft knee
      this.compressorNode.ratio.value = 3.5;
      this.compressorNode.attack.value = 0.003; // 3ms fast transient response
      this.compressorNode.release.value = 0.12; // 120ms smooth natural release

      // Stage 5: Spectrum analyser for visual levels
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.25;

      // Stage 6: Script processor for adaptive DSP and 16kHz PCM chunking
      const bufferSize = 1024;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      // Stage 7: Silent sink node to prevent any mic audio from looping into speaker output
      this.silentSinkNode = this.audioContext.createGain();
      this.silentSinkNode.gain.value = 0;

      // Connect DSP audio graph
      this.mediaStreamSource.connect(this.highPassFilter);
      this.highPassFilter.connect(this.clarityFilter);
      this.clarityFilter.connect(this.antiHissFilter);
      this.antiHissFilter.connect(this.compressorNode);
      this.compressorNode.connect(this.analyserNode);
      this.analyserNode.connect(this.processorNode);
      this.processorNode.connect(this.silentSinkNode);
      this.silentSinkNode.connect(this.audioContext.destination);

      const actualSampleRate = this.audioContext.sampleRate;
      this.pcmBufferOffset = 0;
      let logCounter = 0;

      console.log(`[AURA AudioCapture] Started AudioContext state: ${this.audioContext.state}, sampleRate: ${actualSampleRate}Hz, stream active: ${stream.active}`);

      this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!this.isCapturing) return;

        const inputChannelData = e.inputBuffer.getChannelData(0);
        const bufferLength = inputChannelData.length;

        // 1. Calculate buffer RMS energy and peak
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < bufferLength; i++) {
          const sample = inputChannelData[i];
          const abs = Math.abs(sample);
          if (abs > peak) peak = abs;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / bufferLength);

        // 2. Adaptive ambient noise floor tracking (gentle floor between 0.002 and 0.03)
        if (rms < this.ambientNoiseFloor) {
          this.ambientNoiseFloor = this.ambientNoiseFloor * 0.92 + rms * 0.08;
        } else {
          this.ambientNoiseFloor = this.ambientNoiseFloor * 0.998 + rms * 0.002;
        }
        this.ambientNoiseFloor = Math.max(0.002, Math.min(0.03, this.ambientNoiseFloor));

        // 3. Voice Activity Detection: responsive threshold that catches normal and quiet speech
        const speechThreshold = Math.max(this.ambientNoiseFloor * 1.35, 0.008);
        if (rms >= speechThreshold) {
          this.isVoiceDetected = true;
          this.hangoverFrames = this.HANGOVER_FRAMES_TOTAL;
          this.voiceFramesCaptured++;
          if (peak > this.maxPeakCaptured) {
            this.maxPeakCaptured = peak;
          }
        } else if (this.hangoverFrames > 0) {
          this.hangoverFrames--;
          this.isVoiceDetected = true;
        } else {
          this.isVoiceDetected = false;
        }

        // Periodic diagnostic log (once every ~1.5s)
        logCounter++;
        if (logCounter % 40 === 0) {
          console.log(`[AURA AudioCapture] Audio RMS: ${rms.toFixed(4)}, Peak: ${peak.toFixed(4)}, NoiseFloor: ${this.ambientNoiseFloor.toFixed(4)}, VoiceDetected: ${this.isVoiceDetected}`);
        }

        // 4. Update visualizer level (clean representation of user voice)
        const displayLevel = this.isVoiceDetected
          ? Math.min(1, rms * 4.5)
          : Math.min(0.12, rms * 1.5);
        this.callbacks?.onAudioLevel(displayLevel);
        this.callbacks?.onVoiceActivity?.(this.isVoiceDetected, rms);

        // 5. Barge-in detection: Ignore mild speaker bleed; trigger immediately on genuine user voice ("stop", follow-ups)
        if (this.isSpeaking) {
          const bargeInThreshold = Math.max(this.ambientNoiseFloor * 4.0, 0.065);
          if (rms >= bargeInThreshold) {
            this.bargeInFrames++;
            if (this.bargeInFrames >= 4) {
              this.bargeInFrames = 0;
              this.callbacks?.onUserVoiceDetected?.();
            }
          } else {
            this.bargeInFrames = 0;
          }
        } else {
          this.bargeInFrames = 0;
        }

        // 6. Transparent audio pass-through: do not muffle or crush vocal formants
        // We preserve full dynamic range so speech recognition receives pristine audio
        const processedAudio = new Float32Array(bufferLength);
        for (let i = 0; i < bufferLength; i++) {
          processedAudio[i] = inputChannelData[i];
        }

        // 7. Resample to 16,000 Hz if actualSampleRate differs from target
        const resampled = this.resampleAudio(processedAudio, actualSampleRate, this.sampleRate);

        // Keep rolling buffer of clean 16kHz speech audio for high-fidelity WAV transcription
        const chunkCopy = new Float32Array(resampled);
        this.recordedChunks.push(chunkCopy);
        this.totalRecordedSamples += chunkCopy.length;
        while (this.totalRecordedSamples > this.MAX_RECORDED_SAMPLES && this.recordedChunks.length > 0) {
          const dropped = this.recordedChunks.shift();
          if (dropped) this.totalRecordedSamples -= dropped.length;
        }

        // 8. Convert float [-1.0, 1.0] to 16-bit signed PCM
        for (let i = 0; i < resampled.length; i++) {
          const s = Math.max(-1, Math.min(1, resampled[i]));
          const pcmVal = s < 0 ? s * 0x8000 : s * 0x7fff;
          this.pcmBuffer[this.pcmBufferOffset++] = pcmVal;

          if (this.pcmBufferOffset >= this.targetChunkSamples) {
            const base64Chunk = this.int16ToBase64(this.pcmBuffer);
            this.callbacks?.onAudioChunk(base64Chunk);
            this.pcmBufferOffset = 0;
          }
        }
      };
    } catch (err) {
      console.error('[AURA AudioCapture] Error starting audio capture:', err);
      this.stop();
    }
  }

  public stop() {
    this.isCapturing = false;
    this.pcmBufferOffset = 0;
    this.recordedChunks = [];
    this.totalRecordedSamples = 0;
    this.voiceFramesCaptured = 0;
    this.maxPeakCaptured = 0;

    if (this.processorNode) {
      try {
        this.processorNode.disconnect();
        this.processorNode.onaudioprocess = null;
      } catch {}
      this.processorNode = null;
    }

    if (this.silentSinkNode) {
      try {
        this.silentSinkNode.disconnect();
      } catch {}
      this.silentSinkNode = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {}
      this.analyserNode = null;
    }

    if (this.compressorNode) {
      try {
        this.compressorNode.disconnect();
      } catch {}
      this.compressorNode = null;
    }

    if (this.antiHissFilter) {
      try {
        this.antiHissFilter.disconnect();
      } catch {}
      this.antiHissFilter = null;
    }

    if (this.clarityFilter) {
      try {
        this.clarityFilter.disconnect();
      } catch {}
      this.clarityFilter = null;
    }

    if (this.highPassFilter) {
      try {
        this.highPassFilter.disconnect();
      } catch {}
      this.highPassFilter = null;
    }

    if (this.mediaStreamSource) {
      try {
        this.mediaStreamSource.disconnect();
      } catch {}
      this.mediaStreamSource = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close().catch(() => {});
      } catch {}
      this.audioContext = null;
    }

    this.callbacks?.onAudioLevel(0);
  }

  private resampleAudio(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const newLength = Math.round(input.length / ratio);
    const output = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * ratio;
      const index = Math.floor(srcIdx);
      const frac = srcIdx - index;
      const nextIndex = Math.min(index + 1, input.length - 1);
      output[i] = input[index] * (1 - frac) + input[nextIndex] * frac;
    }
    return output;
  }

  private int16ToBase64(int16Arr: Int16Array): string {
    const uint8Arr = new Uint8Array(int16Arr.buffer, int16Arr.byteOffset, int16Arr.byteLength);
    let binary = '';
    const len = uint8Arr.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Arr[i]);
    }
    return btoa(binary);
  }

  /**
   * Generates a 100% compliant, standard 16kHz 16-bit mono PCM WAV file with a 44-byte RIFF header.
   * Completely immune to browser-specific MediaRecorder chunking and container corruption.
   */
  public getRecordedWavBase64(): string | null {
    // Require at least 250ms of audio and real voice activity energy (avoid sending room silence)
    if (this.totalRecordedSamples < 4000 || this.voiceFramesCaptured < 4 || this.maxPeakCaptured < 0.015) {
      return null;
    }

    // Merge recorded chunks into one continuous Int16Array
    const merged = new Int16Array(this.totalRecordedSamples);
    let offset = 0;
    for (const chunk of this.recordedChunks) {
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        merged[offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }

    const wavBuffer = this.encodeWav(merged, this.sampleRate);
    return this.arrayBufferToBase64(wavBuffer);
  }

  public clearRecordedAudio(): void {
    this.recordedChunks = [];
    this.totalRecordedSamples = 0;
    this.voiceFramesCaptured = 0;
    this.maxPeakCaptured = 0;
  }

  private encodeWav(samples: Int16Array, sampleRate = 16000): ArrayBuffer {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // "RIFF"
    view.setUint32(0, 0x52494646, false);
    // Total file size minus 8 bytes
    view.setUint32(4, 36 + samples.length * 2, true);
    // "WAVE"
    view.setUint32(8, 0x57415645, false);

    // "fmt " chunk
    view.setUint32(12, 0x666d7420, false);
    // Subchunk1Size (16 for PCM)
    view.setUint32(16, 16, true);
    // AudioFormat (1 for PCM)
    view.setUint16(20, 1, true);
    // NumChannels (1 for mono)
    view.setUint16(22, 1, true);
    // SampleRate (16000)
    view.setUint32(24, sampleRate, true);
    // ByteRate = SampleRate * NumChannels * BitsPerSample / 8
    view.setUint32(28, sampleRate * 2, true);
    // BlockAlign = NumChannels * BitsPerSample / 8
    view.setUint16(32, 2, true);
    // BitsPerSample (16-bit)
    view.setUint16(34, 16, true);

    // "data" chunk
    view.setUint32(36, 0x64617461, false);
    // Subchunk2Size
    view.setUint32(40, samples.length * 2, true);

    // Write PCM samples
    const pcmData = new Int16Array(buffer, 44, samples.length);
    pcmData.set(samples);

    return buffer;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const uint8Arr = new Uint8Array(buffer);
    let binary = '';
    const len = uint8Arr.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Arr[i]);
    }
    return btoa(binary);
  }
}
