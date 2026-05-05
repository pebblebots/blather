import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The openclaw plugin-sdk and ws are runtime-only dependencies used by
    // monitor.ts and api.ts. Tests in this package exercise pure helpers
    // (deliver-guard, api payload building) and do not import those modules
    // directly — keeping tests fast and free of a heavyweight install graph.
  },
});
