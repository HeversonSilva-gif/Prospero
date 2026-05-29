import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The Claude CLI's Read tool rasterizes PDFs by shelling out to `pdftoppm`
// (Poppler). It refuses a pdftoppm found in the CWD ("unsafe location"), so the
// binary must live on a real PATH dir. We bundle Poppler (fetched at build time,
// see scripts/fetch-poppler.mjs + electron-builder extraResources) and prepend
// its bin dir to the spawned agent's PATH so PDF reads work out of the box.
//
// Returns the absolute dir containing pdftoppm(.exe), or null when not bundled
// (dev without a fetch, or a platform we don't ship Poppler for — the agent then
// falls back to whatever pdftoppm is on the host PATH, if any).

const exeName = process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm";

// Find the dir containing pdftoppm under `root` (poppler-windows nests it at
// poppler-<ver>/Library/bin; other layouts put it directly in bin/). Shallow,
// bounded scan — we only look a couple levels deep for a `bin` dir.
const findPopplerBin = (root: string): string | null => {
  if (!existsSync(root)) return null;
  const direct = join(root, exeName);
  if (existsSync(direct)) return root;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const child = join(root, entry);
    let isDir = false;
    try {
      isDir = statSync(child).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (existsSync(join(child, exeName))) return child;
    // one more level (e.g. poppler-<ver>/Library/bin)
    const binCandidates = [join(child, "bin"), join(child, "Library", "bin")];
    for (const b of binCandidates) {
      if (existsSync(join(b, exeName))) return b;
    }
  }
  return null;
};

let cached: string | null | undefined;

export const resolvePopplerBinDir = (opts?: {
  resourcesPath?: string;
  devRoot?: string;
}): string | null => {
  if (cached !== undefined) return cached;
  const roots: string[] = [];
  // Packaged: electron-builder copies resources/poppler → <resources>/poppler.
  const resourcesPath = opts?.resourcesPath ?? process.resourcesPath;
  if (typeof resourcesPath === "string" && resourcesPath !== "") {
    roots.push(join(resourcesPath, "poppler"));
  }
  // Dev: the repo's resources/poppler (populated by scripts/fetch-poppler.mjs).
  const devRoot = opts?.devRoot ?? process.cwd();
  roots.push(join(devRoot, "resources", "poppler"));

  for (const root of roots) {
    const bin = findPopplerBin(root);
    if (bin !== null) {
      cached = bin;
      return bin;
    }
  }
  cached = null;
  return null;
};

// Test seam — reset the memoized result.
export const __resetPopplerCache = (): void => {
  cached = undefined;
};
