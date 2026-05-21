// Build guard: assert the three critical tsup outputs exist after a build.
// A missing preload.cjs ships a packaged app whose renderer has no
// window.prospero bridge — i.e. a white screen on launch. This caught a
// non-deterministic tsup clean race (2026-05-21) and fails the build loudly
// instead of letting a broken installer through.
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const required = ["dist/index.js", "dist/ipc/preload.cjs", "dist/mcp/server.cjs"];
const missing = required.filter((p) => !existsSync(resolve(p)));

if (missing.length > 0) {
  console.error(`[check-dist] FAIL — missing build outputs: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("[check-dist] OK — index.js, ipc/preload.cjs, mcp/server.cjs all present");
