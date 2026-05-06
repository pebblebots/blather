/**
 * Blather REST API client.
 */

export interface BlatherUser {
  id: string;
  email: string;
  displayName: string;
  isAgent: boolean;
}

export interface BlatherChannel {
  id: string;
  name: string;
  slug: string;
  channelType: "public" | "private" | "dm";
  isDefault: boolean;
  topic?: string | null;
}

export interface BlatherMessage {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  threadId?: string | null;
  createdAt: string;
}

export interface BlatherClientOptions {
  /** Max retry attempts on 429 rate-limit responses. Default: 3. */
  maxRetries?: number;
  /** Floor for backoff in ms when Retry-After header is absent. Default: 1000. */
  backoffBaseMs?: number;
  /** Ceiling for backoff in ms. Default: 60_000. */
  backoffMaxMs?: number;
  /** Hook for tests/observability. */
  onRateLimit?: (info: { path: string; retryAfterMs: number; attempt: number }) => void;
  /** Sleep function, overridable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_MAX_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse a Retry-After header value into milliseconds.
 * Supports both delta-seconds and HTTP-date formats (RFC 7231 §7.1.3).
 * Returns undefined when the header is missing or unparseable.
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;
  // delta-seconds: a non-negative integer
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  // HTTP-date
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, parsed - nowMs);
}

export class BlatherClient {
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly onRateLimit?: (info: { path: string; retryAfterMs: number; attempt: number }) => void;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private apiUrl: string,
    private apiKey: string,
    options?: BlatherClientOptions,
  ) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffBaseMs = options?.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = options?.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.onRateLimit = options?.onRateLimit;
    this.sleep = options?.sleep ?? defaultSleep;
  }

  private async request(path: string, opts?: RequestInit): Promise<Response> {
    let attempt = 0;
    // Attempts: 1 initial + maxRetries. Only 429 triggers a retry.
    while (true) {
      const res = await fetch(`${this.apiUrl}${path}`, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
          ...(opts?.headers ?? {}),
        },
      });
      if (res.ok) return res;

      // 429: honor Retry-After when present, else exponential backoff with jitter.
      if (res.status === 429 && attempt < this.maxRetries) {
        attempt += 1;
        const retryAfterHeader = res.headers.get("Retry-After");
        const serverHintMs = parseRetryAfter(retryAfterHeader);
        // Exponential backoff: base * 2^(attempt-1), capped at max, +/- 20% jitter.
        const expMs = Math.min(this.backoffBaseMs * 2 ** (attempt - 1), this.backoffMaxMs);
        const jitter = 1 + (Math.random() * 0.4 - 0.2);
        const fallbackMs = Math.round(expMs * jitter);
        const delayMs = Math.min(
          serverHintMs ?? fallbackMs,
          this.backoffMaxMs,
        );
        this.onRateLimit?.({ path, retryAfterMs: delayMs, attempt });
        // Drain the response body so the connection can be reused.
        await res.text().catch(() => "");
        await this.sleep(delayMs);
        continue;
      }

      const body = await res.text().catch(() => "");
      throw new Error(`Blather API ${res.status}: ${body}`);
    }
  }

  async getMe(): Promise<BlatherUser> {
    return (await this.request("/auth/me")).json();
  }

  async getMembers(_workspaceId?: string): Promise<BlatherUser[]> {
    return (await this.request("/members")).json();
  }

  async getChannels(_workspaceId?: string): Promise<BlatherChannel[]> {
    return (await this.request("/channels")).json();
  }

  async sendMessage(channelId: string, content: string): Promise<BlatherMessage> {
    const res = await this.request(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    return res.json();
  }

  async sendTyping(channelId: string): Promise<void> {
    await this.request(`/channels/${channelId}/typing`, { method: "POST" });
  }

  async setStatus(
    text: string,
    opts?: { autoclear?: string; progress?: number; eta?: string },
  ): Promise<void> {
    await this.request("/status", {
      method: "PUT",
      body: JSON.stringify({ text, ...opts }),
    });
  }

  async clearStatus(): Promise<void> {
    await this.request("/status", { method: "DELETE" });
  }

  /** Get or create a DM channel with the given user. Returns the channel. */
  async getOrCreateDM(targetUserId: string): Promise<BlatherChannel> {
    const res = await this.request(`/channels/dm`, {
      method: "POST",
      body: JSON.stringify({ userId: targetUserId }),
    });
    return res.json();
  }

  /** Look up a user by email address. */
  async findUserByEmail(email: string): Promise<BlatherUser | undefined> {
    const members = await this.getMembers();
    return members.find((m) => m.email === email);
  }
}
