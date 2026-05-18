import type Database from "better-sqlite3";
import type { ActivityEventRow } from "@prospero/shared";
import { createDerivationWorker } from "./worker.js";
import { createDerivationDispatcher } from "./dispatcher.js";
import { runDerivation, defaultRunProcess } from "./runner.js";
import { createSettingsRepository } from "../settings/repository.js";
import { loadDecryptedToken } from "../auth/token-storage.js";
import { loadDecryptedApiKey } from "../auth/api-key-storage.js";

// Resolves the auth env for the headless runner from the app's configured
// auth mode. Returns {} if no credential is configured — the run will then
// fail and be dropped silently, which is acceptable for a background job.
// Exported (M12 PR-D1): the charter-generation handler reuses it to resolve
// the headless-call auth env from the app's configured auth mode.
export const buildAuthEnv = (db: Database.Database): Record<string, string> => {
  const mode = createSettingsRepository(db).read().authMode;
  if (mode === "api-key") {
    const key = loadDecryptedApiKey(db);
    return key !== null ? { ANTHROPIC_API_KEY: key } : {};
  }
  const token = loadDecryptedToken(db);
  return token !== null ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {};
};

// Builds the derivation worker + dispatcher. The returned `onActivity` is the
// observer that initRecorder calls after every activity write.
export const initDerivation = (
  db: Database.Database,
): { onActivity: (row: ActivityEventRow) => void } => {
  const worker = createDerivationWorker({
    db,
    runDerivation: (input) => runDerivation({ runProcess: defaultRunProcess }, input),
    now: () => Date.now(),
    authEnv: () => buildAuthEnv(db),
  });
  const dispatcher = createDerivationDispatcher({
    processJob: (job) => worker.processJob(job),
  });
  return { onActivity: (row) => dispatcher.onActivity(row) };
};
