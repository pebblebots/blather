/**
 * Blather ChannelPlugin definition.
 */
import { DEFAULT_ACCOUNT_ID, type ChannelPlugin } from "openclaw/plugin-sdk";
import { listAccountIds, resolveAccount, type ResolvedAccount } from "./config.js";
import { BlatherClient } from "./api.js";
import { getRuntime } from "./runtime.js";
import { startMonitor } from "./monitor.js";

const meta = {
  id: "blather",
  label: "Blather",
  selectionLabel: "Blather",
  docsPath: "/channels/blather",
  docsLabel: "blather",
  blurb: "Headless-first messaging for humans and AI agents.",
  order: 80,
};

export const blatherPlugin: ChannelPlugin<ResolvedAccount> = {
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
    resolveAccount: (cfg, id) => resolveAccount(cfg, id),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (acct) => acct.configured,
    describeAccount: (acct) => ({
      accountId: acct.accountId,
      name: acct.name,
      enabled: acct.enabled,
      configured: acct.configured,
      baseUrl: acct.apiUrl,
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
      let t = raw.trim();
      if (t.startsWith("blather:")) t = t.slice("blather:".length);
      return t || undefined;
    },
    targetResolver: {
      looksLikeId: (raw) =>
        raw.trim().startsWith("blather:") || /^[0-9a-f-]{36}$/.test(raw.trim()),
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
      const acct = resolveAccount(cfg, accountId);
      const client = new BlatherClient(acct.apiUrl, acct.apiKey);

      let targetId = to;
      if (targetId.startsWith("blather:channel:"))
        targetId = targetId.slice("blather:channel:".length);
      else if (targetId.startsWith("channel:"))
        targetId = targetId.slice("channel:".length);

      const msg = await client.sendMessage(targetId, text);
      return { channel: "blather", messageId: msg.id, channelId: msg.channelId };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
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
      const acct = ctx.account;
      ctx.log?.info(`[${acct.accountId}] starting Blather provider (${acct.apiUrl})`);
      return startMonitor({
        core: getRuntime(),
        cfg: ctx.cfg,
        abortSignal: ctx.abortSignal,
        apiUrl: acct.apiUrl,
        apiKey: acct.apiKey,
        workspaceId: acct.workspaceId,
        channelId: acct.channelId,
        accountId: acct.accountId,
        log: ctx.log,
      });
    },
  },
};
