import { describe, it, expect, vi, beforeEach } from "vitest";
import { BlatherClient, parseRetryAfter } from "./api.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BlatherClient", () => {
  const client = new BlatherClient("https://example.com/api", "test-key-123");

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("sets X-API-Key and Content-Type on every request", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "u1", email: "a@b.c", displayName: "A", isAgent: false }));
    await client.getMe();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/api/auth/me");
    expect(opts.headers["X-API-Key"]).toBe("test-key-123");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("throws with status and body on non-ok response", async () => {
    mockFetch.mockResolvedValue(new Response("not found", { status: 404 }));
    await expect(client.getMe()).rejects.toThrow("Blather API 404: not found");
  });

  it("throws with empty body when response text fails", async () => {
    const badResponse = new Response(null, { status: 500 });
    vi.spyOn(badResponse, "text").mockRejectedValue(new Error("read error"));
    mockFetch.mockResolvedValue(badResponse);

    await expect(client.getMe()).rejects.toThrow("Blather API 500: ");
  });

  it("getMe returns parsed user", async () => {
    const user = { id: "u1", email: "a@b.c", displayName: "Alice", isAgent: false };
    mockFetch.mockResolvedValue(jsonResponse(user));

    const result = await client.getMe();
    expect(result).toEqual(user);
  });

  it("getChannels hits correct URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await client.getChannels("ws-1");

    expect(mockFetch.mock.calls[0][0]).toBe("https://example.com/api/channels");
  });

  it("getMembers hits correct URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await client.getMembers("ws-1");

    expect(mockFetch.mock.calls[0][0]).toBe("https://example.com/api/members");
  });

  it("sendMessage posts content and returns the message", async () => {
    const msg = { id: "m1", channelId: "ch1", userId: "u1", content: "hi", createdAt: "2025-01-01T00:00:00Z" };
    mockFetch.mockResolvedValue(jsonResponse(msg));

    const result = await client.sendMessage("ch1", "hi");
    const [url, opts] = mockFetch.mock.calls[0];

    expect(url).toBe("https://example.com/api/channels/ch1/messages");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ content: "hi" });
    expect(result).toEqual(msg);
  });

  it("sendTyping posts to the typing endpoint", async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, 200));
    await client.sendTyping("ch1");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/api/channels/ch1/typing");
    expect(opts.method).toBe("POST");
  });

  it("setStatus sends PUT with text and options", async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, 200));
    await client.setStatus("deploying", { autoclear: "5m", progress: 0.5, eta: "2m" });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/api/status");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({
      text: "deploying",
      autoclear: "5m",
      progress: 0.5,
      eta: "2m",
    });
  });

  it("setStatus sends text only when no options", async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, 200));
    await client.setStatus("thinking");

    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ text: "thinking" });
  });

  it("clearStatus sends DELETE", async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, 200));
    await client.clearStatus();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/api/status");
    expect(opts.method).toBe("DELETE");
  });

  it("T#135: getOrCreateDM posts to /channels/dm with userId and returns channel", async () => {
    const dmChannel = { id: "ch-dm-1", name: "", slug: "dm-u1-u2", channelType: "dm", isDefault: false };
    mockFetch.mockResolvedValue(jsonResponse(dmChannel));

    const result = await client.getOrCreateDM("u-target");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/api/channels/dm");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ userId: "u-target" });
    expect(result).toEqual(dmChannel);
  });
});

// ---------------------------------------------------------------------------
// parseRetryAfter
// ---------------------------------------------------------------------------
describe("parseRetryAfter", () => {
  it("returns undefined for null/undefined/empty", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("   ")).toBeUndefined();
  });

  it("parses delta-seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("parses HTTP-date in the future", () => {
    const nowMs = 1_000_000;
    const futureDate = new Date(nowMs + 10_000).toUTCString();
    const result = parseRetryAfter(futureDate, nowMs);
    expect(result).toBeGreaterThanOrEqual(9_900);
    expect(result).toBeLessThanOrEqual(10_100);
  });

  it("returns 0 for HTTP-date in the past", () => {
    const nowMs = 1_000_000_000;
    const pastDate = new Date(nowMs - 5_000).toUTCString();
    expect(parseRetryAfter(pastDate, nowMs)).toBe(0);
  });

  it("returns undefined for unparseable strings", () => {
    expect(parseRetryAfter("not-a-date")).toBeUndefined();
    expect(parseRetryAfter("abc")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 429 retry / backoff (T#165)
// ---------------------------------------------------------------------------
describe("BlatherClient 429 backoff (T#165)", () => {
  const sleepMock = vi.fn().mockResolvedValue(undefined);
  const rateLimitEvents: Array<{ path: string; retryAfterMs: number; attempt: number }> = [];

  const client429 = new BlatherClient("https://example.com/api", "key", {
    maxRetries: 3,
    backoffBaseMs: 100,
    backoffMaxMs: 10_000,
    sleep: sleepMock,
    onRateLimit: (info) => rateLimitEvents.push(info),
  });

  beforeEach(() => {
    mockFetch.mockReset();
    sleepMock.mockReset();
    rateLimitEvents.length = 0;
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    const user = { id: "u1", email: "a@b.c", displayName: "A", isAgent: false };
    mockFetch
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(jsonResponse(user));

    const result = await client429.getMe();

    expect(result).toEqual(user);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(2000); // honors Retry-After: 2
    expect(rateLimitEvents).toHaveLength(1);
    expect(rateLimitEvents[0]).toMatchObject({ retryAfterMs: 2000, attempt: 1 });
  });

  it("uses exponential backoff when Retry-After is absent", async () => {
    const user = { id: "u1", email: "a@b.c", displayName: "A", isAgent: false };
    mockFetch
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(user));

    await client429.getMe();

    expect(sleepMock).toHaveBeenCalledTimes(1);
    const [delayMs] = sleepMock.mock.calls[0];
    // backoffBaseMs=100, attempt=1 → expMs = 100*2^0 = 100, +/-20% jitter
    expect(delayMs).toBeGreaterThanOrEqual(80);
    expect(delayMs).toBeLessThanOrEqual(120);
  });

  it("retries up to maxRetries then throws", async () => {
    // 4 consecutive 429s (initial + 3 retries)
    mockFetch.mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(client429.getMe()).rejects.toThrow("Blather API 429");

    expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(sleepMock).toHaveBeenCalledTimes(3);
    expect(rateLimitEvents).toHaveLength(3);
  });

  it("does NOT retry on non-429 errors", async () => {
    mockFetch.mockResolvedValue(new Response("server error", { status: 500 }));

    await expect(client429.getMe()).rejects.toThrow("Blather API 500");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("caps delay at backoffMaxMs", async () => {
    const clientCapped = new BlatherClient("https://example.com/api", "key", {
      maxRetries: 1,
      backoffBaseMs: 1_000,
      backoffMaxMs: 500,
      sleep: sleepMock,
    });
    const user = { id: "u1", email: "a@b.c", displayName: "A", isAgent: false };
    mockFetch
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "999" }, // server says 999s
      }))
      .mockResolvedValueOnce(jsonResponse(user));

    await clientCapped.getMe();

    const [delayMs] = sleepMock.mock.calls[0];
    expect(delayMs).toBe(500); // capped at backoffMaxMs
  });
});
