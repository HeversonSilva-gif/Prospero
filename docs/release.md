# Release runbook — cutting a Prospero release (M17)

How to ship a new version. Releases are driven by **git tags**: pushing a
`v*` tag triggers the CI workflow (`.github/workflows/release.yml`) which
builds the Windows installer and publishes it to GitHub Releases, where
`electron-updater` clients pick it up.

## Prerequisites

- All intended work is merged into `main` and pushed to `origin`.
- `pnpm typecheck && pnpm lint && pnpm test` are green.
- A local smoke of `pnpm dist:win` installs and runs (catches packaging
  regressions before burning a tag).

## Steps

1. **Bump the version** in the root `package.json` (`"version"`). Follow the
   versioning policy: patch (`0.0.x`) for fixes, minor (`0.x.0`) for features.
   The installer name and `electron-updater` compare against this value.

   ```bash
   # edit package.json "version" -> e.g. 0.1.1
   git add package.json
   git commit -m "build: release v0.1.1"
   git push origin main
   ```

2. **Tag and push the tag** (this is what triggers CI):

   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. **Watch CI** in the repo's Actions tab. The `Release` workflow runs on
   `windows-latest`: install → build → rebuild native deps for Electron →
   `electron-builder --publish always`.

4. **Verify the GitHub Release.** When CI finishes, the release for the tag
   should have, attached:
   - `Prospero-Setup-<version>.exe` (the NSIS installer)
   - `latest.yml` (the manifest electron-updater polls — required for
     auto-update to work)
   - blockmap files (for delta updates)

5. **Smoke the released artifact.** Download the `.exe` from the release,
   install, open, confirm it runs.

6. **Announce** (changelog / users).

## Verifying auto-update end-to-end (first time)

After a baseline version is installed from a release:

1. Make a trivial change, bump the version (e.g. `0.1.1` → `0.1.2`), tag,
   push the tag.
2. With the old version running, it should (within the launch check window)
   download the new version in the background and show the update banner
   ("Restart to update").
3. Restart and confirm the version updated.

## Rollback

There is no in-app rollback in v1. To roll back: uninstall, then download and
install an earlier `Prospero-Setup-<version>.exe` from the GitHub Releases
list. The next launch of the older build will re-check and offer to update
forward again.

## Notes / gotchas

- **Tags only on releases.** Never push intermediate tags. CI runs on every
  `v*` tag.
- **No code signing in v1** — Windows SmartScreen will warn on first run
  ("More info" → "Run anyway"). Code signing is a future hardening item.
- **electron-updater does not run in dev** (no installed app / `latest.yml`).
  The check is gated on `app.isPackaged`.
- **First release is always a full download**; deltas kick in from the next
  version (electron-builder generates NSIS deltas by default).
