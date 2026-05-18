# M11 PR-F2 — Settings, Nudges, Terminate-Promote & Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close M11 — give the user a Settings panel to edit the global `user.md` and the derivation budget, nudge agents to capture/consolidate memory when the auto-derivation pipeline goes quiet, let a terminated agent's private skills be promoted (the rest cascade soft-delete on a 30-day TTL), and ship the M11 documentation.

**Architecture:** Four mostly-independent slices. (1) A `MemorySettingsSection` reads/writes the real `<userData>/memory/user.md` file through new IPC and edits the existing `derivationsPerDayPerAgent` setting. (2) A pure in-process `NudgeTracker` counts turns/tool-calls per agent session; the orchestrator's turn-complete handler asks it for a one-line hint and parks it on the router, which prepends it to the agent's next stdin turn. (3) A new `skills.soft_deleted_at` column (migration `0023`) lets the terminate modal promote selected private skills to the agent's role and cascade-soft-delete the rest; the boot maintenance pass hard-purges them after 30 days. (4) Docs + roadmap.

**Tech Stack:** Electron 33 · React 18 · better-sqlite3 (WAL) · zod · Vitest · TypeScript (strict, `exactOptionalPropertyTypes`) · pnpm monorepo (`packages/shared`, `apps/main`, `apps/renderer`).

---

## Decisions locked for this plan

- **PR-F2 closes M11.** PR-F was split into F1 (decay/maintenance/trust — merged) and this F2. F2 covers spec §10 Settings, the §7 nudges fallback, the §11 PR-E terminate-modal "promote private skills" (deferred from PR-E2), and §11 PR-F docs/roadmap.
- **The compaction nudge trigger is dropped.** Spec §7 wants a third nudge trigger on a compaction event. There is **no compaction event anywhere in the codebase** (M9 has no such hook) — confirmed by a repo-wide search. Implementing nudges as turn-complete + time-based only; the compaction trigger is out of scope and noted as a known gap in the docs.
- **The nudge heuristic is session-scoped, not per-issue.** Spec §7 wants "`tool_use_count > 5` in an issue AND no derivation enqueued for that issue". The router has **no current-issue concept**, there is **no per-issue tool-use counter**, and the derivation queue is in-memory/ephemeral — none of that infrastructure exists. Instead: a per-agent-session counter fires a nudge after `TURN_THRESHOLD` turns **or** `TOOL_THRESHOLD` cumulative tool calls since the last nudge. The cadence is deliberately conservative (30 turns / 25 tool calls) so a redundant nudge shortly after an auto-derivation is rare and harmless. A nudge is ~45 tokens — negligible against the `feedback_token_efficiency` budget.
- **There is no `memory.md` file.** Spec §3.1/§8 describe per-scope `memory.md` files; the shipped code never built them — company/agent declarative memory are `memories` table rows, and only `user.md` is a real file. The "consolidation when memory.md > 90% of cap" feature is therefore reinterpreted: when an agent's rendered declarative-memory block exceeds 90% of `AGENT_CAP` (1024 chars), a one-time-per-session consolidation hint is delivered through the same nudge channel.
- **Nudge injection rides the next stdin turn, not the system prompt.** The system prompt is fixed for a `claude` process lifetime (changing it forces a re-spawn). A nudge is parked on the router and prepended to whatever user message starts the agent's next turn.
- **Promoted skills go to the terminated agent's role.** The terminate modal has checkboxes only (no per-skill role picker — spec §11 PR-E says "checkboxes"). A promoted skill is published to `applies_to_role = <the agent's role>` so the next hire for that role inherits it (spec §1.1 inflection 3). Non-promoted private skills are soft-deleted immediately; the boot maintenance pass hard-deletes them 30 days later.
- **`user.md` writes from Settings are NOT sanitized.** The sanitizer (spec §9) guards the agent-facing and derivation write paths — untrusted LLM output. The user editing their own `user.md` in Settings is the most-trusted path; it is written verbatim. The injection site already hard-truncates to `USER_CAP`.

## File structure

| File | Responsibility | Action |
|---|---|---|
| `apps/main/src/memory/memory-dir.ts` | `getUserMemoryPath` helper | Modify |
| `apps/main/src/orchestrator/system-prompt-memory.ts` | use the helper; export `agentMemoryNearFull` | Modify |
| `apps/main/src/ipc/learning-handlers.ts` | `getUserMemory` / `setUserMemory` / `importClaudeCodeMemory` / `promoteSkillsOnTerminate` | Modify |
| `packages/shared/src/ipc-channels.ts` | 4 new channels | Modify |
| `apps/main/src/ipc/preload.ts` + `apps/renderer/src/env.d.ts` | preload bridge | Modify |
| `apps/renderer/src/stores/settings.ts` | `setDerivationsPerDay` action | Modify |
| `apps/renderer/src/components/settings/MemorySettingsSection.tsx` | Settings card: `user.md` editor + derivation slider | Create |
| `apps/renderer/src/routes/Settings.tsx` | mount the section | Modify |
| `apps/main/src/db/migrations/0023_skills_soft_deleted_at.sql` | `skills.soft_deleted_at` column | Create |
| `apps/main/src/memory/skills-repository.ts` | timestamped `softDelete` | Modify |
| `apps/main/src/memory/maintenance.ts` | 30-day skill purge | Modify |
| `apps/renderer/src/components/agent-panel/TerminateConfirmModal.tsx` | skill-promotion checklist | Modify |
| `apps/renderer/src/components/agent-panel/AgentHeader.tsx` | load private skills, wire the flow | Modify |
| `apps/main/src/orchestrator/nudge.ts` | the `NudgeTracker` | Create |
| `apps/main/src/orchestrator/router.ts` | `pendingNudge` slot | Modify |
| `apps/main/src/ipc/orchestrator-handlers.ts` | wire the nudge into turn-complete | Modify |
| `apps/renderer/src/i18n/{pt-BR,en-US}.json` + `parity.test.ts` | i18n | Modify |
| `docs/memory-architecture.md`, `docs/skills-format.md`, `docs/derivation-pipeline.md` | M11 docs | Create |
| `SECURITY.md`, `README.md` | memory section + featurette | Modify |
| `ROADMAP.md`, `roadmap.html` | M11 complete | Modify |

**Dependencies:** Task 1 independent. Task 2 depends on 1. Task 3 independent. Task 4 depends on 3. Task 5 depends on 4. Task 6 depends on 3. Task 7 independent. Task 8 independent. Task 9 depends on 7 + 8. Tasks 10–11 depend on everything (they describe it). Execute in order 1→11.

---

## Task 1: `user.md` filesystem IPC

The `MemorySettingsSection` editor reads and writes `<userData>/memory/user.md` and can pull in the user's Claude Code memory (`~/.claude/CLAUDE.md`). Three new handlers on the existing `learning-handlers.ts` factory (it already receives `userDataDir`).

**Files:**
- Modify: `apps/main/src/memory/memory-dir.ts`
- Modify: `apps/main/src/orchestrator/system-prompt-memory.ts`
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `packages/shared/tests/ipc-channels.test.ts`
- Modify: `apps/main/src/ipc/learning-handlers.ts`
- Modify: `apps/main/tests/ipc.learning-handlers.test.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Add the `getUserMemoryPath` helper**

In `apps/main/src/memory/memory-dir.ts`, append (the file already exports `getMemoryRootDir` and imports `join` from `node:path`):

```typescript
// Absolute path of the global USER.md — the "About the user" system-prompt
// slot. The only memory file managed directly under the memory root.
export const getUserMemoryPath = (userDataDir: string): string =>
  join(getMemoryRootDir(userDataDir), "user.md");
```

- [ ] **Step 2: Use the helper in `buildMemoryBlock` (remove the inline duplication)**

In `apps/main/src/orchestrator/system-prompt-memory.ts`:
- Add to the imports: `import { getUserMemoryPath } from "../memory/memory-dir.js";`
- Replace the inline path in `buildMemoryBlock` — the line `const userMd = join(deps.userDataDir, "memory", "user.md");` becomes:
```typescript
  const userMd = getUserMemoryPath(deps.userDataDir);
```
- If `join` is now unused in the file, remove it from the `node:path` import. (`existsSync`/`readFileSync` from `node:fs` stay.)

- [ ] **Step 3: Add the channels + test**

In `packages/shared/src/ipc-channels.ts`, add inside the `IPC` object before `} as const;`:

```typescript
  MEMORY_USER_GET: "memory:user-get",
  MEMORY_USER_SET: "memory:user-set",
  MEMORY_USER_IMPORT_CC: "memory:user-import-cc",
```

