import { describe, it, expect, vi, beforeEach } from "vitest";
import { BlatherClient } from "./api.js";

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

    expect(mockFetch.mock.calls[0][0]).toBe("https://example.com/api/workspaces/ws-1/channels");
  });

  it("getMembers hits correct URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await client.getMembers("ws-1");

    expect(mockFetch.mock.calls[0][0]).toBe("https://example.com/api/workspaces/ws-1/members");
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
});
