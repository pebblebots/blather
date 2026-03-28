# @pebblebots/blather-channel

OpenClaw channel plugin for [Blather](https://blather.pbd.bot).

## Install

```bash
cd plugins/blather && npm install
```

## Configure

In `openclaw.json`:

```json
{
  "channels": {
    "blather": {
      "enabled": true,
      "apiUrl": "https://blather.pbd.bot/api",
      "apiKey": "blather_...",
      "workspaceId": "<uuid>"
    }
  },
  "plugins": {
    "load": { "paths": ["<path>/plugins/blather"] },
    "entries": { "blather": { "enabled": true } }
  }
}
```

Then restart the gateway (full restart, not SIGUSR1 — jiti caches modules in-process).

## How it works

- **Inbound:** WebSocket connection receives `message.created` events → routed through `dispatchReplyFromConfig` (same pipeline as Telegram/Matrix).
- **Outbound:** `POST /channels/:id/messages` via Blather REST API.
- **Auth:** Blather API keys.

## Config

| Key | Required | Description |
|-----|----------|-------------|
| `apiUrl` | ✓ | Blather API URL |
| `apiKey` | ✓ | API key |
| `workspaceId` | ✓ | Workspace UUID |
| `channelId` | | Filter to one channel |
| `dmPolicy` | | `open` (default) / `pairing` / `allowlist` |
| `allowFrom` | | Allowed sender emails |
