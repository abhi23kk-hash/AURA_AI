import type { MathVerificationData, McqOptionItem } from '../types.ts';

/**
 * Normalizes numerical and currency strings into clean numbers for comparison.
 * e.g. "₹19,000" -> 19000, "19,000.00" -> 19000, "19k" -> 19000, "\boxed{1}" -> 1
 */
export function extractNumericValue(raw: string | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;

  // Clean raw LaTeX, currency symbols, commas, percent
  const clean = raw
    .replace(/\\boxed\{([^{}]+)\}/g, '$1')
    .replace(/[₹$€£,%\s]/g, '')
    .replace(/^x\s*=\s*/i, '')
    .trim();

  // Check scientific notation or simple fraction (e.g. "3/4" or "10/2")
  if (/^-?\d+\s*\/\s*\d+$/.test(clean)) {
    const [num, den] = clean.split('/').map((s) => parseFloat(s.trim()));
    if (den !== 0) return num / den;
  }

  const num = parseFloat(clean);
  return isNaN(num) ? null : num;
}

/**
 * Extracts MCQ options from questions or user messages.
 * Matches:
 *   (A) ₹18,000  (B) ₹18,500  (C) ₹19,500  (D) ₹20,000
 *   A) 18000   B) 18500 ...
 *   [A] 10  [B] 20 ...
 *   Option A: 50 ...
 */
