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
  workspaceId: string;
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

export class BlatherClient {
  constructor(
    private apiUrl: string,
    private apiKey: string,
  ) {}

  private async request(path: string, opts?: RequestInit): Promise<Response> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        ...(opts?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Blather API ${res.status}: ${body}`);
    }
    return res;
  }

  async getMe(): Promise<BlatherUser> {
    return (await this.request("/auth/me")).json();
  }

  async getMembers(workspaceId: string): Promise<BlatherUser[]> {
    return (await this.request(`/workspaces/${workspaceId}/members`)).json();
  }

  async getChannels(workspaceId: string): Promise<BlatherChannel[]> {
    return (await this.request(`/workspaces/${workspaceId}/channels`)).json();
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
}
