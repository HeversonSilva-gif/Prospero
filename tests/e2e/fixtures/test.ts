import { test as base, _electron as electron, type ElectronApplication } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createIsolatedUserData, cleanupUserData } from "../helpers/db-reset.js";
import { seedFakeToken } from "../helpers/keychain-mock.js";

type Fixtures = {
  app: ElectronApplication;
  userDataDir: string;
  tokenPath: string;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = createIsolatedUserData();
    await use(dir);
    cleanupUserData(dir);
  },
  tokenPath: async ({ userDataDir }, use) => {
    await use(seedFakeToken(userDataDir));
  },
  app: async ({ userDataDir, tokenPath }, use) => {
    const electronMain = resolve(__dirname, "../../../apps/main/dist/index.js");
    if (!existsSync(electronMain)) {
      throw new Error(
        `Main bundle missing at ${electronMain}. Run 'pnpm build' before 'pnpm test:e2e'.`,
      );
    }
    const app = await electron.launch({
      args: [electronMain],
      env: {
        ...process.env,
        PROSPERO_USER_DATA: userDataDir,
        PROSPERO_E2E_TOKEN_PATH: tokenPath,
        PROSPERO_E2E_FAKE_CLAUDE: "1",
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      },
    });
    await use(app);
    await app.close();
  },
});

export { expect } from "@playwright/test";
