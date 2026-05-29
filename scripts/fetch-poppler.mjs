// Fetches the Windows Poppler build (provides pdftoppm.exe) into resources/poppler
// so electron-builder can bundle it (see electron-builder.yml extraResources) and
// the spawned agent's claude Read tool can rasterize PDFs. Runs in dist:win + CI
// before electron-builder. Idempotent: skips when pdftoppm.exe is already present.
//
// Poppler is invoked as a separate subprocess (not linked), so bundling these
// binaries is mere aggregation — fine for a non-GPL app, like bundling ffmpeg.
//
// Windows-only for now: on macOS/Linux the agent falls back to a host pdftoppm
// (resolvePopplerBinDir returns null when nothing is bundled). Bundling Poppler
// for those targets is a follow-up.

import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const POPPLER_VERSION = "24.08.0-0";
const ZIP_URL = `https://github.com/oschwartz10612/poppler-windows/releases/download/v${POPPLER_VERSION}/Release-${POPPLER_VERSION}.zip`;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(repoRoot, "resources", "poppler");

const log = (m) => console.log(`[fetch-poppler] ${m}`);

// Always ensure the dir exists so electron-builder's extraResources `from`
// resolves on every platform (it's just empty on macOS/Linux for now).
mkdirSync(destDir, { recursive: true });

if (process.platform !== "win32") {
  log(`platform=${process.platform} — skipping download (Windows-only bundle for now).`);
  process.exit(0);
}

// Idempotent: bail if a pdftoppm.exe already exists somewhere under destDir.
const alreadyPresent = () => {
  if (!existsSync(destDir)) return false;
  try {
    const out = execFileSync("where", ["/R", destDir, "pdftoppm.exe"], { encoding: "utf8" });
    return out.trim().length > 0;
  } catch {
    return false;
  }
};

if (alreadyPresent()) {
  log("pdftoppm.exe already present — skipping download.");
  process.exit(0);
}

const download = (url, file) =>
  new Promise((resolve, reject) => {
    const get = (u, redirects) => {
      if (redirects > 5) return reject(new Error("too many redirects"));
      https
        .get(u, (res) => {
          if (
            res.statusCode !== undefined &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            return get(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          }
          const out = createWriteStream(file);
          res.pipe(out);
          out.on("finish", () => out.close(() => resolve()));
          out.on("error", reject);
        })
        .on("error", reject);
    };
    get(url, 0);
  });

const main = async () => {
  mkdirSync(destDir, { recursive: true });
  const zipPath = join(destDir, "poppler.zip");
  log(`downloading ${ZIP_URL}`);
  await download(ZIP_URL, zipPath);
  log("extracting…");
  // PowerShell ships with every Windows build; avoids an extra unzip dependency.
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ],
    { stdio: "inherit" },
  );
  rmSync(zipPath, { force: true });
  if (!alreadyPresent()) {
    throw new Error("pdftoppm.exe not found after extraction — layout changed?");
  }
  log(`done → ${destDir}`);
};

main().catch((err) => {
  console.error(`[fetch-poppler] FAILED: ${err.message}`);
  process.exit(1);
});
