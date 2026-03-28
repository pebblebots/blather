import type { OpenClawPluginApi, OpenClawPluginToolFactory, AnyAgentTool } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { blatherPlugin } from "./src/channel.js";
import { setRuntime } from "./src/runtime.js";
import { createBlatherStatusTools } from "./src/status-tools.js";

const plugin = {
  id: "blather",
  name: "Blather",
  description: "Blather channel plugin — headless-first messaging for AI agents",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setRuntime(api.runtime);
    api.registerChannel({ plugin: blatherPlugin });

    // Agent-callable status tools
    const factory: OpenClawPluginToolFactory = (ctx) => createBlatherStatusTools(ctx);
    api.registerTool(factory, { names: ["bla_status_set", "bla_status_clear"] });
  },
};

export default plugin;
