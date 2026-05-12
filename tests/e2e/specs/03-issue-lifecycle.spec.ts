import { test, expect } from "../fixtures/test.js";
import { seedDb, dbPathOf } from "../helpers/seed.js";

// SKIPPED — see tests/e2e/README.md (Electron 33 + Playwright 1.60 incompat).
// When unskipping, also add data-testid attributes on the Kanban column
// wrappers (data-status="backlog|in_progress|done") and on IssueCard so the
// drag locators work; the renderer code currently lacks them.
test.describe.skip("03 — issue lifecycle", () => {
  test("create issue → drag to In Progress → mark done with artifact warning", async ({
    app,
    userDataDir,
  }) => {
    seedDb(dbPathOf(userDataDir), {
      withCeo: true,
      projectSlug: "BACKEND",
    });

    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await win.locator('a[href*="/issues"]').click();

    await win.locator('button:has-text("New issue"), button:has-text("+")').first().click();
    await win
      .locator('input[name="title"], input[placeholder*="title" i]')
      .fill("Add health endpoint");
    await win
      .locator('textarea[name="description"], textarea[placeholder*="description" i]')
      .fill("Return 200 with uptime.");
    await win.locator('button:has-text("Create"), button:has-text("Save")').click();

    const card = win.locator('[data-testid="issue-card"]:has-text("BACKEND-1")');
    await expect(card).toBeVisible({ timeout: 5_000 });

    const target = win.locator('[data-testid="kanban-column"][data-status="in_progress"]');
    await card.dragTo(target);
    await expect(target.locator('[data-testid="issue-card"]:has-text("BACKEND-1")')).toBeVisible();

    await card.click();
    await win.locator('button:has-text("Mark done"), button:has-text("Done")').first().click();

    await expect(
      win.locator('[role="status"], .toast').filter({ hasText: /artifact/i }),
    ).toBeVisible({ timeout: 5_000 });
    await win.locator('button:has-text("Confirm"), button:has-text("Mark anyway")').click();

    const doneCol = win.locator('[data-testid="kanban-column"][data-status="done"]');
    await expect(doneCol.locator('[data-testid="issue-card"]:has-text("BACKEND-1")')).toBeVisible({
      timeout: 5_000,
    });
  });
});
