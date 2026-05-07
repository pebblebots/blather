/**
 * Secret-linter (T#179).
 *
 * Scans messages posted to high-risk channels (default: #all) for signs of a
 * security-cascade claim — words like "token", "PAT", "key", "leak" — and
 * flags them when no message-id is cited. The output is a structured flag
 * shaped to be compatible with the `cascade_source` field used in the
 * pbd-knowledge `outcome-log.md` workflow.
 *
 * Design notes:
 * - WARN-ONLY. This module never rejects a message. It emits a flag that
 *   the POST /messages handler surfaces as a response header + console log.
 *   Enforcement (reject / require artifact) is a separate task.
 * - The caller is responsible for deciding WHICH channels to scan. This
 *   module only does the regex + citation check.
 * - Exported helpers (`containsSecretTrigger`, `hasMessageIdCitation`,
 *   `scanForSecretLintIssues`) are pure and unit-testable.
 *
 * See `secret-linter.test.ts` for the full contract.
 */

/**
 * Trigger words that indicate a potential security/leak claim.
 * Word-boundary anchored so "keystone" / "brokerage" don't match.
 */
const SECRET_TRIGGER_PATTERN =
  /\b(token|tokens|PAT|PATs|key|keys|leak|leaked|leaks|leaking)\b/i;

/**
 * Detects a Blather message-id citation in free text. The linter accepts:
 *   - Full UUID v4 (8-4-4-4-12)
 *   - UUID prefix of at least 8 hex chars
 *   - Citation forms: `msg a5365a5e`, `message a5365a5e-...`, `id=a5365a5e`,
 *     backticked `` `a5365a5e` ``, or a bare UUID anywhere in the message.
 *
 * This is intentionally permissive — we want to catch "Keith approved in
 * msg 5bf2c13a" just as well as `{"id": "5bf2c13a-..."}`. Precision is
 * handled by the caller requiring a trigger word to be present first.
 */
const FULL_UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

const UUID_PREFIX_PATTERN =
  /\b(?:msg|message|id)[\s:=]+[`'"]?[0-9a-f]{8,}[`'"]?/i;

/**
 * A short ID like `T#179` / `#179` is NOT a message-id citation — tasks
 * are not messages. This pattern exists so the caller can tell the
 * difference in diagnostics; it does NOT count as a citation.
 */
const TASK_SHORTID_PATTERN = /\bT#\d+\b/;

export type SecretFlagReason =
  | "trigger_without_citation"
  | "trigger_with_citation"
  | "no_trigger";

export interface SecretFlag {
  reason: SecretFlagReason;
  /**
   * The user id of the message author — the "first claimant" in
   * cascade-source terminology.
   */
  first_claimant: string;
  /** Whether an artifact (message-id citation) is present. */
  artifact_present: boolean;
  /**
   * The cited message-id prefix, if detected. Null when the author did
   * not cite any id (or only cited a task short-id like T#179).
   */
  cited_message_id: string | null;
  /** The author's own message id, once persisted. Filled in by caller. */
  message_id: string | null;
  /** Channel id the message was posted in. */
  channel_id: string;
  /** ISO-8601 timestamp of the scan. */
  scanned_at: string;
  /**
   * The trigger words the linter matched. Useful for debugging /
   * tuning the pattern.
   */
  matched_triggers: string[];
}

/** True if the content contains any secret-cascade trigger word. */
export function containsSecretTrigger(content: string): boolean {
  return SECRET_TRIGGER_PATTERN.test(content);
}

/**
 * Extract every trigger word present in the content (lowercased). Useful
 * for flag emission and test diagnostics.
 */
export function extractTriggers(content: string): string[] {
  const globalPattern = new RegExp(SECRET_TRIGGER_PATTERN.source, "gi");
  const hits = content.match(globalPattern) ?? [];
  // Preserve insertion order but dedupe case-insensitively.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const hit of hits) {
    const lowered = hit.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    result.push(lowered);
  }
  return result;
}

/**
 * Try to pull a message-id citation out of content. Returns the cited id
 * (or prefix) when one is present, null otherwise. A bare T#<n> is not
 * considered a citation.
 */
export function hasMessageIdCitation(content: string): string | null {
  // Full UUID wins over prefix.
  const full = content.match(FULL_UUID_PATTERN);
  if (full) return full[0].toLowerCase();

  const prefix = content.match(UUID_PREFIX_PATTERN);
  if (prefix) {
    // Return just the hex portion.
    const hex = prefix[0].match(/[0-9a-f]{8,}/i);
    return hex ? hex[0].toLowerCase() : prefix[0];
  }

  return null;
}

/** Returns true when the content cites a task short-id but no message-id. */
export function citesTaskOnly(content: string): boolean {
  return TASK_SHORTID_PATTERN.test(content) && hasMessageIdCitation(content) === null;
}

export interface ScanContext {
  /** Author of the scanned message. */
  authorUserId: string;
  /** Channel the message was posted in. */
  channelId: string;
  /**
   * The message's own id once it has been persisted. Optional — pass null
   * if the scan is happening pre-persist; the caller can fill it in later
   * before emitting the flag downstream.
   */
  messageId?: string | null;
  /** Override for the scan timestamp. Defaults to `new Date().toISOString()`. */
  scannedAt?: string;
}

/**
 * Primary entry point. Returns a {@link SecretFlag} when the message
 * contains a secret-cascade trigger word, or null when the content is
 * clean (no trigger word). The caller decides what to do with the flag —
 * the linter itself is side-effect free.
 */
export function scanForSecretLintIssues(
  content: string,
  ctx: ScanContext,
): SecretFlag | null {
  const triggers = extractTriggers(content);
  if (triggers.length === 0) return null;

  const citation = hasMessageIdCitation(content);

  return {
    reason: citation === null ? "trigger_without_citation" : "trigger_with_citation",
    first_claimant: ctx.authorUserId,
    artifact_present: citation !== null,
    cited_message_id: citation,
    message_id: ctx.messageId ?? null,
    channel_id: ctx.channelId,
    scanned_at: ctx.scannedAt ?? new Date().toISOString(),
    matched_triggers: triggers,
  };
}

/**
 * Default set of channel-names for which the linter is enabled. The
 * caller (POST /:id/messages) resolves a channel id to a name and checks
 * against this set. Keeping it name-based here means the list survives
 * workspace-id churn.
 */
export const DEFAULT_LINTED_CHANNEL_NAMES = new Set<string>(["all"]);

/**
 * Compact one-line log format. The caller writes these to stdout so the
 * ops agent can grep + forward them into outcome-log.md's cascade_source
 * column without any additional parsing.
 *
 * Format:
 *   [secret-linter] reason=<r> channel=<id> author=<id> msg=<id|null>
 *   cited=<id|null> triggers=<comma,list>
 */
export function formatSecretFlagLogLine(flag: SecretFlag): string {
  return (
    `[secret-linter] reason=${flag.reason} ` +
    `channel=${flag.channel_id} ` +
    `author=${flag.first_claimant} ` +
    `msg=${flag.message_id ?? "null"} ` +
    `cited=${flag.cited_message_id ?? "null"} ` +
    `triggers=${flag.matched_triggers.join(",")}`
  );
}
