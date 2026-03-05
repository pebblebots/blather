/**
 * Blather Channel Plugin for OpenClaw
 * Single-file plugin to avoid jiti cross-file import caching issues.
 */
import {
  DEFAULT_ACCOUNT_ID,
  emptyPluginConfigSchema,
  createReplyPrefixOptions,
  type ChannelPlugin,
  type OpenClawConfig,
  type OpenClawPluginApi,
  type PluginRuntime,
} from "openclaw/plugin-sdk";

// ─── Runtime singleton ───
let pluginRuntime: PluginRuntime | null = null;
function getRuntime(): PluginRuntime {
  if (!pluginRuntime) throw new Error("Blather runtime not initialized");
  return pluginRuntime;
}

// ─── Config resolution ───
type BlatherConfig = {
  enabled?: boolean;
  apiUrl?: string;
  apiKey?: string;
  workspaceId?: string;
  channelId?: string;
  dmPolicy?: string;
  allowFrom?: string[];
  accounts?: Record<string, any>;
};

type ResolvedBlatherAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
  channelId?: string;
  config: BlatherConfig;
};

function getSection(cfg: OpenClawConfig): BlatherConfig | undefined {
  return (cfg.channels as any)?.blather;
}

function listAccountIds(cfg: OpenClawConfig): string[] {
  const section = getSection(cfg);
  if (!section) return [];
  const ids: string[] = [DEFAULT_ACCOUNT_ID];
  if (section.accounts) {
    for (const id of Object.keys(section.accounts)) {
      if (id !== DEFAULT_ACCOUNT_ID && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedBlatherAccount {
  const section = getSection(cfg) ?? {};
  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  const acct: any = id !== DEFAULT_ACCOUNT_ID ? section.accounts?.[id] ?? {} : section;
  const apiUrl = (acct.apiUrl ?? section.apiUrl ?? "").trim();
  const apiKey = (acct.apiKey ?? section.apiKey ?? "").trim();
  const workspaceId = (acct.workspaceId ?? section.workspaceId ?? "").trim();
  const channelId = (acct.channelId ?? section.channelId ?? "").trim() || undefined;
  return {
    accountId: id,
    enabled: acct.enabled !== false,
    configured: Boolean(apiUrl && apiKey && workspaceId),
    apiUrl,
    apiKey,
    workspaceId,
    channelId,
    config: section,
  };
}

// ─── HTTP helper ───
async function blatherFetch(apiUrl: string, apiKey: string, path: string, opts?: RequestInit) {
  const res = await fetch(`${apiUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Blather API ${res.status}: ${text}`);
  }
  return res;
}

// ─── WebSocket Monitor ───
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60_000;

type MonitorParams = {
  core: PluginRuntime;
  cfg: OpenClawConfig;
  abortSignal: AbortSignal;
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
  channelId?: string;
  accountId: string;
  log?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug?: (m: string) => void };
};

async function monitorBlather(params: MonitorParams) {
  const { core, cfg, abortSignal, apiUrl, apiKey, workspaceId, channelId, accountId, log } = params;

  // Auth check + self identity
  const meRes = await blatherFetch(apiUrl, apiKey, "/auth/me");
  const selfUser = await meRes.json() as { id: string; email: string; displayName: string };
  log?.info(`blather: authenticated as ${selfUser.displayName} (${selfUser.email})`);

  // Members cache
  const membersCache = new Map<string, { id: string; email: string; displayName: string; isAgent: boolean }>();
  try {
    const membersRes = await blatherFetch(apiUrl, apiKey, `/workspaces/${workspaceId}/members`);
    const members = await membersRes.json() as any[];
    for (const m of members) membersCache.set(m.id, m);
  } catch (err) {
    log?.warn(`blather: failed to load members: ${String(err)}`);
  }

  // Channels cache
  const channelsCache = new Map<string, { name: string; channelType: string }>();
  try {
    const chRes = await blatherFetch(apiUrl, apiKey, `/workspaces/${workspaceId}/channels`);
    const channels = await chRes.json() as any[];
    for (const ch of channels) channelsCache.set(ch.id, { name: ch.name || ch.slug, channelType: ch.channelType });
  } catch (err) {
    log?.warn(`blather: failed to load channels: ${String(err)}`);
  }

  const startupMs = Date.now();
  let reconnectAttempt = 0;

  function connect() {
    if (abortSignal.aborted) return;

    const wsBase = apiUrl.replace(/^http/, "ws").replace(/\/api$/, "");
    const wsUrl = `${wsBase}/ws/events?api_key=${apiKey}&workspace_id=${workspaceId}`;

    log?.info(`blather: connecting WebSocket`);
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      log?.info("blather: WebSocket connected");
      reconnectAttempt = 0;
    });

    ws.addEventListener("message", async (evt: any) => {
      try {
        const raw = typeof evt.data === "string" ? evt.data : String(evt.data);
        const event = JSON.parse(raw);
        if (event.type === "connected") return;
        if (event.type === "message.created" && event.data) {
          await handleInbound(event.data);
        }
      } catch (err) {
        log?.warn(`blather: WS event error: ${String(err)}`);
      }
    });

    ws.addEventListener("close", () => {
      if (abortSignal.aborted) return;
      reconnectAttempt++;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempt - 1), RECONNECT_MAX_MS);
      log?.warn(`blather: disconnected, reconnecting in ${delay}ms`);
      setTimeout(connect, delay);
    });

    ws.addEventListener("error", () => {
      log?.error("blather: WebSocket error");
      ws.close();
    });

    abortSignal.addEventListener("abort", () => ws.close(), { once: true });
  }

  async function handleInbound(data: { id: string; channelId: string; userId: string; content: string; threadId?: string | null; createdAt: string }) {
    if (data.userId === selfUser.id) return;
    if (channelId && data.channelId !== channelId) return;

    const eventTs = new Date(data.createdAt).getTime();
    if (eventTs < startupMs - 5000) return;

    const sender = membersCache.get(data.userId);
    const senderName = sender?.displayName ?? "Unknown";
    const senderEmail = sender?.email ?? data.userId;

    const channel = channelsCache.get(data.channelId);
    const channelName = channel?.name ?? data.channelId;
    const isDm = channel?.channelType === "dm";

    const bodyText = data.content.trim();
    if (!bodyText) return;

    log?.info(`blather: ${senderName} in ${isDm ? "DM" : `#${channelName}`}: ${bodyText.slice(0, 80)}`);

    const peerId = isDm ? `blather:${senderEmail}` : `blather:channel:${data.channelId}`;
    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "blather",
      peer: { kind: isDm ? "direct" : "channel", id: peerId },
    });

    const envelopeFrom = isDm ? senderName : `#${channelName}`;
    const textWithMeta = `${bodyText}\n[blather msg: ${data.id} channel: ${data.channelId}]`;
    const storePath = core.channel.session.resolveStorePath(cfg.session?.store, { agentId: route.agentId });
    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const previousTimestamp = core.channel.session.readSessionUpdatedAt({ storePath, sessionKey: route.sessionKey });

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Blather",
      from: envelopeFrom,
      timestamp: eventTs,
      previousTimestamp,
      envelope: envelopeOptions,
      body: textWithMeta,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: body,
      RawBody: bodyText,
      CommandBody: bodyText,
      From: isDm ? `blather:${senderEmail}` : `blather:channel:${data.channelId}`,
      To: `blather:channel:${data.channelId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isDm ? "direct" : "group",
      ConversationLabel: envelopeFrom,
      SenderName: senderName,
      SenderId: data.userId,
      SenderUsername: senderEmail,
      GroupSubject: isDm ? undefined : channelName,
      GroupChannel: isDm ? undefined : `#${channelName}`,
      Provider: "blather" as any,
      Surface: "blather" as any,
      MessageSid: data.id,
      MessageThreadId: data.threadId ?? undefined,
      Timestamp: eventTs,
      CommandAuthorized: true,
      CommandSource: "text" as any,
      OriginatingChannel: "blather" as any,
      OriginatingTo: `blather:channel:${data.channelId}`,
    });

    await core.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      updateLastRoute: isDm ? {
        sessionKey: route.mainSessionKey,
        channel: "blather",
        to: `blather:channel:${data.channelId}`,
        accountId: route.accountId,
      } : undefined,
      onRecordError: (err) => log?.warn(`blather: session meta error: ${String(err)}`),
    });

    // Dispatch reply
    const sendReply = async (text: string) => {
      if (!text.trim()) return;
      await blatherFetch(apiUrl, apiKey, `/channels/${data.channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
    };

    const { dispatcher, replyOptions, markDispatchIdle } =
      core.channel.reply.createReplyDispatcherWithTyping({
        ...createReplyPrefixOptions({ cfg, agentId: route.agentId, channel: "blather", accountId: route.accountId }),
        humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
        deliver: async (payload) => {
          const text = typeof payload === "string" ? payload : (payload as any).text ?? "";
          await sendReply(text);
        },
        onError: (err, info) => log?.error(`blather: ${info.kind} reply failed: ${String(err)}`),
      });

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });
    markDispatchIdle();

    if (queuedFinal) {
      log?.info(`blather: sent ${counts.final} reply(ies)`);
    }
  }

  connect();
}

// ─── Channel Plugin ───
const meta = {
  id: "blather",
  label: "Blather",
  selectionLabel: "Blather",
  docsPath: "/channels/blather",
  docsLabel: "blather",
  blurb: "Headless-first messaging for humans and AI agents.",
  order: 80,
};

const blatherPlugin: ChannelPlugin<ResolvedBlatherAccount> = {
  id: "blather",
  meta,
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: false,
  },
  reload: { configPrefixes: ["channels.blather"] },
  config: {
    listAccountIds: (cfg) => listAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      baseUrl: account.apiUrl,
    }),
  },
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.config.dmPolicy ?? "open",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: "channels.blather.dmPolicy",
      allowFromPath: "channels.blather.allowFrom",
      approveHint: "Add sender to channels.blather.allowFrom",
    }),
  },
  messaging: {
    normalizeTarget: (raw) => {
      let n = raw.trim();
      if (n.startsWith("blather:")) n = n.slice("blather:".length);
      return n || undefined;
    },
    targetResolver: {
      looksLikeId: (raw) => raw.trim().startsWith("blather:") || /^[0-9a-f-]{36}$/.test(raw.trim()),
      hint: "<channelId>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId }) => {
      const cfg = await getRuntime().config.loadConfig();
      const account = resolveAccount(cfg, accountId);
      let targetId = to;
      if (targetId.startsWith("blather:channel:")) targetId = targetId.slice("blather:channel:".length);
      else if (targetId.startsWith("channel:")) targetId = targetId.slice("channel:".length);
      const res = await blatherFetch(account.apiUrl, account.apiKey, `/channels/${targetId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      const result = await res.json() as any;
      return { channel: "blather", messageId: result.id, channelId: result.channelId };
    },
  },
  status: {
    defaultRuntime: { accountId: DEFAULT_ACCOUNT_ID, running: false, lastStartAt: null, lastStopAt: null, lastError: null },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      baseUrl: account.apiUrl,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[${account.accountId}] starting Blather provider (${account.apiUrl})`);
      return monitorBlather({
        core: getRuntime(),
        cfg: ctx.cfg,
        abortSignal: ctx.abortSignal,
        apiUrl: account.apiUrl,
        apiKey: account.apiKey,
        workspaceId: account.workspaceId,
        channelId: account.channelId,
        accountId: account.accountId,
        log: ctx.log,
      });
    },
  },
};

// ─── Plugin entry ───
const plugin = {
  id: "blather",
  name: "Blather",
  description: "Blather channel plugin — headless-first messaging for AI agents",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    pluginRuntime = api.runtime;
    api.registerChannel({ plugin: blatherPlugin });
  },
};

export default plugin;
