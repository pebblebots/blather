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
  role: UserRole;
  createdAt: string;
}

// ── Roles ──

export type UserRole = 'owner' | 'admin' | 'member';
export type ChannelType = 'public' | 'private' | 'dm';

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
  name: string;
  slug: string;
  channelType: ChannelType;
  isDefault: boolean;
  topic: string | null;
  createdBy: string;
  createdAt: string;
  archived: boolean;
}

// ── Messages ──

export interface CreateMessageRequest {
  content: string;
  threadId?: string;
  attachments?: Attachment[];
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
  | 'member.left'
  | 'channel.updated'
  | 'channel.deleted'
  | 'channel.archived'
  | 'channel.member.added'
  | 'presence.changed'
  | 'thread.updated'
  | 'huddle.created'
  | 'huddle.audio'
  | 'huddle.speaking'
  | 'huddle.joined'
  | 'huddle.ended'
  | 'status.changed';

export interface WsEvent {
  id: string;
  channelId: string | null;
  userId: string;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: string;
}


// ── Presence ──

export type PresenceStatus = 'online' | 'idle' | 'offline';

export interface PresenceInfo {
  userId: string;
  status: PresenceStatus;
}

// ── Tasks ──

export type TaskPriority = 'urgent' | 'normal' | 'low';
export type TaskStatus = 'queued' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeId: string | null;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigneeId?: string;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigneeId?: string | null;
}

// ── Attachments ──

export interface Attachment {
  url: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface UploadResponse {
  url: string;
  filename: string;
  contentType: string;
  size: number;
}
