import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/ipc/preload.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["electron", "better-sqlite3"],
});
