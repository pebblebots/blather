import { type ReactNode } from 'react';

/**
 * Lightweight inline-markdown renderer for chat messages.
 * Supports: **bold**, *italic*, `code`, ~~strikethrough~~, [links](url), @mentions
 */

type KeyCounter = { value: number };

export interface MentionContext {
  usersMap: Map<string, { displayName: string; isAgent: boolean }>;
  currentUserId?: string;
}

const MENTION_SELF_STYLE = { background: '#fff3cd', color: '#856404', borderRadius: 3, padding: '0 3px', fontWeight: 'bold' as const, cursor: 'pointer' };
const MENTION_OTHER_STYLE = { background: '#e8eaf6', color: '#3f51b5', borderRadius: 3, padding: '0 3px', fontWeight: 'bold' as const, cursor: 'pointer' };

function buildMentionRegex(usersMap: Map<string, { displayName: string; isAgent: boolean }>): RegExp | null {
  const names = Array.from(usersMap.values())
    .map(u => u.displayName)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest first to avoid partial matches
  if (names.length === 0) return null;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`@(${escaped.join('|')})(?=\\s|$|[.,!?;:)]|$)`, 'i');
}

type InlineRule = [RegExp, (m: RegExpMatchArray, key: number, kc: KeyCounter) => ReactNode];

const INLINE_RULES: InlineRule[] = [
  // code (must come first so inner markers aren't parsed)
  [/`([^`]+)`/, (m, k) => <code key={k} style={{ background: '#e0d6c2', padding: '0 3px', borderRadius: 2, fontSize: '0.95em' }}>{m[1]}</code>],
  // bold+italic
  [/\*\*\*(.+?)\*\*\*/, (m, k, kc) => <strong key={k}><em>{renderInline(m[1], kc)}</em></strong>],
  // bold
  [/\*\*(.+?)\*\*/, (m, k, kc) => <strong key={k}>{renderInline(m[1], kc)}</strong>],
  // italic
  [/\*(.+?)\*/, (m, k, kc) => <em key={k}>{renderInline(m[1], kc)}</em>],
  // strikethrough
  [/~~(.+?)~~/, (m, k, kc) => <del key={k}>{renderInline(m[1], kc)}</del>],
  // link
  [/\[([^\]]+)\]\(([^)]+)\)/, (m, k) => <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer" style={{ color: '#0066cc' }}>{m[1]}</a>],
];

// Mention rule is dynamically inserted after code rule
let _mentionCtx: MentionContext | null = null;
let _mentionRegex: RegExp | null = null;
let _nameToUserId: Map<string, string> | null = null;

function getMentionRule(): InlineRule | null {
  if (!_mentionCtx || !_mentionRegex) return null;
  return [_mentionRegex, (m, k) => {
    const matchedName = m[1];
    const userId = _nameToUserId?.get(matchedName.toLowerCase());
    const isSelf = userId === _mentionCtx?.currentUserId;
    return <span key={k} style={isSelf ? MENTION_SELF_STYLE : MENTION_OTHER_STYLE}>@{matchedName}</span>;
  }];
}

function buildRules(): InlineRule[] {
  const mentionRule = getMentionRule();
  if (!mentionRule) return INLINE_RULES;
  // Insert mention after code (index 0) but before other rules
  return [INLINE_RULES[0], mentionRule, ...INLINE_RULES.slice(1)];
}

function renderInline(text: string, kc: KeyCounter, rules?: InlineRule[]): ReactNode[] {
  const activeRules = rules || buildRules();
  const nodes: ReactNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliest: { index: number; match: RegExpMatchArray; ruleIdx: number } | null = null;

    for (let i = 0; i < activeRules.length; i++) {
      const m = remaining.match(activeRules[i][0]);
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

    const [, render] = activeRules[earliest.ruleIdx];
    nodes.push(render(earliest.match, kc.value++, kc));
    remaining = remaining.slice(earliest.index + earliest.match[0].length);
  }

  return nodes;
}

interface MarkdownTextProps {
  text: string;
  usersMap?: Map<string, { displayName: string; isAgent: boolean }>;
  currentUserId?: string;
}

export function MarkdownText({ text, usersMap, currentUserId }: MarkdownTextProps) {
  // Set up mention context for this render
  if (usersMap && usersMap.size > 0) {
    _mentionCtx = { usersMap, currentUserId };
    _mentionRegex = buildMentionRegex(usersMap);
    _nameToUserId = new Map();
    for (const [userId, info] of usersMap) {
      _nameToUserId.set(info.displayName.toLowerCase(), userId);
    }
  } else {
    _mentionCtx = null;
    _mentionRegex = null;
    _nameToUserId = null;
  }

  const kc: KeyCounter = { value: 0 };
  const lines = text.split('\n');
  return (
    <span>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {renderInline(line, kc)}
        </span>
      ))}
    </span>
  );
}
