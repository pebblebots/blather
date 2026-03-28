import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { blatherPlugin } from "./src/channel.js";
import { setRuntime } from "./src/runtime.js";

const plugin = {
  id: "blather",
  name: "Blather",
  description: "Blather channel plugin — headless-first messaging for AI agents",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setRuntime(api.runtime);
    api.registerChannel({ plugin: blatherPlugin });
  },
};

export default plugin;
