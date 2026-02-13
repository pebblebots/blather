import { type ReactNode } from 'react';

/**
 * Lightweight inline-markdown renderer for chat messages.
 * Supports: **bold**, *italic*, `code`, ~~strikethrough~~, [links](url)
 */

const INLINE_RULES: [RegExp, (m: RegExpMatchArray, key: number) => ReactNode][] = [
  // code (must come first so inner markers aren't parsed)
  [/`([^`]+)`/, (m, k) => <code key={k} style={{ background: '#e0d6c2', padding: '0 3px', borderRadius: 2, fontSize: '0.95em' }}>{m[1]}</code>],
  // bold+italic
  [/\*\*\*(.+?)\*\*\*/, (m, k) => <strong key={k}><em>{renderInline(m[1])}</em></strong>],
  // bold
  [/\*\*(.+?)\*\*/, (m, k) => <strong key={k}>{renderInline(m[1])}</strong>],
  // italic
  [/\*(.+?)\*/, (m, k) => <em key={k}>{renderInline(m[1])}</em>],
  // strikethrough
  [/~~(.+?)~~/, (m, k) => <del key={k}>{renderInline(m[1])}</del>],
  // link
  [/\[([^\]]+)\]\(([^)]+)\)/, (m, k) => <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer" style={{ color: '#0066cc' }}>{m[1]}</a>],
];

let keyCounter = 0;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliest: { index: number; match: RegExpMatchArray; ruleIdx: number } | null = null;

    for (let i = 0; i < INLINE_RULES.length; i++) {
      const m = remaining.match(INLINE_RULES[i][0]);
      if (m && m.index !== undefined && (!earliest || m.index < earliest.index)) {
        earliest = { index: m.index, match: m, ruleIdx: i };
      }
    }

    if (!earliest) {
      nodes.push(remaining);
      break;
    }

    if (earliest.index > 0) {
      nodes.push(remaining.slice(0, earliest.index));
    }

    const [, render] = INLINE_RULES[earliest.ruleIdx];
    nodes.push(render(earliest.match, keyCounter++));
    remaining = remaining.slice(earliest.index + earliest.match[0].length);
  }

  return nodes;
}

export function MarkdownText({ text }: { text: string }) {
  // Split on newlines to preserve line breaks
  const lines = text.split('\n');
  return (
    <span>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {renderInline(line)}
        </span>
      ))}
    </span>
  );
}
