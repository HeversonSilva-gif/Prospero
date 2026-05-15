import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// In production the OAuth token is stored encrypted via Electron safeStorage
// and detected from the Claude Code keychain. In E2E we bypass detection by
// dropping a plaintext "token" into a fixture file the main process picks up
// when PROSPERO_E2E_TOKEN_PATH is set. The token doesn't have to be
// real — E2E specs never call the live Anthropic API; the agent process is
// stubbed via PROSPERO_E2E_FAKE_CLAUDE=1 (see fixtures/test.ts).

export const seedFakeToken = (userDataDir: string): string => {
  const dir = join(userDataDir, "e2e-fixtures");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "fake-token.txt");
  writeFileSync(path, "E2E_FAKE_TOKEN_DO_NOT_USE_NOT_A_REAL_CREDENTIAL\n", "utf8");
  return path;
};
