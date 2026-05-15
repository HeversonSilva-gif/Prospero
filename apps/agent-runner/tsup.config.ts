import { defineConfig } from "tsup";

// Two self-contained ESM bundles for the Docker image — the runner and the
// mcp-bridge. @prospero/shared is a workspace package and zod is bundled in, so
// the container needs no node_modules at runtime.
export default defineConfig({
  entry: ["src/index.ts", "src/mcp-bridge.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: ["@prospero/shared", "zod"],
});
