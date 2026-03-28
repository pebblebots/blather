import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setRuntime(r: PluginRuntime) {
  runtime = r;
}

export function getRuntime(): PluginRuntime {
  if (!runtime) throw new Error("Blather plugin runtime not initialized");
  return runtime;
}
