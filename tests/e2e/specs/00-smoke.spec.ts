import { test, expect } from "../fixtures/test.js";

// SKIPPED — Electron 33 + Playwright 1.60 incompatibility.
// Electron 33 rejects Playwright's auto-injected `--remote-debugging-port=0`:
//   electron.exe: bad option: --remote-debugging-port=0
// Re-enable when one side upgrades to a compatible pair (planned: track in a
// follow-up issue post-M7.5; spec §C.4 fallback policy applies).
test.describe.skip("E2E smoke (Electron 33 + Playwright 1.60 incompat)", () => {
  test("playwright + electron launches the app", async ({ app }) => {
    const win = await app.firstWindow();
    expect(win).toBeDefined();
  });
});
