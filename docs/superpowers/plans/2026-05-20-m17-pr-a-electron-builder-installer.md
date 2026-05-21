# M17 PR-A — electron-builder config + first local Windows installer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate `release/Prospero-Setup-0.1.0.exe` locally via `pnpm dist:win`. Manual smoke confirms the installer installs, the app launches, the renderer loads, SQLite works, and migrations run.

**Architecture:** Add electron-builder to the workspace root with an `electron-builder.yml` config. Root `package.json` becomes the Electron app entry (`main` → `apps/main/dist/index.js`). better-sqlite3's native binary is forced out of `app.asar` via `asarUnpack`. No publish target yet (that is PR-B). No CI yet (that is PR-B). No updater yet (that is PR-C).

**Tech Stack:** electron-builder 25 (latest stable as of 2026-05), NSIS one-click installer, Windows x64 only, asar packaging with selective unpack for native deps.

**Spec:** `docs/superpowers/specs/2026-05-20-m17-distribution-design.md` §4 PR-A. **Open issues this PR resolves (spec §9):** better-sqlite3 + asarUnpack; `__dirname` in packaged main; renderer path resolution from packaged main.

**Pre-conditions:**
- Working tree clean on `main`.
- `pnpm install` clean (`node_modules` populated).
- `pnpm build` succeeds (`apps/main/dist/` + `apps/renderer/dist/` exist).
- Windows 11 host with Node 20+ and pnpm 9+ (the spec target).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `package.json` (root) | Modify | Bump version 0.0.0→0.1.0; add `main` field; add `electron-builder` devDep; add `dist:win` script. |
| `electron-builder.yml` (root) | Create | Full packaging config: appId, productName, files glob, asarUnpack for native, NSIS one-click target. |
| `.gitignore` | Modify | Add `release/` so the build output never gets committed. |
| `.npmrc` | Create (conditional) | Only if the default pnpm symlink layout breaks the packaged build — `public-hoist-pattern[]=better-sqlite3` to flatten just that dep. |

No test files are produced — packaging changes are validated by running the build and smoke-testing the installer, which is documented in the manual-smoke steps below. No TDD; this PR is config + verification, not logic.

---

## Task 1: Bump root version and register electron-builder

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Read the current root `package.json`**

Run: `cat package.json`
Confirm `"version": "0.0.0"` and that `"main"` is not set.

- [ ] **Step 2: Apply three changes in one edit**

Edit `package.json`:
1. Set `"version": "0.1.0"`.
2. Add `"main": "apps/main/dist/index.js"` immediately after `"private": true,`.
3. Add `"electron-builder": "^25.1.8"` to `devDependencies` (alphabetical position is fine — after `eslint-plugin-react-hooks`).
4. Add a new script `"dist:win": "pnpm -r run build && electron-builder --win --x64"` to `scripts`, immediately after the existing `"build"` script.

Resulting fragments:

```json
{
  "name": "prospero",
  "version": "0.1.0",
  "private": true,
  "main": "apps/main/dist/index.js",
  ...
  "scripts": {
    ...
    "build": "pnpm -r run build",
    "dist:win": "pnpm -r run build && electron-builder --win --x64",
    ...
  },
  "devDependencies": {
    ...
    "electron-builder": "^25.1.8",
    ...
  }
}
```

- [ ] **Step 3: Install the new devDep**

Run: `pnpm install`
Expected: pnpm resolves and installs electron-builder + transitive deps. No errors. `pnpm-lock.yaml` updated.

- [ ] **Step 4: Verify the binary exists**

Run: `pnpm exec electron-builder --version`
Expected: prints `25.x.y` (any 25.x).

- [ ] **Step 5: Verify nothing broke**

Run: `pnpm -r --parallel run typecheck && pnpm -r --parallel run lint && pnpm test`
Expected: all 4 packages typecheck/lint clean; 1747+ tests pass. (No source code changed — this is just a guard.)

- [ ] **Step 6: Do NOT commit yet.** The version bump + `main` field are observable in the next task's config; commit at the end of Task 2.

---

## Task 2: Write the `electron-builder.yml` config

**Files:**
- Create: `electron-builder.yml` (root)

- [ ] **Step 1: Create the config file with the full content below**

