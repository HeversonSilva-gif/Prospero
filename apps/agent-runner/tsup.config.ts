import { defineConfig } from "tsup";

// One self-contained ESM bundle for the Docker image. @dashboard-agent/shared
// is a workspace package and zod is bundled in, so the container needs no
// node_modules at runtime.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: ["@dashboard-agent/shared", "zod"],
});
