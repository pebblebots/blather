import { DEFAULT_ACCOUNT_ID, type OpenClawConfig } from "openclaw/plugin-sdk";

export interface BlatherChannelConfig {
  enabled?: boolean;
  apiUrl?: string;
  apiKey?: string;
  workspaceId?: string;
  channelId?: string;
  dmPolicy?: string;
  allowFrom?: string[];
  accounts?: Record<string, Partial<BlatherChannelConfig>>;
}

export interface ResolvedAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
  channelId?: string;
  config: BlatherChannelConfig;
}

function getSection(cfg: OpenClawConfig): BlatherChannelConfig | undefined {
  return (cfg.channels as any)?.blather;
}

export function listAccountIds(cfg: OpenClawConfig): string[] {
  const section = getSection(cfg);
  if (!section) return [];
  const ids = [DEFAULT_ACCOUNT_ID];
  if (section.accounts) {
    for (const id of Object.keys(section.accounts)) {
      if (id !== DEFAULT_ACCOUNT_ID) ids.push(id);
    }
  }
  return ids;
}

export function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAccount {
  const section = getSection(cfg) ?? ({} as BlatherChannelConfig);
  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  const acct: any =
    id !== DEFAULT_ACCOUNT_ID ? (section.accounts?.[id] ?? {}) : section;

  const apiUrl = (acct.apiUrl ?? section.apiUrl ?? "").trim();
  const apiKey = (acct.apiKey ?? section.apiKey ?? "").trim();
  const workspaceId = (acct.workspaceId ?? section.workspaceId ?? "").trim();
  const channelId =
    (acct.channelId ?? section.channelId ?? "").trim() || undefined;

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