```yaml
appId: com.prospero.app
productName: Prospero
copyright: Copyright © 2026 Heverson Silva

directories:
  output: release
  buildResources: build

# Single-package monorepo: root package.json is the app manifest.
# tsup outputs are in apps/main/dist and apps/renderer/dist.
asar: true

# better-sqlite3 ships a .node native binary that cannot be require()'d from
# inside an asar archive — Electron's asar shim only patches fs reads, not
# native module loading. We unpack it (and any other native dep) to
# app.asar.unpacked/, which is on disk next to app.asar.
asarUnpack:
  - "**/node_modules/better-sqlite3/**/*"
  - "**/node_modules/bindings/**/*"
  - "**/node_modules/file-uri-to-path/**/*"

files:
  # Compiled main process + preload + MCP server (tsup output)
  - "apps/main/dist/**/*"
  - "apps/main/package.json"
  # Compiled renderer bundle (vite output)
  - "apps/renderer/dist/**/*"
  - "apps/renderer/package.json"
  # Shared package source (consumed via "exports" → src/index.ts, no build step)
  - "packages/shared/**/*"
  # Root manifest is needed for productName + version + main
  - "package.json"
  # Exclude TS sources, sourcemaps, tests, dev-only files everywhere
  - "!**/*.{ts,tsx,map}"
  - "!**/{tsconfig,tsconfig.*,vite.config,vitest.config,tsup.config,postcss.config,tailwind.config}.*"
  - "!**/{__tests__,tests,test,__snapshots__}/**"
  - "!**/*.test.*"
  - "!**/.eslintrc*"

# Only Windows x64 for v1 (spec §2). Mac/Linux deferred to M18.
win:
  target:
    - target: nsis
      arch:
        - x64
  artifactName: "${productName}-Setup-${version}.${ext}"

nsis:
  oneClick: true
  perMachine: false
  allowToChangeInstallationDirectory: false
  deleteAppDataOnUninstall: false
  shortcutName: Prospero
  artifactName: "${productName}-Setup-${version}.${ext}"

# No publish block here — that's PR-B. Without it, electron-builder writes
# the installer to ./release/ but does not upload anywhere.
```

- [ ] **Step 2: Validate the YAML is parseable**

Run: `pnpm exec electron-builder --help` (this also loads the config indirectly via the builder CLI to confirm no fatal errors before a real build).
Expected: usage output, no parse error from `electron-builder.yml`.

If a YAML parse error fires, re-read the file and fix indentation (YAML is strict — every nested key uses 2-space indent).

---

## Task 3: Ignore the build output

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Read the current `.gitignore`**

Run: `cat .gitignore`
Confirm `release/` is not already listed.

- [ ] **Step 2: Append the ignore rule**

Append to `.gitignore`:

```
# electron-builder output
release/
```

- [ ] **Step 3: Confirm git agrees**

Run: `git check-ignore -v release/anything.exe`
Expected: prints a line ending in `release/` confirming the rule matches.

- [ ] **Step 4: Commit the config scaffolding**

```bash
git add package.json pnpm-lock.yaml electron-builder.yml .gitignore
git commit -m "build(m17): add electron-builder config and dist:win script"
```

Expected: pre-commit (prettier + eslint + gitleaks) passes. Commit lands on `main`.

---

## Task 4: Produce the first installer locally

**Files:** (none modified — this task only runs the build and observes)

- [ ] **Step 1: Clean previous outputs**

Run: `rm -rf apps/main/dist apps/renderer/dist release`
Expected: no error; the directories are removed.

- [ ] **Step 2: Rebuild native deps for the current Electron**

Run: `pnpm rebuild:native`
Expected: `electron-rebuild` rebuilds `better-sqlite3` against Electron 33's ABI. Prints something like "✔ Rebuild Complete".

- [ ] **Step 3: Run the packaging command**

Run: `pnpm dist:win` (this also runs `pnpm -r run build` first via the script). This step takes 2-5 minutes on first run because electron-builder downloads the Electron distribution for Windows x64.

Expected end state:
- `release/Prospero-Setup-0.1.0.exe` exists (size ~80-120 MB).
- `release/win-unpacked/` exists (the staged app tree before installer packaging).
- `release/builder-debug.yml` and `release/builder-effective-config.yaml` may also be present.

- [ ] **Step 4: Confirm the installer file exists**

Run: `ls release/`
Expected output includes `Prospero-Setup-0.1.0.exe`.

If the build fails, see the **Troubleshooting** section below before proceeding.

---

## Task 5: Manual smoke test the installer

This is the only test that proves PR-A worked. Skipping invalidates the PR.

- [ ] **Step 1: Run the installer**

Double-click `release/Prospero-Setup-0.1.0.exe` (or run from a regular cmd: `.\release\Prospero-Setup-0.1.0.exe`).

