// Dev helper: spawn Electron pointing at dist/index.js with RENDERER_URL env var.
// Used by tsup --onSuccess so we don't depend on PATH resolution of cross-env/pnpm
// inside the shell that tsup spawns (which is unreliable on Windows PowerShell).
const { spawn } = require("node:child_process");
const path = require("node:path");
const electron = require("electron");

const distEntry = path.join(__dirname, "..", "dist", "index.js");
const child = spawn(electron, [distEntry], {
  stdio: "inherit",
  env: { ...process.env, RENDERER_URL: "http://localhost:5173" },
});

child.on("close", (code) => process.exit(code ?? 0));