In `packages/shared/tests/ipc-channels.test.ts`, add inside `describe("IPC channels", ...)`:

```typescript
  it("exposes the M11 user-memory channels", () => {
    expect(IPC.MEMORY_USER_GET).toBe("memory:user-get");
    expect(IPC.MEMORY_USER_SET).toBe("memory:user-set");
    expect(IPC.MEMORY_USER_IMPORT_CC).toBe("memory:user-import-cc");
  });
```

> `ipc-channels.test.ts` uses a uniqueness test (`new Set(...).size`), not a fixed count — no count to bump. Confirm by reading the file.

- [ ] **Step 4: Write the failing handler test**

Read `apps/main/tests/ipc.learning-handlers.test.ts` first — note its `seed()` helper, its `USERDATA` constant, and how it calls the factory (`learningHandlers(db, USERDATA)`). **The user-memory handlers hit the real filesystem**, so the test needs a real temp directory, not whatever placeholder `USERDATA` is. Append:

```typescript
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

describe("learningHandlers — user memory", () => {
  it("getUserMemory returns empty string when user.md does not exist", () => {
    const dir = mkdtempSync(joinPath(tmpdir(), "prospero-um-"));
    try {
      const db = seed();
      expect(learningHandlers(db, dir).getUserMemory()).toEqual({ content: "" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("setUserMemory then getUserMemory round-trips the content", () => {
    const dir = mkdtempSync(joinPath(tmpdir(), "prospero-um-"));
    try {
      const db = seed();
      const h = learningHandlers(db, dir);
      expect(h.setUserMemory({ content: "the user prefers PT-BR" })).toEqual({ ok: true });
      expect(h.getUserMemory()).toEqual({ content: "the user prefers PT-BR" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

> `importClaudeCodeMemory` reads a machine-global path (`~/.claude/CLAUDE.md`) — it is not unit-tested here (its result depends on the host); typecheck covers it.

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: FAIL — `getUserMemory` / `setUserMemory` are not functions.

- [ ] **Step 6: Add the handlers**

In `apps/main/src/ipc/learning-handlers.ts`:

- Add to the imports at the top of the file:
```typescript
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getUserMemoryPath } from "../memory/memory-dir.js";
```
> Some of these may already be imported (the file reads `SKILL.md` bodies). Verify and only add what is missing — do not create duplicate imports.

- Add to the `LearningHandlers` type, after `rateMemory`:
```typescript
  // M11 PR-F2: the global user.md memory file ("About the user" prompt slot).
  getUserMemory(): { content: string };
  setUserMemory(args: { content: string }): { ok: true };
  // Loads the user's Claude Code memory (~/.claude/CLAUDE.md) so it can be
  // reviewed and saved into user.md. Returns "" when there is no such file.
  importClaudeCodeMemory(): { content: string };
```

- Add the methods to the object returned by `learningHandlers(db, userDataDir)`, after `rateMemory` (the factory's `userDataDir` parameter is in scope):
```typescript
    getUserMemory() {
      const path = getUserMemoryPath(userDataDir);
      return { content: existsSync(path) ? readFileSync(path, "utf8") : "" };
    },
    setUserMemory({ content }) {
      writeFileSync(getUserMemoryPath(userDataDir), content, "utf8");
      return { ok: true as const };
    },
    importClaudeCodeMemory() {
      const path = join(homedir(), ".claude", "CLAUDE.md");
      return { content: existsSync(path) ? readFileSync(path, "utf8") : "" };
    },
```

- In `registerLearningHandlers`, register after the trust-feedback handlers:
```typescript
  ipcMain.handle(IPC.MEMORY_USER_GET, () => h.getUserMemory());
  ipcMain.handle(IPC.MEMORY_USER_SET, (_e, args: { content: string }) => h.setUserMemory(args));
  ipcMain.handle(IPC.MEMORY_USER_IMPORT_CC, () => h.importClaudeCodeMemory());
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: PASS.

Run: `pnpm --filter @prospero/shared test`
Expected: PASS (the channel test).

- [ ] **Step 8: Add the preload bridge + `env.d.ts`**

In `apps/main/src/ipc/preload.ts`, inside the `learning: { ... }` namespace, after the trust-feedback entries:
```typescript
    getUserMemory: () => ipcRenderer.invoke(IPC.MEMORY_USER_GET) as Promise<{ content: string }>,
    setUserMemory: (content: string) =>
      ipcRenderer.invoke(IPC.MEMORY_USER_SET, { content }) as Promise<{ ok: true }>,
    importClaudeCodeMemory: () =>
      ipcRenderer.invoke(IPC.MEMORY_USER_IMPORT_CC) as Promise<{ content: string }>,
```

In `apps/renderer/src/env.d.ts`, inside the `learning: { ... }` interface, after the trust-feedback entries:
```typescript
        getUserMemory: () => Promise<{ content: string }>;
        setUserMemory: (content: string) => Promise<{ ok: true }>;
        importClaudeCodeMemory: () => Promise<{ content: string }>;
```

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add apps/main/src/memory/memory-dir.ts apps/main/src/orchestrator/system-prompt-memory.ts packages/shared/src/ipc-channels.ts packages/shared/tests/ipc-channels.test.ts apps/main/src/ipc/learning-handlers.ts apps/main/tests/ipc.learning-handlers.test.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m11): add user-memory file ipc handlers"
```

---

## Task 2: Settings — the Memory section

A Settings card with a `user.md` editor (textarea + char counter + Save + "Import from Claude Code"), and a slider for `derivationsPerDayPerAgent` (the field already exists end-to-end in `AppSettings` — only a UI control is missing).

**Files:**
- Modify: `apps/renderer/src/stores/settings.ts`
- Create: `apps/renderer/src/components/settings/MemorySettingsSection.tsx`
- Modify: `apps/renderer/src/routes/Settings.tsx`
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 1: Add the `setDerivationsPerDay` store action**

In `apps/renderer/src/stores/settings.ts`:
- Add to the `State` type, alongside the other `set*` actions:
```typescript
  setDerivationsPerDay: (n: number) => Promise<void>;
```
- Add the action to the store object, mirroring `setModel` (a flat scalar — no nested pre-merge needed):
```typescript
  setDerivationsPerDay: async (n) => {
    const next = await window.prospero.settings.update({ derivationsPerDayPerAgent: n });
    set({ settings: next });
  },
