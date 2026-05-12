import { test, expect } from "../fixtures/test.js";
import { seedDb, dbPathOf } from "../helpers/seed.js";

// SKIPPED — see tests/e2e/README.md (Electron 33 + Playwright 1.60 incompat).
// Note when unskipping: hire_agent runs through the real MCP path, so the
// fake-claude stub needs to actually invoke the MCP tool — currently it only
// emits a synthetic tool_use + tool_result pair. If that turns out not to
// drive the real side effect, seed the second agent directly in the DB via
// seedDb() and assert on roster broadcast only.
test.describe.skip("02 — hire and message", () => {
  test("CEO hires Alex via MCP, roster grows to 2", async ({ app, userDataDir }) => {
    seedDb(dbPathOf(userDataDir), { withCeo: true });

    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await win.locator('a[href*="/agents/agent_e2e_ceo"]').click();

    const input = win.locator('textarea, input[type="text"]').first();
    await input.fill("Hire a backend engineer named Alex");
    await win.keyboard.press("Enter");

    const alexLink = win.locator('a[href*="/agents/"]:has-text("Alex")');
    await expect(alexLink).toBeVisible({ timeout: 15_000 });

    const messageList = win.locator('[data-testid="message-list"], .message-list');
    await expect(messageList).toContainText(/hired alex/i, { timeout: 5_000 });
  });
});
