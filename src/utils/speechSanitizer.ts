/**
 * AURA AI - Dedicated Speech Sanitization Layer
 *
 * Separates visual response formatting (Markdown, headings, code blocks, tables,
 * bullets, links, JSON, HTML) from the voice/audio/TTS output.
 *
 * Guarantees that AURA never reads formatting characters aloud (e.g. "asterisk",
 * "hash hash", "backtick", "bracket", raw URLs, or markdown table syntax),
 * while preserving natural human phrasing, meaningful punctuation, numbers,
 * currency, units, Big-O notations, and technical terms (e.g. C++, C#, A*).
 */

const LANGUAGE_LABELS: Record<string, string> = {
  python: 'Python code',
  py: 'Python code',
  javascript: 'JavaScript code',
  js: 'JavaScript code',
  typescript: 'TypeScript code',
  ts: 'TypeScript code',
  cpp: 'C plus plus code',
  'c++': 'C plus plus code',
  csharp: 'C sharp code',
  'c#': 'C sharp code',
  c: 'C code',
  java: 'Java code',
  html: 'HTML markup',
  css: 'CSS code',
  sql: 'SQL query',
  bash: 'terminal command',
  sh: 'terminal command',
  shell: 'terminal command',
  zsh: 'terminal command',
  json: 'JSON data',
  yaml: 'configuration code',
  yml: 'configuration code',
  rust: 'Rust code',
  go: 'Go code',
  golang: 'Go code',
  kotlin: 'Kotlin code',
  swift: 'Swift code',
  ruby: 'Ruby code',
  php: 'PHP code',
};

/**
 * Prepares raw assistant response text for clean, natural speech synthesis (TTS).
 * Visual output in the UI preserves rich Markdown; this output is for voice only.
 */
