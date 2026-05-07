import { describe, it, expect } from "vitest";
import {
  containsSecretTrigger,
  extractTriggers,
  hasMessageIdCitation,
  citesTaskOnly,
  scanForSecretLintIssues,
  formatSecretFlagLogLine,
  DEFAULT_LINTED_CHANNEL_NAMES,
} from "./secret-linter.js";

const CTX = {
  authorUserId: "user-a",
  channelId: "channel-all",
  messageId: "msg-123",
  scannedAt: "2026-05-06T22:00:00.000Z",
};

describe("containsSecretTrigger", () => {
  it("matches trigger words", () => {
    expect(containsSecretTrigger("a token leaked yesterday")).toBe(true);
    expect(containsSecretTrigger("rotating the PAT now")).toBe(true);
    expect(containsSecretTrigger("API key exposed")).toBe(true);
    expect(containsSecretTrigger("no leak detected")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(containsSecretTrigger("TOKEN")).toBe(true);
    expect(containsSecretTrigger("Key")).toBe(true);
  });

  it("respects word boundaries", () => {
    expect(containsSecretTrigger("keystone arch")).toBe(false);
    expect(containsSecretTrigger("brokerage fee")).toBe(false);
    expect(containsSecretTrigger("tokenize the input")).toBe(false);
    expect(containsSecretTrigger("leakage test")).toBe(false);
  });

  it("returns false for clean content", () => {
    expect(containsSecretTrigger("hello world")).toBe(false);
    expect(containsSecretTrigger("")).toBe(false);
  });
});

describe("extractTriggers", () => {
  it("returns all matched trigger words, lowercased + deduped", () => {
    expect(extractTriggers("token leaked, PAT rotated")).toEqual([
      "token",
      "leaked",
      "pat",
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(extractTriggers("Token tOKen TOKEN")).toEqual(["token"]);
  });

  it("returns empty for clean content", () => {
    expect(extractTriggers("hello world")).toEqual([]);
  });
});

describe("hasMessageIdCitation", () => {
  it("detects a bare full UUID", () => {
    const content = "see a5365a5e-1234-4321-abcd-0123456789ab for context";
    expect(hasMessageIdCitation(content)).toBe(
      "a5365a5e-1234-4321-abcd-0123456789ab",
    );
  });

  it("detects `msg <hex>` prefix citations", () => {
    expect(hasMessageIdCitation("Keith approved in msg a5365a5e")).toBe("a5365a5e");
    expect(hasMessageIdCitation("message a5365a5eabc")).toBe("a5365a5eabc");
    expect(hasMessageIdCitation("id=a5365a5e")).toBe("a5365a5e");
  });

  it("handles backticked citations", () => {
    expect(hasMessageIdCitation("msg `a5365a5e`")).toBe("a5365a5e");
  });

  it("lowercases hex on return", () => {
    expect(hasMessageIdCitation("msg A5365A5E")).toBe("a5365a5e");
  });

  it("returns null when no citation is present", () => {
    expect(hasMessageIdCitation("no citation here")).toBe(null);
    expect(hasMessageIdCitation("T#179 is the task")).toBe(null);
  });

  it("does not treat short hex fragments as citations", () => {
    // 7 hex chars is below the 8-char threshold.
    expect(hasMessageIdCitation("see ref abc1234")).toBe(null);
  });
});

describe("citesTaskOnly", () => {
  it("true when only a task short-id is cited", () => {
    expect(citesTaskOnly("see T#179")).toBe(true);
  });

  it("false when a message-id is also cited", () => {
    expect(citesTaskOnly("T#179, see msg a5365a5e")).toBe(false);
  });

  it("false when no task short-id is present", () => {
    expect(citesTaskOnly("no task ref")).toBe(false);
  });
});

describe("scanForSecretLintIssues", () => {
  it("returns null for messages with no trigger words", () => {
    expect(scanForSecretLintIssues("hello world", CTX)).toBeNull();
  });

  it("flags trigger-without-citation", () => {
    const flag = scanForSecretLintIssues("a PAT was leaked", CTX);
    expect(flag).not.toBeNull();
    expect(flag!.reason).toBe("trigger_without_citation");
    expect(flag!.artifact_present).toBe(false);
    expect(flag!.cited_message_id).toBeNull();
    expect(flag!.matched_triggers).toEqual(["pat", "leaked"]);
    expect(flag!.first_claimant).toBe(CTX.authorUserId);
    expect(flag!.channel_id).toBe(CTX.channelId);
    expect(flag!.message_id).toBe(CTX.messageId);
    expect(flag!.scanned_at).toBe(CTX.scannedAt);
  });

  it("flags trigger-with-citation", () => {
    const flag = scanForSecretLintIssues(
      "token leaked — see msg a5365a5e",
      CTX,
    );
    expect(flag).not.toBeNull();
    expect(flag!.reason).toBe("trigger_with_citation");
    expect(flag!.artifact_present).toBe(true);
    expect(flag!.cited_message_id).toBe("a5365a5e");
  });

  it("treats a task-only citation as no-citation", () => {
    // Triggered on 'key', only task shortId cited → no artifact.
    const flag = scanForSecretLintIssues("the SSH key broke, see T#179", CTX);
    expect(flag).not.toBeNull();
    expect(flag!.reason).toBe("trigger_without_citation");
    expect(flag!.artifact_present).toBe(false);
  });

  it("defaults messageId to null and scanned_at to now when not provided", () => {
    const flag = scanForSecretLintIssues("token leaked", {
      authorUserId: "user-a",
      channelId: "channel-all",
    });
    expect(flag).not.toBeNull();
    expect(flag!.message_id).toBeNull();
    expect(flag!.scanned_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("formatSecretFlagLogLine", () => {
  it("produces a single-line grep-friendly format", () => {
    const flag = scanForSecretLintIssues("token leaked", CTX)!;
    const line = formatSecretFlagLogLine(flag);
    expect(line).toBe(
      "[secret-linter] reason=trigger_without_citation " +
        "channel=channel-all " +
        "author=user-a " +
        "msg=msg-123 " +
        "cited=null " +
        "triggers=token,leaked",
    );
  });

  it("handles null messageId + citation cleanly", () => {
    const flag = scanForSecretLintIssues(
      "key rotated — msg a5365a5e",
      { authorUserId: "u", channelId: "c" },
    )!;
    const line = formatSecretFlagLogLine(flag);
    expect(line).toContain("msg=null");
    expect(line).toContain("cited=a5365a5e");
    expect(line).toContain("triggers=key");
  });
});

describe("DEFAULT_LINTED_CHANNEL_NAMES", () => {
  it("includes #all by default", () => {
    expect(DEFAULT_LINTED_CHANNEL_NAMES.has("all")).toBe(true);
  });
});