```

> Read `setModel` first and match its exact shape. The hardcoded initial `settings` literal already includes `derivationsPerDayPerAgent: 3` — no change needed there.

- [ ] **Step 2: Add the i18n parity check (failing test first)**

In `apps/renderer/src/i18n/parity.test.ts`, add at the end of the `describe("i18n parity", ...)` block (match the file's helpers — `flatten`, `ptBR`, `enUS`):

```typescript
  it("includes the M11 PR-F2 memory-settings keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "settings.memory.title",
      "settings.memory.subtitle",
      "settings.memory.userMemoryLabel",
      "settings.memory.import",
      "settings.memory.save",
      "settings.memory.saved",
      "settings.memory.overCap",
      "settings.memory.derivationBudgetLabel",
      "settings.memory.derivationBudgetHint",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: FAIL — keys missing.

- [ ] **Step 4: Add the i18n keys**

In `apps/renderer/src/i18n/pt-BR.json`, inside the `settings` object, add a nested `memory` block (match indentation; mind the trailing comma):

```json
  "memory": {
   "title": "Memória e aprendizado",
   "subtitle": "Edite o que os agentes sabem sobre você e ajuste o orçamento de derivação automática.",
   "userMemoryLabel": "Sobre você (user.md)",
   "import": "Importar do Claude Code",
   "save": "Salvar",
   "saved": "Salvo.",
   "overCap": "O texto passou do limite e será cortado ao entrar no prompt do agente.",
   "derivationBudgetLabel": "Orçamento de derivação",
   "derivationBudgetHint": "Máximo de skills e memórias derivadas automaticamente por agente por dia."
  }
```

In `apps/renderer/src/i18n/en-US.json`, mirror inside the `settings` object:

```json
  "memory": {
   "title": "Memory and learning",
   "subtitle": "Edit what agents know about you and tune the auto-derivation budget.",
   "userMemoryLabel": "About you (user.md)",
   "import": "Import from Claude Code",
   "save": "Save",
   "saved": "Saved.",
   "overCap": "The text is over the limit and will be trimmed when it enters the agent prompt.",
   "derivationBudgetLabel": "Derivation budget",
   "derivationBudgetHint": "Maximum skills and memories auto-derived per agent per day."
  }
```

- [ ] **Step 5: Run the parity test to verify it passes**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 6: Create the section component**

Read `apps/renderer/src/components/settings/RemoteExecutionSection.tsx` first to confirm the `: FC`-no-props convention and the Tailwind tokens. Create `apps/renderer/src/components/settings/MemorySettingsSection.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settings.js";

// USER.md prompt cap — mirrors USER_CAP in apps/main system-prompt-memory.ts.
// The counter is cosmetic; the injection site hard-truncates regardless.
const USER_MEMORY_CAP = 1024;

// M11 PR-F2: Settings card — the global user.md editor + the derivation budget.
export const MemorySettingsSection: FC = () => {
  const { t } = useTranslation();
  const derivations = useSettingsStore((s) => s.settings.derivationsPerDayPerAgent);
  const setDerivationsPerDay = useSettingsStore((s) => s.setDerivationsPerDay);

  const [userMemory, setUserMemory] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.prospero.learning.getUserMemory().then((r) => setUserMemory(r.content));
  }, []);

  const onSave = async (): Promise<void> => {
    await window.prospero.learning.setUserMemory(userMemory);
    setDirty(false);
    setSaved(true);
  };

  const onImport = async (): Promise<void> => {
    const r = await window.prospero.learning.importClaudeCodeMemory();
    setUserMemory(r.content);
    setDirty(true);
    setSaved(false);
  };

  const overCap = userMemory.length > USER_MEMORY_CAP;

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("settings.memory.title")}
      </h2>
      <p className="text-xs text-ink-muted mb-3">{t("settings.memory.subtitle")}</p>

      <label className="block text-sm font-medium text-ink mb-1">
        {t("settings.memory.userMemoryLabel")}
      </label>
      <textarea
        value={userMemory}
        onChange={(e) => {
          setUserMemory(e.target.value);
          setDirty(true);
          setSaved(false);
        }}
        rows={6}
        className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
      />
      <div className="flex items-center gap-2 mt-1">
        <span className={overCap ? "text-xs text-semantic-danger" : "text-xs text-ink-muted"}>
          {userMemory.length} / {USER_MEMORY_CAP}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void onImport()}
          className="px-3 py-1.5 text-sm border border-surface-border rounded"
        >
          {t("settings.memory.import")}
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!dirty}
          className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
        >
          {t("settings.memory.save")}
        </button>
      </div>
      {saved && (
        <p className="mt-1 text-xs text-semantic-success">{t("settings.memory.saved")}</p>
      )}
      {overCap && (
        <p className="mt-1 text-xs text-semantic-danger">{t("settings.memory.overCap")}</p>
      )}

      <label className="block text-sm font-medium text-ink mt-4 mb-1">
        {t("settings.memory.derivationBudgetLabel")}
      </label>
      <p className="text-xs text-ink-muted mb-2">{t("settings.memory.derivationBudgetHint")}</p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={10}
          value={derivations}
          onChange={(e) => void setDerivationsPerDay(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-sm font-mono text-ink w-8 text-right">{derivations}</span>
      </div>
    </section>
  );
};
```

> Verify the Tailwind tokens (`bg-surface-card`, `border-surface-border`, `bg-surface-soft`, `text-brand-dark`, `text-ink`, `text-ink-muted`, `bg-brand`, `text-brand-fg`, `text-semantic-danger`, `text-semantic-success`) against `RemoteExecutionSection.tsx` / `AgentsMdImportSection.tsx`. If a token differs, use the one those files use.

- [ ] **Step 7: Mount the section in Settings**

In `apps/renderer/src/routes/Settings.tsx`:
- Add the import alongside the other section-component imports:
```typescript
import { MemorySettingsSection } from "../components/settings/MemorySettingsSection.js";
```
- Drop `<MemorySettingsSection />` into the returned JSX, immediately after `<RemoteExecutionSection />` (so memory/learning settings sit next to the execution settings).

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm typecheck` → PASS
Run: `pnpm lint` → PASS

- [ ] **Step 9: Commit**

```bash
git add apps/renderer/src/stores/settings.ts apps/renderer/src/components/settings/MemorySettingsSection.tsx apps/renderer/src/routes/Settings.tsx apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m11): add the memory settings section"
```

---

## Task 3: Migration `0023` — `skills.soft_deleted_at`

The terminate-promote cascade soft-deletes non-promoted skills; the maintenance pass hard-purges them 30 days later. That needs a timestamp — `skills` has only the `soft_deleted` boolean today. SQLite supports `ADD COLUMN` directly (no table recreation — unlike a CHECK change).

**Files:**
- Create: `apps/main/src/db/migrations/0023_skills_soft_deleted_at.sql`
- Modify: `apps/main/src/memory/skills-repository.ts`
- Modify: `apps/main/src/memory/skills-repository.test.ts`
- Modify: `apps/main/src/db/migrations.test.ts`

- [ ] **Step 1: Create the migration**

Create `apps/main/src/db/migrations/0023_skills_soft_deleted_at.sql`:

```sql
-- M11 PR-F2: record WHEN a skill was soft-deleted, so the boot maintenance
-- pass can hard-purge it after a 30-day grace period (terminate-promote
-- cascade). NULL for live rows and for rows soft-deleted before this migration.

ALTER TABLE skills ADD COLUMN soft_deleted_at INTEGER;
```

- [ ] **Step 2: Write the failing migration test**

Read `apps/main/src/db/migrations.test.ts` — find the `0022` test added by PR-F1 and match its import/helper style. Append:

```typescript
it("0023 adds the skills.soft_deleted_at column", () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const cols = (db.prepare("PRAGMA table_info(skills)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  expect(cols).toContain("soft_deleted_at");
});
```

- [ ] **Step 3: Write the failing repository test**

In `apps/main/src/memory/skills-repository.test.ts`, append (match the file's `seed()` helper and the real `create` signature — `companyId, agentId, name, bodyPath, description, source`):

```typescript
describe("skills-repository — soft-delete timestamp", () => {
  it("softDelete records soft_deleted_at", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.softDelete(s.id, 123456);
    const row = db
      .prepare("SELECT soft_deleted, soft_deleted_at FROM skills WHERE id = ?")
      .get(s.id) as { soft_deleted: number; soft_deleted_at: number | null };
    expect(row.soft_deleted).toBe(1);
    expect(row.soft_deleted_at).toBe(123456);
  });

  it("softDelete defaults the timestamp to now", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "y",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    const before = Date.now();
    repo.softDelete(s.id);
    const row = db.prepare("SELECT soft_deleted_at FROM skills WHERE id = ?").get(s.id) as {
      soft_deleted_at: number;
    };
    expect(row.soft_deleted_at).toBeGreaterThanOrEqual(before);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @prospero/main exec vitest run src/db/migrations.test.ts src/memory/skills-repository.test.ts`
Expected: FAIL — `softDelete` ignores the second argument / `soft_deleted_at` column does not exist before the migration.

> The migration test may already pass once the `.sql` file exists (migrations are auto-discovered) — that is fine. The repo test fails until Step 5.

- [ ] **Step 5: Update `softDelete` to record the timestamp**

In `apps/main/src/memory/skills-repository.ts`:
- Change the `SkillsRepository` type member from `softDelete(id: string): void;` to:
```typescript
  // M11 PR-F2: `now` (default Date.now()) is stored as soft_deleted_at so the
  // maintenance pass can hard-purge the row after a 30-day grace period.
  softDelete(id: string, now?: number): void;
```
- Change the prepared statement (find the existing `softDeleteStmt` / `UPDATE skills SET soft_deleted = 1 WHERE id = ?`):
```typescript
  const softDeleteStmt = db.prepare(
    "UPDATE skills SET soft_deleted = 1, soft_deleted_at = ? WHERE id = ?",
  );
```
- Change the method on the returned object:
```typescript
    softDelete(id, now = Date.now()) {
      softDeleteStmt.run(now, id);
    },
```

> Match the file's actual statement variable name. All existing `softDelete(id)` callers keep working via the default parameter.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @prospero/main exec vitest run src/db/migrations.test.ts src/memory/skills-repository.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add apps/main/src/db/migrations/0023_skills_soft_deleted_at.sql apps/main/src/memory/skills-repository.ts apps/main/src/memory/skills-repository.test.ts apps/main/src/db/migrations.test.ts
git commit -m "feat(m11): add the skills soft-delete timestamp column"
```

---

## Task 4: `promoteSkillsOnTerminate` IPC handler

When an agent is terminated, the user's chosen private skills are promoted to the agent's role; every other private skill of that agent is soft-deleted.

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `packages/shared/tests/ipc-channels.test.ts`
- Modify: `apps/main/src/ipc/learning-handlers.ts`
- Modify: `apps/main/tests/ipc.learning-handlers.test.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Add the channel + test**

In `packages/shared/src/ipc-channels.ts`, add inside the `IPC` object before `} as const;`:
```typescript
  SKILLS_PROMOTE_ON_TERMINATE: "skills:promote-on-terminate",
```

In `packages/shared/tests/ipc-channels.test.ts`, inside `describe("IPC channels", ...)`:
```typescript
  it("exposes the M11 terminate-promote channel", () => {
    expect(IPC.SKILLS_PROMOTE_ON_TERMINATE).toBe("skills:promote-on-terminate");
  });
```

- [ ] **Step 2: Write the failing handler test**

In `apps/main/tests/ipc.learning-handlers.test.ts`, append (the file imports `createSkillsRepository`; `seed()` builds company `c1` + agent `a1` — confirm `a1`'s `role`; if `seed()` does not create an agent with a known role, build one inline matching the migration column set):

```typescript
describe("learningHandlers — promoteSkillsOnTerminate", () => {
  it("promotes the chosen skills to the agent's role and soft-deletes the rest", () => {
    const db = seed();
    const role = (
      db.prepare("SELECT role FROM agents WHERE id = 'a1'").get() as { role: string }
    ).role;
    const repo = createSkillsRepository(db);
    const keep = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "keeper",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    const drop = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "dropper",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });

    const out = learningHandlers(db, USERDATA).promoteSkillsOnTerminate({
      agentId: "a1",
      promoteSkillIds: [keep.id],
    });
    expect(out).toEqual({ promoted: 1, softDeleted: 1 });

    const promoted = repo.getById(keep.id);
    expect(promoted?.agentId).toBeNull();
    expect(promoted?.promoted).toBe(true);
    expect(promoted?.appliesToRole).toBe(role);

    // the non-promoted skill is soft-deleted -> excluded from getById
    expect(repo.getById(drop.id)).toBeNull();
  });

  it("returns zeros when the agent has no private skills", () => {
    const db = seed();
    expect(
      learningHandlers(db, USERDATA).promoteSkillsOnTerminate({
        agentId: "a1",
        promoteSkillIds: [],
      }),
    ).toEqual({ promoted: 0, softDeleted: 0 });
  });
});
```

> Confirm `getById` returns `null` for a soft-deleted skill (the repo filters `soft_deleted = 0`). If it does NOT, assert `repo.getById(drop.id)` differently — query `soft_deleted` directly.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: FAIL — `promoteSkillsOnTerminate` is not a function.

- [ ] **Step 4: Add the handler**

In `apps/main/src/ipc/learning-handlers.ts`:
- Add to the `LearningHandlers` type, after `importClaudeCodeMemory`:
```typescript
  // M11 PR-F2: on agent termination, promote the chosen private skills to the
  // agent's role (so future hires for that role inherit them) and soft-delete
  // the agent's remaining private skills.
  promoteSkillsOnTerminate(args: { agentId: string; promoteSkillIds: string[] }): {
    promoted: number;
    softDeleted: number;
  };
