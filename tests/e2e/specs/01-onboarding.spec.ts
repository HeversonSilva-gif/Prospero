import { test, expect } from "../fixtures/test.js";
import { seedDb, dbPathOf } from "../helpers/seed.js";

// SKIPPED — see tests/e2e/README.md (Electron 33 + Playwright 1.60 incompat).
// The scenario body is fully written so unskipping is a one-line change once
// the upstream incompatibility is resolved.
test.describe.skip("01 — onboarding", () => {
  test("token detected, company seeded, dashboard renders", async ({ app, userDataDir }) => {
    seedDb(dbPathOf(userDataDir), {
      companyId: "co_e2e_1",
      companyName: "E2E Co",
      withCeo: true,
    });

    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const ceoLink = win.locator('a[href*="/agents/agent_e2e_ceo"]');
    await expect(ceoLink).toBeVisible({ timeout: 10_000 });

    const statusDot = ceoLink.locator('span[title="idle"]');
    await expect(statusDot).toBeVisible();
  });
});
