/**
 * WebSocket monitor — connects to Blather, receives message events,
 * and dispatches them through the OpenClaw reply pipeline.
 */
import WebSocket from "ws";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import { createReplyPrefixContext } from "openclaw/plugin-sdk/channel-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { BlatherClient, type BlatherUser } from "./api.js";
import {
  shouldDeliverReplyPayload,
  createPerTurnDeliveryGuard,
  extractRecoverableText,
  type DeliverReplyInfo,
  type RecoverableReplyPayload,
} from "./deliver-guard.js";
export { shouldDeliverReplyPayload, createPerTurnDeliveryGuard, extractRecoverableText };
export type { DeliverReplyInfo, RecoverableReplyPayload };

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

interface Log {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
  debug?: (m: string) => void;
}

export interface MonitorParams {
  core: PluginRuntime;
  cfg: OpenClawConfig;
  abortSignal: AbortSignal;
  apiUrl: string;
  apiKey: string;
  workspaceId?: string;
  channelId?: string;
  accountId: string;
  log?: Log;
}

export async function startMonitor(params: MonitorParams) {
  const { core, cfg, abortSignal, apiUrl, apiKey, channelId, accountId, log } =
    params;

  const client = new BlatherClient(apiUrl, apiKey);

  // Authenticate
  const self = await client.getMe();
  log?.info(`authenticated as ${self.displayName} (${self.email})`);

  // Cache members
  const members = new Map<string, BlatherUser>();
  try {
    for (const m of await client.getMembers()) members.set(m.id, m);
  } catch (e) {
    log?.warn(`failed to load members: ${e}`);
  }

  // Cache channels
  const channels = new Map<string, { name: string; channelType: string }>();
  try {
    for (const ch of await client.getChannels())
      channels.set(ch.id, { name: ch.name || ch.slug, channelType: ch.channelType });
  } catch (e) {
    log?.warn(`failed to load channels: ${e}`);
  }

  const startupMs = Date.now();
  let reconnects = 0;
  let activeWs: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connecting = false;

  // ── WebSocket connection ──────────────────────────────────────

  function connect() {
    if (abortSignal.aborted) return;
    if (connecting) {
      log?.debug?.("connect() called while already connecting — skipping");
      return;
    }

    // Clean up any existing connection
    if (activeWs) {
      try {
        activeWs.removeAllListeners();
        activeWs.close();
      } catch (_) {}
      activeWs = null;
    }

    connecting = true;
    const wsBase = apiUrl.replace(/^http/, "ws").replace(/\/api$/, "");
    const wsUrl = `${wsBase}/ws/events?api_key=${apiKey}`;

    log?.info("connecting WebSocket");
    const ws = new WebSocket(wsUrl);
    activeWs = ws;

    ws.on("open", () => {
      log?.info("WebSocket connected");
      reconnects = 0;
      connecting = false;
    });

    ws.on("message", async (raw: Buffer) => {
      try {
        const evt = JSON.parse(raw.toString());
        if (evt.type === "connected") return;
        if (evt.type === "message.created" && evt.data) {
          await handleMessage(evt.data);
        }
      } catch (e) {
        log?.warn(`event error: ${e}`);
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      connecting = false;
      // Only handle close for the current active connection
      if (ws !== activeWs && activeWs !== null) return;
      activeWs = null;
      if (abortSignal.aborted) return;
      if (code === 4008) {
        log?.info("closed by server (too many connections) — not reconnecting");
        return;
      }
      scheduleReconnect(code);
    });

    ws.on("error", (e) => {
      log?.error(`WebSocket error: ${e}`);
      // Don't call connect() directly — let the close handler deal with it
      // ws.close() will fire the close event
      try { ws.close(); } catch (_) {}
    });

    abortSignal.addEventListener("abort", () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (activeWs) { try { activeWs.removeAllListeners(); activeWs.close(); } catch (_) {} activeWs = null; }
    }, { once: true });
  }

  function scheduleReconnect(code?: number) {
    if (abortSignal.aborted) return;
    if (reconnectTimer) {
      log?.debug?.("reconnect already scheduled — skipping");
      return;
    }
    reconnects++;
    const jitter = Math.random() * 0.5 + 0.75; // 0.75–1.25x
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (reconnects - 1), RECONNECT_MAX_MS) * jitter;
    const delayMs = Math.round(delay);
    log?.warn(`disconnected${code != null ? ` (code=${code})` : ""}, retrying in ${delayMs}ms (attempt ${reconnects})`);

    if (reconnects > 10) {
      log?.error(`exceeded 10 reconnect attempts — backing off to max interval`);
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  }

  // ── Inbound handler ───────────────────────────────────────────

  async function handleMessage(data: {
    id: string;
    channelId: string;
    userId: string;
    content: string;
    threadId?: string | null;
    createdAt: string;
  }) {
    if (data.userId === self.id) return;
    // Allow configured channel OR any channel the agent is a member of
    // (huddle channels are created dynamically and won't match channelId)
    if (channelId && data.channelId !== channelId) {
      // Check if we know this channel (i.e., we're a member)
      if (!channels.has(data.channelId)) {
        // Refresh channels cache — maybe we were added to a new channel (e.g., huddle)
        try {
          for (const ch of await client.getChannels())
            channels.set(ch.id, { name: ch.name || ch.slug, channelType: ch.channelType });
        } catch (_) {}
      }
      // If still unknown, skip it
      if (!channels.has(data.channelId)) return;
      // Otherwise fall through — we're a member of this channel
    }

    const eventTs = new Date(data.createdAt).getTime();
    if (eventTs < startupMs - 5_000) return;

    let sender = members.get(data.userId);
    if (!sender) {
      // Refresh members cache on unknown user
      try {
        for (const m of await client.getMembers()) members.set(m.id, m);
        sender = members.get(data.userId);
      } catch (_) {}
    }
    const senderName = sender?.displayName ?? "Unknown";
    const senderEmail = sender?.email ?? data.userId;
    const ch = channels.get(data.channelId);
    const chName = ch?.name ?? data.channelId;
    const isDm = ch?.channelType === "dm";
    const bodyText = data.content.trim();
    if (!bodyText) return;

    log?.info(`${senderName} in ${isDm ? "DM" : `#${chName}`}: ${bodyText.slice(0, 80)}`);

    // Route
    const peerId = isDm ? `blather:${senderEmail}` : `blather:channel:${data.channelId}`;
    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "blather",
      accountId,
      peer: { kind: isDm ? "direct" : "channel", id: peerId },
    });

    // Envelope
    const from = isDm ? senderName : `#${chName}`;
    const storePath = core.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    const prevTs = core.channel.session.readSessionUpdatedAt({
      storePath,
      sessionKey: route.sessionKey,
    });
    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Blather",
      from,
      timestamp: eventTs,
      previousTimestamp: prevTs,
      envelope: core.channel.reply.resolveEnvelopeFormatOptions(cfg),
      body: `${bodyText}\n[blather msg: ${data.id} channel: ${data.channelId}]`,
    });

    // Build context
    const ctx = core.channel.reply.finalizeInboundContext({
      Body: body,
      RawBody: bodyText,
      CommandBody: bodyText,
      From: isDm ? `blather:${senderEmail}` : `blather:channel:${data.channelId}`,
      To: `blather:channel:${data.channelId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isDm ? "direct" : "group",
      ConversationLabel: from,
      SenderName: senderName,
      SenderId: data.userId,
      SenderUsername: senderEmail,
      GroupSubject: isDm ? undefined : chName,
      GroupChannel: isDm ? undefined : `#${chName}`,
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

    // Record session
    await core.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctx.SessionKey ?? route.sessionKey,
      ctx,
      updateLastRoute: isDm
        ? {
            sessionKey: route.mainSessionKey,
            channel: "blather",
            to: `blather:channel:${data.channelId}`,
            accountId: route.accountId,
          }
        : undefined,
      onRecordError: (e) => log?.warn(`session meta error: ${e}`),
    });

    // Send typing indicator with heartbeat
    client.sendTyping(data.channelId).catch(() => {});
    const typingInterval = setInterval(() => {
      client.sendTyping(data.channelId).catch(() => {});
    }, 4000);

    // Dispatch reply
    const { prefixContext, ...replyPrefix } = createReplyPrefixContext({
      cfg,
      agentId: route.agentId,
      channel: "blather",
      accountId: route.accountId,
    });
    // T#178: fresh per-turn idempotency guard. Any finals beyond the first
    // are logged and suppressed here, breaking the cascade at source.
    const perTurnGuard = createPerTurnDeliveryGuard();
    const { dispatcher, replyOptions, markDispatchIdle } =
      core.channel.reply.createReplyDispatcherWithTyping({
        ...replyPrefix,
        responsePrefixContext: prefixContext,
        humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
        deliver: async (payload, info) => {
          // T#147 + T#171 + T#178: filter reasoning / compaction /
          // intermediate block-reply payloads before they reach Blather,
          // and suppress any duplicate finals from a single model turn.
          //
          // The core dispatcher fires `deliver` once per assistant-text
          // segment with `info.kind in {tool, block, final}`; only
          // `final` is the real reply. Blather is non-streaming, so
          // blocks would leak as narration-prose (T#171).
          //
          // T#178 additionally guards against the upstream dispatcher
          // emitting MORE THAN ONE `final` per turn, which manifests as
          // duplicate chat messages and feeds the O(N²) cross-agent
          // cascade. The per-turn guard approves the first final and
          // logs-and-suppresses any extras.
          const decision = perTurnGuard.check(payload, info);
          if (!decision.deliver) {
            if (decision.reason === "duplicate_final") {
              log?.warn?.(
                `[t178-cascade-guard] suppressed duplicate final #${
                  "suppressedIndex" in decision ? decision.suppressedIndex : "?"
                } for channel=${data.channelId}`,
              );
            } else {
              log?.debug?.(`deliver skipped: ${decision.reason}`);
            }
            return;
          }
          await client.sendMessage(data.channelId, decision.text);
        },
        onError: (err, info) => log?.error(`${info.kind} reply failed: ${err}`),
      });

    // T#178 drop-recovery: intercept `getReplyFromConfig` via the
    // `replyResolver` parameter so we can capture the model's reply
    // payloads as a side effect. If the dispatcher returns
    // `queuedFinal: false` we can still deliver the captured text
    // manually. This is additive and doesn't change the dispatcher's
    // own decision-making — we just get a parallel handle on the data.
    let capturedReplyResult:
      | RecoverableReplyPayload
      | RecoverableReplyPayload[]
      | undefined;
    const replyResolver = async (
      resolverCtx: unknown,
      resolverOpts?: unknown,
      resolverConfigOverride?: unknown,
    ) => {
      // Lazily import the default resolver so the plugin doesn't pay
      // the cost on every inbound. Openclaw caches the module after
      // first load. Dynamic import keeps the plugin's own import graph
      // clean (the plugin-sdk doesn't re-export getReplyFromConfig).
      const mod = (await import("openclaw")) as typeof import("openclaw");
      const result = await (mod as any).getReplyFromConfig(
        resolverCtx,
        resolverOpts,
        resolverConfigOverride,
      );
      capturedReplyResult = result;
      return result;
    };

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx,
      cfg,
      dispatcher,
      replyOptions,
      replyResolver: replyResolver as any,
    });
    markDispatchIdle();
    clearInterval(typingInterval);

    // T#178 observability + drop-recovery.
    const approved = perTurnGuard.approvedFinalCount();
    const suppressed = perTurnGuard.suppressedFinalCount();
    if (queuedFinal) {
      log?.info(
        `sent ${approved} reply(ies)` +
          (suppressed > 0 ? ` [t178: suppressed ${suppressed} duplicate final(s)]` : "") +
          (approved !== counts.final
            ? ` [t178: dispatcher counts.final=${counts.final} approved=${approved}]`
            : ""),
      );
    } else if (approved === 0) {
      // Dispatcher completed without queuing a final AND the per-turn
      // guard didn't approve anything either. Three sub-cases:
      //   1. Agent deliberately chose silence (NO_REPLY / HEARTBEAT_OK)
      //   2. Agent produced text but dispatcher dropped it (T#178 bug)
      //   3. Agent produced nothing (legitimate abort / compaction-only)
      // extractRecoverableText returns null for (1) and (3); a non-null
      // string for (2) is our recovery case.
      const recoveredText = extractRecoverableText(capturedReplyResult);
      if (recoveredText) {
        try {
          await client.sendMessage(data.channelId, recoveredText);
          log?.warn(
            `[t178-drop-recovery] recovered final text (len=${recoveredText.length}) ` +
              `after dispatcher returned queuedFinal=false`,
          );
        } catch (err) {
          log?.error(
            `[t178-drop-recovery] failed to post recovered text: ${err}`,
          );
        }
      } else {
        log?.debug?.(
          `[t178-drop-check] no final queued (counts.tool=${counts.tool ?? 0} ` +
            `counts.block=${counts.block ?? 0}) and no recoverable text`,
        );
      }
    }
  }

  connect();

  // Keep the promise alive so the plugin framework doesn't think we exited.
  // Resolves only when the abort signal fires (i.e. the framework stops us).
  return new Promise<void>(resolve => {
    abortSignal.addEventListener("abort", resolve, { once: true });
  });
}
