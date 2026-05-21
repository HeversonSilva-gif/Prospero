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
    // Bundle every JS dep into the entry so the packaged app is self-contained.
    // Only the native better-sqlite3 (electron is provided by the runtime;
    // fsevents is optional/macOS-only) stays external and is collected separately.
    external: ["electron", "better-sqlite3", "fsevents"],
    noExternal: [/^(?!(electron|better-sqlite3|fsevents)$).+/],
    // ESM output needs a real require() in scope: esbuild's __require shim and
    // the bundled CJS deps (require("fs"), etc.) throw otherwise.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    onSuccess: async () => {
      // Copy tray asset
      mkdirSync(resolve("dist/resources"), { recursive: true });
      copyFileSync(resolve("resources/tray-icon.png"), resolve("dist/resources/tray-icon.png"));
      // Copy SQL migrations to dist/migrations (where the bundled code looks for them).
      // The bundled code's __dirname resolves to dist/, so migrations must be at dist/migrations/.
      copyTreeIfExists(resolve("src/db/migrations"), resolve("dist/migrations"));
      // Copy orchestrator preamble.md to dist/ root: everything is bundled into
      // dist/index.js, so the reader's __dirname resolves to dist/ (same reason
      // migrations land in dist/migrations, not dist/db/migrations).
      copyFileSync(resolve("src/orchestrator/preamble.md"), resolve("dist/preamble.md"));
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
    external: ["electron", "fsevents"],
    noExternal: [/^(?!(electron|better-sqlite3|fsevents)$).+/],
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
    external: ["better-sqlite3", "fsevents"],
    noExternal: [/^(?!(electron|better-sqlite3|fsevents)$).+/],
    // ESM output needs a real require() in scope (see index entry above).
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  },
]);