Expected:
- Windows SmartScreen warning appears (because there is no code signing — spec §2). Click "Mais informações" → "Executar mesmo assim" / "More info" → "Run anyway".
- NSIS installer runs silently (oneClick mode — no UI prompts).
- App launches automatically when install finishes.
- Install location: `%LOCALAPPDATA%\Programs\Prospero\` (perMachine: false).
- Shortcut created in Start Menu under "Prospero".

- [ ] **Step 2: Verify the app starts**

Expected:
- Main window opens, Prospero renderer loads (the same setup wizard / home screen you see in `pnpm dev`).
- No DevTools red-screen crash.
- Title bar shows "Prospero".

- [ ] **Step 3: Verify SQLite + migrations work**

In the running app, do anything that hits the DB (e.g., create a company in the setup wizard, or open Ajustes — any screen that reads from SQLite).

Expected:
- No "failed to load better-sqlite3" / "cannot find module" crash. If you see one, the asar unpack didn't include the native binary — re-read **Troubleshooting → better-sqlite3** below.
- Data persists across restart: close app, reopen from Start Menu, see the company/setting you created.

- [ ] **Step 4: Verify the renderer assets resolve**

Expected:
- No "white screen of death" (would indicate `loadFile` couldn't find `apps/renderer/dist/index.html`).
- No 404s in DevTools network tab when you open it (Ctrl+Shift+I).
- Static assets (fonts, CSS) load.

- [ ] **Step 5: Verify migrations and runtime resources resolve**

Expected:
- No "ENOENT: migrations directory not found" — tsup copies migrations to `dist/migrations/` and `app.asar` reads through asar's fs shim.
- No "ENOENT: preamble.md" — same story.
- No "ENOENT: tray-icon.png" — same story.

- [ ] **Step 6: Uninstall to leave the system clean**

Run from cmd: `& "$env:LOCALAPPDATA\Programs\Prospero\Uninstall Prospero.exe"` (PowerShell) or run "Uninstall" from Windows Settings → Apps.

Expected:
- Uninstaller runs silently.
- App is removed from `%LOCALAPPDATA%\Programs\Prospero\`.
- User data at `%APPDATA%\Prospero\` survives (deleteAppDataOnUninstall: false — spec leaves user data intact across reinstalls).

- [ ] **Step 7: Document the smoke result**

If everything above worked, proceed to Task 6 (commit verification). If anything failed, return to **Troubleshooting** below and resolve before continuing. Do not declare PR-A done on a failed smoke.

---

## Task 6: Final commit + close-out

- [ ] **Step 1: Confirm working tree is clean except for `release/`**

Run: `git status`
Expected: `release/` (or nothing — it should be ignored). No source files modified by the build.

If anything else changed (e.g., `pnpm-lock.yaml` got re-written), include it in a follow-up commit:

```bash
git add pnpm-lock.yaml
git commit -m "build(m17): refresh lockfile after electron-builder install"
```

- [ ] **Step 2: Run full verification one more time**

Run: `pnpm -r --parallel run typecheck && pnpm -r --parallel run lint && pnpm test`
Expected: 4 packages clean, 1747+ tests pass.

- [ ] **Step 3: Push to origin**

Run: `git push origin main`
Expected: push succeeds. (Working in `main` directly is the established pattern — see handoff memory.)

- [ ] **Step 4: Update memory with lessons**

Save a `project_m17_pr_a_lessons.md` memory entry (see superpowers `auto memory` rules) capturing:
- Final commit SHA.
- Any troubleshooting fix that was actually needed (especially around pnpm + better-sqlite3 + asarUnpack).
- The final size of `Prospero-Setup-0.1.0.exe`.
- Whether the `.npmrc` escape hatch was needed.

Add a one-liner to `MEMORY.md` index pointing at the new file.

---

## Troubleshooting

These are the failure modes the spec §9 flagged. Apply only the ones that actually fire.

### A. `better-sqlite3` fails to load in the installed app

Symptom: app crashes on first DB call with `Cannot find module 'better_sqlite3.node'` or `bindings: Could not find …`.

Cause: pnpm's default symlink layout (`node_modules/.pnpm/better-sqlite3@…/node_modules/better-sqlite3/`) confuses electron-builder when it walks `node_modules` for the `files` glob — the unpack may copy the symlink target but miss the prebuilt `.node` binary.

Fix (try in order):

1. **Confirm the binary is in the unpacked tree:**
   ```powershell
   Get-ChildItem -Recurse "release\win-unpacked\resources\app.asar.unpacked\node_modules\better-sqlite3" -Filter *.node
   ```
   If empty, the unpack glob missed it.

2. **Create `.npmrc` at repo root to public-hoist just better-sqlite3:**

   ```ini
   public-hoist-pattern[]=better-sqlite3
   public-hoist-pattern[]=bindings
   public-hoist-pattern[]=file-uri-to-path
   ```

   Then: `rm -rf node_modules pnpm-lock.yaml && pnpm install && pnpm rebuild:native && pnpm dist:win`.

   This makes pnpm symlink those three packages into the top-level `node_modules/` (still using the .pnpm store underneath), which electron-builder handles correctly.

3. If hoisting alone doesn't fix it, escalate to `node-linker=hoisted` in `.npmrc` (flattens the whole tree, slower install, but the most compatible layout).

### B. `__dirname` resolution breaks for migrations or preamble.md

Symptom: app starts but crashes on first DB open with `ENOENT: no such file or directory, scandir '…/dist/migrations'`.

Cause: when packaged, `apps/main/dist/index.js` lives at `app.asar/apps/main/dist/index.js`. `__dirname` resolves to `app.asar/apps/main/dist`. Electron's asar fs shim should make `readdirSync('app.asar/apps/main/dist/migrations')` work — but only if the migrations files are actually inside the asar. Check that `apps/main/dist/migrations/*.sql` are present in `release/win-unpacked/resources/app.asar` (extract with `pnpm exec asar list resources/app.asar | findstr migrations`).

Fix: confirm tsup ran (the `onSuccess` copy step in `tsup.config.ts:48`). If `apps/main/dist/migrations/` is empty on disk before `electron-builder` runs, the asar will be empty too. Rerun `pnpm --filter @prospero/main run build` and re-check.

### C. Renderer shows blank white window after install

Symptom: app window opens, stays black/white, DevTools shows `Failed to load … index.html`.

Cause: `main-window.ts:28` resolves the renderer with `resolve(__dirname, "../../renderer/dist/index.html")`. From `app.asar/apps/main/dist/`, going up two levels lands at `app.asar/apps/renderer/dist/index.html`. That path exists if the `files` glob in `electron-builder.yml` includes `apps/renderer/dist/**/*` (it does in this plan).

Fix: extract the asar and confirm `apps/renderer/dist/index.html` is present:
```powershell
pnpm exec asar list release\win-unpacked\resources\app.asar | Select-String "renderer/dist/index.html"
```
If absent, your `files` glob is wrong — re-read Task 2's config.

### D. `pnpm dist:win` fails with "main field missing"

Symptom: electron-builder errors out with `Application entry file "apps/main/dist/index.js" in the … does not exist`.

Cause: either you forgot to bump `main` in root `package.json` (Task 1 Step 2), or `pnpm -r run build` didn't run before electron-builder (the script ordering matters).

Fix: verify `apps/main/dist/index.js` exists on disk. If not, run `pnpm --filter @prospero/main run build` manually. If yes, verify `package.json` has `"main": "apps/main/dist/index.js"`.

### E. SmartScreen blocks the .exe entirely (no "Run anyway" option)

Symptom: Windows blocks the installer with no override path.

Cause: depends on Windows version and SmartScreen policy. Some corp-managed Windows installs hide the "More info" link.

Fix: this is expected behavior for unsigned binaries (spec §7 acknowledges). For developer smoke, right-click the .exe → Properties → "Unblock" checkbox at bottom → OK, then double-click again. For real users in PR-E, this becomes a documented limitation (`docs/auto-update.md`).

---

## Out of scope (deferred to later PRs)

- Publishing to GitHub Releases — **PR-B**.
- CI workflow that triggers on tag push — **PR-B**.
- electron-updater integration in the main process — **PR-C**.
- UI banner + Ajustes section — **PR-D**.
- `docs/release.md` + `docs/auto-update.md` + SECURITY.md section + first real release tag — **PR-E**.
- Mac (.dmg) / Linux (.AppImage) targets — **M18**.
- Code signing — **M18**.

---

## Self-review notes (for the implementer)

Before declaring PR-A complete, walk through this checklist:

1. **Spec §4 PR-A coverage:** Tasks 1-3 modify `package.json`, create `electron-builder.yml`, and update `.gitignore` — matches the spec file list. Tasks 4-5 produce and validate the installer — matches "Saída".
2. **Open issues §9:** better-sqlite3 + asarUnpack → addressed by config + Troubleshooting A. `__dirname` → addressed by Troubleshooting B (resolved by Task 5 smoke). userData paths → out of scope for PR-A (documented in PR-E user docs). electron-updater + dev mode → not relevant to PR-A.
3. **Frequent commits:** Task 3 commits config; Task 6 may add a lockfile-refresh commit. The build output is gitignored.
4. **No placeholders:** every step has the actual command, the expected output, and the next action. Troubleshooting sections include the actual fix commands, not "investigate the issue".
5. **Manual smoke is required:** packaging changes have no automated test surface. The smoke test in Task 5 is the verification.
