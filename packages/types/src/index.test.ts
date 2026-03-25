import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  RegisterRequest, LoginRequest, AuthResponse, CreateApiKeyRequest, ApiKeyResponse,
  UserPublic,
  CreateWorkspaceRequest, Workspace, WorkspaceRole, ChannelType, WorkspaceMember, CreateDMRequest,
  CreateChannelRequest, Channel,
  Message, CreateReactionRequest, Reaction,
  EventType, WsEvent,
  PresenceStatus, PresenceInfo,
  TaskPriority, TaskStatus, Task, CreateTaskRequest, UpdateTaskRequest,
  Attachment, UploadResponse,
} from './index.js';

describe('types compile check', () => {
  it('EventType includes all expected values', () => {
    const allEventTypes: EventType[] = [
      'message.created', 'message.updated', 'message.deleted',
      'reaction.added', 'reaction.removed',
      'channel.created', 'channel.updated', 'channel.deleted', 'channel.archived', 'channel.member.added',
      'member.joined', 'member.left',
      'presence.changed', 'thread.updated',
      'huddle.created', 'huddle.audio', 'huddle.speaking', 'huddle.joined', 'huddle.ended',
    ];
    expect(allEventTypes).toHaveLength(19);
  });

  it('ChannelType includes expected values', () => {
    const types: ChannelType[] = ['public', 'private', 'dm'];
    expect(types).toHaveLength(3);
  });

  it('WorkspaceRole includes expected values', () => {
    const roles: WorkspaceRole[] = ['owner', 'admin', 'member'];
    expect(roles).toHaveLength(3);
  });

  it('TaskPriority includes expected values', () => {
    const priorities: TaskPriority[] = ['urgent', 'normal', 'low'];
    expect(priorities).toHaveLength(3);
  });

  it('TaskStatus includes expected values', () => {
    const statuses: TaskStatus[] = ['queued', 'in_progress', 'done'];
    expect(statuses).toHaveLength(3);
  });

  it('PresenceStatus includes expected values', () => {
    const statuses: PresenceStatus[] = ['online', 'idle', 'offline'];
    expect(statuses).toHaveLength(3);
  });

  it('interfaces have expected shapes', () => {
    expectTypeOf<UserPublic>().toHaveProperty('id');
    expectTypeOf<UserPublic>().toHaveProperty('email');
    expectTypeOf<UserPublic>().toHaveProperty('displayName');
    expectTypeOf<UserPublic>().toHaveProperty('isAgent');

    expectTypeOf<Workspace>().toHaveProperty('slug');
    expectTypeOf<Workspace>().toHaveProperty('allowedDomains');

    expectTypeOf<Channel>().toHaveProperty('channelType');
    expectTypeOf<Channel>().toHaveProperty('archived');

    expectTypeOf<Message>().toHaveProperty('threadId');
    expectTypeOf<Message>().toHaveProperty('content');

    expectTypeOf<WsEvent>().toHaveProperty('type');
    expectTypeOf<WsEvent>().toHaveProperty('payload');

    expectTypeOf<Task>().toHaveProperty('priority');
    expectTypeOf<Task>().toHaveProperty('status');
    expectTypeOf<Task>().toHaveProperty('assigneeId');

    expectTypeOf<Attachment>().toHaveProperty('url');
    expectTypeOf<Attachment>().toHaveProperty('size');
  });
});
