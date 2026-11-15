import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Mic, 
  MicOff, 
  Paperclip, 
  ExternalLink, 
  Sparkles, 
  Volume2, 
  Square,
  AlertTriangle,
  ChevronDown,
  ShieldCheck,
  Activity
} from 'lucide-react';
import { ChatMessage, AssistantState } from '../../types.js';
import { VisualResponseCard } from './VisualResponseCard.js';
import { MathRenderer } from './MathRenderer.js';

interface ConversationHUDProps {
  messages: ChatMessage[];
  state: AssistantState;
  interimTranscript: string;
  audioLevel?: number;
  isNoiseFilterActive?: boolean;
  onToggleNoiseFilter?: () => void;
  onSendMessage: (text: string) => void;
  onInterrupt: () => void;
  onOpenUpload: () => void;
  isHandsFree: boolean;
  onToggleHandsFree: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  onStartListening?: () => void;
  micPermissionDenied?: boolean;
  isMicAvailable?: boolean;
  userName: string;
  onSpeakMessage?: (text: string, visualContent?: any) => void;
}

export const ConversationHUD: React.FC<ConversationHUDProps> = ({
  messages,
  state,
  interimTranscript,
  audioLevel = 0,
  isNoiseFilterActive = true,
  onToggleNoiseFilter,
  onSendMessage,
  onInterrupt,
  onOpenUpload,
  isHandsFree,
  onToggleHandsFree,
  isMuted,
  onToggleMute,
  onStartListening,
  micPermissionDenied = false,
  isMicAvailable = true,
  userName,
  onSpeakMessage,
}) => {
  const [inputText, setInputText] = useState('');
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, interimTranscript, state]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  // Curated demo scenario chips for fast voice & visual interactions
  const scenarioChips = [
    { label: '📐 127^240 mod 241 (Fermat)', query: "Calculate 127^240 mod 241 using Fermat's Little Theorem" },
    { label: '📐 152 / 0.008 (MCQ Check)', query: 'Calculate 152 / 0.008. Options: (A) ₹18,000, (B) ₹18,500, (C) ₹19,500, (D) ₹20,000.' },
    { label: '📐 Solve 2x + 5 = 15', query: 'Solve 2x + 5 = 15 step by step' },
    { label: '🎨 Red Apple on Table', query: 'Generate an image of a red apple on a white table' },
    { label: '🎨 Futuristic Car', query: 'Generate an image of a futuristic car' },
    { label: 'Python Calculator', query: 'Give me Python code for a calculator' },
    { label: 'Ration Card Portal', query: 'Give me the ration card portal link' },
    { label: 'Install React', query: 'Give me the command to install React' },
    { label: 'Compare Python & Java', query: 'Compare Python and Java' },
    { label: 'Explain DFS & BFS', query: 'Explain DFS and BFS' },
    { label: 'Start 5 min timer', query: 'Start a 5 minute timer' },
    { label: 'Open Learning', query: 'Open learning dashboard' },
    { label: 'Take a note', query: 'Take a note: revise graph algorithms tomorrow' },
  ];

  const latestAssistantMessage = messages.filter(m => m.role === 'assistant').slice(-1)[0];

  // Keep visual companion content (tables, code, math, links, images) visible until a new user question arrives
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  const activeTurnMessages = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages;
  const pinnedVisualContent =
    [...activeTurnMessages]
      .reverse()
      .find((m) => m.role === 'assistant' && Boolean(m.visualContent))?.visualContent ||
    latestAssistantMessage?.visualContent;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col items-center px-4 pb-6">
      {/* Mic Permission Warning Banner if blocked */}
      {micPermissionDenied && (
        <div className="w-full mb-3 p-3.5 rounded-xl bg-rose-950/70 border border-rose-500/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-200 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              <strong>Microphone access blocked:</strong> To enable, click the lock or site settings icon in your browser address bar and set Microphone to "Allow", then tap Allow & Retry.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onStartListening && (
              <button
                onClick={onStartListening}
                className="px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-medium transition"
              >
                Allow & Retry
              </button>
            )}
            <a
              href={typeof window !== 'undefined' ? window.location.href : '#'}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 transition"
            >
              <span>Open in Tab</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {/* Active Live Response Card (Voice HUD) */}
      <div className="w-full glass-panel rounded-2xl p-5 mb-4 shadow-xl border border-slate-800/80 relative overflow-hidden transition-all">
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-3 mb-3 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${state === 'LISTENING' ? 'bg-cyan-400 animate-pulse' : state === 'SPEAKING' ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
            <span className="text-slate-300 font-medium">
              {state === 'LISTENING' ? 'LIVE LISTENING STREAM' : state === 'SPEAKING' ? 'AURA VOICE ACTIVE' : 'VOICE STREAM READY'}
            </span>
            {state === 'LISTENING' && (
              <div className="flex items-center gap-0.5 ml-1.5 px-1 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/20" title="Live filtered voice input level">
                {[0.4, 0.9, 0.5, 1.0, 0.6].map((scale, idx) => (
                  <span
                    key={idx}
                    className="w-1 bg-cyan-400 rounded-full transition-all duration-75"
                    style={{
                      height: `${Math.max(4, Math.min(18, (audioLevel || 0) * 35 * scale + 4))}px`,
                      opacity: (audioLevel || 0) > 0.04 ? 1 : 0.35,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Noise Cancellation & Acoustic Filtration Status */}
            <button
              onClick={onToggleNoiseFilter}
              className={`px-2.5 py-1 rounded-md text-[11px] transition flex items-center gap-1.5 ${
                isNoiseFilterActive 
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' 
                  : 'bg-slate-800/80 text-slate-400 border border-slate-700/50'
              }`}
              title="Acoustic echo cancellation, bandpass filtering & dynamic noise floor suppression"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Noise Filter:</span>
              <span className="font-semibold">{isNoiseFilterActive ? 'ON' : 'OFF'}</span>
            </button>

            <button
              onClick={onToggleHandsFree}
              className={`px-2.5 py-1 rounded-md text-[11px] transition flex items-center gap-1.5 ${
                isHandsFree ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-400'
              }`}
              title="Toggle automatic continuous listening"
            >
              <span className="hidden sm:inline">Hands-free:</span>
              <span className="font-semibold">{isHandsFree ? 'ON' : 'OFF'}</span>
            </button>

            {state === 'SPEAKING' && (
              <button
                onClick={onInterrupt}
                className="px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-medium flex items-center gap-1 hover:bg-amber-500/30 transition animate-pulse"
              >
                <Square className="w-3 h-3 fill-amber-300" />
                <span>Interrupt</span>
              </button>
            )}

            {state !== 'LISTENING' && state !== 'SPEAKING' && state !== 'PROCESSING' && onStartListening && (
              <button
                onClick={onStartListening}
                className="px-2.5 py-1 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[11px] font-medium flex items-center gap-1 hover:bg-cyan-500/30 transition"
              >
                <Mic className="w-3 h-3 text-cyan-400" />
                <span>Activate Mic</span>
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Display Area */}
        <div className="min-h-[90px] flex flex-col justify-center">
          {/* Listening State Banner when active and waiting for user speech */}
          {state === 'LISTENING' && !interimTranscript && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2.5 text-cyan-300 text-sm py-2 px-3.5 bg-cyan-950/40 border border-cyan-500/30 rounded-xl mb-3 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping shrink-0" />
              <span className="font-medium text-xs sm:text-sm">Listening to you... Speak now in English, Telugu, Hindi, or ask any problem</span>
            </motion.div>
          )}

          {/* Interim user speech as it's being spoken */}
          {interimTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-cyan-300 text-base sm:text-lg font-medium italic mb-2 flex items-center gap-2 bg-cyan-950/30 p-2.5 rounded-xl border border-cyan-500/20"
            >
              <Mic className="w-4 h-4 text-cyan-400 animate-bounce shrink-0" />
              <span>"{interimTranscript}"</span>
            </motion.div>
          )}

          {/* Assistant's latest spoken text */}
          {state === 'PROCESSING' ? (
            <div className="flex items-center gap-3 text-purple-300 text-sm py-3 bg-purple-950/20 px-3.5 rounded-xl border border-purple-500/30">
              <Sparkles className="w-4 h-4 animate-spin text-purple-400 shrink-0" />
              <span className="font-medium">AURA is reasoning and formulating response...</span>
            </div>
          ) : latestAssistantMessage ? (
            <div className="space-y-2">
              <div className="text-slate-100 text-base sm:text-lg leading-relaxed font-normal">
                <MathRenderer content={latestAssistantMessage.text} />
              </div>

              {/* Audio Playback Controls & Status */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/40">
                {onSpeakMessage && (
                  <button
                    type="button"
                    onClick={() => onSpeakMessage(latestAssistantMessage.text, pinnedVisualContent)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 hover:text-cyan-100 border border-cyan-500/30 text-xs transition active:scale-95"
                    title="Play response aloud at 100% device volume"
                  >
                    <Volume2 className={`w-3.5 h-3.5 ${state === 'SPEAKING' ? 'text-emerald-400 animate-pulse' : 'text-cyan-400'}`} />
                    <span>{state === 'SPEAKING' ? 'Speaking aloud...' : 'Hear answer aloud'}</span>
                  </button>
                )}
                {state === 'SPEAKING' && (
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Audio playing (100% volume)
                  </span>
                )}
              </div>

              {/* Visual Content Companion (Code, Links, Commands, Tables, Steps, Images) */}
              {pinnedVisualContent && (
                <div className="pt-1.5">
                  <VisualResponseCard 
                    content={pinnedVisualContent} 
                    onRetryImage={(p) => onSendMessage(`Generate an image of ${p}`)}
                  />
                </div>
              )}

              {/* Citations if available from Web Search */}
              {latestAssistantMessage.citations && latestAssistantMessage.citations.length > 0 && (
                <div className="pt-2 flex flex-wrap gap-2 items-center text-xs text-slate-400">
                  <span className="text-slate-500">Sources:</span>
                  {latestAssistantMessage.citations.map((cite, idx) => (
                    <a
                      key={idx}
                      href={cite.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 transition text-[11px]"
                    >
                      <span>{cite.title || 'Web Result'}</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-slate-300 text-base font-normal">
                Good afternoon, {userName}. Talk to me naturally.
              </p>
              <p className="text-xs text-slate-400">
                You can speak in English, Telugu, Hindi, or ask any technical or conceptual question.
              </p>
            </div>
          )}
        </div>

        {/* Drawer button to review full conversation history */}
        <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
          <span>{messages.length} messages in session</span>
          <button
            onClick={() => setShowHistoryDrawer(!showHistoryDrawer)}
            className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium transition"
          >
            <span>{showHistoryDrawer ? 'Hide transcript' : 'View full transcript'}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showHistoryDrawer ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expandable Conversation Transcript Drawer */}
      <AnimatePresence>
        {showHistoryDrawer && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="w-full overflow-hidden mb-4"
          >
            <div className="glass-panel rounded-2xl p-4 max-h-72 overflow-y-auto space-y-3 border border-slate-800/80">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs font-mono text-slate-400">
                <span>CONVERSATION HISTORY</span>
                <span>{messages.length} TURNS</span>
              </div>
              {messages.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">No previous messages yet.</p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col text-sm rounded-xl p-3 ${
                      m.role === 'user'
                        ? 'bg-cyan-950/30 border border-cyan-500/20 text-cyan-100 ml-8'
                        : 'bg-slate-900/60 border border-slate-800 text-slate-200 mr-8'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                      <span>{m.role === 'user' ? 'YOU' : 'AURA'}</span>
                      <div className="flex items-center gap-2">
                        {m.role === 'assistant' && onSpeakMessage && (
                          <button
                            type="button"
                            onClick={() => onSpeakMessage(m.text, m.visualContent)}
                            className="text-cyan-400 hover:text-cyan-200 flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/20 transition active:scale-95"
                            title="Hear response aloud"
                          >
                            <Volume2 className="w-3 h-3" />
                            <span>Hear</span>
                          </button>
                        )}
                        <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                    <div className="leading-relaxed">
                      <MathRenderer content={m.text} />
                    </div>
                    {m.visualContent && (
                      <div className="pt-2">
                        <VisualResponseCard 
                          content={m.visualContent} 
                          onRetryImage={(p) => onSendMessage(`Generate an image of ${p}`)}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Scenario Chips for Testing / Instant Exploration */}
      <div className="w-full mb-3 overflow-x-auto scrollbar-none py-1">
        <div className="flex flex-wrap gap-2">
          {scenarioChips.map((chip, i) => (
            <button
              key={i}
              onClick={() => onSendMessage(chip.query)}
              className="text-xs px-3 py-1.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 hover:border-cyan-500/40 transition active:scale-95 flex items-center gap-1"
            >
              <span>{chip.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Hybrid Text & Attachment Input Bar */}
      <form onSubmit={handleSubmit} className="w-full flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenUpload}
          className="p-3 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 transition"
          title="Upload image or document"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          className={`p-3 rounded-xl border transition ${
            state === 'LISTENING'
              ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400 shadow-[0_0_15px_rgba(56,189,248,0.4)] animate-pulse'
              : isMuted
              ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
              : 'bg-slate-900/90 hover:bg-slate-800 text-cyan-400 border-slate-800'
          }`}
          title={state === 'LISTENING' ? 'Listening (Click to pause)' : 'Click to talk'}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <div className="flex-1 relative">
          <input
            id="aura-chat-input"
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              state === 'LISTENING'
                ? "Listening to you... or type question here"
                : "Ask AURA anything or tap mic to talk..."
            }
            className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/50 transition font-sans"
          />
        </div>

        <button
          type="submit"
          disabled={!inputText.trim()}
          className="p-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition shadow-lg shadow-cyan-500/20"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
