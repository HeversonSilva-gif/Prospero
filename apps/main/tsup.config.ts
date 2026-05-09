import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

const copyTreeIfExists = (srcDir: string, destDir: string): void => {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      copyFileSync(join(srcDir, entry.name), join(destDir, entry.name));
    }
  }
};

// In watch mode (pnpm dev), launch the dev electron helper after copying assets.
// In one-shot mode (pnpm build), skip — the helper is dev-only.
const isWatch = process.argv.includes("--watch");

const launchDevElectron = (): void => {
  if (!isWatch) return;
  spawn(process.execPath, [resolve("scripts/dev.cjs")], {
    stdio: "inherit",
    detached: false,
  });
};

// Two builds:
//   1. Main process — ESM (apps/main has "type": "module")
//   2. Preload — CJS, because Electron with sandbox:true requires CommonJS preload scripts
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    clean: true,
    external: ["electron", "better-sqlite3"],
    noExternal: ["@dashboard-agent/shared"],
    onSuccess: async () => {
      // Copy tray asset
      mkdirSync(resolve("dist/resources"), { recursive: true });
      copyFileSync(resolve("resources/tray-icon.png"), resolve("dist/resources/tray-icon.png"));
      // Copy SQL migrations to dist/migrations (where the bundled code looks for them).
      // The bundled code's __dirname resolves to dist/, so migrations must be at dist/migrations/.
      copyTreeIfExists(resolve("src/db/migrations"), resolve("dist/migrations"));
      // Launch electron in watch mode (dev.cjs is idempotent — uses lockfile to prevent multiple).
      launchDevElectron();
    },
  },
  {
    entry: { "ipc/preload": "src/ipc/preload.ts" },
    format: ["cjs"],
    target: "node20",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    clean: false, // first config already cleaned the dist dir
    external: ["electron"],
    noExternal: ["@dashboard-agent/shared"],
    outExtension: () => ({ js: ".cjs" }),
  },
  {
    entry: { "mcp/server": "src/mcp/server.ts" },
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    clean: false,
    external: ["better-sqlite3"],
    noExternal: ["@dashboard-agent/shared", "@modelcontextprotocol/sdk"],
  },
]);
