import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Copy, 
  Check, 
  ShieldCheck, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  Calculator, 
  Sparkles,
  HelpCircle,
  FileCheck2,
  ExternalLink
} from 'lucide-react';
import { MathVerificationData, McqOptionItem, MathStep } from '../../types.js';
import { MathRenderer } from './MathRenderer.js';

interface PremiumAnswerCardProps {
  finalAnswer: string;
  shortExplanation?: string;
  verification?: MathVerificationData;
  mathSteps?: MathStep[];
  mathProblem?: string;
  className?: string;
}

export const PremiumAnswerCard: React.FC<PremiumAnswerCardProps> = ({
  finalAnswer,
  shortExplanation,
  verification,
  mathSteps,
  mathProblem,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const [showCalculation, setShowCalculation] = useState(false);
  const [showVerificationAudit, setShowVerificationAudit] = useState(false);

  const cleanAnswerText = finalAnswer.replace(/\\boxed\{([^{}]+)\}/g, '$1').trim();

  const handleCopyAnswer = () => {
    navigator.clipboard.writeText(cleanAnswerText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isVerified = verification?.calculationStatus === 'Verified';
  const hasInconsistency = verification?.status === 'inconsistent' || verification?.optionMatchStatus === 'No matching option';
  const hasMcqMatch = Boolean(verification?.matchedOption);

  return (
    <div className={`w-full rounded-2xl overflow-hidden border transition-all duration-300 shadow-2xl ${
      hasInconsistency
        ? 'border-amber-500/40 bg-gradient-to-b from-slate-950 via-slate-900 to-amber-950/20 shadow-[0_0_35px_rgba(245,158,11,0.15)]'
        : isVerified
        ? 'border-emerald-500/40 bg-gradient-to-b from-slate-950 via-slate-900 to-emerald-950/20 shadow-[0_0_35px_rgba(16,185,129,0.15)]'
        : 'border-cyan-500/40 bg-gradient-to-b from-slate-950 via-slate-900 to-cyan-950/20 shadow-[0_0_35px_rgba(6,182,212,0.15)]'
    } ${className}`}>
      
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg border ${
            hasInconsistency
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              : isVerified
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
          }`}>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <span className="font-mono text-xs sm:text-sm font-bold tracking-wider uppercase text-slate-200">
            FINAL ANSWER
          </span>
        </div>

        {/* Copy Answer Button */}
        <button
          onClick={handleCopyAnswer}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 transition shadow-sm border border-slate-700/60 active:scale-95"
          title="Copy answer to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-semibold">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>Copy Answer</span>
            </>
          )}
        </button>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* Hero Final Answer Presentation */}
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3 pb-3 border-b border-slate-800/60">
          <div className="space-y-1">
            <span className="text-[11px] font-mono uppercase tracking-widest text-slate-400">
              Calculated Result
            </span>
            <div className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">
              <MathRenderer content={cleanAnswerText.startsWith('$') ? cleanAnswerText : `$${cleanAnswerText}$`} />
            </div>
          </div>

          {/* Status Badges */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Calculation Status */}
            {isVerified ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Verified Calculation</span>
              </span>
            ) : verification?.calculationStatus === 'Unverified' ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800/80 text-slate-400 border border-slate-700/60">
                <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                <span>AI-Estimated (Unverified)</span>
              </span>
            ) : null}

            {/* MCQ Match Status */}
            {hasMcqMatch ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                <FileCheck2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>{verification?.matchedOption}</span>
              </span>
            ) : hasInconsistency ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>No Matching Option</span>
              </span>
            ) : null}
          </div>
        </div>

        {/* Inconsistency Callout Alert (Option Mismatch) */}
        {hasInconsistency && (
          <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs sm:text-sm text-amber-200 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>Question / Options Inconsistency Detected</span>
            </div>
            <p className="leading-relaxed pl-6 text-amber-200/90 text-xs">
              {verification?.discrepancyNote ||
                `The calculated answer is ${cleanAnswerText}, but it does not match any of the provided choices in the question.`}
            </p>
          </div>
        )}

        {/* Short Explanation Section */}
        {(shortExplanation || verification?.shortExplanation) && (
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs sm:text-sm text-slate-300 space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold block">
              Why this result is correct
            </span>
            <div className="leading-relaxed">
              <MathRenderer content={shortExplanation || verification?.shortExplanation || ''} />
            </div>
          </div>
        )}

        {/* Compact Answer Verification Panel */}
        {verification && (
          <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-wider text-slate-300 uppercase">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span>ANSWER VERIFICATION</span>
              </div>
              <button
                onClick={() => setShowVerificationAudit(!showVerificationAudit)}
                className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition"
              >
                <span>{showVerificationAudit ? 'Hide Audit' : 'Audit Details'}</span>
                {showVerificationAudit ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {/* Status Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase">Calculation</span>
                <span className={`font-semibold ${
                  isVerified ? 'text-emerald-400' : 'text-slate-300'
                }`}>
                  {verification.calculationStatus}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase">Verified Value</span>
                <span className="font-semibold text-slate-200 truncate block">
                  {verification.verifiedValue || cleanAnswerText}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase">Option Match</span>
                <span className={`font-semibold ${
                  hasMcqMatch ? 'text-cyan-400' : hasInconsistency ? 'text-amber-400' : 'text-slate-400'
                }`}>
                  {verification.matchedOption || verification.optionMatchStatus}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase">Consistency</span>
                <span className={`font-semibold ${
                  hasInconsistency ? 'text-amber-400' : isVerified ? 'text-emerald-400' : 'text-slate-400'
                }`}>
                  {hasInconsistency ? 'Inconsistency' : isVerified ? 'Verified' : 'Unchecked'}
                </span>
              </div>
            </div>

            {/* Expandable Verification Steps / Audit Log */}
            {showVerificationAudit && verification.verificationSteps && (
              <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-xs text-slate-300 font-mono">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">
                  Independent Verification Steps ({verification.verificationMethod || 'Deterministic Evaluator'})
                </span>
                <div className="space-y-1 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  {verification.verificationSteps.map((step, sIdx) => (
                    <div key={sIdx} className="flex items-start gap-2">
                      <span className="text-cyan-400 font-semibold">{sIdx + 1}.</span>
                      <span className="leading-relaxed">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expandable "View Calculation" Toggle */}
        {mathSteps && mathSteps.length > 0 && (
          <div className="pt-1">
            <button
              onClick={() => setShowCalculation(!showCalculation)}
              className="w-full py-2 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 text-xs font-medium text-slate-300 hover:text-cyan-300 transition flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Calculator className="w-3.5 h-3.5 text-cyan-400" />
                <span>{showCalculation ? 'Hide Full Calculation' : 'View Full Step-by-Step Calculation'}</span>
              </div>
              {showCalculation ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {/* Expanded Calculation Steps */}
            {showCalculation && (
              <div className="mt-3 space-y-3 pt-2 animate-fadeIn">
                {mathSteps.map((step, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1.5 text-xs sm:text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/20">
                        Step {step.stepNumber || idx + 1}
                      </span>
                      <span className="font-semibold text-slate-200">{step.title}</span>
                    </div>
                    {step.explanation && (
                      <div className="text-slate-300 pl-1">
                        <MathRenderer content={step.explanation} />
                      </div>
                    )}
                    {step.formula && (
                      <div className="pt-1">
                        <MathRenderer content={step.formula} displayMode={true} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
