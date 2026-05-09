// Dev helper: spawn Electron pointing at dist/index.js with RENDERER_URL env var.
// Used by tsup --onSuccess. Because tsup runs --onSuccess once per build entry (main,
// preload, mcp/server), this script uses a lockfile to ensure only ONE Electron
// instance is launched per dev session.
const { spawn } = require("node:child_process");
const { existsSync, writeFileSync, unlinkSync, readFileSync } = require("node:fs");
const path = require("node:path");
const electron = require("electron");

const lockfile = path.join(__dirname, "..", "dist", ".electron.pid");

const isProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (existsSync(lockfile)) {
  const existingPid = Number.parseInt(readFileSync(lockfile, "utf8").trim(), 10);
  if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
    // Electron is already running for this dev session — silently exit.
    process.exit(0);
  }
  // Stale lockfile — clean it up.
  try {
    unlinkSync(lockfile);
  } catch {
    /* ignore */
  }
}

const distEntry = path.join(__dirname, "..", "dist", "index.js");
const child = spawn(electron, [distEntry], {
  stdio: "inherit",
  env: { ...process.env, RENDERER_URL: "http://localhost:5173" },
});

writeFileSync(lockfile, String(child.pid), "utf8");

const cleanup = () => {
  try {
    unlinkSync(lockfile);
  } catch {
    /* ignore */
  }
};

child.on("close", (code) => {
  cleanup();
  process.exit(code ?? 0);
});

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);
