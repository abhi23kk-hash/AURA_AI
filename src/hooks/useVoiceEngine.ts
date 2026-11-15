import { useState, useEffect, useRef, useCallback } from 'react';
import { AssistantState, UserSettings } from '../types.ts';
import { playAssistantChime } from '../utils/assistantAudio.ts';
import { prepareTextForSpeech } from '../utils/speechSanitizer.ts';
import { SharedAudioOutputEngine, LiveAudioPlayer } from '../lib/voice/audioPlayback.ts';
import { LiveAudioCapture } from '../lib/voice/audioCapture.ts';
import {
  acquireMicrophoneStream,
  queryMicrophonePermission,
  getCachedPermissionStatus,
  releaseMicrophoneStream,
} from '../lib/voice/permissions.ts';

// Chromium garbage collector protection: maintains references to all active utterances
const activeUtterances = new Set<SpeechSynthesisUtterance>();

interface UseVoiceEngineProps {
  settings: UserSettings;
  userId?: string;
  onUserSpeechFinal: (transcript: string) => void;
  onUserLiveTranscript?: (transcript: string) => void;
  onUserInterrupted?: () => void;
  onToolCall?: (name: string, args: any) => void;
  onAssistantTranscript?: (text: string) => void;
  onAssistantTurnComplete?: () => void;
  isHandsFreeActive: boolean;
}