export function prepareTextForSpeech(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let speech = text;

  // 1. Strip and replace Markdown Code Blocks with natural spoken placeholders
  // e.g. ```python ... ``` -> "I've displayed the Python code on screen. You can copy it using the Copy button."
  const codeBlockRegex = /```([a-zA-Z0-9_#+-]*)\s*[\r\n]+([\s\S]*?)```/g;
  speech = speech.replace(codeBlockRegex, (_match, rawLang) => {
    const langKey = (rawLang || '').trim().toLowerCase();
    const label = LANGUAGE_LABELS[langKey] || (langKey ? `${langKey} code` : 'code');
    return ` I've displayed the ${label} on screen. You can copy it using the Copy button. `;
  });

  // 2. Strip and summarize Markdown Tables
  // Tables consist of pipe-delimited lines with separator lines like |---|---|
  const tableRegex = /(?:^[ \t]*\|[^\r\n]*\|[ \t]*$(?:\r?\n|$)){2,}/gm;
  speech = speech.replace(tableRegex, (tableBlock) => {
    const firstLine = tableBlock.trim().split('\n')[0] || '';
    const headers = firstLine
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0 && !c.includes('---'));

    if (headers.length >= 2) {
      const headerNames = headers.slice(0, 3).join(' and ');
      return ` I've displayed the comparison table for ${headerNames} on screen. `;
    }
    return " I've displayed the comparison table on screen. ";
  });

  // 3. Convert Markdown Links [Link Text](URL) into clean spoken descriptions
  // e.g. [Aadhaar Official Website](https://...) -> "I've displayed the Aadhaar Official Website link on screen."
  // Also clean up common lead-ins like "Visit [Aadhaar Official Website](...)" or "[...] for details"
  speech = speech.replace(/(?:(?:you can\s+)?(?:visit|check out|go to|open)\s+)?\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)(?:\s*(?:for details|to learn more|here))?/gi, (_match, linkText) => {
    const cleanLabel = linkText.trim();
    if (!cleanLabel || cleanLabel.toLowerCase().includes('click here') || cleanLabel.toLowerCase().includes('link')) {
      return " I've displayed the official link on screen. ";
    }
    return ` I've displayed the ${cleanLabel} link on screen. `;
  });

  // Also catch any remaining markdown links
  const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  speech = speech.replace(mdLinkRegex, (_match, linkText) => {
    const cleanLabel = linkText.trim();
    if (!cleanLabel || cleanLabel.toLowerCase().includes('click here') || cleanLabel.toLowerCase().includes('link')) {
      return " I've displayed the official link on screen. ";
    }
    return ` I've displayed the ${cleanLabel} link on screen. `;
  });

  // 4. Clean standalone / bare URLs so TTS doesn't spell out "h-t-t-p-s colon slash slash"
  const bareUrlRegex = /https?:\/\/[^\s<>"')]+/gi;
  speech = speech.replace(bareUrlRegex, (url) => {
    const lower = url.toLowerCase();
    if (lower.includes('uidai.gov.in') || lower.includes('aadhaar')) {
      return 'the official Aadhaar portal';
    }
    if (lower.includes('nfsa.gov.in') || lower.includes('ration')) {
      return 'the official Ration Card portal';
    }
    if (lower.includes('github.com')) {
      return 'the GitHub repository';
    }
    if (lower.includes('python.org')) {
      return 'the official Python website';
    }
    return 'the official link';
  });

  // 5. Preserve & expand meaningful technical names & domain symbols BEFORE stripping symbols
  // "C++" -> "C plus plus"
  speech = speech.replace(/\bC\+\+/g, 'C plus plus');
  // "C#" -> "C sharp"
  speech = speech.replace(/\bC#/g, 'C sharp');
  // "A*" algorithm -> "A star" algorithm
  speech = speech.replace(/\bA\*\s*(algorithm|search|pathfinding)?\b/gi, (_m, trailing) => {
    return trailing ? `A star ${trailing}` : 'A star';
  });

  // 6. Currency expansions (e.g. ₹500 -> 500 rupees, $50 -> 50 dollars)
  speech = speech.replace(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 rupees');
  speech = speech.replace(/\$\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 dollars');
  speech = speech.replace(/€\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 euros');
  speech = speech.replace(/£\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 pounds');

  // 7. Percentages (e.g. 10% -> 10 percent)
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent');

  // 8. Units of frequency, storage, and measurement (e.g. 5 GHz -> 5 gigahertz)
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*GHz\b/gi, '$1 gigahertz');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*MHz\b/gi, '$1 megahertz');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*kHz\b/gi, '$1 kilohertz');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*THz\b/gi, '$1 terahertz');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*TB\b/gi, '$1 terabytes');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*GB\b/gi, '$1 gigabytes');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*MB\b/gi, '$1 megabytes');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*KB\b/gi, '$1 kilobytes');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*ms\b/gi, '$1 milliseconds');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*km\b/gi, '$1 kilometers');
  speech = speech.replace(/(\d+(?:\.\d+)?)\s*kg\b/gi, '$1 kilograms');

  // 8.5. Mathematical & LaTeX formula phonetic translations
  // \boxed{1} -> the final answer is 1
  speech = speech.replace(/\\boxed\{([^{}]+)\}/gi, 'the final answer is $1');
  // \equiv -> is congruent to
  speech = speech.replace(/\\equiv/gi, ' is congruent to ');
  // \pmod{n} or \pmod p -> modulo n
  speech = speech.replace(/\\pmod\{?([a-zA-Z0-9]+)\}?/gi, ' modulo $1 ');
  speech = speech.replace(/\\bmod\{?([a-zA-Z0-9]+)\}?/gi, ' modulo $1 ');
  // \frac{a}{b} -> a over b
  speech = speech.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/gi, '$1 over $2');
  // \sqrt{x} -> square root of x
  speech = speech.replace(/\\sqrt\{([^{}]+)\}/gi, 'square root of $1');
  speech = speech.replace(/\\sqrt\s*([0-9a-zA-Z])/gi, 'square root of $1');
  // Power expressions: x^2 -> x squared, x^3 -> x cubed, x^{n} -> x to the power of n
  speech = speech.replace(/([a-zA-Z0-9]+)\^\{?2\}?(?![0-9])/gi, '$1 squared');
  speech = speech.replace(/([a-zA-Z0-9]+)\^\{?3\}?(?![0-9])/gi, '$1 cubed');
  speech = speech.replace(/([a-zA-Z0-9]+)\^\{([^{}]+)\}/gi, '$1 to the power of $2');
  speech = speech.replace(/([a-zA-Z0-9]+)\^([a-zA-Z0-9])/gi, '$1 to the power of $2');
  // Common math symbols
  speech = speech.replace(/\\times/gi, ' times ');
  speech = speech.replace(/\\cdot/gi, ' times ');
  speech = speech.replace(/\\div/gi, ' divided by ');
  speech = speech.replace(/\\pm/gi, ' plus or minus ');
  speech = speech.replace(/\\approx/gi, ' approximately ');
  speech = speech.replace(/\\(?:ne|neq)\b/gi, ' is not equal to ');
  speech = speech.replace(/\\(?:le|leq)\b/gi, ' is less than or equal to ');
  speech = speech.replace(/\\(?:ge|geq)\b/gi, ' is greater than or equal to ');
  speech = speech.replace(/\\sum(?:_\{[^{}]+\})?(?:\^\{[^{}]+\})?/gi, 'sum of ');
  speech = speech.replace(/\\int(?:_\{[^{}]+\})?(?:\^\{[^{}]+\})?/gi, 'integral of ');
  speech = speech.replace(/\\infty/gi, 'infinity');
  speech = speech.replace(/\\pi\b/gi, 'pi');
  speech = speech.replace(/\\theta\b/gi, 'theta');
  speech = speech.replace(/\\alpha\b/gi, 'alpha');
  speech = speech.replace(/\\beta\b/gi, 'beta');
  speech = speech.replace(/\\lambda\b/gi, 'lambda');
  speech = speech.replace(/\\sigma\b/gi, 'sigma');
  speech = speech.replace(/\\Delta\b/gi, 'delta');
  speech = speech.replace(/\\(?:quad|qquad|text|mathrm|mathbf)\b/gi, ' ');
  // Math delimiters: $$, $, \[, \], \(, \)
  speech = speech.replace(/\$\$|\\\[|\\\]|\\\(|\\\)/g, ' ');
  speech = speech.replace(/(^|[^\\])\$([^\$]+)\$/g, '$1 $2 ');

  // 9. Big-O Complexity expressions
  speech = speech.replace(/\bO\(1\)/gi, 'O of 1');
  speech = speech.replace(/\bO\(log\s*n\)/gi, 'O of log n');
  speech = speech.replace(/\bO\(n\s*log\s*n\)/gi, 'O of n log n');
  speech = speech.replace(/\bO\(n\^2\)/gi, 'O of n squared');
  speech = speech.replace(/\bO\(n\^3\)/gi, 'O of n cubed');
  speech = speech.replace(/\bO\(2\^n\)/gi, 'O of 2 to the n');
  speech = speech.replace(/\bO\(n!\)/gi, 'O of n factorial');
  speech = speech.replace(/\bO\(n\)/gi, 'O of n');
  speech = speech.replace(/\bO\(V\s*\+\s*E\)/gi, 'O of V plus E');

  // 10. Common Conversational & Technical Abbreviations
  speech = speech.replace(/\be\.g\.,?\s*/gi, 'for example, ');
  speech = speech.replace(/\bi\.e\.,?\s*/gi, 'that is, ');
  speech = speech.replace(/\bvs\.?\b/gi, 'versus');
  speech = speech.replace(/\betc\.?\b/gi, 'and so on');
  speech = speech.replace(/(?:^|\s)w\/(?=\s|$)/gi, ' with ');
  speech = speech.replace(/(?:^|\s)w\/o(?=\s|$)/gi, ' without ');

  // 11. HTML / XML tags removal & replacements
  speech = speech.replace(/<br\s*\/?>/gi, '. ');
  speech = speech.replace(/<\/p>/gi, '. ');
  speech = speech.replace(/<[^>]+>/g, ' ');
  // HTML entities
  speech = speech.replace(/&amp;/g, ' and ');
  speech = speech.replace(/&lt;/g, ' less than ');
  speech = speech.replace(/&gt;/g, ' greater than ');
  speech = speech.replace(/&quot;/g, ' ');
  speech = speech.replace(/&#39;/g, "'");
  speech = speech.replace(/&nbsp;/g, ' ');

  // 12. Convert Markdown Headings into natural spoken sentence pauses
  // e.g. "## Benefits of Black Rice" -> "Benefits of black rice."
  speech = speech.replace(/^[ \t]*#{1,6}[ \t]+([^\r\n]+)/gm, (_m, headingText) => {
    const trimmed = headingText.trim();
    if (!trimmed) return '';
    if (!/[.!?]$/.test(trimmed)) {
      return `${trimmed}. `;
    }
    return `${trimmed} `;
  });

  // 13. Convert Markdown Bullet Points into natural pauses/sentences
  // e.g.
  // * Rich in antioxidants
  // * Good source of fiber
  // -> "Rich in antioxidants. Good source of fiber."
  speech = speech.replace(/^[ \t]*[*+-•][ \t]+([^\r\n]+)/gm, (_m, itemText) => {
    const trimmed = itemText.trim();
    if (!trimmed) return '';
    if (!/[.!?]$/.test(trimmed)) {
      return `${trimmed}. `;
    }
    return `${trimmed} `;
  });

  // 14. Numbered list items (e.g. "1. First step", "2. Second step")
  speech = speech.replace(/^[ \t]*\d+[\.\)][ \t]+([^\r\n]+)/gm, (_m, itemText) => {
    const trimmed = itemText.trim();
    if (!trimmed) return '';
    if (!/[.!?]$/.test(trimmed)) {
      return `${trimmed}. `;
    }
    return `${trimmed} `;
  });

  // 15. Remove Markdown Bold & Italics (*, **, _, __) and Strikethrough (~~)
  // Bold **text** or __text__
  speech = speech.replace(/\*\*(.*?)\*\*/g, '$1');
  speech = speech.replace(/__(.*?)__/g, '$1');
  // Italic *text* (excluding arithmetic or standalone asterisks)
  speech = speech.replace(/(^|[^\w*])\*([^\s*][^*]*?[^\s*]|[^\s*])\*(?=[^\w*]|$)/g, '$1$2');
  // Italic _text_ (excluding snake_case identifiers)
  speech = speech.replace(/(^|[^\w_])_([^\s_][^_]*?[^\s_]|[^\s_])_(?=[^\w_]|$)/g, '$1$2');
  // Strikethrough ~~text~~
  speech = speech.replace(/~~(.*?)~~/g, '$1');

  // 16. Convert Snake_case Identifiers (e.g. binary_search -> binary search)
  // so TTS doesn't say "binary underscore search"
  speech = speech.replace(/([a-zA-Z0-9]+)_([a-zA-Z0-9]+)/g, '$1 $2');

  // 17. Remove inline code backticks (`code` -> code)
  speech = speech.replace(/`([^`]+)`/g, '$1');
  speech = speech.replace(/`/g, ' ');

  // 18. Citation brackets e.g. [1], [2], [citation needed]
  speech = speech.replace(/\[\d+\]/g, ' ');
  speech = speech.replace(/\[citation needed\]/gi, ' ');

  // 19. JSON / Code syntax brackets and braces if present as formatting
  // Remove standalone braces and brackets without removing words
  speech = speech.replace(/[{}\[\]]/g, ' ');

  // 20. Formatting-only Parentheses: soften into natural pause commas
  // e.g. "DSA (Data Structures and Algorithms)" -> "DSA, Data Structures and Algorithms,"
  speech = speech.replace(/\(([a-zA-Z0-9\s,.-]+)\)/g, ', $1,');

  // 21. Equality and logic operator symbols
  speech = speech.replace(/\s*===?\s*/g, ' equals ');
  speech = speech.replace(/\s*!==?\s*/g, ' does not equal ');
  speech = speech.replace(/\s*>=\s*/g, ' greater than or equal to ');
  speech = speech.replace(/\s*<=\s*/g, ' less than or equal to ');
  speech = speech.replace(/\s*(?:->|=>)\s*/g, ' leads to ');

  // 22. Arithmetic & connector symbols in speech context
  // "3 * 5" -> "3 times 5"
  speech = speech.replace(/(\d+)\s*\*\s*(\d+)/g, '$1 times $2');
  // Ampersand between words -> "and"
  speech = speech.replace(/\s*&\s*/g, ' and ');
  // Slash between words e.g. "input/output" -> "input or output"
  speech = speech.replace(/([a-zA-Z]{2,})\/([a-zA-Z]{2,})/g, '$1 or $2');

  // 23. Remove remaining stray formatting symbols that would otherwise be spoken literally
  // such as stray #, *, ~, _, ^, \, |, <, >
  speech = speech.replace(/[#*~_^\\|<>\/]/g, ' ');

  // 24. Punctuation and Whitespace Polish
  // Collapse whitespace
  speech = speech.replace(/[ \t]+/g, ' ');
  // Replace multiple newlines with a single space or pause
  speech = speech.replace(/[\r\n]+/g, ' ');
  // Clean multiple commas or comma-periods
  speech = speech.replace(/,\s*,+/g, ',');
  speech = speech.replace(/,\s*\./g, '.');
  speech = speech.replace(/\.\s*\.+/g, '.');
  speech = speech.replace(/\s+([,.:;!?])/g, '$1');
  // Clean dangling lead-in phrasing
  speech = speech.replace(/\b(?:visit|check out|go to|open)\s+(I've displayed)/gi, '$1');
  speech = speech.replace(/\b(?:at|on|from|via)\s+(I've displayed)/gi, '. $1');
  speech = speech.replace(/\.\s*\./g, '.');
  speech = speech.replace(/,\s*\./g, '.');

  // Final trim
  return speech.trim();
}

/**
 * Produces a concise, natural spoken overview for audio output.
 * Ensures the assistant speaks a fast, conversational response and final answer
 * rather than reciting extensive multi-step visual derivations or code lines aloud.
 */
export function getSpokenVoiceOverview(text: string, visualContent?: any): string {
  if (!text && !visualContent) return '';

  if (visualContent?.type === 'math') {
    const rawAnswer = visualContent.finalAnswer || '';
    const cleanAnswer = rawAnswer
      .replace(/\\boxed\{([^{}]+)\}/g, '$1')
      .replace(/[\$\\]/g, '')
      .trim();

    const theoremMention = text.toLowerCase().includes('fermat')
      ? "Using Fermat's Little Theorem"
      : visualContent.title || 'For this calculation';

    let summaryLine = '';
    if (visualContent.summary) {
      summaryLine = prepareTextForSpeech(visualContent.summary);
    }

    if (cleanAnswer) {
      return prepareTextForSpeech(
        `${theoremMention}, the final answer is ${cleanAnswer}. ${summaryLine ? summaryLine + '. ' : ''}I've displayed the complete step-by-step calculation on your screen.`
      );
    }
  }

  if (visualContent?.type === 'code') {
    const lang = visualContent.language || 'code';
    return prepareTextForSpeech(
      `I've generated and displayed the ${lang} code on your screen for you to copy.`
    );
  }

  if (visualContent?.type === 'link') {
    const label = visualContent.urlLabel || visualContent.title || 'official link';
    return prepareTextForSpeech(
      `I've displayed the ${label} on your screen.`
    );
  }

  const sanitized = prepareTextForSpeech(text);
  if (!sanitized) return '';

  // If text is already concise (<= 320 chars), speak all of it
  if (sanitized.length <= 320) {
    return sanitized;
  }

  // Split into sentences and speak the first 2 key sentences
  const sentences = sanitized.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (sentences && sentences.length > 2) {
    return sentences.slice(0, 2).join(' ').trim() + " I've displayed the full details on your screen.";
  }

  return sanitized;
}
