import React, { useMemo, useState } from 'react';
import katex from 'katex';
import { Copy, Check } from 'lucide-react';

interface MathRendererProps {
  content: string;
  className?: string;
  displayMode?: boolean;
}

/**
 * Safely renders a LaTeX mathematical formula using KaTeX with robust error handling.
 */
export function renderLatexToString(latex: string, displayMode: boolean = false): string {
  if (!latex) return '';
  // Normalize escaped backslashes from JSON strings (e.g. \\frac -> \frac)
  let cleanLatex = latex
    .replace(/\\\\([a-zA-Z]+)/g, '\\$1')
    .replace(/\\n/g, ' ')
    .trim();

  // Strip wrapping delimiters if already present
  cleanLatex = cleanLatex
    .replace(/^(\$\$|\\\[)/, '')
    .replace(/(\$\$|\\\])$/, '')
    .replace(/^(\$|\\\()/, '')
    .replace(/(\$|\\\))$/, '')
    .trim();

  try {
    return katex.renderToString(cleanLatex, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: false,
      trust: true,
      macros: {
        '\\₹': '\\text{₹}',
        '\\INR': '\\text{₹}',
        '\\Rs': '\\text{Rs.}',
      },
    });
  } catch (err) {
    console.warn('[KaTeX Render]', err);
    return `<span class="katex-fallback">${cleanLatex}</span>`;
  }
}

/**
 * Normalizes raw text to ensure that un-delimited LaTeX expressions (such as
 * naked \frac, \times, \text{}, \equiv, \pmod, \sqrt, \sum, or $x = 152 / 0.008$)
 * are properly delimited before segmentation.
 */