export function extractMcqOptions(text: string): McqOptionItem[] {
  if (!text) return [];

  const options: McqOptionItem[] = [];

  // Match options formatted like:
  // (A) ₹18,000, (B) ₹18,500, (C) ₹19,500, (D) ₹20,000
  // or: A) ₹18,000  B) ₹18,500
  // or: Option A: ₹18,000
  const optionRegex = /(?:Option\s+)?(?:\(|\[)?([A-Da-d1-4])(?:\)|\.|\:|\s*-\s*)\s*([^\n\(\)\[\]]+?)(?=(?:,\s*|\s+)(?:Option\s+)?(?:\(|\[)?[A-Da-d1-4](?:\)|\.|\:|\s*-\s*)|$|\n)/gi;

  let match: RegExpExecArray | null;
  while ((match = optionRegex.exec(text)) !== null) {
    const rawLabel = match[1].trim().toUpperCase();
    let rawText = match[2].trim().replace(/^[,;\s]+|[,;\s]+$/g, '').trim();

    const label = rawLabel === '1' ? 'A' : rawLabel === '2' ? 'B' : rawLabel === '3' ? 'C' : rawLabel === '4' ? 'D' : rawLabel;

    if (rawText.length > 0 && rawText.length < 100 && !options.some((o) => o.label === label)) {
      options.push({
        label,
        text: rawText,
        numericValue: extractNumericValue(rawText) ?? undefined,
      });
    }
  }

  // Also support line-by-line options e.g.:
  // A) ₹18,000
  // B) ₹18,500
  if (options.length < 2) {
    const lines = text.split('\n');
    for (const line of lines) {
      const lineMatch = line.trim().match(/^(?:Option\s+)?(?:\(|\[)?([A-Da-d1-4])(?:\)|\.|\:|\s*-\s*)\s*(.*)/i);
      if (lineMatch) {
        const rawLabel = lineMatch[1].trim().toUpperCase();
        const rawText = lineMatch[2].trim().replace(/^[,;\s]+|[,;\s]+$/g, '').trim();
        const label = rawLabel === '1' ? 'A' : rawLabel === '2' ? 'B' : rawLabel === '3' ? 'C' : rawLabel === '4' ? 'D' : rawLabel;
        if (rawText && !options.some((o) => o.label === label)) {
          options.push({
            label,
            text: rawText,
            numericValue: extractNumericValue(rawText) ?? undefined,
          });
        }
      }
    }
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Modular Exponentiation: computes (base^exp) % mod deterministically.
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let res = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) res = (res * base) % mod;
    base = (base * base) % mod;
    exp = exp / 2n;
  }
  return res;
}

/**
 * Checks if a number is prime deterministically.
 */
function isPrime(n: number): boolean {
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/**
 * Greatest common divisor.
 */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

interface DeterministicEvaluationResult {
  verified: boolean;
  value?: string;
  numericValue?: number;
  method?: string;
  steps: string[];
}

/**
 * Attempts deterministic verification for standard arithmetic, aptitude, and algebraic expressions.
 */
function evaluateDeterministically(problemText: string, solutionText: string): DeterministicEvaluationResult | null {
  const combined = `${problemText} \n ${solutionText}`;
  const steps: string[] = [];

  // 1. Division / Fraction / Multiplicative arithmetic
  // e.g. "152 / 0.008" or "152 \div 0.008" or "\frac{152}{0.008}"
  const divRegex = /(?:(\d+(?:\.\d+)?)\s*(?:\/|\\div|divided by)\s*(\d+(?:\.\d+)?)|\\frac\{(\d+(?:\.\d+)?)\}\{(\d+(?:\.\d+)?)\})/i;
  const divMatch = combined.match(divRegex);
  if (divMatch) {
    const num = parseFloat(divMatch[1] || divMatch[3]);
    const den = parseFloat(divMatch[2] || divMatch[4]);
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      const result = num / den;
      const formatted = Number.isInteger(result) ? result.toLocaleString() : result.toFixed(4).replace(/\.?0+$/, '');
      steps.push(`Evaluated numerator: ${num}`);
      steps.push(`Evaluated denominator: ${den}`);
      steps.push(`Computed exact division: ${num} / ${den} = ${formatted}`);

      return {
        verified: true,
        value: formatted,
        numericValue: result,
        method: 'Deterministic Arithmetic Evaluator',
        steps,
      };
    }
  }

  // 2. Fermat's Little Theorem / Modular Arithmetic
  // e.g. "127^240 mod 241" or "a = 127, p = 241"
  const modMatch = combined.match(/(\d+)\s*\^\s*\{?(\d+)\}?\s*(?:mod|\\pmod|\\bmod)\s*\{?(\d+)\}?/i);
  if (modMatch) {
    const a = parseInt(modMatch[1], 10);
    const exp = parseInt(modMatch[2], 10);
    const p = parseInt(modMatch[3], 10);

    if (a > 0 && exp >= 0 && p > 1) {
      const pPrime = isPrime(p);
      const coprime = gcd(a, p) === 1;
      steps.push(`Base a = ${a}, Exponent = ${exp}, Modulus p = ${p}`);
      steps.push(`Prime check: p = ${p} is ${pPrime ? 'prime' : 'composite'}`);
      steps.push(`Coprime check: gcd(${a}, ${p}) = ${gcd(a, p)} (coprime: ${coprime})`);

      const evaluated = modPow(BigInt(a), BigInt(exp), BigInt(p));
      steps.push(`Modular exponentiation computation: ${a}^${exp} mod ${p} = ${evaluated.toString()}`);

      return {
        verified: true,
        value: evaluated.toString(),
        numericValue: Number(evaluated),
        method: pPrime && coprime && exp === p - 1 ? "Fermat's Little Theorem (Deterministic Verification)" : 'Modular Exponentiation Algorithm',
        steps,
      };
    }
  }

  // 3. Linear Single-Variable Equation: ax + b = c or ax - b = c
  const linearMatch = combined.match(/(\d+(?:\.\d+)?)x\s*([\+\-])\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)/i);
  if (linearMatch) {
    const a = parseFloat(linearMatch[1]);
    const op = linearMatch[2];
    const b = parseFloat(linearMatch[3]);
    const c = parseFloat(linearMatch[4]);

    if (a !== 0) {
      const rhs = op === '+' ? c - b : c + b;
      const xVal = rhs / a;
      steps.push(`Identified linear equation: ${a}x ${op} ${b} = ${c}`);
      steps.push(`Isolated variable term: ${a}x = ${rhs}`);
      steps.push(`Solved x = ${rhs} / ${a} = ${xVal}`);

      return {
        verified: true,
        value: `x = ${xVal}`,
        numericValue: xVal,
        method: 'Symbolic Linear Solver',
        steps,
      };
    }
  }

  // 4. Time, Speed & Distance conversion (km/h to m/s or m/s to km/h)
  const speedConvMatch = combined.match(/(\d+(?:\.\d+)?)\s*km\/?h(?:r)?\s*(?:to\s*m\/?s|in\s*m\/?s)/i);
  if (speedConvMatch) {
    const kmh = parseFloat(speedConvMatch[1]);
    const ms = (kmh * 5) / 18;
    steps.push(`Converted ${kmh} km/h using standard ratio 5/18`);
    steps.push(`Result: ${kmh} * (5/18) = ${ms} m/s`);
    return {
      verified: true,
      value: `${ms} m/s`,
      numericValue: ms,
      method: 'Physical Unit Dimension Evaluator',
      steps,
    };
  }

  // 5. Profit & Loss: Cost Price from Selling Price and Profit/Loss Percentage
  const profitMatch = combined.match(/(?:SP|Selling Price)\s*=\s*(?:₹|\$)?(\d+(?:,\d+)*(?:\.\d+)?).*?(?:Profit|Gain)\s*=\s*(\d+(?:\.\d+)?)\s*%/i);
  if (profitMatch) {
    const sp = parseFloat(profitMatch[1].replace(/,/g, ''));
    const pPct = parseFloat(profitMatch[2]);
    const cp = sp / (1 + pPct / 100);
    steps.push(`Selling Price (SP) = ${sp}, Profit Percentage = ${pPct}%`);
    steps.push(`Cost Price Formula: CP = SP / (1 + Profit/100) = ${sp} / ${1 + pPct / 100} = ${cp.toFixed(2)}`);
    return {
      verified: true,
      value: `₹${Math.round(cp).toLocaleString()}`,
      numericValue: Math.round(cp),
      method: 'Deterministic Commercial Arithmetic Evaluator',
      steps,
    };
  }

  return null;
}

/**
 * Answer Verification Engine Workflow
 * 1. Detects mathematical problem and checks options
 * 2. Deterministically recalculates the value where possible
 * 3. Compares verified value against provided MCQ options
 * 4. Flags inconsistencies or option mismatches
 */
export function verifyAnswer(
  problemText: string,
  solutionText: string,
  claimedFinalAnswer?: string
): MathVerificationData {
  // Extract MCQ options if present in problem or response
  const options = extractMcqOptions(`${problemText}\n${solutionText}`);
  const hasMcq = options.length >= 2;

  // Run deterministic calculation
  const evalResult = evaluateDeterministically(problemText, solutionText);

  // If deterministic evaluation succeeded
  if (evalResult && evalResult.verified) {
    const verifiedNum = evalResult.numericValue;
    const verifiedStr = evalResult.value || String(verifiedNum);

    // Option Matching Check
    if (hasMcq) {
      let matchedOpt: McqOptionItem | undefined;

      if (verifiedNum !== undefined) {
        matchedOpt = options.find((opt) => {
          if (opt.numericValue !== undefined) {
            return Math.abs(opt.numericValue - verifiedNum) < 1e-3;
          }
          return false;
        });
      }

      // If no numeric match, check string includes
      if (!matchedOpt) {
        matchedOpt = options.find((opt) => {
          const optClean = opt.text.replace(/[₹$€£,\s]/g, '').toLowerCase();
          const verClean = verifiedStr.replace(/[₹$€£,\s]/g, '').toLowerCase();
          return optClean === verClean || verClean.includes(optClean);
        });
      }

      if (matchedOpt) {
        evalResult.steps.push(`Verified that calculated value (${verifiedStr}) matches Option (${matchedOpt.label}): ${matchedOpt.text}`);

        return {
          status: 'verified',
          calculationStatus: 'Verified',
          verifiedValue: verifiedStr,
          expectedValue: verifiedStr,
          mcqOptions: options.map((o) => ({ ...o, isMatch: o.label === matchedOpt?.label })),
          matchedOption: `Option (${matchedOpt.label})`,
          optionMatchStatus: 'Matched',
          shortExplanation: `Verified calculation yielded ${verifiedStr}, which exactly matches Option (${matchedOpt.label}).`,
          verificationMethod: evalResult.method,
          verificationSteps: evalResult.steps,
          auditLogs: evalResult.steps,
        };
      } else {
        // No provided option matches the calculated answer!
        const optionsList = options.map((o) => `(${o.label}) ${o.text}`).join(', ');
        const discrepancy = `Question/options inconsistency detected. Calculated answer (${verifiedStr}) does not match any given choice: ${optionsList}.`;
        evalResult.steps.push(`Checked choices: ${optionsList}`);
        evalResult.steps.push(`Discrepancy: Verified answer ${verifiedStr} is NOT among the provided options.`);

        return {
          status: 'inconsistent',
          calculationStatus: 'Verified',
          verifiedValue: verifiedStr,
          expectedValue: verifiedStr,
          mcqOptions: options.map((o) => ({ ...o, isMatch: false })),
          matchedOption: undefined,
          optionMatchStatus: 'No matching option',
          discrepancyNote: discrepancy,
          shortExplanation: `Calculation is verified as ${verifiedStr}. However, none of the provided choices match this result.`,
          verificationMethod: evalResult.method,
          verificationSteps: evalResult.steps,
          auditLogs: evalResult.steps,
        };
      }
    }

    // Non-MCQ question, calculation verified
    return {
      status: 'verified',
      calculationStatus: 'Verified',
      verifiedValue: verifiedStr,
      expectedValue: verifiedStr,
      optionMatchStatus: 'Not an MCQ',
      shortExplanation: `Calculation independently verified using ${evalResult.method}.`,
      verificationMethod: evalResult.method,
      verificationSteps: evalResult.steps,
      auditLogs: evalResult.steps,
    };
  }

  // If deterministic evaluation was not applicable (e.g. proof or abstract theory)
  // Check if claimedFinalAnswer is present
  const claimedNum = extractNumericValue(claimedFinalAnswer);

  if (hasMcq && claimedNum !== null) {
    const matchedOpt = options.find((opt) => opt.numericValue !== undefined && Math.abs(opt.numericValue - claimedNum) < 1e-3);

    return {
      status: 'unverified',
      calculationStatus: 'Unverified',
      verifiedValue: claimedFinalAnswer,
      expectedValue: claimedFinalAnswer,
      mcqOptions: options.map((o) => ({ ...o, isMatch: o.label === matchedOpt?.label })),
      matchedOption: matchedOpt ? `Option (${matchedOpt.label})` : undefined,
      optionMatchStatus: matchedOpt ? 'Matched' : 'No matching option',
      discrepancyNote: !matchedOpt ? 'Calculated answer does not match any provided options.' : undefined,
      shortExplanation: 'Answer derived from AI model reasoning. Deterministic calculation engine could not independently audit this formula.',
      verificationMethod: 'AI Reasoning (Deterministic Evaluator Out-of-Scope)',
      verificationSteps: ['Identified question choices', 'No automated algebraic template matched for deterministic execution'],
      auditLogs: ['Calculation marked Unverified in accordance with verification policy.'],
    };
  }

  return {
    status: 'unverified',
    calculationStatus: 'Unverified',
    verifiedValue: claimedFinalAnswer,
    expectedValue: claimedFinalAnswer,
    optionMatchStatus: hasMcq ? 'No matching option' : 'Not an MCQ',
    shortExplanation: 'Answer derived from AI reasoning. Independent deterministic verification was not performed.',
    verificationMethod: 'Unverified / AI-Estimated',
    verificationSteps: ['Theoretical derivation (symbolic evaluation unavailable)'],
    auditLogs: ['Verification policy: Clearly marked unverified.'],
  };
}