```
- Add the method to the returned object, after `importClaudeCodeMemory`:
```typescript
    promoteSkillsOnTerminate({ agentId, promoteSkillIds }) {
      const agentRow = db
        .prepare("SELECT role FROM agents WHERE id = ?")
        .get(agentId) as { role: string } | undefined;
      if (agentRow === undefined) throw new Error(`agent ${agentId} not found`);
      const skillsRepo = createSkillsRepository(db);
      const promoteSet = new Set(promoteSkillIds);
      let promoted = 0;
      let softDeleted = 0;
      for (const skill of skillsRepo.listByAgent(agentId)) {
        if (promoteSet.has(skill.id)) {
          skillsRepo.promote(skill.id, agentRow.role);
          promoted += 1;
        } else {
          skillsRepo.softDelete(skill.id);
          softDeleted += 1;
        }
      }
      return { promoted, softDeleted };
    },
```
- In `registerLearningHandlers`, register after the user-memory handlers:
```typescript
  ipcMain.handle(
    IPC.SKILLS_PROMOTE_ON_TERMINATE,
    (_e, args: { agentId: string; promoteSkillIds: string[] }) =>
      h.promoteSkillsOnTerminate(args),
  );
```

> `createSkillsRepository` is already imported. `listByAgent(agentId)` returns only that agent's live private skills — iterating it and mutating rows is safe (it returns a materialized array).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: PASS.

Run: `pnpm --filter @prospero/shared test`
Expected: PASS.

- [ ] **Step 6: Add the preload bridge + `env.d.ts`**

In `apps/main/src/ipc/preload.ts`, inside the `learning: { ... }` namespace:
```typescript
    promoteSkillsOnTerminate: (agentId: string, promoteSkillIds: string[]) =>
      ipcRenderer.invoke(IPC.SKILLS_PROMOTE_ON_TERMINATE, { agentId, promoteSkillIds }) as Promise<{
        promoted: number;
        softDeleted: number;
      }>,
```

In `apps/renderer/src/env.d.ts`, inside the `learning: { ... }` interface:
```typescript
        promoteSkillsOnTerminate: (
          agentId: string,
          promoteSkillIds: string[],
        ) => Promise<{ promoted: number; softDeleted: number }>;
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add packages/shared/src/ipc-channels.ts packages/shared/tests/ipc-channels.test.ts apps/main/src/ipc/learning-handlers.ts apps/main/tests/ipc.learning-handlers.test.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m11): add the terminate-time skill promotion handler"
```

---

## Task 5: Terminate modal — the skill-promotion checklist

`TerminateConfirmModal` gains a checklist of the agent's private skills; `AgentHeader` loads them and runs the promote-then-terminate flow.

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/TerminateConfirmModal.tsx`
- Modify: `apps/renderer/src/components/agent-panel/AgentHeader.tsx`
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 1: Add the parity check (failing test first)**

In `apps/renderer/src/i18n/parity.test.ts`, add at the end of the `describe` block:

```typescript
  it("includes the M11 PR-F2 terminate-promote keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of ["agent.terminate.promoteTitle", "agent.terminate.promoteHint"]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: FAIL — keys missing.

- [ ] **Step 3: Add the i18n keys**

In `apps/renderer/src/i18n/pt-BR.json`, inside the `agent.terminate` object (it already has `title`/`message`/`reasonLabel`/`cancel`/`confirm` — match its form, flat-dotted or nested):

```json
   "promoteTitle": "Promover skills privados deste agente?",
   "promoteHint": "Skills marcados viram compartilhados no papel do agente. Os não marcados são removidos após 30 dias."
```

In `apps/renderer/src/i18n/en-US.json`, mirror:

```json
   "promoteTitle": "Promote this agent's private skills?",
   "promoteHint": "Checked skills become shared on the agent's role. Unchecked ones are removed after 30 days."