export function useVoiceEngine({
  settings,
  userId = 'user_abhishek',
  onUserSpeechFinal,
  onUserLiveTranscript,
  onUserInterrupted,
  onToolCall,
  onAssistantTranscript,
  onAssistantTurnComplete,
  isHandsFreeActive,
}: UseVoiceEngineProps) {
  const [state, setState] = useState<AssistantState>('IDLE');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isMicAvailable, setIsMicAvailable] = useState<boolean>(true);
  const [micPermissionDenied, setMicPermissionDenied] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isNoiseFilterActive, setIsNoiseFilterActive] = useState<boolean>(true);
  const [isLiveSessionConnected, setIsLiveSessionConnected] = useState<boolean>(false);

  // References for Live API WebSocket + Real-Time Audio Playback
  const liveWsRef = useRef<WebSocket | null>(null);
  const livePlayerRef = useRef<LiveAudioPlayer | null>(null);
  const isLiveModeRef = useRef<boolean>(false);
  const liveInputTranscriptRef = useRef<string>('');
  const liveTurnHasCommittedInputRef = useRef<boolean>(false);
  const liveReconnectAttemptsRef = useRef<number>(0);
  const liveReconnectTimerRef = useRef<any>(null);
  const liveConnectTimeoutRef = useRef<any>(null);
  const liveHasConnectedRef = useRef<boolean>(false);

  // References for Fallback SpeechRecognition + Audio Capture
  const recognitionRef = useRef<any>(null);
  const audioCaptureRef = useRef<LiveAudioCapture | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeStreamRef = useRef<MediaStream | null>(null);

  const isListeningRef = useRef<boolean>(false);
  const isSpeakingLocalRef = useRef<boolean>(false);
  const hasUserInteractedRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<any>(null);
  const vadCheckTimerRef = useRef<any>(null);
  const speechKeepaliveRef = useRef<any>(null);
  const recognitionRestartTimerRef = useRef<any>(null);
  const accumulatedTranscriptRef = useRef<string>('');
  const latestTranscriptRef = useRef<string>('');

  // Fallback VAD tracking
  const hasVoiceSpokenRef = useRef<boolean>(false);
  const speechStartTimeRef = useRef<number>(0);
  const lastVoiceDetectedTimeRef = useRef<number>(0);
  const isTranscribingRef = useRef<boolean>(false);
  const transcribeCooldownUntilRef = useRef<number>(0);
  const ttsCooldownUntilRef = useRef<number>(0);
  const speakInvocationIdRef = useRef<number>(0);
  const isInterruptedTurnRef = useRef<boolean>(false);
  const interruptedUntilRef = useRef<number>(0);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeBufferSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const onUserInterruptedRef = useRef(onUserInterrupted);
  const onToolCallRef = useRef(onToolCall);
  const onAssistantTranscriptRef = useRef(onAssistantTranscript);
  const onAssistantTurnCompleteRef = useRef(onAssistantTurnComplete);
  const onUserSpeechFinalRef = useRef(onUserSpeechFinal);
  const onUserLiveTranscriptRef = useRef(onUserLiveTranscript);
  const isHandsFreeRef = useRef(isHandsFreeActive);
  const settingsRef = useRef(settings);

  useEffect(() => {
    onUserInterruptedRef.current = onUserInterrupted;
    onToolCallRef.current = onToolCall;
    onAssistantTranscriptRef.current = onAssistantTranscript;
    onAssistantTurnCompleteRef.current = onAssistantTurnComplete;
    onUserSpeechFinalRef.current = onUserSpeechFinal;
    onUserLiveTranscriptRef.current = onUserLiveTranscript;
    isHandsFreeRef.current = isHandsFreeActive;
    settingsRef.current = settings;
  });

  // Unlock AudioContext on first real user interaction so async playback never fails autoplay checks
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      hasUserInteractedRef.current = true;
      SharedAudioOutputEngine.getInstance().resume().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Pre-load speech synthesis voices
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      const onVoicesChanged = () => {
        window.speechSynthesis.getVoices();
      };
      window.speechSynthesis.onvoiceschanged = onVoicesChanged;
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  // Proactively detect microphone permission state without triggering prompt
  useEffect(() => {
    queryMicrophonePermission()
      .then((status) => {
        if (status === 'granted') {
          setMicPermissionDenied(false);
        } else if (status === 'denied') {
          setMicPermissionDenied(true);
        }
      })
      .catch(() => {});
  }, []);

  const stopLiveSession = useCallback(() => {
    isLiveModeRef.current = false;
    liveHasConnectedRef.current = false;
    liveReconnectAttemptsRef.current = 0;
    setIsLiveSessionConnected(false);
    liveInputTranscriptRef.current = '';
    liveTurnHasCommittedInputRef.current = false;

    if (liveReconnectTimerRef.current) {
      clearTimeout(liveReconnectTimerRef.current);
      liveReconnectTimerRef.current = null;
    }
    if (liveConnectTimeoutRef.current) {
      clearTimeout(liveConnectTimeoutRef.current);
      liveConnectTimeoutRef.current = null;
    }

    if (livePlayerRef.current) {
      try {
        livePlayerRef.current.close();
      } catch {}
      livePlayerRef.current = null;
    }

    if (liveWsRef.current) {
      try {
        liveWsRef.current.onopen = null;
        liveWsRef.current.onmessage = null;
        liveWsRef.current.onerror = null;
        liveWsRef.current.onclose = null;
        if (liveWsRef.current.readyState === WebSocket.OPEN || liveWsRef.current.readyState === WebSocket.CONNECTING) {
          liveWsRef.current.close();
        }
      } catch {}
      liveWsRef.current = null;
    }
  }, []);

  // Stop audio capture and media recorder helper
  const stopAudioCapture = useCallback(() => {
    if (vadCheckTimerRef.current) {
      clearInterval(vadCheckTimerRef.current);
      vadCheckTimerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];

    if (audioCaptureRef.current) {
      audioCaptureRef.current.stop();
      audioCaptureRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  // Stop speech recognition helper
  const stopRecognition = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRestartTimerRef.current) {
      clearTimeout(recognitionRestartTimerRef.current);
      recognitionRestartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
  }, []);

  // Finalize user speech in turn-based fallback mode and dispatch to /api/chat
  const finalizeUserSpeech = useCallback((spokenText: string) => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (vadCheckTimerRef.current) {
      clearInterval(vadCheckTimerRef.current);
      vadCheckTimerRef.current = null;
    }

    const clean = spokenText.trim();
    if (!clean) return;

    isListeningRef.current = false;
    hasVoiceSpokenRef.current = false;
    speechStartTimeRef.current = 0;
    lastVoiceDetectedTimeRef.current = 0;
    isTranscribingRef.current = false;
    accumulatedTranscriptRef.current = '';
    latestTranscriptRef.current = '';
    setInterimTranscript('');

    stopRecognition();
    stopAudioCapture();

    setState('PROCESSING');
    playAssistantChime('complete');
    console.log('[AURA Voice] User speech recognized:', clean);
    onUserSpeechFinalRef.current?.(clean);
  }, [stopAudioCapture, stopRecognition]);

  // Server audio transcription helper (Fallback when Live API and Web Speech API are unavailable/silent)
  const processServerAudioTranscription = useCallback(async (_stream: MediaStream) => {
    if (isTranscribingRef.current || !isListeningRef.current || isLiveModeRef.current) return;

    if (Date.now() < transcribeCooldownUntilRef.current) {
      hasVoiceSpokenRef.current = false;
      speechStartTimeRef.current = 0;
      lastVoiceDetectedTimeRef.current = 0;
      audioCaptureRef.current?.clearRecordedAudio();
      audioChunksRef.current = [];
      return;
    }

    const hasAudioCapture = Boolean(audioCaptureRef.current);
    let wavBase64: string | null = null;
    try {
      wavBase64 = audioCaptureRef.current?.getRecordedWavBase64() || null;
    } catch {}

    const hasChunks = !hasAudioCapture && audioChunksRef.current.length > 0;
    if (!wavBase64 && !hasChunks) {
      hasVoiceSpokenRef.current = false;
      speechStartTimeRef.current = 0;
      lastVoiceDetectedTimeRef.current = 0;
      audioChunksRef.current = [];
      return;
    }

    isTranscribingRef.current = true;
    hasVoiceSpokenRef.current = false;
    speechStartTimeRef.current = 0;
    lastVoiceDetectedTimeRef.current = 0;
    setState('PROCESSING');
    setInterimTranscript('Processing your speech...');

    let audioPayload: { audio: string; mimeType: string } | null = null;

    if (wavBase64 && wavBase64.length > 2000) {
      audioPayload = { audio: wavBase64, mimeType: 'audio/wav' };
      audioCaptureRef.current?.clearRecordedAudio();
      audioChunksRef.current = [];
    } else if (hasChunks) {
      const chunks = [...audioChunksRef.current];
      audioChunksRef.current = [];
      const rawMimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
      const cleanMimeType = rawMimeType.split(';')[0].trim() || 'audio/webm';
      const blob = new Blob(chunks, { type: rawMimeType });

      if (blob.size >= 1500) {
        try {
          const rawResult = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const base64Audio = rawResult.includes(',') ? rawResult.split(',')[1] : rawResult;
          audioPayload = { audio: base64Audio, mimeType: cleanMimeType };
        } catch {}
      }
    }

    if (!audioPayload || !audioPayload.audio) {
      isTranscribingRef.current = false;
      hasVoiceSpokenRef.current = false;
      speechStartTimeRef.current = 0;
      lastVoiceDetectedTimeRef.current = 0;
      if (isListeningRef.current) {
        setState('LISTENING');
        setInterimTranscript('');
      } else {
        setState('IDLE');
      }
      return;
    }

    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioPayload),
      });
      const data = await res.json();
      const transcribed = (data.text || '').trim();

      if (res.status === 429 || data.quotaExceeded) {
        transcribeCooldownUntilRef.current = Date.now() + 2 * 60 * 1000;
        console.log('[AURA Voice] Server transcription quota reached; relying on browser speech recognition');
      }

      if (transcribed && transcribed.length > 1) {
        console.log('[AURA Voice] Transcribed via Server Gemini:', transcribed);
        finalizeUserSpeech(transcribed);
      } else {
        console.log('[AURA Voice] Audio transcribed without speech words');
        isTranscribingRef.current = false;
        hasVoiceSpokenRef.current = false;
        speechStartTimeRef.current = 0;
        lastVoiceDetectedTimeRef.current = 0;
        if (isListeningRef.current) {
          setState('LISTENING');
          setInterimTranscript('');
          audioCaptureRef.current?.clearRecordedAudio();
          audioChunksRef.current = [];
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
            try {
              mediaRecorderRef.current.start(250);
            } catch {}
          }
        } else {
          setState('IDLE');
        }
      }
    } catch (serverErr) {
      console.log('[AURA Voice] Server transcription request notice:', serverErr);
      isTranscribingRef.current = false;
      hasVoiceSpokenRef.current = false;
      speechStartTimeRef.current = 0;
      lastVoiceDetectedTimeRef.current = 0;
      if (isListeningRef.current) {
        setState('LISTENING');
        setInterimTranscript('');
      } else {
        setState('IDLE');
      }
    }
  }, [finalizeUserSpeech]);

  // Helper: Start legacy SpeechRecognition + VAD fallback if Live API WebSocket is unavailable
  const startFallbackRecognition = useCallback((stream: MediaStream) => {
    if (!isListeningRef.current || isLiveModeRef.current) return;

    // 1. Initialize MediaRecorder if SpeechRecognition might need server audio fallback
    if (typeof MediaRecorder !== 'undefined' && !mediaRecorderRef.current) {
      try {
        let mimeType = '';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        }

        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
            if (audioChunksRef.current.length > 60) {
              audioChunksRef.current = [audioChunksRef.current[0], ...audioChunksRef.current.slice(-59)];
            }
          }
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
      } catch (recErr) {
        console.log('[AURA Voice] MediaRecorder setup notice:', recErr);
      }
    }

    // 2. Browser SpeechRecognition
    const SpeechRecAPI =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (SpeechRecAPI && !recognitionRef.current) {
      try {
        const recognition = new SpeechRecAPI();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        const langMap: Record<string, string> = {
          te: 'te-IN',
          hi: 'hi-IN',
          ta: 'ta-IN',
          kn: 'kn-IN',
          ml: 'ml-IN',
          mr: 'mr-IN',
          bn: 'bn-IN',
          en: 'en-US',
        };
        const activeSettings = settingsRef.current;
        const activeLang = activeSettings.language || (activeSettings.languageMode !== 'auto' ? activeSettings.languageMode : 'en');
        recognition.lang = langMap[activeLang] || (activeLang && activeLang.includes('-') ? activeLang : 'en-US');

        recognition.onstart = () => {
          console.log('[AURA Voice] Fallback speech recognition started in language:', recognition.lang);
          setMicPermissionDenied(false);
          setIsMicAvailable(true);
        };

        recognition.onresult = (event: any) => {
          if (!isListeningRef.current || isLiveModeRef.current || isSpeakingLocalRef.current) return;

          let currentInterim = '';
          let currentFinal = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const res = event.results[i];
            if (res.isFinal) {
              currentFinal += res[0].transcript + ' ';
            } else {
              currentInterim += res[0].transcript;
            }
          }

          if (currentFinal) {
            accumulatedTranscriptRef.current = (accumulatedTranscriptRef.current + ' ' + currentFinal).trim();
          }

          const currentTotal = (accumulatedTranscriptRef.current + ' ' + currentInterim).trim();
          if (currentTotal) {
            latestTranscriptRef.current = currentTotal;
            hasVoiceSpokenRef.current = true;
            lastVoiceDetectedTimeRef.current = Date.now();
            setInterimTranscript(currentTotal);
          }

          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }

          // Natural 1100ms conversational pause window so natural mid-sentence pauses aren't chopped
          silenceTimerRef.current = setTimeout(() => {
            const finalWords = latestTranscriptRef.current.trim();
            if (finalWords && isListeningRef.current && !isLiveModeRef.current) {
              finalizeUserSpeech(finalWords);
            }
          }, 1100);
        };

        recognition.onerror = (event: any) => {
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            console.log('[AURA Voice] Speech recognition notice:', event.error);
          }
          if (!activeStreamRef.current && (event.error === 'not-allowed' || event.error === 'service-not-allowed')) {
            setMicPermissionDenied(true);
            setIsMicAvailable(false);
            setState('ERROR');
          }
        };

        recognition.onend = () => {
          const words = latestTranscriptRef.current.trim();
          if (words && isListeningRef.current && !isLiveModeRef.current) {
            finalizeUserSpeech(words);
            return;
          }
          // Restart recognition cleanly with brief cooldown to avoid Chrome InvalidStateError
          if (isListeningRef.current && !isLiveModeRef.current && !isSpeakingLocalRef.current) {
            recognitionRestartTimerRef.current = setTimeout(() => {
              if (isListeningRef.current && !isLiveModeRef.current && !isSpeakingLocalRef.current && recognitionRef.current === recognition) {
                try {
                  recognition.start();
                } catch {}
              }
            }, 220);
          }
        };

        recognitionRef.current = recognition;
        try {
          recognition.start();
        } catch {}
      } catch (recErr: any) {
        console.log('[AURA Voice] Could not start fallback speech recognition:', recErr?.message || recErr);
      }
    }

    // 3. VAD silence poller for fallback mode
    if (vadCheckTimerRef.current) {
      clearInterval(vadCheckTimerRef.current);
    }
    vadCheckTimerRef.current = setInterval(() => {
      if (!isListeningRef.current || isTranscribingRef.current || isLiveModeRef.current || isSpeakingLocalRef.current) return;

      const now = Date.now();
      if (hasVoiceSpokenRef.current && lastVoiceDetectedTimeRef.current > 0) {
        const elapsedSilence = now - lastVoiceDetectedTimeRef.current;
        const totalSpeechDuration = speechStartTimeRef.current > 0 ? now - speechStartTimeRef.current : 0;

        const words = latestTranscriptRef.current.trim();
        if (words && elapsedSilence >= 1100) {
          finalizeUserSpeech(words);
          return;
        }

        const hasWebSpeech = Boolean(recognitionRef.current);
        const silenceThreshold = hasWebSpeech ? 2400 : 1200;

        if (elapsedSilence >= silenceThreshold || (totalSpeechDuration >= 9000 && elapsedSilence >= 600)) {
          if (words) {
            finalizeUserSpeech(words);
            return;
          }

          if (stream && (audioChunksRef.current.length > 0 || audioCaptureRef.current)) {
            processServerAudioTranscription(stream);
          }
        }
      }
    }, 100);
  }, [finalizeUserSpeech, processServerAudioTranscription]);

  // 2. Start Listening: Primary Real-Time Gemini Live API (gemini-3.8-live) + Automatic SpeechRecognition Fallback
  const startListening = useCallback(async () => {
    hasUserInteractedRef.current = true;
    speakInvocationIdRef.current += 1;
    isInterruptedTurnRef.current = false;
    setIsMuted(false);

    // Stop any non-live speech playback immediately before listening
    if (activeBufferSourceRef.current) {
      try {
        activeBufferSourceRef.current.onended = null;
        activeBufferSourceRef.current.stop();
        activeBufferSourceRef.current.disconnect();
      } catch {}
      activeBufferSourceRef.current = null;
    }
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      } catch {}
      activeAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    activeUtterances.clear();
    isSpeakingLocalRef.current = false;

    // Unlock Web Audio Context on user gesture
    try {
      await SharedAudioOutputEngine.getInstance().resume();
    } catch {}

    playAssistantChime('wake');

    // Clean up any previous sessions cleanly
    stopRecognition();
    stopAudioCapture();
    stopLiveSession();

    isListeningRef.current = true;
    hasVoiceSpokenRef.current = false;
    speechStartTimeRef.current = 0;
    lastVoiceDetectedTimeRef.current = 0;
    isTranscribingRef.current = false;
    accumulatedTranscriptRef.current = '';
    latestTranscriptRef.current = '';
    audioChunksRef.current = [];
    setInterimTranscript('');
    setState('CONNECTING');

    // Acquire hardware microphone stream
    let stream: MediaStream | null = null;
    try {
      const micResult = await acquireMicrophoneStream();
      if (micResult.stream) {
        stream = micResult.stream;
        activeStreamRef.current = stream;
        setMicPermissionDenied(false);
        setIsMicAvailable(true);
      } else {
        const cached = getCachedPermissionStatus();
        if (cached === 'denied') {
          isListeningRef.current = false;
          setMicPermissionDenied(true);
          setState('ERROR');
          return;
        }
      }
    } catch (micErr) {
      console.warn('[AURA Voice] Audio capture stream notice:', micErr);
    }

    if (!stream) {
      isListeningRef.current = false;
      setIsMicAvailable(false);
      setState('ERROR');
      return;
    }

    // Initialize Real-Time 24kHz PCM Output Player for Gemini Live
    const livePlayer = new LiveAudioPlayer((isPlaying) => {
      audioCaptureRef.current?.setAssistantSpeaking(isPlaying);
      if (!isListeningRef.current && !isPlaying) return;
      if (isPlaying) {
        setState('SPEAKING');
      } else if (isListeningRef.current) {
        setState('LISTENING');
      }
    });
    livePlayerRef.current = livePlayer;

    // Open WebSocket to /api/live-assistant (gemini-3.8-live) with resilient auto-reconnect
    let fallbackTriggered = false;
    const engageFallback = () => {
      if (fallbackTriggered || !isListeningRef.current) return;
      fallbackTriggered = true;
      if (liveReconnectTimerRef.current) {
        clearTimeout(liveReconnectTimerRef.current);
        liveReconnectTimerRef.current = null;
      }
      if (liveConnectTimeoutRef.current) {
        clearTimeout(liveConnectTimeoutRef.current);
        liveConnectTimeoutRef.current = null;
      }
      isLiveModeRef.current = false;
      setIsLiveSessionConnected(false);
      setState('LISTENING');
      startFallbackRecognition(stream!);
    };

    const connectLiveWebSocket = () => {
      if (!isListeningRef.current || fallbackTriggered) return;

      if (liveWsRef.current) {
        try {
          liveWsRef.current.onopen = null;
          liveWsRef.current.onmessage = null;
          liveWsRef.current.onerror = null;
          liveWsRef.current.onclose = null;
          if (liveWsRef.current.readyState === WebSocket.OPEN || liveWsRef.current.readyState === WebSocket.CONNECTING) {
            liveWsRef.current.close();
          }
        } catch {}
        liveWsRef.current = null;
      }

      try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const voiceParam = encodeURIComponent(settingsRef.current.voiceName || 'Zephyr');
        const userParam = encodeURIComponent(userId || 'user_abhishek');
        const wsUrl = `${wsProtocol}//${window.location.host}/api/live-assistant?userId=${userParam}&voiceName=${voiceParam}`;
        const ws = new WebSocket(wsUrl);
        liveWsRef.current = ws;

        let socketHandled = false;

        if (liveConnectTimeoutRef.current) {
          clearTimeout(liveConnectTimeoutRef.current);
        }
        liveConnectTimeoutRef.current = setTimeout(() => {
          if (liveWsRef.current === ws && !isLiveModeRef.current && isListeningRef.current && !socketHandled) {
            console.log('[AURA Live] Connection timed out');
            handleSocketDrop(true);
          }
        }, 5000);

        const handleSocketDrop = (wasTimeout = false) => {
          if (socketHandled) return;
          socketHandled = true;

          if (liveConnectTimeoutRef.current) {
            clearTimeout(liveConnectTimeoutRef.current);
            liveConnectTimeoutRef.current = null;
          }

          if (liveWsRef.current === ws) {
            try {
              ws.onopen = null;
              ws.onmessage = null;
              ws.onerror = null;
              ws.onclose = null;
              if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
              }
            } catch {}
            liveWsRef.current = null;
          }

          isLiveModeRef.current = false;
          setIsLiveSessionConnected(false);

          if (!isListeningRef.current || fallbackTriggered) return;

          const maxAttempts = liveHasConnectedRef.current ? 4 : 1;
          if ((!wasTimeout || liveHasConnectedRef.current) && liveReconnectAttemptsRef.current < maxAttempts) {
            liveReconnectAttemptsRef.current += 1;
            const attempt = liveReconnectAttemptsRef.current;
            console.log(`[AURA Live] Session dropped, reconnecting seamlessly (${attempt}/${maxAttempts})...`);
            if (liveReconnectTimerRef.current) {
              clearTimeout(liveReconnectTimerRef.current);
            }
            liveReconnectTimerRef.current = setTimeout(() => {
              liveReconnectTimerRef.current = null;
              connectLiveWebSocket();
            }, 700);
          } else {
            console.log('[AURA Live] Engaging fallback recognition');
            engageFallback();
          }
        };

        ws.onmessage = (event) => {
          if (!isListeningRef.current || liveWsRef.current !== ws) return;
          try {
            const msg = JSON.parse(event.data);

            const isTurnSuppressed = () => {
              if (!isInterruptedTurnRef.current) return false;
              if (Date.now() >= interruptedUntilRef.current) {
                isInterruptedTurnRef.current = false;
                return false;
              }
              return true;
            };

            if (msg.type === 'connected') {
              if (liveConnectTimeoutRef.current) {
                clearTimeout(liveConnectTimeoutRef.current);
                liveConnectTimeoutRef.current = null;
              }
              liveReconnectAttemptsRef.current = 0;
              liveHasConnectedRef.current = true;
              isLiveModeRef.current = true;
              isInterruptedTurnRef.current = false;
              setIsLiveSessionConnected(true);
              liveInputTranscriptRef.current = '';
              liveTurnHasCommittedInputRef.current = false;
              if (!livePlayer.getIsPlaying()) {
                setState('LISTENING');
              }
              console.log('[AURA Live] Real-time Gemini Live (gemini-3.8-live) connected');
            } else if (msg.type === 'input_transcript' && msg.text) {
              const rawInput = String(msg.text).replace(/<noise>|\[noise\]|\[inaudible\]/gi, '').trim();
              if (!rawInput || !/[\p{L}\p{N}]/u.test(rawInput)) return;
              isInterruptedTurnRef.current = false;
              liveInputTranscriptRef.current = liveInputTranscriptRef.current
                ? `${liveInputTranscriptRef.current} ${rawInput}`.replace(/\s+/g, ' ').trim()
                : rawInput;
              liveTurnHasCommittedInputRef.current = false;
              setInterimTranscript(liveInputTranscriptRef.current);
            } else if (msg.type === 'audio' && msg.audio) {
              if (isTurnSuppressed()) return;
              // Flush user's spoken transcript into conversation history when assistant starts replying
              if (liveInputTranscriptRef.current && !liveTurnHasCommittedInputRef.current) {
                liveTurnHasCommittedInputRef.current = true;
                const spokenUserText = liveInputTranscriptRef.current.trim();
                liveInputTranscriptRef.current = '';
                setInterimTranscript('');
                onUserLiveTranscriptRef.current?.(spokenUserText);
              }
              livePlayer.resetInterruption();
              livePlayer.playChunk(msg.audio);
            } else if (msg.type === 'transcript' && msg.text) {
              if (isTurnSuppressed()) return;
              if (liveInputTranscriptRef.current && !liveTurnHasCommittedInputRef.current) {
                liveTurnHasCommittedInputRef.current = true;
                const spokenUserText = liveInputTranscriptRef.current.trim();
                liveInputTranscriptRef.current = '';
                setInterimTranscript('');
                onUserLiveTranscriptRef.current?.(spokenUserText);
              }
              onAssistantTranscriptRef.current?.(msg.text);
            } else if (msg.type === 'tool_call' && msg.name) {
              if (isTurnSuppressed()) return;
              onToolCallRef.current?.(msg.name, msg.args);
            } else if (msg.type === 'interrupted') {
              isInterruptedTurnRef.current = false;
              livePlayer.stopAll();
              audioCaptureRef.current?.setAssistantSpeaking(false, true);
              if (isListeningRef.current) {
                setState('LISTENING');
              }
            } else if (msg.type === 'turn_complete') {
              isInterruptedTurnRef.current = false;
              if (liveInputTranscriptRef.current && !liveTurnHasCommittedInputRef.current) {
                liveTurnHasCommittedInputRef.current = true;
                const spokenUserText = liveInputTranscriptRef.current.trim();
                liveInputTranscriptRef.current = '';
                setInterimTranscript('');
                onUserLiveTranscriptRef.current?.(spokenUserText);
              }
              onAssistantTurnCompleteRef.current?.();
              if (!livePlayer.getIsPlaying() && isListeningRef.current) {
                setState('LISTENING');
              }
            } else if (msg.type === 'error' || msg.type === 'closed') {
              console.log('[AURA Live] Session notice:', msg.message || msg.type);
              handleSocketDrop(false);
            }
          } catch {}
        };

        ws.onerror = () => {
          handleSocketDrop(false);
        };

        ws.onclose = () => {
          handleSocketDrop(false);
        };
      } catch {
        engageFallback();
      }
    };

    connectLiveWebSocket();

    // Start Real-Time 16kHz PCM Capture (feeds Live API WebSocket AND powers orb audio levels + barge-in)
    const audioCapture = new LiveAudioCapture();
    audioCaptureRef.current = audioCapture;
    audioCapture.start(stream, {
      onAudioLevel: (lvl) => {
        setAudioLevel(lvl);
      },
      onAudioChunk: (base64Pcm) => {
        if (
          isListeningRef.current &&
          isLiveModeRef.current &&
          liveWsRef.current &&
          liveWsRef.current.readyState === WebSocket.OPEN
        ) {
          // Suppress speaker-bleed acoustic echo while assistant is speaking (barge-in clears immediately)
          if (audioCapture.isAssistantOutputActive()) {
            return;
          }
          liveWsRef.current.send(
            JSON.stringify({
              type: 'realtime_audio',
              audio: base64Pcm,
            })
          );
        }
      },
      onUserVoiceDetected: () => {
        // Real-time Barge-In Interruption when user speaks over assistant
        if (isLiveModeRef.current && settingsRef.current.interruptibility !== false) {
          if (livePlayerRef.current?.getIsPlaying()) {
            console.log('[AURA Live] Instant user voice barge-in detected');
            isInterruptedTurnRef.current = true;
            interruptedUntilRef.current = Date.now() + 2500;
            livePlayerRef.current.stopAll();
            audioCapture.setAssistantSpeaking(false, true);
            if (liveWsRef.current?.readyState === WebSocket.OPEN) {
              liveWsRef.current.send(JSON.stringify({ type: 'interrupt' }));
            }
            setState('INTERRUPTED');
            setTimeout(() => {
              if (isListeningRef.current) setState('LISTENING');
            }, 180);
            onUserInterruptedRef.current?.();
          }
        }
      },
      onVoiceActivity: (isActive, rms) => {
        if (!isLiveModeRef.current && !isSpeakingLocalRef.current && isActive && rms >= 0.012) {
          if (!hasVoiceSpokenRef.current) {
            hasVoiceSpokenRef.current = true;
            speechStartTimeRef.current = Date.now();
          }
          lastVoiceDetectedTimeRef.current = Date.now();
          if (!latestTranscriptRef.current && isListeningRef.current) {
            setInterimTranscript('Listening to your voice...');
          }
        }
      },
    });
  }, [startFallbackRecognition, stopAudioCapture, stopLiveSession, stopRecognition, userId]);

  // 3. Stop / Pause Listening
  const stopListening = useCallback(() => {
    const pendingWords = (latestTranscriptRef.current || accumulatedTranscriptRef.current).trim();
    if (!isLiveModeRef.current && pendingWords && isListeningRef.current) {
      finalizeUserSpeech(pendingWords);
      return;
    }

    if (!isLiveModeRef.current && hasVoiceSpokenRef.current && activeStreamRef.current && (audioChunksRef.current.length > 0 || audioCaptureRef.current)) {
      processServerAudioTranscription(activeStreamRef.current);
      return;
    }

    isListeningRef.current = false;
    hasVoiceSpokenRef.current = false;
    isTranscribingRef.current = false;
    speakInvocationIdRef.current += 1;
    isInterruptedTurnRef.current = false;
    setIsMuted(true);
    playAssistantChime('stop');

    stopRecognition();
    stopAudioCapture();
    stopLiveSession();

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setState('IDLE');
    setAudioLevel(0);
    setInterimTranscript('');
  }, [finalizeUserSpeech, processServerAudioTranscription, stopAudioCapture, stopLiveSession, stopRecognition]);

  // 4. Interrupt Speaking (Instant barge-in cutoff across both Live API and TTS)
  const interruptSpeaking = useCallback(() => {
    playAssistantChime('stop');
    speakInvocationIdRef.current += 1;
    isSpeakingLocalRef.current = false;

    if (speechKeepaliveRef.current) {
      clearInterval(speechKeepaliveRef.current);
      speechKeepaliveRef.current = null;
    }

    if (livePlayerRef.current?.getIsPlaying()) {
      isInterruptedTurnRef.current = true;
      interruptedUntilRef.current = Date.now() + 2500;
    }
    if (livePlayerRef.current) {
      livePlayerRef.current.stopAll();
    }
    if (liveWsRef.current && liveWsRef.current.readyState === WebSocket.OPEN) {
      isInterruptedTurnRef.current = true;
      interruptedUntilRef.current = Date.now() + 2500;
      try {
        liveWsRef.current.send(JSON.stringify({ type: 'interrupt' }));
      } catch {}
    }

    if (activeBufferSourceRef.current) {
      try {
        activeBufferSourceRef.current.onended = null;
        activeBufferSourceRef.current.stop();
        activeBufferSourceRef.current.disconnect();
      } catch {}
      activeBufferSourceRef.current = null;
    }

    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      } catch {}
      activeAudioRef.current = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    activeUtterances.clear();
    audioCaptureRef.current?.setAssistantSpeaking(false, true);
    setState(isListeningRef.current ? 'LISTENING' : 'IDLE');
    onUserInterruptedRef.current?.();
  }, []);

  // 5. Speak: Reliable Web Audio + Server Gemini TTS + Browser SpeechSynthesis
  const speak = useCallback(
    async (text: string, _lang?: string, onComplete?: () => void) => {
      const speechText = prepareTextForSpeech(text);
      if (!speechText.trim()) {
        onComplete?.();
        return;
      }

      const invocationId = ++speakInvocationIdRef.current;
      const wasListening = isListeningRef.current;

      // Cancel any currently playing non-live speech
      if (activeBufferSourceRef.current) {
        try {
          activeBufferSourceRef.current.onended = null;
          activeBufferSourceRef.current.stop();
          activeBufferSourceRef.current.disconnect();
        } catch {}
        activeBufferSourceRef.current = null;
      }

      if (activeAudioRef.current) {
        try {
          activeAudioRef.current.pause();
          activeAudioRef.current.currentTime = 0;
        } catch {}
        activeAudioRef.current = null;
      }

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
      activeUtterances.clear();

      if (speechKeepaliveRef.current) {
        clearInterval(speechKeepaliveRef.current);
        speechKeepaliveRef.current = null;
      }

      // Inform capture DSP so local TTS does not self-interrupt via microphone
      isSpeakingLocalRef.current = true;
      audioCaptureRef.current?.setAssistantSpeaking(true);

      let finished = false;
      let browserStarted = false;
      const isStale = () => finished || speakInvocationIdRef.current !== invocationId;

      const finishPlayback = () => {
        if (finished) return;
        finished = true;
        if (speakInvocationIdRef.current !== invocationId) return;

        isSpeakingLocalRef.current = false;
        audioCaptureRef.current?.setAssistantSpeaking(false);

        if (speechKeepaliveRef.current) {
          clearInterval(speechKeepaliveRef.current);
          speechKeepaliveRef.current = null;
        }
        activeBufferSourceRef.current = null;
        activeAudioRef.current = null;
        onComplete?.();

        // Only return to listening automatically if user had already engaged voice/hands-free
        if (wasListening || (isHandsFreeRef.current && hasUserInteractedRef.current)) {
          startListening();
        } else {
          setState((prev) => (prev === 'SPEAKING' || prev === 'PROCESSING' ? 'IDLE' : prev));
        }
      };

      const playViaBrowserSpeech = (allowServerFallback: boolean) => {
        if (isStale()) return;
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          if (allowServerFallback) {
            playViaServerTTS(false);
          } else {
            finishPlayback();
          }
          return;
        }

        try {
          if (window.speechSynthesis.paused) {
            try {
              window.speechSynthesis.resume();
            } catch {}
          }

          const voices = window.speechSynthesis.getVoices();
          // Headless/sandbox Linux Chromium often reports 0 voices and silently stalls SpeechSynthesis
          if (voices.length === 0 && allowServerFallback && Date.now() >= ttsCooldownUntilRef.current) {
            console.log('[AURA Voice] No browser SpeechSynthesis voices available, using Server Neural TTS');
            playViaServerTTS(false);
            return;
          }

          const utterance = new SpeechSynthesisUtterance(speechText);
          utterance.volume = 1.0;
          utterance.rate = Math.min(1.25, Math.max(0.85, settingsRef.current.voiceSpeed || 1.05));
          utterance.pitch = 1.0;

          const langMap: Record<string, string> = {
            te: 'te-IN',
            hi: 'hi-IN',
            ta: 'ta-IN',
            kn: 'kn-IN',
            ml: 'ml-IN',
            mr: 'mr-IN',
            bn: 'bn-IN',
            en: 'en-US',
          };
          const targetLang = _lang ? (langMap[_lang] || _lang) : 'en-US';
          utterance.lang = targetLang;

          let chosenVoice = voices.find(
            (v) =>
              v.lang === targetLang &&
              (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Enhanced'))
          );
          if (!chosenVoice) chosenVoice = voices.find((v) => v.lang === targetLang);
          if (!chosenVoice) chosenVoice = voices.find((v) => v.lang.startsWith(targetLang.slice(0, 2)));
          if (!chosenVoice) chosenVoice = voices.find((v) => v.lang.startsWith('en'));
          if (chosenVoice) utterance.voice = chosenVoice;

          let cancelledByWatchdog = false;
          activeUtterances.add(utterance);

          utterance.onstart = () => {
            if (isStale() || cancelledByWatchdog) {
              activeUtterances.delete(utterance);
              try {
                window.speechSynthesis.cancel();
              } catch {}
              return;
            }
            browserStarted = true;
            setState('SPEAKING');
          };

          utterance.onend = () => {
            activeUtterances.delete(utterance);
            if (!cancelledByWatchdog) {
              finishPlayback();
            }
          };

          utterance.onerror = () => {
            activeUtterances.delete(utterance);
            if (isStale() || cancelledByWatchdog) return;
            if (!browserStarted && allowServerFallback) {
              playViaServerTTS(false);
            } else {
              finishPlayback();
            }
          };

          speechKeepaliveRef.current = setInterval(() => {
            if (isStale()) {
              clearInterval(speechKeepaliveRef.current);
              speechKeepaliveRef.current = null;
              return;
            }
            if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.paused) {
              window.speechSynthesis.resume();
            }
          }, 2500);

          window.speechSynthesis.speak(utterance);

          // Watchdog with speaking check so slow-warming OS SpeechSynthesis does not overlap with Server TTS
          setTimeout(() => {
            if (isStale() || browserStarted) return;
            if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking) {
              browserStarted = true;
              setState('SPEAKING');
              return;
            }
            cancelledByWatchdog = true;
            try {
              window.speechSynthesis.cancel();
            } catch {}
            activeUtterances.clear();
            setTimeout(() => {
              if (isStale() || browserStarted) return;
              if (allowServerFallback) {
                playViaServerTTS(false);
              } else {
                finishPlayback();
              }
            }, 120);
          }, 2200);
        } catch {
          if (isStale()) return;
          if (allowServerFallback) {
            playViaServerTTS(false);
          } else {
            finishPlayback();
          }
        }
      };

      const playViaServerTTS = async (allowBrowserFallback: boolean) => {
        if (isStale()) return;
        if (Date.now() < ttsCooldownUntilRef.current) {
          if (allowBrowserFallback && !isStale()) {
            playViaBrowserSpeech(false);
          } else {
            finishPlayback();
          }
          return;
        }
        try {
          const engine = SharedAudioOutputEngine.getInstance();
          const preCtx = await engine.resume().catch(() => null);
          if (isStale()) return;
          if ((!preCtx || preCtx.state === 'suspended') && !hasUserInteractedRef.current) {
            finishPlayback();
            return;
          }

          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: speechText,
              voiceName: settingsRef.current.voiceName || 'Kore',
            }),
          });
          if (isStale()) return;
          const data = await res.json();
          if (isStale()) return;

          if (res.status === 429 || data?.quotaExceeded) {
            ttsCooldownUntilRef.current = Date.now() + 15 * 60 * 1000;
            console.log('[AURA Voice] Server TTS quota reached; relying on browser SpeechSynthesis');
          }

          if (data && data.audio && !isStale()) {
            // Decode & play through unlocked Web Audio API graph (immune to async HTML5 autoplay blocks + applies 1.5x limiter boost)
            try {
              const ctx = await engine.resume();
              if (isStale()) return;
              if (ctx.state === 'suspended') {
                throw new Error('AudioContext suspended');
              }
              const { targetNode } = engine.getOutputNode();

              const binary = atob(data.audio);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
              if (isStale()) return;

              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.playbackRate.value = Math.min(1.25, Math.max(0.85, settingsRef.current.voiceSpeed || 1.0));
              source.connect(targetNode);
              activeBufferSourceRef.current = source;

              setState('SPEAKING');
              source.onended = () => {
                if (activeBufferSourceRef.current === source) {
                  activeBufferSourceRef.current = null;
                }
                finishPlayback();
              };
              source.start(0);
              return;
            } catch {
              if (isStale()) return;
              // Secondary fallback: HTML5 Audio element
              if (!hasUserInteractedRef.current) {
                finishPlayback();
                return;
              }
              const audio = new Audio('data:audio/wav;base64,' + data.audio);
              activeAudioRef.current = audio;
              audio.onplay = () => {
                if (!isStale()) setState('SPEAKING');
              };
              audio.onended = finishPlayback;
              audio.onerror = () => {
                if (isStale()) return;
                if (allowBrowserFallback) {
                  playViaBrowserSpeech(false);
                } else {
                  finishPlayback();
                }
              };
              await audio.play();
              return;
            }
          }
        } catch (err) {
          console.log('[AURA Voice] Server TTS fallback notice:', err);
        }

        if (isStale()) return;
        if (allowBrowserFallback) {
          playViaBrowserSpeech(false);
        } else {
          finishPlayback();
        }
      };

      // Choose primary speech output engine based on settings (always falling back cleanly to the other)
      if (settingsRef.current.ttsEngine === 'gemini') {
        await playViaServerTTS(true);
      } else {
        playViaBrowserSpeech(true);
      }
    },
    [startListening]
  );

  // Send text message directly over active Live session if connected, else caller handles HTTP /api/chat
  const sendLiveTextMessage = useCallback((text: string): boolean => {
    if (isLiveModeRef.current && liveWsRef.current && liveWsRef.current.readyState === WebSocket.OPEN) {
      isInterruptedTurnRef.current = false;
      liveWsRef.current.send(JSON.stringify({ type: 'text', text }));
      return true;
    }
    return false;
  }, []);

  const sendTextMessage = useCallback((text: string) => {
    onUserSpeechFinalRef.current?.(text);
  }, []);

  const toggleNoiseFilter = useCallback(() => {
    setIsNoiseFilterActive((prev) => !prev);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecognition();
      stopAudioCapture();
      stopLiveSession();
      releaseMicrophoneStream();
      if (speechKeepaliveRef.current) {
        clearInterval(speechKeepaliveRef.current);
      }
      if (activeBufferSourceRef.current) {
        try {
          activeBufferSourceRef.current.stop();
          activeBufferSourceRef.current.disconnect();
        } catch {}
        activeBufferSourceRef.current = null;
      }
      if (activeAudioRef.current) {
        try {
          activeAudioRef.current.pause();
          activeAudioRef.current.currentTime = 0;
        } catch {}
        activeAudioRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      activeUtterances.clear();
    };
  }, [stopAudioCapture, stopLiveSession, stopRecognition]);

  return {
    state,
    setState,
    audioLevel,
    interimTranscript,
    finalTranscript: '',
    isMuted,
    isMicAvailable,
    micPermissionDenied,
    isNoiseFilterActive,
    isLiveActive: isLiveSessionConnected || isListeningRef.current,
    isLiveSessionConnected,
    startListening,
    stopListening,
    interruptSpeaking,
    speak,
    sendTextMessage,
    sendLiveTextMessage,
    toggleNoiseFilter,
  };
}
