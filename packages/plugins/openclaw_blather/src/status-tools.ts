/**
 * Agent-callable tools for setting/clearing Blather status.
 * Registered via api.registerTool() in the plugin entry.
 */
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import { BlatherClient } from "./api.js";

function resolveClient(ctx: OpenClawPluginToolContext): BlatherClient | null {
  const section = (ctx.config?.channels as any)?.blather;
  if (!section) return null;

  const accountId = ctx.agentAccountId;
  const acct = accountId && accountId !== "DEFAULT" && section.accounts?.[accountId]
    ? section.accounts[accountId]
    : section;

  const apiUrl = (acct.apiUrl ?? section.apiUrl ?? "").trim();
  const apiKey = (acct.apiKey ?? section.apiKey ?? "").trim();
  if (!apiUrl || !apiKey) return null;

  return new BlatherClient(apiUrl, apiKey);
}

const SetStatusSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Status text visible to other users in the sidebar." },
    autoclear: { type: "string", description: 'Auto-clear after duration, e.g. "5m", "30s", "1h".' },
    progress: { type: "number", description: "Progress bar value between 0 and 1.", minimum: 0, maximum: 1 },
    eta: { type: "string", description: 'Estimated time remaining, e.g. "2m", "30s".' },
  },
  required: ["text"],
  additionalProperties: false,
};

const ClearStatusSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export function createBlatherStatusTools(ctx: OpenClawPluginToolContext) {
  const client = resolveClient(ctx);
  if (!client) return null;

  return [
    {
      name: "bla_status_set",
      label: "Set Status",
      description:
        "Set your visible status in the Blather sidebar. Other users will see this text, an optional progress bar, and an optional ETA. Use autoclear to automatically remove the status after a duration.",
      parameters: SetStatusSchema,
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const text = params.text as string;
        const opts: Record<string, unknown> = {};
        if (params.autoclear) opts.autoclear = params.autoclear;
        if (params.progress != null) opts.progress = params.progress;
        if (params.eta) opts.eta = params.eta;

        await client.setStatus(text, Object.keys(opts).length > 0 ? opts as any : undefined);
        return {
          content: [{ type: "text" as const, text: `Status set: ${text}` }],
          details: { status: "ok" },
        };
      },
    },
    {
      name: "bla_status_clear",
      label: "Clear Status",
      description: "Clear your visible status from the Blather sidebar.",
      parameters: ClearStatusSchema,
      async execute() {
        await client.clearStatus();
        return {
          content: [{ type: "text" as const, text: "Status cleared." }],
          details: { status: "ok" },
        };
      },
    },
  ];
}