```

> If `agent.terminate.*` keys are flat dotted strings (e.g. `"terminate.title": "..."` under `agent`), add `"terminate.promoteTitle"` / `"terminate.promoteHint"` in that same flat form instead. Read the file and match exactly.

- [ ] **Step 4: Run the parity test to verify it passes**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `TerminateConfirmModal.tsx`**

Read `apps/renderer/src/components/agent-panel/TerminateConfirmModal.tsx` in full. Apply these changes, matching the file's existing markup/Tailwind:

- Add the `Skill` import: `import type { Skill } from "@prospero/shared";`
- Ensure `useState` is imported.
- Change the `Props` type — add `skills: Skill[]` and widen `onConfirm`:
```typescript
type Props = {
  agentName: string;
  skills: Skill[];
  onConfirm: (reason: string | undefined, promoteSkillIds: string[]) => void;
  onCancel: () => void;
};
```
- Add promotion state near the existing `reason` state:
```typescript
  const [promoteIds, setPromoteIds] = useState<Set<string>>(new Set());
  const toggle = (id: string): void => {
    setPromoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
```
- Render the checklist **only when `skills.length > 0`**, between the reason textarea and the buttons:
```tsx
      {skills.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-ink">{t("agent.terminate.promoteTitle")}</p>
          <p className="text-xs text-ink-muted mb-2">{t("agent.terminate.promoteHint")}</p>
          <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {skills.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={promoteIds.has(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-ink-muted">{s.description}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
```
- Change the Confirm button handler to pass both arguments:
```tsx
        onClick={() => onConfirm(reason.trim() === "" ? undefined : reason.trim(), [...promoteIds])}
```

> `t` / `useTranslation` are already in this component (it renders translated labels). Match the real i18n key form chosen in Step 3.

- [ ] **Step 6: Wire `AgentHeader.tsx`**

Read `apps/renderer/src/components/agent-panel/AgentHeader.tsx`. It currently holds `showTerminate` state and renders the modal. Apply:

- Ensure `useState` is imported; add `import type { Skill } from "@prospero/shared";`.
- Add private-skills state:
```typescript
  const [privateSkills, setPrivateSkills] = useState<Skill[]>([]);
```
- Change the `onTerminate` handler passed to `<OverflowMenu>` so it loads the agent's private skills before opening the modal:
```tsx
        onTerminate={() => {
          void window.prospero.learning
            .listSkills({ agentId: agent.id })
            .then((all) => setPrivateSkills(all.filter((s) => s.agentId !== null)));
          setShowTerminate(true);
        }}
```
- Replace the `<TerminateConfirmModal .../>` block with:
```tsx
      {showTerminate && (
        <TerminateConfirmModal
          agentName={agent.name}
          skills={privateSkills}
          onConfirm={(reason, promoteSkillIds) => {
            void window.prospero.learning
              .promoteSkillsOnTerminate(agent.id, promoteSkillIds)
              .then(() => terminate(agent.id, reason));
            setShowTerminate(false);
          }}
          onCancel={() => setShowTerminate(false)}
        />
      )}
```

> `listSkills` returns the agent's private skills plus the company-shared skills it inherits; private ones have a non-null `agentId`, so `s.agentId !== null` filters to exactly the agent's own skills. The promote IPC runs before `terminate` so the skill rows are mutated while the agent still exists.

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck` → PASS
Run: `pnpm lint` → PASS

- [ ] **Step 8: Commit**

```bash
git add apps/renderer/src/components/agent-panel/TerminateConfirmModal.tsx apps/renderer/src/components/agent-panel/AgentHeader.tsx apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m11): add skill promotion to the terminate modal"
```

---

## Task 6: 30-day skill purge in the maintenance pass

The boot maintenance pass (PR-F1) gains one more step: hard-delete skills that were soft-deleted (by the terminate cascade) more than 30 days ago.

**Files:**
- Modify: `apps/main/src/memory/maintenance.ts`
- Modify: `apps/main/src/memory/maintenance.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/main/src/memory/maintenance.test.ts`, the `seed()` helper builds company `c1`. The purge test needs an agent (`skills.agent_id` has an FK to `agents`). Append:

```typescript
import { createSkillsRepository } from "./skills-repository.js";

describe("runMemoryMaintenance — skill purge", () => {
  const seedWithAgent = (): Database.Database => {
    const db = seed();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
         allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
    ).run();
    return db;
  };

  it("hard-deletes skills soft-deleted more than 30 days ago, keeps recent ones", () => {
    const db = seedWithAgent();
    const repo = createSkillsRepository(db);
    const mk = (name: string) =>
      repo.create({
        companyId: "c1",
        agentId: "a1",
        name,
        bodyPath: "p",
        description: "d",
        source: "user_authored",
      });
    const old = mk("old");
    const recent = mk("recent");
    repo.softDelete(old.id, 0); // soft-deleted at t=0
    repo.softDelete(recent.id, 100 * DAY); // soft-deleted "recently"
    setLastRun(db, 0);

    // now = 100 days: `old` is 100d stale (>30d), `recent` is 0d stale
    const result = runMemoryMaintenance(db, 100 * DAY);
    expect(result.purgedSkills).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM skills WHERE id = ?").get(old.id) as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM skills WHERE id = ?").get(recent.id) as { n: number }).n).toBe(1);
  });

  it("never purges a live (non-soft-deleted) skill", () => {
    const db = seedWithAgent();
    const repo = createSkillsRepository(db);
    const live = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "live",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    setLastRun(db, 0);
    const result = runMemoryMaintenance(db, 100 * DAY);
    expect(result.purgedSkills).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM skills WHERE id = ?").get(live.id) as { n: number }).n).toBe(1);
  });
});
```

> `DAY`, `seed`, `setLastRun` are already defined at the top of `maintenance.test.ts` (PR-F1). Reuse them. If `seed()` already inserts an agent `a1`, drop the extra INSERT and use `seed()` directly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/maintenance.test.ts`
Expected: FAIL — `purgedSkills` is `undefined` on the result.

- [ ] **Step 3: Add the purge to `maintenance.ts`**

In `apps/main/src/memory/maintenance.ts`:

- Add a constant near the others (after `STALE_DAYS`):
```typescript
// A skill soft-deleted (e.g. by the terminate-promote cascade) is hard-removed
// once it has sat soft-deleted this many days.
const SKILL_PURGE_DAYS = 30;
```
- Add `purgedSkills` to `MaintenanceResult`:
```typescript
export type MaintenanceResult = {
  ran: boolean;
  decayed: number;
  warned: number;
  pruned: number;
  purgedSkills: number;
};
```
- Update **both early-return objects** to include `purgedSkills: 0`:
  - the throttle return: `return { ran: false, decayed: 0, warned: 0, pruned: 0, purgedSkills: 0 };`
  - the first-run return: `return { ran: true, decayed: 0, warned: 0, pruned: 0, purgedSkills: 0 };`
- After the memory `for` loop and before `writeLastRun(db, now);`, add:
```typescript
  // M11 PR-F2: hard-purge skills soft-deleted past the 30-day grace period.
  const purgeBefore = now - SKILL_PURGE_DAYS * DAY_MS;
  const purgedSkills = db
    .prepare(
      "DELETE FROM skills WHERE soft_deleted = 1 AND soft_deleted_at IS NOT NULL AND soft_deleted_at < ?",
    )
    .run(purgeBefore).changes;
```
- Change the final return to include it:
```typescript
  return { ran: true, decayed, warned, pruned, purgedSkills };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/maintenance.test.ts`
Expected: PASS — the PR-F1 maintenance tests plus the 2 new purge tests.

- [ ] **Step 5: Update the boot log line**

In `apps/main/src/index.ts`, the maintenance call site logs `decayed/warned/pruned` (PR-F1). Add `purgedSkills` to that `console.warn` so the boot log reflects the purge — e.g. append `+ \`, purged ${maintenance.purgedSkills} skills\``. Match the existing string-concat style exactly.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add apps/main/src/memory/maintenance.ts apps/main/src/memory/maintenance.test.ts apps/main/src/index.ts
git commit -m "feat(m11): purge expired soft-deleted skills in the maintenance pass"
```

---

## Task 7: The nudge tracker

A pure in-process module: per-agent-session counters of turns and tool calls. After `TURN_THRESHOLD` turns or `TOOL_THRESHOLD` tool calls since the last nudge it returns a skill-capture hint; when memory is near full it returns a one-time consolidation hint. No database.

**Files:**
- Create: `apps/main/src/orchestrator/nudge.ts`
- Create: `apps/main/src/orchestrator/nudge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/orchestrator/nudge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createNudgeTracker,
  NUDGE_SKILL_HINT,
  NUDGE_CONSOLIDATION_HINT,
  TURN_THRESHOLD,
  TOOL_THRESHOLD,
} from "./nudge.js";

const quiet = { toolUseCount: 0, memoryNearFull: false };

describe("createNudgeTracker", () => {
  it("returns null before the turn threshold is reached", () => {
    const t = createNudgeTracker();
    let last: string | null = "x";
    for (let i = 0; i < TURN_THRESHOLD - 1; i += 1) last = t.recordTurn("a1", quiet);
    expect(last).toBeNull();
  });

  it("returns the skill hint exactly on the turn threshold, then resets", () => {
    const t = createNudgeTracker();
    let last: string | null = null;
    for (let i = 0; i < TURN_THRESHOLD; i += 1) last = t.recordTurn("a1", quiet);
    expect(last).toBe(NUDGE_SKILL_HINT);
    // counter reset — the very next turn does not immediately re-fire
    expect(t.recordTurn("a1", quiet)).toBeNull();
  });

  it("returns the skill hint when cumulative tool calls cross the threshold", () => {
    const t = createNudgeTracker();
    expect(t.recordTurn("a1", { toolUseCount: TOOL_THRESHOLD, memoryNearFull: false })).toBe(
      NUDGE_SKILL_HINT,
    );
  });

  it("returns the consolidation hint once when memory is near full", () => {
    const t = createNudgeTracker();
    expect(t.recordTurn("a1", { toolUseCount: 0, memoryNearFull: true })).toBe(
      NUDGE_CONSOLIDATION_HINT,
    );
    // does not repeat on the next near-full turn
    expect(t.recordTurn("a1", { toolUseCount: 0, memoryNearFull: true })).toBeNull();
  });

  it("tracks each agent independently", () => {
    const t = createNudgeTracker();
    for (let i = 0; i < TURN_THRESHOLD - 1; i += 1) t.recordTurn("a1", quiet);
    expect(t.recordTurn("a2", quiet)).toBeNull(); // a2 has its own counter
  });

  it("clear() forgets an agent's counters", () => {
    const t = createNudgeTracker();
    for (let i = 0; i < TURN_THRESHOLD - 1; i += 1) t.recordTurn("a1", quiet);
    t.clear("a1");
    expect(t.recordTurn("a1", quiet)).toBeNull(); // counting restarts from zero
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/nudge.test.ts`
Expected: FAIL — `Cannot find module './nudge.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/main/src/orchestrator/nudge.ts`:

```typescript
// M11 PR-F2: the memory nudge — a fallback that reminds an agent to capture or
// consolidate knowledge when the auto-derivation pipeline (PR-D) has been quiet.
//
// A nudge is a one-line hint the orchestrator prepends to the agent's NEXT turn
// (via the router's pendingNudge slot). Two triggers:
//   - work volume: TURN_THRESHOLD turns OR TOOL_THRESHOLD cumulative tool calls
//     since the last nudge — the agent has done enough that something is worth
//     saving as a skill or memory.
//   - memory pressure: the agent's declarative memory is near its prompt cap —
//     a one-time-per-session consolidation hint.
//
// The counters are per-agent and per claude-process session: the orchestrator
// calls clear() on session-init so a fresh process starts from zero.

// Turns since the last nudge before the work-volume hint fires.
export const TURN_THRESHOLD = 30;
// Cumulative tool calls since the last nudge before the work-volume hint fires.
export const TOOL_THRESHOLD = 25;

export const NUDGE_SKILL_HINT =
  "[memory note] You've completed a fair amount of work since the last " +
  "checkpoint. If any of it is a reusable procedure worth repeating, save it " +
  "with skill_create. If it is a durable fact worth remembering, use memory_add.";

export const NUDGE_CONSOLIDATION_HINT =
  "[memory note] Your declarative memory is nearly full. Consolidate it before " +
  "adding more: drop stale entries with memory_remove, or merge overlapping ones.";

export type NudgeInput = {
  // Distinct tool calls in the turn that just completed.
  toolUseCount: number;
  // True when the agent's rendered declarative memory is past 90% of its cap.
  memoryNearFull: boolean;
};

export type NudgeTracker = {
  // Records one completed turn; returns a hint to inject into the agent's next
  // turn, or null. Resets the work counters when the work-volume hint fires.
  recordTurn(agentId: string, input: NudgeInput): string | null;
  // Forgets an agent's counters — call on session-init (fresh claude process).
  clear(agentId: string): void;
};

type AgentNudgeState = {
  turns: number;
  tools: number;
  consolidationSent: boolean;
};

export const createNudgeTracker = (): NudgeTracker => {
  const states = new Map<string, AgentNudgeState>();

  const ensure = (agentId: string): AgentNudgeState => {
    let s = states.get(agentId);
    if (s === undefined) {
      s = { turns: 0, tools: 0, consolidationSent: false };
      states.set(agentId, s);
    }
    return s;
  };

  return {
    recordTurn(agentId, input) {
      const s = ensure(agentId);
      s.turns += 1;
      s.tools += Math.max(0, input.toolUseCount);

      // Memory pressure wins, and only fires once per session.
      if (input.memoryNearFull && !s.consolidationSent) {
        s.consolidationSent = true;
        return NUDGE_CONSOLIDATION_HINT;
      }

      if (s.turns >= TURN_THRESHOLD || s.tools >= TOOL_THRESHOLD) {
        s.turns = 0;
        s.tools = 0;
        return NUDGE_SKILL_HINT;
      }
      return null;
    },
    clear(agentId) {
      states.delete(agentId);
    },
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/nudge.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/nudge.ts apps/main/src/orchestrator/nudge.test.ts
git commit -m "feat(m11): add the memory nudge tracker"
```

---

## Task 8: Router — the `pendingNudge` slot

The router gains a per-agent `pendingNudge`. When set, it is prepended to whatever content starts the agent's next turn (either the immediate-write path or the dequeue path), then cleared.

**Files:**
- Modify: `apps/main/src/orchestrator/router.ts`
- Create: `apps/main/src/orchestrator/router.test.ts` (if it does not exist; otherwise modify)

- [ ] **Step 1: Check for an existing router test**

Look for `apps/main/src/orchestrator/router.test.ts`. If it exists, the new tests append to it; if not, Step 2 creates it.

- [ ] **Step 2: Write the failing test**

Create (or append to) `apps/main/src/orchestrator/router.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createRouter } from "./router.js";

const user = { kind: "user" as const, id: null, name: "CEO" };

describe("createRouter — pending nudge", () => {
  it("prepends a pending nudge to the next immediate turn", () => {
    const writes: Array<{ agentId: string; content: string }> = [];
    const router = createRouter({ writeStdin: (agentId, content) => writes.push({ agentId, content }) });
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t1", "do the thing", user);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toBe("NUDGE\n\n[from: CEO] do the thing");
  });

  it("delivers the nudge on the dequeued turn when the agent is busy", () => {
    const writes: Array<{ content: string }> = [];
    const router = createRouter({ writeStdin: (_a, content) => writes.push({ content }) });
    router.enqueue("a1", "t1", "first", user); // starts turn 1 (no nudge yet)
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t2", "second", user); // queued behind turn 1
    router.onTurnComplete("a1"); // dequeues "second"
    expect(writes[1]?.content).toBe("NUDGE\n\n[from: CEO] second");
  });

  it("clears the nudge after one delivery", () => {
    const writes: string[] = [];
    const router = createRouter({ writeStdin: (_a, content) => writes.push(content) });
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t1", "first", user);
    router.onTurnComplete("a1"); // idle, no queued message
    router.enqueue("a1", "t2", "second", user);
    expect(writes[0]).toBe("NUDGE\n\n[from: CEO] first");
    expect(writes[1]).toBe("[from: CEO] second"); // no nudge the second time
  });

  it("a turn with no pending nudge is written unchanged", () => {
    const writes: string[] = [];
    const router = createRouter({ writeStdin: (_a, content) => writes.push(content) });
    router.enqueue("a1", "t1", "plain", user);
    expect(writes[0]).toBe("[from: CEO] plain");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/router.test.ts`
Expected: FAIL — `setPendingNudge` is not a function.

- [ ] **Step 4: Add the slot**

Rewrite `apps/main/src/orchestrator/router.ts` to:

```typescript
export type Sender = { kind: "user" | "agent"; id: string | null; name: string };

type State = {
  currentTurnThreadId: string | null;
  queue: Array<{ threadId: string; content: string; sender: Sender }>;
  // M11 PR-F2: a memory nudge to prepend to this agent's next turn, or null.
  pendingNudge: string | null;
};

export type RouterOptions = {
  writeStdin: (agentId: string, content: string) => void;
};

export type Router = {
  enqueue(agentId: string, threadId: string, content: string, sender: Sender): void;
  onTurnComplete(agentId: string): void;
  getCurrentThread(agentId: string): string | null;
  // M11 PR-F2: park a nudge to ride along with the agent's next turn.
  setPendingNudge(agentId: string, nudge: string): void;
};

const formatSender = (sender: Sender, content: string): string =>
  `[from: ${sender.name}] ${content}`;

export const createRouter = (opts: RouterOptions): Router => {
  const states = new Map<string, State>();

  const ensure = (agentId: string): State => {
    let s = states.get(agentId);
    if (s === undefined) {
      s = { currentTurnThreadId: null, queue: [], pendingNudge: null };
      states.set(agentId, s);
    }
    return s;
  };

  // Prepends and consumes a parked nudge, if any.
  const withNudge = (s: State, content: string): string => {
    if (s.pendingNudge === null) return content;
    const out = `${s.pendingNudge}\n\n${content}`;
    s.pendingNudge = null;
    return out;
  };

  return {
    enqueue(agentId, threadId, content, sender) {
      const s = ensure(agentId);
      const formatted = formatSender(sender, content);
      if (s.currentTurnThreadId === null) {
        s.currentTurnThreadId = threadId;
        opts.writeStdin(agentId, withNudge(s, formatted));
      } else {
        s.queue.push({ threadId, content: formatted, sender });
      }
    },
    onTurnComplete(agentId) {
      const s = ensure(agentId);
      const next = s.queue.shift();
      if (next === undefined) {
        s.currentTurnThreadId = null;
      } else {
        s.currentTurnThreadId = next.threadId;
        opts.writeStdin(agentId, withNudge(s, next.content));
      }
    },
    getCurrentThread(agentId) {
      return ensure(agentId).currentTurnThreadId;
    },
    setPendingNudge(agentId, nudge) {
      ensure(agentId).pendingNudge = nudge;
    },
  };
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/router.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add apps/main/src/orchestrator/router.ts apps/main/src/orchestrator/router.test.ts
git commit -m "feat(m11): let the router inject a pending nudge into the next turn"
```

---

## Task 9: Wire the nudge into the turn-complete handler

The orchestrator's turn-complete handler asks the tracker for a hint each turn and parks it on the router. A new exported helper, `agentMemoryNearFull`, supplies the memory-pressure signal.

**Files:**
- Modify: `apps/main/src/orchestrator/system-prompt-memory.ts`
- Modify: `apps/main/src/orchestrator/system-prompt-memory.test.ts`
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

- [ ] **Step 1: Write the failing `agentMemoryNearFull` test**

In `apps/main/src/orchestrator/system-prompt-memory.test.ts`, append a test inside the top-level `describe`. Match the file's existing fixture helpers — it already builds a `MemoriesRepository` (in-memory db or fake) for `buildMemoryBlock` tests; reuse that exact setup:

```typescript
import { agentMemoryNearFull } from "./system-prompt-memory.js";

it("agentMemoryNearFull is false for an agent with little memory", () => {
  // build a memoriesRepo with one short memory for agent "a1" (reuse the
  // file's existing repo-seeding helper)
  expect(agentMemoryNearFull(memoriesRepo, "a1")).toBe(false);
});

it("agentMemoryNearFull is true once the agent's memory fills past 90% of the cap", () => {
  // create enough memories for agent "a1" that renderMemories fills the
  // 1024-char AGENT_CAP — e.g. 20 memories whose bodies are ~80 chars each.
  // Each must have trust >= 0.2 (the default 0.5 is fine) to count.
  expect(agentMemoryNearFull(memoriesRepo, "a1")).toBe(true);
});
```

> Concretely: in the "true" case, `create` ~20 memories for `a1` with `body` strings around 80 characters (`"x".repeat(80)` with distinct prefixes so they are not deduped). `renderMemories` joins `- <body>\n` lines until 1024 chars, so ~12+ such lines push the rendered length past `0.9 * 1024 = 921.6`. Use the file's real repo helper; if it uses an in-memory db, `createMemoriesRepository(db)` + `.create({ companyId, agentId: "a1", kind: "rule", body })`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/system-prompt-memory.test.ts`
Expected: FAIL — `agentMemoryNearFull` is not exported.

- [ ] **Step 3: Add `agentMemoryNearFull`**

In `apps/main/src/orchestrator/system-prompt-memory.ts`, append (it reuses the module-private `renderMemories` and `AGENT_CAP`):

```typescript
// M11 PR-F2: true when the agent's rendered declarative memory has filled past
// 90% of its system-prompt cap — the consolidation-nudge trigger. Mirrors the
// agent slot of buildMemoryBlock (low-trust entries are excluded, as in L0).
export const agentMemoryNearFull = (
  memoriesRepo: MemoriesRepository,
  agentId: string,
): boolean => {
  const rendered = renderMemories(memoriesRepo.listByAgent(agentId), AGENT_CAP);
  return rendered.length > AGENT_CAP * 0.9;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/system-prompt-memory.test.ts`
Expected: PASS — the existing tests plus the 2 new ones.

- [ ] **Step 5: Wire the tracker into `orchestrator-handlers.ts`**

Read `apps/main/src/ipc/orchestrator-handlers.ts` — focus on: the in-process tracker creation site (where `recoveryTracker` is built), the `turn-complete` event branch (it ends with `collectedToolCalls.clear()` and `router.onTurnComplete(agent.id)`), and the `session-init` event branch. Apply:

- Add imports:
```typescript
import { createNudgeTracker } from "../orchestrator/nudge.js";
import { agentMemoryNearFull } from "../orchestrator/system-prompt-memory.js";
```
> `createMemoriesRepository` is already imported (the spawn path uses it for `buildMemoryBlock`). Verify; add it only if missing.

- Where `recoveryTracker` is created, add alongside it:
```typescript
  const nudgeTracker = createNudgeTracker();
```

- In the `turn-complete` branch, **before** `collectedToolCalls.clear()`, capture the count and compute the nudge:
```typescript
        const toolUseCount = collectedToolCalls.size;
```
  Then, after `router.onTurnComplete(agent.id);`, add:
```typescript
        const memoryNearFull = agentMemoryNearFull(createMemoriesRepository(db), agent.id);
        const nudge = nudgeTracker.recordTurn(agent.id, { toolUseCount, memoryNearFull });
        if (nudge !== null) router.setPendingNudge(agent.id, nudge);
```
  Keep the existing `collectedToolCalls.clear()` where it is — just make sure `toolUseCount` is read before it.

- In the `session-init` branch, add (use the agent-id variable in scope there — it may be `agentId` rather than `agent.id`):
```typescript
        nudgeTracker.clear(<agentIdInScope>);
```
  This resets the per-session counters whenever a fresh `claude` process starts.

> Match the surrounding code's variable names and indentation exactly. The turn-complete branch has `agent` in scope (it uses `agent.id`, `agent.companyId`); confirm before using `agent.id`.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck` → PASS
Run: `pnpm lint` → PASS

- [ ] **Step 7: Full verification**

Run: `pnpm test`
Expected: PASS — every prior suite plus the new channel, learning-handler, migration, skills-repo, maintenance, nudge, router, and system-prompt tests; no regressions. If `agents-md-handlers.test.ts` times out under parallel load, re-run `pnpm test` once.

- [ ] **Step 8: Commit**

```bash
git add apps/main/src/orchestrator/system-prompt-memory.ts apps/main/src/orchestrator/system-prompt-memory.test.ts apps/main/src/ipc/orchestrator-handlers.ts
git commit -m "feat(m11): nudge agents to capture and consolidate memory"
```

---

## Task 10: M11 documentation

Three new docs plus a SECURITY.md section and a README featurette. No tests — verification is that the prose is accurate and the files render as valid markdown.

**Files:**
- Create: `docs/memory-architecture.md`
- Create: `docs/skills-format.md`
- Create: `docs/derivation-pipeline.md`
- Modify: `SECURITY.md`
- Modify: `README.md`

- [ ] **Step 1: Write `docs/memory-architecture.md`**

Cover, accurately against the shipped code (NOT the stale spec):
- The 3×2 cognitive matrix (declarative / procedural / episodic × individual / collective) — spec §1.2.
- **What is a file and what is a DB row:** only `<userData>/memory/user.md` is a file; company and agent declarative memory are `memories` table rows; skill *bodies* are `SKILL.md` files (`skills.body_path`), skill *metadata* are `skills` rows. Explicitly correct the spec's `memory.md`-per-scope description.
- The 4 system-prompt slots and their caps: `user.md` 1024 / company memory 1536 / agent memory 1024 / skills L0 4096 — assembled by `buildMemoryBlock` in `system-prompt-memory.ts`, injected once per spawn.
- L0 priority: sort by `use_count` then `trust`; entries with `trust < 0.2` drop out (loaded on-demand via `skill_read` / `memory_search`).
- Decay & maintenance (PR-F1): the once-per-session boot pass — 90-day importance half-life, `memory_review_needed` warnings, pruning, and the 30-day skill purge (PR-F2).
- Trust feedback: thumb up `+0.05` / down `−0.10`.
- The `user.md` editor in Settings; that edits apply at the next agent spawn.

- [ ] **Step 2: Write `docs/skills-format.md`**

Cover:
- What a skill is (procedural know-how) vs an M7 capability (a tool bundle) — the PR-A rename.
- The `SKILL.md` body file + the `skills` table columns (`name`, `description` = L0, `body_path`, `version`, `applies_to_role`, `source`, `trust`, `use_count`, `promoted`, `soft_deleted` / `soft_deleted_at`).
- Scopes: agent-private (`agent_id` set), role-scoped and company-global (`agent_id` NULL, `applies_to_role` set or NULL).
- The `skill_*` MCP tools (`skill_search`, `skill_read`, `skill_create`, `skill_update`, `skill_promote`) — spec §5.
- Promotion: `skill_promote` → inbox `skill_promotion_requested` → user approves; and the terminate-modal promote-to-role flow (PR-F2). Non-promoted skills of a terminated agent are soft-deleted and hard-purged after 30 days.
- The 16 KB body cap + the sanitizer.

- [ ] **Step 3: Write `docs/derivation-pipeline.md`**

Cover:
- The 4 triggers (spec §2.4): `issue.status_changed→done` and `agent.recovered` → `skill_candidate`; `goal.status_changed→achieved` → company `retrospective` memory; `approval.rejected` → agent `preference` memory.
- The headless runner: `claude -p` print mode, `claude-sonnet-4-6`, empty MCP config, trail embedded in the prompt — spec §2.1.
- The worker pipeline: trail → prompt → run → parse → sanitize → `cost_event` → write (spec §7).
- Review gating: `skill_candidate`s go through human Accept/Edit/Reject; derived memories are sanitized and written directly (no human review — they are facts, not procedures).
- The per-agent daily cap (`derivationsPerDayPerAgent`, default 3, editable in Settings).
- **The nudge fallback (PR-F2):** when the pipeline has been quiet, a per-session counter (30 turns / 25 tool calls) prepends a one-line skill-capture hint to the agent's next turn; a near-full agent memory triggers a one-time consolidation hint. **Known gap:** the spec also named a compaction-event nudge trigger — there is no compaction event in the app, so that trigger is not implemented.

- [ ] **Step 4: Add the SECURITY.md section**

Add a section "Memory & skills as injection vectors" to `SECURITY.md`:
- The shared sanitizer (`apps/main/src/memory/sanitizer.ts`) runs on **both** write paths — the agent-facing MCP tools and the derivation pipeline output (derivation is untrusted LLM generation).
- `skill_candidate`s additionally require human review before becoming skills.
- `pinned` memories and `promoted` skills are read-only to the agent — only the user changes them via the UI.
- `user.md` edited in Settings is the trusted path (the user authoring their own file) and is written verbatim; it is hard-truncated at injection.
- Match the existing SECURITY.md heading depth and tone.

- [ ] **Step 5: Add the README featurette**

In `README.md`, in the features list/section, add a short paragraph: agents have persistent cross-session memory and skills, the company accumulates shared learnings, and a derivation pipeline turns completed work into reviewable skill candidates. Match the existing README style — one tight paragraph or bullet, no marketing fluff.

- [ ] **Step 6: Commit**

```bash
git add docs/memory-architecture.md docs/skills-format.md docs/derivation-pipeline.md SECURITY.md README.md
git commit -m "docs(m11): document the memory and skills architecture"
```

---

## Task 11: Roadmap — mark M11 complete

Per `feedback_roadmap_3_lugares`, every merged milestone updates the roadmap in three places: `ROADMAP.md` (2 sections) and `roadmap.html` (3 sections — `/00` plain-language, `/01` progress, `/03` modules).

**Files:**
- Modify: `ROADMAP.md`
- Modify: `roadmap.html`

- [ ] **Step 1: Update `ROADMAP.md`**

Read `ROADMAP.md`. Find the M11 section and the progress/status section. Mark **PR-F (F1 + F2) done** and **M11 complete** — M11 was the V2 anchor, so the status line should reflect that the anchor milestone is closed. Summarize PR-F2's deliverables (Settings memory section, nudges, terminate-promote, decay/trust from F1, docs). Keep the writing style of the surrounding entries.

- [ ] **Step 2: Update `roadmap.html`**

Read `roadmap.html`. Update all three sections:
- `/00` (plain-language): a layperson-friendly line that agents now remember and learn across sessions, with no jargon.
- `/01` (progress): mark M11 done / update the progress count.
- `/03` (modules): mark the M11 module complete and reflect PR-F2's scope.
Match the existing markup and tone of each section.

- [ ] **Step 3: Verify the build still passes**

Run: `pnpm typecheck` → PASS (no code changed, but confirms nothing broke).

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md roadmap.html
git commit -m "docs(m11): mark m11 complete in the roadmap"
```

---

## Notes for every task

- Branch is `main`; commit directly to `main` (no feature branch — the established workflow).
- commitlint rejects uppercase / `+` / `%` in the commit subject — use the messages verbatim.
- Run each verification command on its own; confirm the result before committing — never pipe test output through `grep` then `&&` commit (the pipe masks failures).
- TDD: write the test, see it fail, implement, see it pass, commit.
- The pre-commit hook runs prettier/eslint and may reformat — that is expected.
- Do NOT invent repo method names, CSS classes, or import paths — read the actual files and match what exists.
- **Housekeeping:** the PR-E2 plan file `docs/superpowers/plans/2026-05-16-m11-pr-e2-memory-derivation-org-learnings.md` is untracked (it was never committed with PR-E2). `git add` it together with this plan file in the plan commit that precedes Task 1.

---

## Self-Review notes

- **Spec coverage (§7, §8, §10, §11 PR-E/PR-F):** Settings `user.md` editor + "Import from Claude Code" + derivation budget → Tasks 1, 2 (§10, §11 PR-F). Nudges fallback turn-complete + time-based → Tasks 7, 8, 9 (§7). Consolidation prompt at >90% of cap → Task 9's `agentMemoryNearFull` + the consolidation hint in Task 7 (§8 — reinterpreted onto agent memory rows, since no `memory.md` file exists). Terminate-modal "promote private skills" + 30-day TTL cascade → Tasks 3, 4, 5, 6 (§11 PR-E, deferred from PR-E2). Docs `memory-architecture.md` / `skills-format.md` / `derivation-pipeline.md` + SECURITY.md + README → Task 10 (§11 PR-F). Roadmap in 3 places → Task 11 (§11 PR-F, `feedback_roadmap_3_lugares`). **Deliberately not implemented** (documented in "Decisions locked"): the compaction-event nudge trigger (no compaction event exists in the app); the per-issue precision of the nudge heuristic (no per-issue tool-use counter or current-issue concept exists — replaced by a conservative per-session counter).
- **Placeholder scan:** every code step ships complete code; every command has an expected result. Failure paths are concrete — handlers throw on a missing agent, `getUserMemory` returns `""` when the file is absent, `importClaudeCodeMemory` returns `""` when `~/.claude/CLAUDE.md` is absent, the nudge tracker resets cleanly, the router leaves un-nudged turns unchanged, the maintenance purge only touches `soft_deleted = 1` rows. Task 10 (docs) ships a per-file content outline rather than code — appropriate for prose; Task 11 instructs reading the live roadmap and matching, since its current text is not reproduced here.
- **Type consistency:** `getUserMemoryPath` (Task 1) is consumed by `learning-handlers.ts` (Task 1) and `system-prompt-memory.ts` (Task 1). The three user-memory IPC return shapes (`{ content: string }`, `{ ok: true }`) are identical across `LearningHandlers`, the preload, and `env.d.ts`. `promoteSkillsOnTerminate`'s `{ promoted, softDeleted }` shape and its `{ agentId, promoteSkillIds }` args are identical across the handler, preload, `env.d.ts`, and `AgentHeader`. `softDelete(id, now?)` (Task 3) is called with the default by `promoteSkillsOnTerminate` (Task 4) and with an explicit timestamp by the tests; `soft_deleted_at` (Task 3) is read by the maintenance purge (Task 6). `NudgeTracker` / `NudgeInput` (Task 7) are consumed by the orchestrator wiring (Task 9). `Router.setPendingNudge` (Task 8) is called by Task 9. `agentMemoryNearFull` (Task 9) returns `boolean`, fed straight into `NudgeInput.memoryNearFull`. `MaintenanceResult` gains `purgedSkills` (Task 6) — both early-return objects and the boot log (Task 6 Step 5) are updated to match.
- **Non-regression:** `softDelete` keeps its old call sites working via the default `now` parameter. The router change is additive — a turn with no pending nudge is byte-identical to before (Task 8 test covers it). The maintenance purge only `DELETE`s rows already flagged `soft_deleted = 1` with a non-NULL `soft_deleted_at` older than 30 days — live skills and rows soft-deleted pre-`0023` (NULL timestamp) are untouched. `buildMemoryBlock` is unchanged in behavior — only the inline `user.md` path is swapped for the identical helper. The new Settings section is purely additive. Migration `0023` is a plain `ADD COLUMN` (no table recreation, no data movement). The nudge is ~45 tokens delivered at most once per ~30 turns — well within `feedback_no_regression` / `feedback_token_efficiency`.
- **Security (§9):** `user.md` written from Settings is the trusted user-authored path — not sanitized, by design (the agent never writes it; the injection truncates it). Skill promotion and the terminate cascade are user-driven (no LLM path). The nudge text is a fixed constant — no untrusted interpolation. No new SQL-injection surface — all new SQL is parameterized or constant.
- **Out of scope / closes M11:** after PR-F2, M11 (the V2 anchor) is complete. Remaining V2 work — M12 Agent & Org Definition Layer, then Tier 1 — is tracked separately. The `claude -p` derivation-runner live smoke (a pre-existing M11 PR-D1 pendency) is still open and is not addressed here.
