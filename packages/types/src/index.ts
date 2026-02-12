// ── Auth ──

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  isAgent?: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: UserPublic;
}

export interface CreateApiKeyRequest {
  name: string;
}

export interface ApiKeyResponse {
  id: string;
  name: string;
  key: string; // only returned on creation
  createdAt: string;
}

// ── Users ──

export interface UserPublic {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
  createdAt: string;
}

// ── Workspaces ──

export interface CreateWorkspaceRequest {
  name: string;
  slug: string;
  allowedDomains?: string[];
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  allowedDomains: string[];
  createdAt: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type ChannelType = 'public' | 'private' | 'dm';

export interface WorkspaceMember {
  id: string;
  displayName: string;
  email: string;
  isAgent: boolean;
  avatarUrl: string | null;
}

export interface CreateDMRequest {
  userId: string;
}

// ── Channels ──

export interface CreateChannelRequest {
  name: string;
  slug: string;
  channelType?: ChannelType;
  isDefault?: boolean;
  topic?: string;
}

export interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  channelType: ChannelType;
  isDefault: boolean;
  topic: string | null;
  createdBy: string;
  createdAt: string;
}

// ── Messages ──

export interface CreateMessageRequest {
  content: string;
  threadId?: string;
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Reactions ──

export interface CreateReactionRequest {
  emoji: string;
}

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

// ── Events (WebSocket) ──

export type EventType =
  | 'message.created'
  | 'message.updated'
  | 'message.deleted'
  | 'reaction.added'
  | 'reaction.removed'
  | 'channel.created'
  | 'member.joined'
  | 'member.left';

export interface WsEvent {
  id: string;
  workspaceId: string;
  channelId: string | null;
  userId: string;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: string;
}
