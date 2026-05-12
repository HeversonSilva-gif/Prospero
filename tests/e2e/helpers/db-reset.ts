import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Returns a fresh, isolated userData directory for one E2E run. The main
// process reads DASHBOARD_AGENT_USER_DATA at startup (set in the fixture)
// and points its Electron userData there, so each test starts from an
// empty DB.

export const createIsolatedUserData = (): string =>
  mkdtempSync(join(tmpdir(), "dashboard-agent-e2e-"));

export const cleanupUserData = (path: string): void => {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    /* best effort — Windows file locks sometimes survive Electron exit */
  }
};
