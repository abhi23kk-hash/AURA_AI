import React, { useState } from 'react';
import { Sigma, Copy, Check, Sparkles, BookOpen } from 'lucide-react';
import { VisualContentData, MathStep } from '../../types.js';
import { MathRenderer } from './MathRenderer.js';
import { PremiumAnswerCard } from './PremiumAnswerCard.js';

interface MathResponseCardProps {
  content: VisualContentData;
}

export const MathResponseCard: React.FC<MathResponseCardProps> = ({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopySolution = () => {
    let textToCopy = content.title ? `${content.title}\n\n` : '';
    if (content.mathProblem) {
      textToCopy += `Problem:\n${content.mathProblem}\n\n`;
    }
    if (content.mathSteps && content.mathSteps.length > 0) {
      content.mathSteps.forEach((s) => {
        textToCopy += `Step ${s.stepNumber} — ${s.title}\n`;
        if (s.explanation) textToCopy += `${s.explanation}\n`;
        if (s.formula) textToCopy += `${s.formula}\n`;
        textToCopy += '\n';
      });
    }
    if (content.finalAnswer) {
      textToCopy += `Final Answer:\n${content.finalAnswer}\n`;
    } else if (content.rawSolution) {
      textToCopy += content.rawSolution;
    }

    navigator.clipboard.writeText(textToCopy.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const steps: MathStep[] = content.mathSteps || [];

  return (
    <div className="w-full my-3 space-y-4">
      {/* 1. Premium Final Answer Hero Card */}
      {content.finalAnswer && (
        <PremiumAnswerCard
          finalAnswer={content.finalAnswer}
          shortExplanation={content.shortExplanation}
          verification={content.verification}
          mathSteps={content.mathSteps}
          mathProblem={content.mathProblem}
        />
      )}

      {/* 2. Step-by-Step Derivation & Verification Container */}
      <div className="w-full rounded-2xl overflow-hidden border border-cyan-500/30 bg-gradient-to-b from-slate-950/95 via-slate-900/90 to-slate-950/95 shadow-xl backdrop-blur-md transition-all">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900/90 border-b border-cyan-500/20 text-xs font-mono">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
              <Sigma className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-slate-200 font-semibold text-sm">
                  {content.title || 'Mathematical Solution'}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 font-semibold tracking-wider">
                  STEP-BY-STEP
                </span>
              </div>
              {content.formula && (
                <p className="text-[11px] text-cyan-300/70 font-mono mt-0.5 truncate max-w-sm">
                  Formula: {content.formula}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={handleCopySolution}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/90 transition shadow-sm border border-slate-700/60"
            title="Copy formatted solution to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy Steps</span>
              </>
            )}
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Problem statement banner */}
          {content.mathProblem && (
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs sm:text-sm text-slate-200 flex items-start gap-2.5">
              <BookOpen className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div className="space-y-1 w-full overflow-hidden">
                <span className="font-semibold text-slate-400 uppercase tracking-wide text-[10px] block">
                  Problem Statement
                </span>
                <MathRenderer content={content.mathProblem} />
              </div>
            </div>
          )}

          {/* Discrete Step-by-Step Sections */}
          {steps.length > 0 ? (
            <div className="space-y-3.5">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800/80 hover:border-cyan-500/30 transition-colors space-y-2"
                >
                  {/* Step Header */}
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-300 font-mono font-bold text-xs border border-cyan-500/30">
                      Step {step.stepNumber || idx + 1}
                    </span>
                    <span className="text-slate-100 font-semibold text-xs sm:text-sm">
                      {step.title}
                    </span>
                  </div>

                  {/* Step Verbal Explanation */}
                  {step.explanation && (
                    <div className="text-xs sm:text-sm text-slate-300 leading-relaxed pl-1">
                      <MathRenderer content={step.explanation} />
                    </div>
                  )}

                  {/* Step Mathematical Expression / Derivation */}
                  {step.formula && (
                    <div className="pt-1">
                      <MathRenderer content={step.formula} displayMode={true} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : content.rawSolution ? (
            /* Render raw solution cleanly with KaTeX */
            <div className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800/80 text-xs sm:text-sm text-slate-200 leading-relaxed">
              <MathRenderer content={content.rawSolution} />
            </div>
          ) : null}

          {content.summary && (
            <div className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/60 text-[11px] text-slate-400 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>{content.summary}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