function normalizeMathDelimiters(input: string): string {
  if (!input) return '';

  let text = input;

  // 1. Normalize double-escaped backslashes commonly seen in JSON API responses
  text = text.replace(/\\\\([a-zA-Z]+)/g, '\\$1');

  // 2. Protect explicit code blocks from math normalization
  const codeBlocks: string[] = [];
  text = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // 3. Protect currency dollar amounts like "$500" or "$152" so they don't pair up with math delimiters
  // A currency amount is $ followed immediately by digits (e.g. $50, $152.50) without spaces or equals
  text = text.replace(/\$(?=\d+(?:,\d+)*(?:\.\d+)?(?:\s|$|[.,;!?]))/g, '&#36;');

  // 4. Wrap naked LaTeX commands that appear outside of $ or $$ delimiters
  // Common naked math patterns:
  // e.g. "x = \frac{152}{0.008} = 19000" or "152 \times 125" or "\text{Profit} = ..."
  const nakedMathCommandRegex = /(?:^|\s)(?:[a-zA-Z0-9_]+\s*=\s*)?\\(?:frac|sqrt|times|cdot|equiv|pmod|bmod|sum|int|boxed|pm|approx|ne|neq|le|leq|ge|geq|text|mathrm|mathbf|alpha|beta|gamma|delta|pi|theta|sigma|lambda|infty)\b[^\n$]*(?:\$|$|\n)/g;

  // Line-by-line check for un-delimited math
  const lines = text.split('\n');
  const processedLines = lines.map((line) => {
    const trimmed = line.trim();

    // Skip lines already containing standard math delimiters
    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[') || (trimmed.startsWith('$') && trimmed.endsWith('$'))) {
      return line;
    }

    // Check if line is a standalone equation or contains naked LaTeX
    const hasNakedLatex =
      trimmed.includes('\\frac') ||
      trimmed.includes('\\sqrt') ||
      trimmed.includes('\\times') ||
      trimmed.includes('\\cdot') ||
      trimmed.includes('\\equiv') ||
      trimmed.includes('\\pmod') ||
      trimmed.includes('\\bmod') ||
      trimmed.includes('\\sum') ||
      trimmed.includes('\\boxed') ||
      trimmed.includes('\\pm') ||
      trimmed.includes('\\approx') ||
      trimmed.includes('\\leq') ||
      trimmed.includes('\\geq') ||
      trimmed.includes('\\neq');

    // If an entire line is clearly an equation with an equals sign and numbers/variables
    // e.g. "x = 152 / 0.008 = 19,000" or "SP = 1500 * (1 + 0.15) = 1725"
    const isStandaloneEquation =
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('#') &&
      /^[a-zA-Z0-9_\(\)]+\s*=\s*[\d\.\+\-\*\/\\x\s\(\)]+(?:=\s*[\d\.\+\-\*\/\\x\s\(\)]+)?$/.test(trimmed) &&
      (trimmed.includes('/') || trimmed.includes('*') || trimmed.includes('+') || trimmed.includes('-'));

    if (hasNakedLatex && !trimmed.includes('$')) {
      // If the whole line is math, wrap in block math
      if (/^[a-zA-Z0-9_\s\(\)\=\+\-\*\/\\]+\{/.test(trimmed) || trimmed.startsWith('\\')) {
        return `$$${trimmed}$$`;
      }
      // Otherwise wrap the equation segment
      return line.replace(/([a-zA-Z0-9_\(\)]*\s*=\s*\\(?:frac|sqrt|text|boxed)[^$\n]+)/g, '$$$1$$');
    }

    if (isStandaloneEquation && !trimmed.includes('$')) {
      return `$$${trimmed}$$`;
    }

    return line;
  });

  text = processedLines.join('\n');

  // Restore protected code blocks
  text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[parseInt(idx, 10)] || '');

  // Restore currency dollar signs
  text = text.replace(/&#36;/g, '$');

  return text;
}

interface Segment {
  type: 'text' | 'inline-math' | 'block-math' | 'code-block' | 'table';
  value: string;
  language?: string;
}

/**
 * Parses mixed markdown and KaTeX content into structured segments.
 */
function parseMixedContent(raw: string): Segment[] {
  if (!raw) return [];

  const normalized = normalizeMathDelimiters(raw);
  const segments: Segment[] = [];
  let remaining = normalized;

  // Regex matching:
  // 1. Code blocks: ```lang\n...```
  // 2. Block math: $$...$$ or \[...\]
  // 3. Inline math: $...$ or \(...\)
  const masterRegex = /(```([a-zA-Z0-9_-]*)\n([\s\S]*?)```|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\$((?:\\\$|[^\$\r\n])+)\$|\\\(([\s\S]*?)\\\))/;

  while (remaining.length > 0) {
    const match = remaining.match(masterRegex);
    if (!match || match.index === undefined) {
      if (remaining.trim()) {
        segments.push({ type: 'text', value: remaining });
      }
      break;
    }

    // Push preceding text if present
    if (match.index > 0) {
      const preText = remaining.slice(0, match.index);
      if (preText) {
        segments.push({ type: 'text', value: preText });
      }
    }

    const fullMatch = match[0];

    // 1. Code block
    if (fullMatch.startsWith('```')) {
      segments.push({
        type: 'code-block',
        language: match[2] || 'text',
        value: match[3] || '',
      });
    }
    // 2. Block Math ($$...$$ or \[...\])
    else if (fullMatch.startsWith('$$')) {
      segments.push({ type: 'block-math', value: match[4] || '' });
    } else if (fullMatch.startsWith('\\[')) {
      segments.push({ type: 'block-math', value: match[5] || '' });
    }
    // 3. Inline Math ($...$ or \(...\))
    else if (fullMatch.startsWith('$')) {
      segments.push({ type: 'inline-math', value: match[6] || '' });
    } else if (fullMatch.startsWith('\\(')) {
      segments.push({ type: 'inline-math', value: match[7] || '' });
    } else {
      segments.push({ type: 'text', value: fullMatch });
    }

    remaining = remaining.slice(match.index + fullMatch.length);
  }

  return segments;
}

/**
 * Renders Markdown tables with KaTeX math inside table cells.
 */
function renderMarkdownTable(lines: string[], keyPrefix: string): React.ReactNode {
  if (lines.length < 2) return null;

  const headerCells = lines[0]
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean);

  const dataRows = lines
    .slice(1)
    .filter((l) => !l.includes('---'))
    .map((l) =>
      l
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
    );

  return (
    <div key={keyPrefix} className="w-full my-3 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80 shadow-md">
      <table className="w-full text-left text-xs sm:text-sm">
        <thead className="bg-slate-900/90 text-slate-200 border-b border-slate-800 font-semibold font-mono text-[11px] sm:text-xs">
          <tr>
            {headerCells.map((h, i) => (
              <th key={i} className="px-3 py-2.5">
                <MathRenderer content={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {dataRows.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-slate-900/40 transition">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-3 py-2 text-slate-300">
                  <MathRenderer content={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Formats rich text segment (lists, blockquotes, bold, inline code, and line breaks)
 */
function renderTextSegment(text: string, keyPrefix: string): React.ReactNode {
  // Check if text contains a markdown table
  if (text.includes('|') && text.includes('\n|') && text.includes('---')) {
    const lines = text.split('\n');
    const tableLines = lines.filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'));
    if (tableLines.length >= 2) {
      return renderMarkdownTable(tableLines, keyPrefix);
    }
  }

  const lines = text.split('\n');

  return lines.map((line, lineIdx) => {
    const trimmed = line.trim();

    // Empty line -> spacing
    if (!trimmed) {
      return <div key={`${keyPrefix}-blank-${lineIdx}`} className="h-2" />;
    }

    // Headings (#, ##, ###)
    if (trimmed.startsWith('#')) {
      const level = (trimmed.match(/^#+/)?.[0] || '#').length;
      const headingText = trimmed.replace(/^#+\s*/, '');
      const headingClass =
        level === 1
          ? 'text-lg sm:text-xl font-bold text-white mt-3 mb-1.5'
          : level === 2
          ? 'text-base sm:text-lg font-semibold text-cyan-200 mt-2.5 mb-1'
          : 'text-sm sm:text-base font-semibold text-slate-200 mt-2 mb-1';

      return (
        <div key={`${keyPrefix}-h-${lineIdx}`} className={headingClass}>
          {parseInlineFormatting(headingText, `${keyPrefix}-h-${lineIdx}`)}
        </div>
      );
    }

    // Unordered List item (- or *)
    if (/^[\*\-•]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[\*\-•]\s+/, '');
      return (
        <div key={`${keyPrefix}-ul-${lineIdx}`} className="flex items-start gap-2 my-0.5 pl-1.5 text-slate-200">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 shrink-0" />
          <span className="leading-relaxed">{parseInlineFormatting(itemText, `${keyPrefix}-ul-${lineIdx}`)}</span>
        </div>
      );
    }

    // Numbered List item (1. or 2.)
    const numMatch = trimmed.match(/^(\d+)[\.\)]\s+(.*)/);
    if (numMatch) {
      return (
        <div key={`${keyPrefix}-ol-${lineIdx}`} className="flex items-start gap-2 my-0.5 pl-1 text-slate-200">
          <span className="font-mono text-cyan-400 text-xs font-semibold mt-0.5 shrink-0">
            {numMatch[1]}.
          </span>
          <span className="leading-relaxed">{parseInlineFormatting(numMatch[2], `${keyPrefix}-ol-${lineIdx}`)}</span>
        </div>
      );
    }

    // Standard paragraph line
    return (
      <div key={`${keyPrefix}-p-${lineIdx}`} className="my-0.5 leading-relaxed">
        {parseInlineFormatting(line, `${keyPrefix}-p-${lineIdx}`)}
      </div>
    );
  });
}

/**
 * Formats inline bold (**text**), italic (*text*), and code (`code`).
 */
function parseInlineFormatting(text: string, keyPrefix: string): React.ReactNode {
  // Regex to split by bold (**...**) or inline code (`...`)
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*([^\*]+)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // Bold
      parts.push(
        <strong key={`b-${keyPrefix}-${match.index}`} className="font-semibold text-white">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // Inline Code
      parts.push(
        <code
          key={`c-${keyPrefix}-${match.index}`}
          className="px-1.5 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-cyan-300 font-mono text-xs"
        >
          {match[3]}
        </code>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

/**
 * Universal KaTeX Math & Markdown Renderer Component
 * Accurately renders mathematical expressions and rich markdown across all components.
 */
export const MathRenderer: React.FC<MathRendererProps> = ({
  content,
  className = '',
  displayMode = false,
}) => {
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);

  const handleCopyCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeIdx(idx);
    setTimeout(() => setCopiedCodeIdx(null), 2000);
  };

  // If explicitly flagged as pure display formula (e.g. inside a step equation card)
  if (displayMode) {
    const html = renderLatexToString(content, true);
    return (
      <div
        className={`my-2 py-2 px-3 overflow-x-auto text-center font-normal rounded-xl bg-slate-900/60 border border-slate-800/80 text-cyan-100 shadow-inner ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const segments = useMemo(() => parseMixedContent(content), [content]);

  return (
    <div className={`leading-relaxed text-inherit ${className}`}>
      {segments.map((seg, idx) => {
        // Block Math ($$...$$ or \[...\])
        if (seg.type === 'block-math') {
          const html = renderLatexToString(seg.value, true);
          return (
            <div
              key={`block-${idx}`}
              className="my-2.5 py-2 px-4 rounded-xl bg-slate-900/70 border border-cyan-500/20 text-center overflow-x-auto text-cyan-200 shadow-sm"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        // Inline Math ($...$ or \(...\))
        if (seg.type === 'inline-math') {
          const html = renderLatexToString(seg.value, false);
          return (
            <span
              key={`inline-${idx}`}
              className="inline-block px-1 align-baseline font-normal text-cyan-200"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        // Code Block (```lang ... ```)
        if (seg.type === 'code-block') {
          return (
            <div
              key={`code-${idx}`}
              className="my-2.5 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-md font-mono text-xs"
            >
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400">
                <span className="uppercase font-semibold tracking-wider text-cyan-400">
                  {seg.language || 'code'}
                </span>
                <button
                  onClick={() => handleCopyCode(seg.value, idx)}
                  className="flex items-center gap-1 hover:text-white transition"
                >
                  {copiedCodeIdx === idx ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 overflow-x-auto text-cyan-100/90 whitespace-pre leading-relaxed">
                {seg.value}
              </pre>
            </div>
          );
        }

        // Text & Markdown
        return <React.Fragment key={`txt-${idx}`}>{renderTextSegment(seg.value, `seg-${idx}`)}</React.Fragment>;
      })}
    </div>
  );
};
