import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { blatherPlugin } from "./src/channel.js";
import { setRuntime } from "./src/runtime.js";
import { createBlatherStatusTools } from "./src/status-tools.js";
import { recordModeEToolCall } from "./src/mode-e-audit.js";

const plugin = {
  id: "blather",
  name: "Blather",
  description: "Blather channel plugin — headless-first messaging for AI agents",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setRuntime(api.runtime);
    api.registerChannel({ plugin: blatherPlugin });

    // T#192: record host-authoritative tool invocation evidence. The monitor
    // later compares it to a final reply's *present-tense* tool-work claim;
    // this remains audit-only until production data proves a safe guard.
    api.on("before_tool_call", (_event, ctx) => {
      recordModeEToolCall(ctx.sessionKey);
    });

    // Agent-callable status tools
    api.registerTool(createBlatherStatusTools, { names: ["bla_status_set", "bla_status_clear"] });
  },
};

export default plugin;
