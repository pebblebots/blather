import React from "react";

// --- Types ---

export interface UserInfo {
  displayName: string;
  isAgent: boolean;
}

export type UsersMap = Map<string, UserInfo>;

export interface MarkdownTextProps {
  text: string;
  usersMap?: UsersMap;
  currentUserId?: string;
}

// --- Inline rule system ---

interface InlineRule {
  name: string;
  pattern: RegExp;
  render: (match: RegExpMatchArray, key: string) => React.ReactNode;
}

function buildMentionRule(
  usersMap: UsersMap,
  currentUserId?: string
): InlineRule | null {
  if (!usersMap || usersMap.size === 0) return null;

  const nameToUserId = new Map<string, string>();
  for (const [userId, info] of usersMap) {
    nameToUserId.set(info.displayName.toLowerCase(), userId);
  }

  const escapedNames = Array.from(usersMap.values())
    .map((u) => u.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length); // longest first to avoid partial matches

  if (escapedNames.length === 0) return null;

  const pattern = new RegExp(`@(${escapedNames.join("|")})(?=\\s|$|[.,!?;:)])`, "i");

  return {
    name: "mention",
    pattern,
    render: (match, key) => {
      const mentionedName = match[1];
      const userId = nameToUserId.get(mentionedName.toLowerCase());
      const isSelf = userId === currentUserId;

      const style: React.CSSProperties = isSelf
        ? {
            background: "#fff3cd",
            color: "#856404",
            borderRadius: 3,
            padding: "0 3px",
            fontWeight: "bold",
            cursor: "pointer",
          }
        : {
            background: "#e8eaf6",
            color: "#3f51b5",
            borderRadius: 3,
            padding: "0 3px",
            fontWeight: "bold",
            cursor: "pointer",
          };

      return (
        <span key={key} style={style} data-mention-user-id={userId}>
          @{mentionedName}
        </span>
      );
    },
  };
}

const INLINE_RULES: InlineRule[] = [
  {
    name: "codeInline",
    pattern: /`([^`]+)`/,
    render: (match, key) => (
      <code
        key={key}
        style={{
          background: "#f0f0f0",
          padding: "1px 4px",
          borderRadius: 3,
          fontFamily: "monospace",
          fontSize: "0.9em",
        }}
      >
        {match[1]}
      </code>
    ),
  },
  {
    name: "boldItalic",
    pattern: /\*\*\*(.+?)\*\*\*/,
    render: (match, key) => (
      <strong key={key}>
        <em>{match[1]}</em>
      </strong>
    ),
  },
  {
    name: "bold",
    pattern: /\*\*(.+?)\*\*/,
    render: (match, key) => <strong key={key}>{match[1]}</strong>,
  },
  {
    name: "italic",
    pattern: /\*(.+?)\*/,
    render: (match, key) => <em key={key}>{match[1]}</em>,
  },
  {
    name: "strikethrough",
    pattern: /~~(.+?)~~/,
    render: (match, key) => (
      <del key={key}>{match[1]}</del>
    ),
  },
  {
    name: "link",
    pattern: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/,
    render: (match, key) => (
      <a key={key} href={match[2]} target="_blank" rel="noopener noreferrer">
        {match[1]}
      </a>
    ),
  },
  {
    name: "autolink",
    pattern: /(https?:\/\/[^\s]+)/,
    render: (match, key) => (
      <a key={key} href={match[1]} target="_blank" rel="noopener noreferrer">
        {match[1]}
      </a>
    ),
  },
];

function buildRules(usersMap?: UsersMap, currentUserId?: string): InlineRule[] {
  const rules: InlineRule[] = [];

  // Code inline is always first — nothing is parsed inside code
  rules.push(INLINE_RULES[0]); // codeInline

  // Mentions come before other inline formatting
  if (usersMap) {
    const mentionRule = buildMentionRule(usersMap, currentUserId);
    if (mentionRule) rules.push(mentionRule);
  }

  // Then the rest of the inline rules (skip codeInline which is already added)
  for (let i = 1; i < INLINE_RULES.length; i++) {
    rules.push(INLINE_RULES[i]);
  }

  return rules;
}

function parseInline(
  text: string,
  rules: InlineRule[],
  keyPrefix: string = "0"
): React.ReactNode[] {
  if (!text) return [];

  for (let ruleIdx = 0; ruleIdx < rules.length; ruleIdx++) {
    const rule = rules[ruleIdx];
    const match = text.match(rule.pattern);
    if (!match || match.index === undefined) continue;

    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const result: React.ReactNode[] = [];

    if (before) {
      result.push(...parseInline(before, rules, `${keyPrefix}-b${ruleIdx}`));
    }

    const rendered = rule.render(match, `${keyPrefix}-${rule.name}`);
    // For code blocks, don't recurse into the content
    if (rule.name === "codeInline") {
      result.push(rendered);
    } else if (rule.name === "mention") {
      result.push(rendered);
    } else {
      result.push(rendered);
    }

    if (after) {
      result.push(...parseInline(after, rules, `${keyPrefix}-a${ruleIdx}`));
    }

    return result;
  }

  return [text];
}

export const MarkdownText: React.FC<MarkdownTextProps> = ({
  text,
  usersMap,
  currentUserId,
}) => {
  const rules = buildRules(usersMap, currentUserId);
  const lines = text.split("\n");

  return (
    <span>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {i > 0 && <br />}
          {parseInline(line, rules, String(i))}
        </React.Fragment>
      ))}
    </span>
  );
};

export default MarkdownText;
