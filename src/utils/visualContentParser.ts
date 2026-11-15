import type { VisualContentData, MathStep } from '../types.ts';
import { verifyAnswer } from './mathVerificationEngine.ts';

/**
 * Parses step-by-step mathematical solutions and formulas from response text,
 * and executes independent deterministic answer verification.
 */
function tryParseMathSolution(text: string, problemText?: string): {
  cleanText: string;
  visualContent: VisualContentData;
} | null {
  if (!text) return null;

  // Indicators that this response contains a mathematical solution
  const hasLatexCommands =
    text.includes('\\equiv') ||
    text.includes('\\pmod') ||
    text.includes('\\bmod') ||
    text.includes('\\frac') ||
    text.includes('\\sqrt') ||
    text.includes('\\sum') ||
    text.includes('\\int') ||
    text.includes('\\boxed') ||
    text.includes('$$') ||
    text.includes('\\[') ||
    text.includes('\\times') ||
    text.includes('\\cdot');

  const hasStepStructure =
    /(?:^|\n)(?:\*\*)?Step\s*\d+/i.test(text) &&
    (/\$[^$]+\$|\b[a-zA-Z]\^\{?\d+\}?|\b\d+\^\{?\d+\}?|\\equiv|\\pmod|\bmod|=|\/|\*/i.test(text));

  const hasKnownMathTopics =
    /(?:fermat's little theorem|modular arithmetic|quadratic equation|derivative|integral|eigenvalue|matrix multiplication|remainder theorem|speed|distance|profit|loss|work-rate|ratio)/i.test(
      `${problemText || ''} ${text}`
    ) && (text.includes('^') || text.includes('mod') || text.includes('\\') || text.includes('$') || text.includes('=') || text.includes('/'));

  if (!hasLatexCommands && !hasStepStructure && !hasKnownMathTopics) {
    return null;
  }

  // Determine a title for the mathematical solution card
  let title = 'Step-by-Step Mathematical Solution';
  const lower = `${problemText || ''} ${text}`.toLowerCase();
  if (lower.includes("fermat's little theorem") || lower.includes("fermat")) {
    title = "Fermat's Little Theorem Solution";
  } else if (lower.includes('modular arithmetic') || lower.includes('remainder')) {
    title = 'Modular Arithmetic & Remainder Solution';
  } else if (lower.includes('quadratic equation') || lower.includes('roots')) {
    title = 'Quadratic Equation Solution';
  } else if (lower.includes('derivative') || lower.includes('differentiat')) {
    title = 'Calculus: Derivative Solution';
  } else if (lower.includes('integral') || lower.includes('integrat')) {
    title = 'Calculus: Integral Solution';
  } else if (lower.includes('matrix') || lower.includes('determinant')) {
    title = 'Linear Algebra Solution';
  } else if (lower.includes('profit') || lower.includes('loss')) {
    title = 'Commercial Arithmetic: Profit & Loss';
  } else if (lower.includes('speed') || lower.includes('distance')) {
    title = 'Time, Speed & Distance Solution';
  }

  // Extract final answer if boxed or marked
  let finalAnswer: string | undefined;
  const boxedMatch = text.match(/\\boxed\{([^{}]+(?:\{[^{}]*\}[^{}]*)*)\}/);
  if (boxedMatch) {
    finalAnswer = boxedMatch[1].trim();
  } else {
    const finalAnswerRegex = /(?:Final Answer|Answer|Result|Therefore)[^\n:]*[:—–-]\s*([^\n]+)/i;
    const ansMatch = text.match(finalAnswerRegex);
    if (ansMatch) {
      finalAnswer = ansMatch[1].replace(/^[*\s]+|[*\s]+$/g, '').trim();
    }
  }

  // Extract problem statement if present
  let mathProblem = problemText;
  if (!mathProblem) {
    const probMatch = text.match(/(?:Problem Statement|Given Problem|Question|Problem)[:—–-]?\s*([^\n]+)/i);
    if (probMatch) {
      mathProblem = probMatch[1].trim();
    }
  }

  // Run independent mathematical answer verification
  const verification = verifyAnswer(problemText || text, text, finalAnswer);

  // If finalAnswer was not found via boxed or regex, use verified value
  if (!finalAnswer && verification.verifiedValue) {
    finalAnswer = verification.verifiedValue;
  }

  // Extract discrete steps: "Step 1 — ...", "**Step 1:** ...", "Step 1: ..."
  const steps: MathStep[] = [];
  const stepSplitRegex = /(?:^|\n)(?:\*\*)?Step\s*(\d+)[\s:—–-]+([^\n*]+)(?:\*\*)?/gi;

  const matches: { index: number; stepNum: number; title: string; fullMatchLen: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = stepSplitRegex.exec(text)) !== null) {
    matches.push({
      index: m.index,
      stepNum: parseInt(m[1], 10),
      title: m[2].replace(/^[\s—–-]+|[\s—–-]+$/g, '').trim(),
      fullMatchLen: m[0].length,
    });
  }

  if (matches.length >= 2) {
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const nextIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const stepBody = text.slice(current.index + current.fullMatchLen, nextIndex).trim();

      // Separate verbal explanation from LaTeX formula block
      let explanation = stepBody;
      let formula: string | undefined;

      // Extract block formula if present
      const blockFormulaMatch = stepBody.match(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/);
      if (blockFormulaMatch) {
        formula = blockFormulaMatch[0].replace(/^(\$\$|\\\[)|(\$\$|\\\])$/g, '').trim();
        explanation = stepBody.replace(blockFormulaMatch[0], '').trim();
      } else {
        const lines = stepBody.split('\n').map((l) => l.trim()).filter(Boolean);
        const formulaLines = lines.filter(
          (l) => l.startsWith('$') || l.startsWith('\\[') || l.includes('\\equiv') || (l.includes('=') && !l.includes(' '))
        );
        const textLines = lines.filter((l) => !formulaLines.includes(l));

        if (formulaLines.length > 0) {
          formula = formulaLines.join('\n');
          explanation = textLines.join('\n');
        }
      }

      steps.push({
        stepNumber: current.stepNum,
        title: current.title,
        explanation: explanation || undefined,
        formula: formula || undefined,
      });
    }
  }

  // Construct concise spoken text (Audio voice overview)
  let cleanSpokenText = '';
  if (matches.length > 0 && matches[0].index > 0) {
    const intro = text.slice(0, matches[0].index).trim();
    if (intro && intro.length > 10 && !intro.startsWith('#')) {
      cleanSpokenText = intro.replace(/[*_#]/g, '').trim();
    }
  }

  if (!cleanSpokenText) {
    if (finalAnswer) {
      const spokenAns = finalAnswer.replace(/[{}\\$]/g, '').trim();
      cleanSpokenText = `The final answer is ${spokenAns}.`;
    } else {
      cleanSpokenText = "I've displayed the step-by-step mathematical solution on your screen.";
    }
  } else if (finalAnswer && !cleanSpokenText.includes(finalAnswer)) {
    const spokenAns = finalAnswer.replace(/[{}\\$]/g, '').trim();
    cleanSpokenText += ` The final answer is ${spokenAns}.`;
  }

  // If an option mismatch was detected, verbally inform the user
  if (verification.optionMatchStatus === 'No matching option') {
    cleanSpokenText += " Note that this result does not match any of the provided choices.";
  }

  return {
    cleanText: cleanSpokenText,
    visualContent: {
      type: 'math',
      title,
      mathProblem,
      mathSteps: steps.length > 0 ? steps : undefined,
      finalAnswer: finalAnswer || verification.verifiedValue || 'Answer Calculated',
      rawSolution: text,
      verification,
      mcqOptions: verification.mcqOptions,
      matchedOption: verification.matchedOption,
      optionMatchStatus: verification.optionMatchStatus,
      discrepancyNote: verification.discrepancyNote,
      shortExplanation: verification.shortExplanation,
      summary: finalAnswer ? `Final Answer: ${finalAnswer.replace(/[{}\\$]/g, '')}` : undefined,
    },
  };
}

/**
 * Extracts visual companion data (math, code, link, command, table, steps)
 * from response text if not explicitly provided by tool call.
 */
export function extractVisualContentFromText(
  text: string,
  problemText?: string
): {
  cleanText: string;
  visualContent?: VisualContentData;
} {
  if (!text) return { cleanText: text };

  // 1. Check for Mathematical Solution & Verification
  const mathResult = tryParseMathSolution(text, problemText);
  if (mathResult) {
    return mathResult;
  }

  // 2. Detect markdown code block
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/;
  const codeMatch = text.match(codeBlockRegex);
  if (codeMatch) {
    const language = codeMatch[1].trim() || 'python';
    const code = codeMatch[2].trim();
    // If it's bash/sh command
    if (
      language === 'bash' ||
      language === 'sh' ||
      language === 'shell' ||
      code.startsWith('npm ') ||
      code.startsWith('pip ') ||
      code.startsWith('brew ')
    ) {
      const clean = text.replace(codeBlockRegex, '').trim();
      return {
        cleanText: clean || `I've displayed the ${language} command for you.`,
        visualContent: {
          type: 'command',
          title: 'Terminal Command',
          command: code,
          language,
        },
      };
    }

    const clean = text.replace(codeBlockRegex, '').trim();
    return {
      cleanText: clean || `I've displayed the ${language} code for you.`,
      visualContent: {
        type: 'code',
        title: `${language.charAt(0).toUpperCase() + language.slice(1)} Code`,
        code,
        language,
      },
    };
  }

  // 3. Detect markdown table
  if (text.includes('|') && text.includes('\n|') && text.includes('---')) {
    const lines = text.split('\n');
    const tableLines = lines.filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'));
    if (tableLines.length >= 3) {
      const headerLine = tableLines[0];
      const headers = headerLine
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      // skip divider row
      const rowLines = tableLines.slice(2);
      const rows = rowLines.map((rl) =>
        rl
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean)
      );

      const clean = lines.filter((l) => !l.trim().startsWith('|')).join('\n').trim();
      return {
        cleanText: clean || 'Here is the comparison table you requested.',
        visualContent: {
          type: 'table',
          title: 'Comparison Table',
          tableHeaders: headers,
          tableRows: rows,
        },
      };
    }
  }

  // 4. Detect standalone URLs (especially government / official / portal links)
  const urlRegex = /(https?:\/\/[^\s<>"']+)/i;
  const urlMatch = text.match(urlRegex);
  if (urlMatch) {
    const rawUrl = urlMatch[1].replace(/[.,;:)]$/, '');
    let title = 'Official Web Portal';
    if (rawUrl.includes('nfsa.gov.in') || text.toLowerCase().includes('ration')) {
      title = 'National Food Security Portal (Ration Card)';
    } else if (rawUrl.includes('uidai.gov.in') || text.toLowerCase().includes('aadhaar')) {
      title = 'UIDAI Official Aadhaar Portal';
    } else if (rawUrl.includes('github.com')) {
      title = 'GitHub Repository';
    } else if (rawUrl.includes('python.org')) {
      title = 'Official Python Website';
    }

    return {
      cleanText: text,
      visualContent: {
        type: 'link',
        title,
        url: rawUrl,
        urlLabel: 'Open Official Portal',
      },
    };
  }

  return { cleanText: text };
}
