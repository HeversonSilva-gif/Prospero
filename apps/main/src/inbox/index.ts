// Inbox public API (M13 PR-F) — lazy singleton accessor for the inbox repo.
//
// Mirrors `apps/main/src/activity/index.ts`. The repository itself is also
// instantiated by `inbox-handlers.ts`; this module exists so non-handler call
// sites (e.g. the security gate) can write inbox cards without importing
// `inbox-handlers.ts`. `initInbox` is called once at the top of
// `registerIpcHandlers` before any handler can run. `_setInboxForTest` is an
// escape hatch for tests that need to stub the global instance.

import type { InboxRepository } from "./repository.js";

let _inbox: InboxRepository | null = null;

export const initInbox = (repo: InboxRepository): void => {
  _inbox = repo;
};

export const tryGetInbox = (): InboxRepository | undefined => _inbox ?? undefined;

export const _setInboxForTest = (repo: InboxRepository | null): void => {
  _inbox = repo;
};

export { createInboxRepository } from "./repository.js";
export type { InboxRepository, CreateInboxInput } from "./repository.js";
