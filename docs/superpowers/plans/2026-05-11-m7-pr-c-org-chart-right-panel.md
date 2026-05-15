# M7 PR-C — Org Chart + Right Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar `/org` (org chart SVG vertical + drag-to-reassign), right panel em `/agents/:id` com 3 tabs (Config/Issues/Stats), e os IPC handlers de mutação que reiniciam o runner do agente quando model/role/system_prompt mudam.

**Architecture:** Toda mutação que afeta `--model` ou `--allowedTools` mata o runner ativo e zera `claude_session_id` — próximo `sendMessage` re-spawna com config nova (mesmo pattern do `agent:kill` existente). Org chart é SVG inline em DOM (sem libs); layout faz traversal recursivo de `reports_to`. Drag emite `pointermove` → modal de confirm → IPC `setReportsTo` com validação anti-ciclo no main.

**Tech Stack:** Electron 33, better-sqlite3, React 18 + react-router-dom (HashRouter), Tailwind, Zustand, Vitest. Zero novas deps.

**Decisões locked-in (memory + ROADMAP §"Decisão arquitetural"):**
- Org Chart: SVG handcrafted, NÃO React Flow / D3 / dagre.
- Skills: continuam tag-based (`agents.skills_json`), sem source sync.
- AllowlistEditor extraído? Não — componente atual `AgentAccessSection` é project-centric. Criamos `AgentProjectsEditor` agent-centric (simétrico) sem refatorar o original. Mais limpo.
- `agents:listIssues` (spec original): **omitido**, renderer chama `window.prospero.issues.list({companyId, assigneeId})` existente.
- `agents:stats` (spec original): mantido como handler dedicado (agrega turns + lastActivity server-side).

---

## File Structure

### Backend (main)
- Modify: `apps/main/src/agents/repository.ts` — `setModel`, `setRole`, `setSystemPrompt`, `setReportsTo` methods.
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts` — handlers `agents:setModel`, `agents:setRole`, `agents:setSystemPrompt`, `agents:setReportsTo`, `agents:stats`. Restart helper `restartIfRunning`.
- Modify: `packages/shared/src/ipc-channels.ts` — 5 channels novos.
- Modify: `packages/shared/src/types/agent.ts` — type `AgentStats`.
- Modify: `apps/main/src/ipc/preload.ts` — expor os 5 channels.

### Renderer
- Modify: `apps/renderer/src/env.d.ts` — declarar os 5 channels.
- Modify: `apps/renderer/src/stores/agents.ts` — actions `setModel`, `setRole`, `setSystemPrompt`, `setReportsTo`.
- Create: `apps/renderer/src/components/agent-panel/AgentProjectsEditor.tsx` — agent-centric allowlist (chips de projetos).
- Create: `apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx` — wrapper com tabs.
- Create: `apps/renderer/src/components/agent-panel/ConfigTab.tsx` — role/model/persona/projects.
- Create: `apps/renderer/src/components/agent-panel/IssuesTab.tsx` — lista issues assignee.
- Create: `apps/renderer/src/components/agent-panel/StatsTab.tsx` — 4 metrics (turns + 3 placeholders).
- Create: `apps/renderer/src/components/agent-panel/ChangeRoleModal.tsx` — confirm modal + dropdown.
- Modify: `apps/renderer/src/routes/Agent.tsx` — abre o `<aside>` com `AgentConfigPanel`.
- Create: `apps/renderer/src/routes/Org.tsx` — full-page SVG tree.
- Create: `apps/renderer/src/components/org/layoutTree.ts` — pure function: agents → positioned nodes.
- Create: `apps/renderer/src/components/org/OrgNode.tsx` — `<g>` por node.
- Create: `apps/renderer/src/components/org/ReassignConfirmModal.tsx` — confirm drag-drop.
- Modify: `apps/renderer/src/App.tsx` — route `/org` + sidebar NavLink "Org Chart".
- Modify: `apps/renderer/src/i18n/pt-BR.json` + `apps/renderer/src/i18n/en-US.json` — keys novas.

### Tests
- Create: `apps/main/src/agents/repository.test.ts` (se não existir) — `setRole` atomicidade.
- Create: `apps/renderer/src/components/org/layoutTree.test.ts` — layout puro.
- Modify: `packages/shared/tests/ipc-channels.test.ts` — assert presença das 5 keys novas.

---

## Task Overview

| # | Tarefa | Tempo |
|---|---|---|
| 1 | Shared: IPC channels + `AgentStats` type | 15min |
| 2 | Repository: `setModel`/`setSystemPrompt` + tests | 30min |
| 3 | Repository: `setRole` (atômico) + tests | 30min |
| 4 | Repository: `setReportsTo` (anti-cycle) + tests | 30min |
| 5 | Orchestrator handler: `restartIfRunning` helper | 20min |
| 6 | IPC handlers: 5 channels novos | 40min |
| 7 | Preload + env.d.ts: expor channels | 15min |
| 8 | Renderer: agents store actions | 20min |
| 9 | Renderer: `AgentProjectsEditor` component | 30min |
| 10 | Renderer: `ChangeRoleModal` + `ConfigTab` | 60min |
| 11 | Renderer: `IssuesTab` + `StatsTab` | 30min |
| 12 | Renderer: `AgentConfigPanel` + integrar em `Agent.tsx` | 30min |
| 13 | Org chart: `layoutTree.ts` (pure) + tests | 30min |
| 14 | Org chart: `Org.tsx` render + click drawer | 60min |
| 15 | Org chart: drag + `ReassignConfirmModal` | 60min |
| 16 | Sidebar link + route + i18n | 20min |
| 17 | Verification (build/lint/typecheck/tests) | 30min |
| 18 | Commit + memory update | 15min |

**Total:** ~8h de trabalho focado (~2-3 dias com pausas/contexto).

---

## Task 1: Shared — IPC channels + `AgentStats` type

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/tests/ipc-channels.test.ts`

- [ ] **Step 1: Adicionar `AgentStats` ao `types/agent.ts`**

Append ao fim de `packages/shared/src/types/agent.ts`:

```typescript
export type AgentStats = {
  turns: number;
  tokensIn: number | null;
  tokensOut: number | null;
  lastActivityAt: number | null;
};
```

- [ ] **Step 2: Adicionar 5 channels ao `ipc-channels.ts`**

Em `packages/shared/src/ipc-channels.ts`, dentro do objeto `IPC`, depois de `ROLES_GET`, adicionar:

```typescript
  AGENTS_SET_MODEL: "agents:set-model",
  AGENTS_SET_ROLE: "agents:set-role",
  AGENTS_SET_SYSTEM_PROMPT: "agents:set-system-prompt",
  AGENTS_SET_REPORTS_TO: "agents:set-reports-to",
  AGENTS_STATS: "agents:stats",
```

- [ ] **Step 3: Adicionar test que valida os channels novos**

Em `packages/shared/tests/ipc-channels.test.ts`, adicionar (ou ampliar test existente que confere presence das keys):

```typescript
import { describe, expect, it } from "vitest";
import { IPC } from "../src/ipc-channels.js";

describe("M7 PR-C channels", () => {
  it("exposes mutation channels for agent runtime config", () => {
    expect(IPC.AGENTS_SET_MODEL).toBe("agents:set-model");
    expect(IPC.AGENTS_SET_ROLE).toBe("agents:set-role");
    expect(IPC.AGENTS_SET_SYSTEM_PROMPT).toBe("agents:set-system-prompt");
    expect(IPC.AGENTS_SET_REPORTS_TO).toBe("agents:set-reports-to");
    expect(IPC.AGENTS_STATS).toBe("agents:stats");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @prospero/shared test
```

Expected: PASS, todos os tests do shared verdes.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ipc-channels.ts packages/shared/src/types/agent.ts packages/shared/tests/ipc-channels.test.ts
git commit -m "feat(m7c): shared types + ipc channels for agent runtime mutations"
```

---

## Task 2: Repository — `setModel` & `setSystemPrompt`

**Files:**
- Modify: `apps/main/src/agents/repository.ts`
- Create: `apps/main/src/agents/repository.test.ts` (se não existir; ver Step 0)

- [ ] **Step 0: Verificar se já existe test file**

```bash
ls apps/main/src/agents/repository.test.ts
```

Se não existir, criar com header:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createAgentsRepository } from "./repository.js";

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};
```

- [ ] **Step 1: Adicionar tests para `setModel` e `setSystemPrompt`**

Em `repository.test.ts`:

```typescript
describe("setModel", () => {
  it("updates the agent model column", () => {
    const db = setupDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
    const repo = createAgentsRepository(db);
    const agent = repo.create({
      companyId: "c1",
      name: "A",
      role: "engineer",
      systemPrompt: "p",
      mode: "supervised",
      alwaysOn: false,
      model: "claude-sonnet-4-6",
      skills: ["chat"],
    });
    repo.setModel(agent.id, "claude-opus-4-7");
    expect(repo.getById(agent.id)?.model).toBe("claude-opus-4-7");
  });
});

describe("setSystemPrompt", () => {
  it("updates the agent system prompt", () => {
    const db = setupDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
    const repo = createAgentsRepository(db);
    const agent = repo.create({
      companyId: "c1", name: "A", role: "r", systemPrompt: "old",
      mode: "supervised", alwaysOn: false, model: "claude-sonnet-4-6", skills: [],
    });
    repo.setSystemPrompt(agent.id, "new prompt");
    expect(repo.getById(agent.id)?.systemPrompt).toBe("new prompt");
  });
});
```

- [ ] **Step 2: Rodar tests pra confirmar que falham**

```bash
pnpm --filter @prospero/main test -- repository.test.ts
```

Expected: FAIL — `repo.setModel is not a function`.

- [ ] **Step 3: Implementar `setModel` e `setSystemPrompt`**

Em `apps/main/src/agents/repository.ts`, adicionar ao type `AgentsRepository`:

```typescript
  setModel(id: string, model: string): void;
  setSystemPrompt(id: string, systemPrompt: string): void;
```

E ao return de `createAgentsRepository`:

```typescript
    setModel(id, model) {
      db.prepare("UPDATE agents SET model = ?, updated_at = ? WHERE id = ?").run(
        model,
        Date.now(),
        id,
      );
    },
    setSystemPrompt(id, systemPrompt) {
      db.prepare("UPDATE agents SET system_prompt = ?, updated_at = ? WHERE id = ?").run(
        systemPrompt,
        Date.now(),
        id,
      );
    },
```

- [ ] **Step 4: Rodar tests, confirmar PASS**

```bash
pnpm --filter @prospero/main test -- repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents/repository.ts apps/main/src/agents/repository.test.ts
git commit -m "feat(m7c): agents repository — setModel + setSystemPrompt"
```

---

## Task 3: Repository — `setRole` (atômico)

**Files:**
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/src/agents/repository.test.ts`

`setRole` é especial: tem que escrever `template_id`, `skills_json`, e (opcionalmente) `model` numa única transação, lendo do `role_templates`. Se o role não existe, lança erro.

- [ ] **Step 1: Adicionar test**

```typescript
describe("setRole", () => {
  it("atomically updates template_id, skills, and model from role_template", () => {
    const db = setupDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
    // Seed um role pra teste (post-migration 0004 já roda, mas garantimos):
    db.prepare(
      `INSERT OR REPLACE INTO role_templates (id, name, description, default_system_prompt, default_skills_json, default_model, icon)
       VALUES ('role-engineer', 'Engineer', '', 'p', '["shell","chat"]', 'claude-sonnet-4-6', NULL)`,
    ).run();
    const repo = createAgentsRepository(db);
    const agent = repo.create({
      companyId: "c1", name: "A", role: "qa", systemPrompt: "p",
      mode: "supervised", alwaysOn: false, model: "claude-haiku-4-5-20251001", skills: ["chat"],
    });
    repo.setRole(agent.id, "role-engineer");
    const updated = repo.getById(agent.id)!;
    expect(updated.templateId).toBe("role-engineer");
    expect(updated.skills).toEqual(["shell", "chat"]);
    expect(updated.model).toBe("claude-sonnet-4-6");
  });

  it("does NOT overwrite model when caller passes preserveModel=true", () => {
    const db = setupDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
    db.prepare(
      `INSERT OR REPLACE INTO role_templates (id, name, description, default_system_prompt, default_skills_json, default_model, icon)
       VALUES ('role-engineer', 'Engineer', '', 'p', '["shell"]', 'claude-sonnet-4-6', NULL)`,
    ).run();
    const repo = createAgentsRepository(db);
    const agent = repo.create({
      companyId: "c1", name: "A", role: "qa", systemPrompt: "p",
      mode: "supervised", alwaysOn: false, model: "claude-opus-4-7", skills: [],
    });
    repo.setRole(agent.id, "role-engineer", { preserveModel: true });
    expect(repo.getById(agent.id)?.model).toBe("claude-opus-4-7");
  });

  it("throws when role_template_id does not exist", () => {
    const db = setupDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
    const repo = createAgentsRepository(db);
    const agent = repo.create({
      companyId: "c1", name: "A", role: "r", systemPrompt: "p",
      mode: "supervised", alwaysOn: false, model: "claude-sonnet-4-6", skills: [],
    });
    expect(() => repo.setRole(agent.id, "role-nonexistent")).toThrow();
  });
});
```

- [ ] **Step 2: Rodar tests pra confirmar que falham**

```bash
pnpm --filter @prospero/main test -- repository.test.ts
```

Expected: FAIL — `setRole is not a function`.

- [ ] **Step 3: Implementar `setRole`**

Em `apps/main/src/agents/repository.ts`:

```typescript
// Adicionar ao type AgentsRepository:
  setRole(id: string, roleTemplateId: string, opts?: { preserveModel?: boolean }): void;
```

E ao return:

```typescript
    setRole(id, roleTemplateId, opts) {
      const role = db
        .prepare(
          "SELECT default_skills_json, default_model FROM role_templates WHERE id = ?",
        )
        .get(roleTemplateId) as { default_skills_json: string; default_model: string } | undefined;
      if (role === undefined) throw new Error(`Role template not found: ${roleTemplateId}`);
      const now = Date.now();
      const txn = db.transaction(() => {
        if (opts?.preserveModel === true) {
          db.prepare(
            "UPDATE agents SET template_id = ?, skills_json = ?, updated_at = ? WHERE id = ?",
          ).run(roleTemplateId, role.default_skills_json, now, id);
        } else {
          db.prepare(
            "UPDATE agents SET template_id = ?, skills_json = ?, model = ?, updated_at = ? WHERE id = ?",
          ).run(roleTemplateId, role.default_skills_json, role.default_model, now, id);
        }
      });
      txn();
    },
```

- [ ] **Step 4: Rodar tests, confirmar PASS**

```bash
pnpm --filter @prospero/main test -- repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents/repository.ts apps/main/src/agents/repository.test.ts
git commit -m "feat(m7c): agents repository — setRole atomic with role template lookup"
```

---

## Task 4: Repository — `setReportsTo` (anti-cycle)

**Files:**
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/src/agents/repository.test.ts`

`setReportsTo` precisa rejeitar ciclos: o novo parent não pode ser descendente do agente alvo. Validação faz traversal de `reports_to` partindo do parent proposto.

- [ ] **Step 1: Adicionar test**

```typescript
describe("setReportsTo", () => {
  it("updates reports_to to a new parent", () => {
    const db = setupDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
    const repo = createAgentsRepository(db);
    const ceo = repo.create({
      companyId: "c1", name: "CEO", role: "ceo", systemPrompt: "p",
      mode: "supervised", alwaysOn: false, model: "claude-opus-4-7", skills: [],
    });
    const eng = repo.create({
      companyId: "c1", name: "Eng", role: "engineer", systemPrompt: "p",
      mode: "supervised", alwaysOn: false, model: "claude-sonnet-4-6", skills: [],
    });
    repo.setReportsTo(eng.id, ceo.id);
    expect(db.prepare("SELECT reports_to FROM agents WHERE id = ?").get(eng.id))
      .toEqual({ reports_to: ceo.id });
  });

  it("accepts null parent (detach to root)", () => {
    const db = setupDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
    const repo = createAgentsRepository(db);
    const eng = repo.create({
      companyId: "c1", name: "Eng", role: "r", systemPrompt: "p",
      mode: "supervised", alwaysOn: false, model: "claude-sonnet-4-6", skills: [],
    });
    db.prepare("UPDATE agents SET reports_to = 'x' WHERE id = ?").run(eng.id);
    repo.setReportsTo(eng.id, null);
    expect(db.prepare("SELECT reports_to FROM agents WHERE id = ?").get(eng.id))
      .toEqual({ reports_to: null });
  });

  it("rejects self as parent", () => {
    const db = setupDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1", name: "A", role: "r", systemPrompt: "p",
      mode: "supervised", alwaysOn: false, model: "claude-sonnet-4-6", skills: [],
    });
    expect(() => repo.setReportsTo(a.id, a.id)).toThrow(/cycle|self/i);
  });

  it("rejects a descendant as parent (would create cycle)", () => {
    const db = setupDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
    const repo = createAgentsRepository(db);
    const ceo = repo.create({
      companyId: "c1", name: "CEO", role: "r", systemPrompt: "p",
      mode: "supervised", alwaysOn: false, model: "claude-sonnet-4-6", skills: [],
    });
    const eng = repo.create({
      companyId: "c1", name: "Eng", role: "r", systemPrompt: "p",
      mode: "supervised", alwaysOn: false, model: "claude-sonnet-4-6", skills: [],
    });
    repo.setReportsTo(eng.id, ceo.id);
    // tentar fazer CEO reportar pra ENG cria ciclo
    expect(() => repo.setReportsTo(ceo.id, eng.id)).toThrow(/cycle/i);
  });
});
```

- [ ] **Step 2: Rodar tests pra confirmar que falham**

```bash
pnpm --filter @prospero/main test -- repository.test.ts
```

Expected: FAIL — `setReportsTo is not a function`.

- [ ] **Step 3: Implementar `setReportsTo` + helper anti-cycle**

Em `apps/main/src/agents/repository.ts`, adicionar ao type:

```typescript
  setReportsTo(id: string, newParentId: string | null): void;
```

E ao return:

```typescript
    setReportsTo(id, newParentId) {
      if (newParentId === null) {
        db.prepare("UPDATE agents SET reports_to = NULL, updated_at = ? WHERE id = ?").run(
          Date.now(),
          id,
        );
        return;
      }
      if (newParentId === id) throw new Error("Agent cannot report to itself (cycle)");
      // Walk newParentId's reports_to chain — if we hit `id`, that's a cycle.
      const stmt = db.prepare("SELECT reports_to FROM agents WHERE id = ?");
      let cursor: string | null = newParentId;
      const seen = new Set<string>();
      while (cursor !== null) {
        if (cursor === id) throw new Error(`reports_to would create a cycle through ${id}`);
        if (seen.has(cursor)) break; // defensive — pre-existing cycle in DB
        seen.add(cursor);
        const row = stmt.get(cursor) as { reports_to: string | null } | undefined;
        cursor = row?.reports_to ?? null;
      }
      db.prepare("UPDATE agents SET reports_to = ?, updated_at = ? WHERE id = ?").run(
        newParentId,
        Date.now(),
        id,
      );
    },
```

- [ ] **Step 4: Rodar tests, confirmar PASS**

```bash
pnpm --filter @prospero/main test -- repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents/repository.ts apps/main/src/agents/repository.test.ts
git commit -m "feat(m7c): agents repository — setReportsTo with cycle detection"
```

---

## Task 5: Orchestrator handler — `restartIfRunning` helper

**Files:**
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

Toda mutação que afeta args do spawn (`--model`, `--allowedTools`, `--system-prompt`) precisa: 1) matar runner se vivo; 2) zerar `claude_session_id`; 3) broadcast `roster-changed`. Empacotar num helper local.

- [ ] **Step 1: Adicionar helper no escopo do `registerOrchestratorHandlers`**

Em `apps/main/src/ipc/orchestrator-handlers.ts`, dentro da função `registerOrchestratorHandlers`, depois da definição de `ensureAgentRunner`:

```typescript
  // Restart helper for config mutations. Trocar --model / --allowedTools /
  // --system-prompt exige re-spawn (claude lê esses args só na inicialização).
  // Strategy: kill runner se vivo, zera claude_session_id pra próxima mensagem
  // não tentar --resume com session stale, broadcast roster pra UI re-render.
  const restartIfRunning = (agentId: string, companyId: string): void => {
    const runner = getRunner(agentId);
    if (runner !== undefined && runner.isAlive()) {
      runner.kill();
      removeRunner(agentId);
    }
    agents.clearSessionId(agentId);
    agents.updateStatus(agentId, { status: "idle", currentAction: null });
    broadcast({ kind: "roster-changed", companyId });
  };
```

(Sem test isolado — coberto via handlers nos próximos steps.)

- [ ] **Step 2: Build verifica que helper compila**

```bash
pnpm --filter @prospero/main build
```

Expected: build OK (helper definido mas não usado ainda — typescript não reclama de unused locals em escopo de função).

Se reclamar de "declared but never read", manter o helper — Task 6 vai consumir. Pode add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` temporário se necessário, mas remove no commit final.

- [ ] **Step 3: Não commitar ainda** — vai junto com Task 6.

---

## Task 6: IPC handlers — os 5 channels novos

**Files:**
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`
- Modify: `apps/main/src/messages/repository.ts` (apenas leitura — se já tem `listByAgent`, ignorar)

- [ ] **Step 1: Verificar API do messages repo pra stats**

```bash
grep -n "listByAgent\|countByAgent" apps/main/src/messages/repository.ts
```

Se `countByAgent` não existir, vamos inline a query no handler de stats.

- [ ] **Step 2: Adicionar os 5 handlers ao fim de `registerOrchestratorHandlers`**

Em `apps/main/src/ipc/orchestrator-handlers.ts`, **antes** do `};` final que fecha `registerOrchestratorHandlers`, adicionar:

```typescript
  ipcMain.handle(
    IPC.AGENTS_SET_MODEL,
    (_e, payload: { agentId: string; model: string }): { ok: true } => {
      // Defense-in-depth: re-validate model id even though renderer also validates.
      // Prevents command injection via --model arg if a malicious renderer bypasses UI.
      const { MODEL_ID_REGEX } = require("@prospero/shared") as {
        MODEL_ID_REGEX: RegExp;
      };
      if (!MODEL_ID_REGEX.test(payload.model)) throw new Error("Invalid model id");
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setModel(payload.agentId, payload.model);
      restartIfRunning(payload.agentId, agent.companyId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_ROLE,
    (_e, payload: { agentId: string; roleTemplateId: string; preserveModel?: boolean }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setRole(payload.agentId, payload.roleTemplateId, {
        preserveModel: payload.preserveModel === true,
      });
      restartIfRunning(payload.agentId, agent.companyId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_SYSTEM_PROMPT,
    (_e, payload: { agentId: string; systemPrompt: string }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setSystemPrompt(payload.agentId, payload.systemPrompt);
      restartIfRunning(payload.agentId, agent.companyId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_REPORTS_TO,
    (_e, payload: { agentId: string; reportsTo: string | null }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setReportsTo(payload.agentId, payload.reportsTo);
      // Não restart — reports_to é metadata visual, não afeta spawn args.
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_STATS,
    (_e, payload: { agentId: string }): import("@prospero/shared").AgentStats => {
      const turnsRow = db
        .prepare(
          `SELECT COUNT(*) as n, MAX(created_at) as last
           FROM messages WHERE sender_kind = 'agent' AND sender_id = ?`,
        )
        .get(payload.agentId) as { n: number; last: number | null };
      return {
        turns: turnsRow.n,
        tokensIn: null, // M8
        tokensOut: null, // M8
        lastActivityAt: turnsRow.last,
      };
    },
  );
```

Trocar o `const { MODEL_ID_REGEX } = require(...)` por import top-of-file (mais limpo). No topo:

```typescript
import { IPC, MODEL_ID_REGEX, ... } from "@prospero/shared";
```

(remove o `require` inline).

- [ ] **Step 3: Build verifica que compila**

```bash
pnpm --filter @prospero/main build
```

Expected: OK. Se houver erros de tipo, ajustar.

- [ ] **Step 4: Smoke test — start app, abrir DevTools, executar invoke**

```bash
pnpm dev
```

Manualmente no DevTools do renderer:

```javascript
await window.prospero
// Deve mostrar os channels novos não expostos ainda (próximo task)
```

Esse step só confirma que o main não crasha no startup. Fecha o app.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/ipc/orchestrator-handlers.ts
git commit -m "feat(m7c): ipc handlers — setModel/setRole/setSystemPrompt/setReportsTo/stats + restart runner"
```

---

## Task 7: Preload + env.d.ts — expor channels ao renderer

**Files:**
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Adicionar ao preload.ts**

Em `apps/main/src/ipc/preload.ts`, no `contextBridge.exposeInMainWorld("prospero", { ... })`, dentro do objeto `agents:` (logo após `setAllowedProjects`), adicionar:

```typescript
    setModel: (agentId: string, model: string) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_MODEL, { agentId, model }) as Promise<{ ok: true }>,
    setRole: (agentId: string, roleTemplateId: string, opts?: { preserveModel?: boolean }) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_ROLE, {
        agentId,
        roleTemplateId,
        ...(opts ?? {}),
      }) as Promise<{ ok: true }>,
    setSystemPrompt: (agentId: string, systemPrompt: string) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_SYSTEM_PROMPT, { agentId, systemPrompt }) as Promise<{
        ok: true;
      }>,
    setReportsTo: (agentId: string, reportsTo: string | null) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_REPORTS_TO, { agentId, reportsTo }) as Promise<{
        ok: true;
      }>,
    stats: (agentId: string) =>
      ipcRenderer.invoke(IPC.AGENTS_STATS, { agentId }) as Promise<
        import("@prospero/shared").AgentStats
      >,
```

- [ ] **Step 2: Adicionar imports do type em preload.ts (se necessário)**

No topo de `preload.ts`, no import block, adicionar `AgentStats`:

```typescript
import {
  IPC,
  // ... existing
  type AgentStats,
} from "@prospero/shared";
```

E trocar `import("@prospero/shared").AgentStats` pela referência direta `AgentStats`.

- [ ] **Step 3: Atualizar env.d.ts**

Em `apps/renderer/src/env.d.ts`, no import block, adicionar `AgentStats`:

```typescript
import type {
  // ... existing
  AgentStats,
} from "@prospero/shared";
```

E no shape de `agents:`, depois de `setAllowedProjects`:

```typescript
        setModel: (agentId: string, model: string) => Promise<{ ok: true }>;
        setRole: (
          agentId: string,
          roleTemplateId: string,
          opts?: { preserveModel?: boolean },
        ) => Promise<{ ok: true }>;
        setSystemPrompt: (agentId: string, systemPrompt: string) => Promise<{ ok: true }>;
        setReportsTo: (agentId: string, reportsTo: string | null) => Promise<{ ok: true }>;
        stats: (agentId: string) => Promise<AgentStats>;
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @prospero/renderer typecheck
pnpm --filter @prospero/main typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m7c): expose agent mutation channels to renderer via preload"
```

---

## Task 8: Renderer — agents store actions

**Files:**
- Modify: `apps/renderer/src/stores/agents.ts`

- [ ] **Step 1: Adicionar actions ao store**

Substituir o conteúdo de `apps/renderer/src/stores/agents.ts`:

```typescript
import { create } from "zustand";
import type { Agent, AgentStats, AgentStatus } from "@prospero/shared";

type State = {
  agents: Agent[];
  loaded: boolean;
  load: (companyId: string) => Promise<void>;
  applyStatus: (agentId: string, status: AgentStatus, currentAction: string | null) => void;
  setAllowedProjects: (agentId: string, projectIds: string[]) => Promise<void>;
  setModel: (agentId: string, model: string) => Promise<void>;
  setRole: (
    agentId: string,
    roleTemplateId: string,
    opts?: { preserveModel?: boolean },
  ) => Promise<void>;
  setSystemPrompt: (agentId: string, systemPrompt: string) => Promise<void>;
  setReportsTo: (agentId: string, reportsTo: string | null) => Promise<void>;
  fetchStats: (agentId: string) => Promise<AgentStats>;
};

const reloadAgentsForCompany = async (
  set: (partial: Partial<State> | ((s: State) => Partial<State>)) => void,
  companyId: string,
): Promise<void> => {
  const list = await window.prospero.agents.list(companyId);
  set({ agents: list });
};

export const useAgentsStore = create<State>((set, get) => ({
  agents: [],
  loaded: false,
  load: async (companyId) => {
    const list = await window.prospero.agents.list(companyId);
    set({ agents: list, loaded: true });
  },
  applyStatus: (agentId, status, currentAction) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, status, currentAction } : a)),
    })),
  setAllowedProjects: async (agentId, projectIds) => {
    await window.prospero.agents.setAllowedProjects(agentId, projectIds);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, allowedProjects: projectIds } : a)),
    }));
  },
  setModel: async (agentId, model) => {
    await window.prospero.agents.setModel(agentId, model);
    // Re-fetch agent canonical row (model + status may have changed).
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  setRole: async (agentId, roleTemplateId, opts) => {
    await window.prospero.agents.setRole(agentId, roleTemplateId, opts);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  setSystemPrompt: async (agentId, systemPrompt) => {
    await window.prospero.agents.setSystemPrompt(agentId, systemPrompt);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, systemPrompt } : a)),
    }));
  },
  setReportsTo: async (agentId, reportsTo) => {
    await window.prospero.agents.setReportsTo(agentId, reportsTo);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  fetchStats: async (agentId) => window.prospero.agents.stats(agentId),
}));
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @prospero/renderer typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/stores/agents.ts
git commit -m "feat(m7c): agents store — setModel/setRole/setSystemPrompt/setReportsTo/fetchStats"
```

---

## Task 9: Renderer — `AgentProjectsEditor` component

**Files:**
- Create: `apps/renderer/src/components/agent-panel/AgentProjectsEditor.tsx`

Componente agent-centric: mostra chips de projetos com toggle (granted/not). Simétrico ao `AgentAccessSection` mas orientado pelo agente.

- [ ] **Step 1: Criar o componente**

```tsx
import { useEffect, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { NO_ACCESS_SENTINEL, type Agent, type Project } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";

type Props = {
  agent: Agent;
  allProjects: Project[];
};

const hasAccess = (agent: Agent, projectId: string): boolean =>
  agent.allowedProjects.length === 0 || agent.allowedProjects.includes(projectId);

export const AgentProjectsEditor: FC<Props> = ({ agent, allProjects }) => {
  const { t } = useTranslation();
  const setAllowedProjects = useAgentsStore((s) => s.setAllowedProjects);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  const granted = allProjects.filter((p) => hasAccess(agent, p.id));
  const ungranted = allProjects.filter((p) => !hasAccess(agent, p.id));

  const revoke = async (project: Project): Promise<void> => {
    // If we're at "all access" ([]), materialize to explicit list minus this one.
    const base =
      agent.allowedProjects.length === 0
        ? allProjects.map((p) => p.id)
        : agent.allowedProjects.filter((id) => id !== NO_ACCESS_SENTINEL);
    const filtered = base.filter((id) => id !== project.id);
    const next = filtered.length === 0 ? [NO_ACCESS_SENTINEL] : filtered;
    await setAllowedProjects(agent.id, next);
  };

  const grant = async (project: Project): Promise<void> => {
    if (agent.allowedProjects.length === 0) return; // already all-access
    const cleaned = agent.allowedProjects.filter((id) => id !== NO_ACCESS_SENTINEL);
    await setAllowedProjects(agent.id, [...cleaned, project.id]);
    setPickerOpen(false);
  };

  return (
    <div className="flex gap-1.5 flex-wrap items-center">
      {granted.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => void revoke(p)}
          title={t("agent.config.projects.removeTitle")}
          className="group text-[11px] px-2 py-0.5 rounded-full bg-brand-bg text-brand hover:bg-semantic-danger hover:text-white transition-colors flex items-center gap-1"
        >
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="opacity-0 group-hover:opacity-100">×</span>
        </button>
      ))}
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={ungranted.length === 0}
          className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-surface-border text-ink-muted hover:text-brand hover:border-brand disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("agent.config.projects.add")}
        </button>
        {pickerOpen && ungranted.length > 0 && (
          <div className="absolute top-full left-0 mt-1 bg-surface-card border border-surface-border rounded shadow-lg p-1 z-10 min-w-[160px]">
            {ungranted.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void grant(p)}
                className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-brand-bg hover:text-brand flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {agent.allowedProjects.length === 0 && (
        <span className="text-[10px] text-ink-soft italic">
          {t("agent.config.projects.allAccess")}
        </span>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @prospero/renderer typecheck
```

Expected: PASS (i18n keys ainda não existem — vão ser adicionadas em Task 16, mas typecheck não valida keys de i18n).

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/agent-panel/AgentProjectsEditor.tsx
git commit -m "feat(m7c): AgentProjectsEditor — agent-centric allowlist chips"
```

---

## Task 10: Renderer — `ChangeRoleModal` + `ConfigTab`

**Files:**
- Create: `apps/renderer/src/components/agent-panel/ChangeRoleModal.tsx`
- Create: `apps/renderer/src/components/agent-panel/ConfigTab.tsx`

`ChangeRoleModal`: dropdown de roles + checkbox "manter model atual" + warning de restart.

`ConfigTab`: Role line + Change... button → modal · Model dropdown · Persona textarea · Projects allowlist.

- [ ] **Step 1: Criar `ChangeRoleModal.tsx`**

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { RoleTemplate } from "@prospero/shared";

type Props = {
  currentRoleId: string | null;
  onConfirm: (roleId: string, preserveModel: boolean) => void | Promise<void>;
  onCancel: () => void;
};

export const ChangeRoleModal: FC<Props> = ({ currentRoleId, onConfirm, onCancel }) => {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(currentRoleId);
  const [preserveModel, setPreserveModel] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const list = await window.prospero.roles.list();
      setRoles(list);
    })();
  }, []);

  const submit = async (): Promise<void> => {
    if (selectedId === null || selectedId === currentRoleId) return;
    setBusy(true);
    try {
      await onConfirm(selectedId, preserveModel);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center">
      <div className="bg-surface-card rounded-lg shadow-xl w-[420px] p-5">
        <h2 className="text-sm font-bold text-brand-dark mb-1">
          {t("agent.config.role.modalTitle")}
        </h2>
        <p className="text-[11px] text-ink-muted mb-4">{t("agent.config.role.modalWarning")}</p>
        <label className="block text-[10px] uppercase text-ink-soft mb-1 font-semibold">
          {t("agent.config.role.selectLabel")}
        </label>
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="w-full text-xs px-2 py-1.5 border border-surface-border rounded mb-3 bg-surface"
        >
          <option value="">—</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.defaultModel})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[11px] text-ink-muted mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={preserveModel}
            onChange={(e) => setPreserveModel(e.target.checked)}
          />
          {t("agent.config.role.preserveModel")}
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || selectedId === null || selectedId === currentRoleId}
            className="text-xs px-3 py-1 bg-brand text-white rounded disabled:opacity-50"
          >
            {busy ? "…" : t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Criar `ConfigTab.tsx`**

```tsx
import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  CLAUDE_MODEL_PRESETS,
  MODEL_ID_REGEX,
  type Agent,
  type RoleTemplate,
} from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { useProjectsStore } from "../../stores/projects.js";
import { AgentProjectsEditor } from "./AgentProjectsEditor.js";
import { ChangeRoleModal } from "./ChangeRoleModal.js";

type Props = { agent: Agent };

export const ConfigTab: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const setModel = useAgentsStore((s) => s.setModel);
  const setRole = useAgentsStore((s) => s.setRole);
  const setSystemPrompt = useAgentsStore((s) => s.setSystemPrompt);
  const allProjects = useProjectsStore((s) => s.projects);

  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [modelPreset, setModelPreset] = useState<string>("");
  const [customModel, setCustomModel] = useState<string>("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [persona, setPersona] = useState(agent.systemPrompt);
  const [personaSavedAt, setPersonaSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const list = await window.prospero.roles.list();
      setRoles(list);
    })();
  }, []);

  // Sync local state when agent prop changes (e.g. after re-load).
  useEffect(() => {
    setPersona(agent.systemPrompt);
    if ((CLAUDE_MODEL_PRESETS as readonly string[]).includes(agent.model)) {
      setModelPreset(agent.model);
      setCustomModel("");
    } else {
      setModelPreset("custom");
      setCustomModel(agent.model);
    }
  }, [agent.id, agent.systemPrompt, agent.model]);

  const currentRole = useMemo(
    () => roles.find((r) => r.id === agent.templateId) ?? null,
    [roles, agent.templateId],
  );

  const onModelPresetChange = async (v: string): Promise<void> => {
    setModelPreset(v);
    setModelError(null);
    if (v === "custom") return; // wait for input
    await setModel(agent.id, v);
  };

  const onCustomModelBlur = async (): Promise<void> => {
    const v = customModel.trim();
    if (v === "") return;
    if (!MODEL_ID_REGEX.test(v)) {
      setModelError(t("agent.config.model.invalid"));
      return;
    }
    setModelError(null);
    await setModel(agent.id, v);
  };

  // Debounced persona save (500ms).
  useEffect(() => {
    if (persona === agent.systemPrompt) return;
    const handle = setTimeout(() => {
      void (async () => {
        await setSystemPrompt(agent.id, persona);
        setPersonaSavedAt(Date.now());
      })();
    }, 500);
    return () => clearTimeout(handle);
  }, [persona, agent.id, agent.systemPrompt, setSystemPrompt]);

  return (
    <div className="p-4 space-y-5 text-xs">
      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.role.label")}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-ink font-medium">
            {currentRole !== null ? currentRole.name : agent.role || "—"}
          </span>
          <button
            type="button"
            onClick={() => setShowRoleModal(true)}
            className="text-[10px] px-2 py-0.5 rounded bg-surface-soft text-ink-muted hover:text-brand"
          >
            {t("agent.config.role.change")}
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.model.label")}
        </h3>
        <select
          value={modelPreset}
          onChange={(e) => void onModelPresetChange(e.target.value)}
          className="w-full px-2 py-1 border border-surface-border rounded bg-surface text-xs"
        >
          {CLAUDE_MODEL_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="custom">{t("agent.config.model.custom")}</option>
        </select>
        {modelPreset === "custom" && (
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            onBlur={() => void onCustomModelBlur()}
            placeholder="claude-..."
            className="mt-2 w-full px-2 py-1 border border-surface-border rounded bg-surface text-xs font-mono"
          />
        )}
        {modelError !== null && <p className="mt-1 text-[10px] text-semantic-danger">{modelError}</p>}
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.skills.label")}
        </h3>
        <div className="flex gap-1 flex-wrap">
          {agent.skills.length === 0 ? (
            <span className="text-[11px] text-ink-soft italic">
              {t("agent.config.skills.empty")}
            </span>
          ) : (
            agent.skills.map((s) => (
              <span
                key={s}
                className="text-[10px] px-2 py-0.5 rounded-full bg-surface-soft text-ink-muted"
              >
                {s}
              </span>
            ))
          )}
        </div>
        <p className="text-[10px] text-ink-soft italic mt-1">
          {t("agent.config.skills.hint")}
        </p>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.persona.label")}
        </h3>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          rows={6}
          className="w-full px-2 py-1.5 border border-surface-border rounded bg-surface text-xs font-mono leading-relaxed"
        />
        {personaSavedAt !== null && (
          <p className="text-[10px] text-semantic-success mt-1">{t("agent.config.persona.saved")}</p>
        )}
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.projects.label")}
        </h3>
        <AgentProjectsEditor agent={agent} allProjects={allProjects} />
      </section>

      {showRoleModal && (
        <ChangeRoleModal
          currentRoleId={agent.templateId}
          onCancel={() => setShowRoleModal(false)}
          onConfirm={async (roleId, preserveModel) => {
            await setRole(agent.id, roleId, { preserveModel });
            setShowRoleModal(false);
          }}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @prospero/renderer typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/agent-panel/ChangeRoleModal.tsx apps/renderer/src/components/agent-panel/ConfigTab.tsx
git commit -m "feat(m7c): ConfigTab + ChangeRoleModal — role/model/persona/projects edit"
```

---

## Task 11: Renderer — `IssuesTab` + `StatsTab`

**Files:**
- Create: `apps/renderer/src/components/agent-panel/IssuesTab.tsx`
- Create: `apps/renderer/src/components/agent-panel/StatsTab.tsx`

- [ ] **Step 1: Criar `IssuesTab.tsx`**

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Issue, IssueStatus } from "@prospero/shared";

type Props = { agentId: string; companyId: string };

const STATUS_COLOR: Record<IssueStatus, string> = {
  backlog: "bg-ink-soft",
  todo: "bg-brand",
  doing: "bg-semantic-warning",
  review: "bg-semantic-info",
  done: "bg-semantic-success",
};

export const IssuesTab: FC<Props> = ({ agentId, companyId }) => {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      const list = await window.prospero.issues.list({ companyId, assigneeId: agentId });
      setIssues(list);
      setLoading(false);
    })();
    const off = window.prospero.issues.onChanged(() => {
      void (async () => {
        const list = await window.prospero.issues.list({ companyId, assigneeId: agentId });
        setIssues(list);
      })();
    });
    return off;
  }, [agentId, companyId]);

  if (loading) {
    return <div className="p-4 text-xs text-ink-muted">…</div>;
  }
  if (issues.length === 0) {
    return <div className="p-4 text-xs text-ink-muted italic">{t("agent.issues.empty")}</div>;
  }
  return (
    <ul className="p-3 space-y-2">
      {issues.map((i) => (
        <li
          key={i.id}
          className="flex items-center gap-2 text-xs hover:bg-surface-soft rounded px-2 py-1.5 cursor-pointer"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[i.status]}`} />
          <span className="flex-1 truncate">{i.title}</span>
          <span className="text-[10px] text-ink-soft uppercase">{i.status}</span>
        </li>
      ))}
    </ul>
  );
};
```

(O click pra abrir o modal de detail M6 é polish — não inclui agora; usuário pode navegar `/issues` manual. Quando a UI de issues evoluir, replugar.)

- [ ] **Step 2: Criar `StatsTab.tsx`**

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { AgentStats } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";

type Props = { agentId: string };

const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return "—";
  const d = new Date(ms);
  return d.toLocaleString();
};

export const StatsTab: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const fetchStats = useAgentsStore((s) => s.fetchStats);
  const [stats, setStats] = useState<AgentStats | null>(null);

  useEffect(() => {
    void (async () => {
      const s = await fetchStats(agentId);
      setStats(s);
    })();
  }, [agentId, fetchStats]);

  if (stats === null) {
    return <div className="p-4 text-xs text-ink-muted">…</div>;
  }
  return (
    <dl className="p-4 grid grid-cols-2 gap-3 text-xs">
      <div>
        <dt className="text-[10px] uppercase text-ink-soft font-semibold">
          {t("agent.stats.turns")}
        </dt>
        <dd className="text-lg font-bold text-brand-dark mt-0.5">{stats.turns}</dd>
      </div>
      <div>
        <dt className="text-[10px] uppercase text-ink-soft font-semibold">
          {t("agent.stats.lastActivity")}
        </dt>
        <dd className="text-[11px] text-ink mt-1.5">{formatTimestamp(stats.lastActivityAt)}</dd>
      </div>
      <div>
        <dt className="text-[10px] uppercase text-ink-soft font-semibold">
          {t("agent.stats.tokensIn")}
        </dt>
        <dd className="text-lg font-bold text-ink-muted mt-0.5">
          {stats.tokensIn ?? "—"}
        </dd>
        <p className="text-[10px] text-ink-soft italic">{t("agent.stats.m8Note")}</p>
      </div>
      <div>
        <dt className="text-[10px] uppercase text-ink-soft font-semibold">
          {t("agent.stats.tokensOut")}
        </dt>
        <dd className="text-lg font-bold text-ink-muted mt-0.5">
          {stats.tokensOut ?? "—"}
        </dd>
      </div>
    </dl>
  );
};
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @prospero/renderer typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/agent-panel/IssuesTab.tsx apps/renderer/src/components/agent-panel/StatsTab.tsx
git commit -m "feat(m7c): IssuesTab + StatsTab — assignee list + turn count"
```

---

## Task 12: Renderer — `AgentConfigPanel` + integrar em `Agent.tsx`

**Files:**
- Create: `apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx`
- Modify: `apps/renderer/src/routes/Agent.tsx`

- [ ] **Step 1: Criar `AgentConfigPanel.tsx`**

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@prospero/shared";
import { ConfigTab } from "./ConfigTab.js";
import { IssuesTab } from "./IssuesTab.js";
import { StatsTab } from "./StatsTab.js";

type Tab = "config" | "issues" | "stats";

type Props = { agent: Agent };

export const AgentConfigPanel: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("config");
  return (
    <aside className="w-80 border-l border-surface-border bg-surface-card flex flex-col">
      <nav className="flex border-b border-surface-border">
        {(["config", "issues", "stats"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 py-2 text-[11px] font-semibold border-b-2 -mb-px ${
              tab === k
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t(`agent.panel.tabs.${k}`)}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">
        {tab === "config" && <ConfigTab agent={agent} />}
        {tab === "issues" && <IssuesTab agentId={agent.id} companyId={agent.companyId} />}
        {tab === "stats" && <StatsTab agentId={agent.id} />}
      </div>
    </aside>
  );
};
```

- [ ] **Step 2: Integrar em `Agent.tsx`**

Em `apps/renderer/src/routes/Agent.tsx`, importar:

```typescript
import { AgentConfigPanel } from "../components/agent-panel/AgentConfigPanel.js";
```

E ajustar o JSX final pra wrappear em flex horizontal. Substituir o `return` do final:

```tsx
  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex h-screen">
      <div className="flex-1 flex flex-col">
        <header className="px-6 py-3.5 border-b border-surface-border flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-md bg-gradient-to-br from-brand to-brand-dark text-white flex items-center justify-center text-[13px] font-bold">
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="font-bold text-[15px] text-brand-dark">{agent.name}</div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              {agent.role} · {agent.status}
            </div>
          </div>
        </header>
        <div className="flex border-b border-surface-border px-6">
          <button
            type="button"
            onClick={() => setTab("chat")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
              tab === "chat"
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("agent.tabs.chat")}
          </button>
          <button
            type="button"
            onClick={() => setTab("delegations")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px flex items-center gap-1.5 ${
              tab === "delegations"
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("agent.tabs.delegations")}
            {delegationMessages.length > 0 && (
              <span className="text-[10px] bg-surface-soft text-ink-muted px-1.5 py-0.5 rounded-full">
                {delegationMessages.length}
              </span>
            )}
          </button>
        </div>
        {tab === "chat" ? (
          <MessageList messages={chatMessages} agents={agents} />
        ) : (
          <DelegationsPanel messages={delegationMessages} currentAgentId={agent.id} agents={agents} />
        )}
        {pendingApprovals.map((req) => (
          <ApprovalCard
            key={req.toolUseId}
            request={req}
            onResolve={(allow) => resolve(req, allow)}
          />
        ))}
        <Composer onSubmit={(text) => void onSend(text)} />
      </div>
      <AgentConfigPanel agent={agent} />
    </div>
  );
};
```

(Note: o outer `<div>` foi `flex flex-col h-screen` antes — vira `flex h-screen` com inner column.)

- [ ] **Step 3: Smoke test visual**

```bash
pnpm dev
```

Abrir um agent route — confirmar que o panel aparece à direita com tabs e que Config tab carrega.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx apps/renderer/src/routes/Agent.tsx
git commit -m "feat(m7c): AgentConfigPanel — 3-tab right side panel in /agents/:id"
```

---

## Task 13: Org chart — `layoutTree.ts` (pure) + tests

**Files:**
- Create: `apps/renderer/src/components/org/layoutTree.ts`
- Create: `apps/renderer/src/components/org/layoutTree.test.ts`

Algoritmo: dado array de agents, retorna `{ nodes: PositionedNode[], width, height }`. Roots = agents com `reportsTo === null`. Layout top-down, children centrados sob parent.

- [ ] **Step 1: Definir contract via tests**

```typescript
import { describe, expect, it } from "vitest";
import { layoutTree, type PositionedNode } from "./layoutTree.js";
import type { Agent } from "@prospero/shared";

const mkAgent = (id: string, reportsTo: string | null): Agent => ({
  id,
  companyId: "c1",
  name: id,
  role: "r",
  systemPrompt: "",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  skills: [],
  templateId: null,
  // @ts-expect-error reportsTo is on the row but we extend the Agent type below in source
  reportsTo,
});

describe("layoutTree", () => {
  it("returns single node centered for a lone CEO", () => {
    const out = layoutTree([mkAgent("ceo", null)]);
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]!.id).toBe("ceo");
    expect(out.nodes[0]!.depth).toBe(0);
  });

  it("places direct children below parent at depth=1", () => {
    const out = layoutTree([
      mkAgent("ceo", null),
      mkAgent("eng1", "ceo"),
      mkAgent("eng2", "ceo"),
    ]);
    const ceo = out.nodes.find((n) => n.id === "ceo")!;
    const eng1 = out.nodes.find((n) => n.id === "eng1")!;
    const eng2 = out.nodes.find((n) => n.id === "eng2")!;
    expect(ceo.depth).toBe(0);
    expect(eng1.depth).toBe(1);
    expect(eng2.depth).toBe(1);
    expect(eng1.y).toBeGreaterThan(ceo.y);
    expect(eng1.x).not.toBe(eng2.x);
  });

  it("orphans (reportsTo points nowhere) become roots", () => {
    const out = layoutTree([mkAgent("orphan", "ghost")]);
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]!.depth).toBe(0);
  });

  it("handles multi-level chain", () => {
    const out = layoutTree([
      mkAgent("a", null),
      mkAgent("b", "a"),
      mkAgent("c", "b"),
    ]);
    const c = out.nodes.find((n) => n.id === "c")!;
    expect(c.depth).toBe(2);
  });
});
```

- [ ] **Step 2: Estender o type Agent shared pra incluir `reportsTo`**

Verificar se `reportsTo` está no type. Olhar `packages/shared/src/types/agent.ts` — atualmente NÃO está. Adicionar:

```typescript
export type Agent = {
  // ... existing
  reportsTo: string | null; // adicionar
};
```

E em `apps/main/src/agents/repository.ts`, no `rowToAgent`:

```typescript
const rowToAgent = (r: Row): Agent => ({
  // ... existing
  reportsTo: r.reports_to,
});
```

(Já existe coluna `reports_to` em row e schema.)

- [ ] **Step 3: Rodar tests pra confirmar que falham**

```bash
pnpm --filter @prospero/renderer test -- layoutTree
```

Expected: FAIL — `layoutTree is not defined`.

- [ ] **Step 4: Implementar `layoutTree.ts`**

```typescript
import type { Agent } from "@prospero/shared";

export type PositionedNode = {
  id: string;
  name: string;
  role: string;
  status: string;
  templateId: string | null;
  reportsTo: string | null;
  depth: number;
  x: number;
  y: number;
};

export type LayoutResult = {
  nodes: PositionedNode[];
  width: number;
  height: number;
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const H_GAP = 28;
const V_GAP = 56;

type LayoutNode = {
  agent: Agent;
  children: LayoutNode[];
  subtreeWidth: number;
};

// Reingold-Tilford-lite: each subtree occupies enough width for its leaves.
// First pass computes subtree width bottom-up; second pass assigns x left-to-right.
export const layoutTree = (agents: Agent[]): LayoutResult => {
  if (agents.length === 0) return { nodes: [], width: 0, height: 0 };

  const byId = new Map<string, Agent>();
  for (const a of agents) byId.set(a.id, a);

  // Build LayoutNode tree(s). An agent is a root if reportsTo is null OR points at
  // a missing agent.
  const childrenOf = new Map<string, Agent[]>();
  const roots: Agent[] = [];
  for (const a of agents) {
    const parentId = a.reportsTo;
    if (parentId === null || !byId.has(parentId)) {
      roots.push(a);
    } else {
      const arr = childrenOf.get(parentId) ?? [];
      arr.push(a);
      childrenOf.set(parentId, arr);
    }
  }

  const build = (a: Agent): LayoutNode => {
    const kids = (childrenOf.get(a.id) ?? []).map(build);
    const subtreeWidth =
      kids.length === 0
        ? NODE_WIDTH
        : kids.reduce((acc, k) => acc + k.subtreeWidth, 0) + H_GAP * (kids.length - 1);
    return { agent: a, children: kids, subtreeWidth };
  };

  const layoutRoots = roots.map(build);
  const totalWidth =
    layoutRoots.reduce((acc, r) => acc + r.subtreeWidth, 0) +
    H_GAP * Math.max(0, layoutRoots.length - 1);

  const out: PositionedNode[] = [];
  let cursorX = 0;

  const place = (node: LayoutNode, depth: number, leftX: number): void => {
    const myX = leftX + node.subtreeWidth / 2 - NODE_WIDTH / 2;
    out.push({
      id: node.agent.id,
      name: node.agent.name,
      role: node.agent.role,
      status: node.agent.status,
      templateId: node.agent.templateId,
      reportsTo: node.agent.reportsTo,
      depth,
      x: myX,
      y: depth * (NODE_HEIGHT + V_GAP),
    });
    let childCursor = leftX;
    for (const k of node.children) {
      place(k, depth + 1, childCursor);
      childCursor += k.subtreeWidth + H_GAP;
    }
  };

  for (const r of layoutRoots) {
    place(r, 0, cursorX);
    cursorX += r.subtreeWidth + H_GAP;
  }

  const maxDepth = Math.max(0, ...out.map((n) => n.depth));
  const height = (maxDepth + 1) * (NODE_HEIGHT + V_GAP);
  return { nodes: out, width: totalWidth, height };
};

export const NODE_DIMENSIONS = {
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
  hGap: H_GAP,
  vGap: V_GAP,
};
```

- [ ] **Step 5: Rodar tests, confirmar PASS**

```bash
pnpm --filter @prospero/renderer test -- layoutTree
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/agent.ts apps/main/src/agents/repository.ts apps/renderer/src/components/org/layoutTree.ts apps/renderer/src/components/org/layoutTree.test.ts
git commit -m "feat(m7c): layoutTree pure function + reportsTo on Agent type"
```

---

## Task 14: Org chart — `Org.tsx` render + click drawer

**Files:**
- Create: `apps/renderer/src/components/org/OrgNode.tsx`
- Create: `apps/renderer/src/routes/Org.tsx`

- [ ] **Step 1: Criar `OrgNode.tsx`**

```tsx
import { type FC } from "react";
import type { PositionedNode } from "./layoutTree.js";

type Props = {
  node: PositionedNode;
  selected: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onClick: () => void;
};

const STATUS_FILL: Record<string, string> = {
  idle: "#a0a4ab",
  thinking: "#5a8fff",
  working: "#3fbf5f",
  waiting: "#f3a83c",
  error: "#e2434a",
};

export const OrgNode: FC<Props> = ({ node, selected, dragging, onPointerDown, onClick }) => {
  const fill = STATUS_FILL[node.status] ?? "#a0a4ab";
  return (
    <g
      transform={`translate(${String(node.x)}, ${String(node.y)})`}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <rect
        width={180}
        height={80}
        rx={8}
        fill={selected ? "#eef2ff" : "white"}
        stroke={selected ? "#5a8fff" : "#d0d4dc"}
        strokeWidth={selected ? 2 : 1}
        style={{ opacity: dragging ? 0.5 : 1 }}
      />
      <circle cx={20} cy={20} r={14} fill="url(#avatar-grad)" />
      <text x={20} y={25} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">
        {node.name.slice(0, 2).toUpperCase()}
      </text>
      <text x={44} y={22} fontSize="13" fontWeight="700" fill="#1f2937">
        {node.name}
      </text>
      <text x={44} y={38} fontSize="10" fill="#6b7280">
        {node.role || "—"}
      </text>
      <circle cx={20} cy={62} r={4} fill={fill} />
      <text x={32} y={66} fontSize="10" fill="#6b7280" textTransform="capitalize">
        {node.status}
      </text>
    </g>
  );
};
```

- [ ] **Step 2: Criar `Org.tsx`**

```tsx
import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { useIssuesStore } from "../stores/issues.js";
import { layoutTree, NODE_DIMENSIONS } from "../components/org/layoutTree.js";
import { OrgNode } from "../components/org/OrgNode.js";

export const Org: FC = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const issues = useIssuesStore((s) => s.issues);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const layout = useMemo(() => layoutTree(agents), [agents]);
  const selected = useMemo(
    () => (selectedId !== null ? agents.find((a) => a.id === selectedId) ?? null : null),
    [agents, selectedId],
  );
  const selectedOpenIssues = useMemo(
    () => (selected !== null ? issues.filter((i) => i.assigneeId === selected.id && i.status !== "done").length : 0),
    [issues, selected],
  );

  // Map id → positioned node for edge rendering.
  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of layout.nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [layout]);

  const edges = useMemo(() => {
    return layout.nodes
      .filter((n) => n.reportsTo !== null && positions.has(n.reportsTo))
      .map((n) => ({
        from: positions.get(n.reportsTo!)!,
        to: { x: n.x, y: n.y },
        childId: n.id,
      }));
  }, [layout, positions]);

  // ESC closes drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (agents.length === 0) {
    return <div className="p-8 text-ink-muted text-sm">{t("org.empty")}</div>;
  }

  const svgWidth = layout.width + 48;
  const svgHeight = layout.height + 48;

  return (
    <div className="h-full flex">
      <div className="flex-1 overflow-auto bg-surface-soft p-6">
        <svg width={svgWidth} height={svgHeight} className="bg-surface-card rounded shadow-sm">
          <defs>
            <linearGradient id="avatar-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5a8fff" />
              <stop offset="100%" stopColor="#3850b0" />
            </linearGradient>
          </defs>
          <g transform="translate(24, 24)">
            {edges.map((e, i) => {
              const startX = e.from.x + NODE_DIMENSIONS.width / 2;
              const startY = e.from.y + NODE_DIMENSIONS.height;
              const endX = e.to.x + NODE_DIMENSIONS.width / 2;
              const endY = e.to.y;
              const midY = (startY + endY) / 2;
              return (
                <path
                  key={`edge-${e.childId}-${String(i)}`}
                  d={`M${String(startX)},${String(startY)} L${String(startX)},${String(midY)} L${String(endX)},${String(midY)} L${String(endX)},${String(endY)}`}
                  fill="none"
                  stroke="#d0d4dc"
                  strokeWidth={1.5}
                />
              );
            })}
            {layout.nodes.map((n) => (
              <OrgNode
                key={n.id}
                node={n}
                selected={n.id === selectedId}
                dragging={false}
                onPointerDown={() => {
                  /* Task 15: drag handler */
                }}
                onClick={() => setSelectedId(n.id)}
              />
            ))}
          </g>
        </svg>
      </div>
      {selected !== null && (
        <aside className="w-80 border-l border-surface-border bg-surface-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-md bg-gradient-to-br from-brand to-brand-dark text-white flex items-center justify-center text-base font-bold">
              {selected.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <h2 className="text-base font-bold text-brand-dark">{selected.name}</h2>
              <p className="text-[11px] text-ink-muted">{selected.role || "—"}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-ink-muted hover:text-ink"
            >
              ×
            </button>
          </div>
          <dl className="space-y-3 text-xs">
            <div>
              <dt className="text-[10px] uppercase text-ink-soft font-semibold">
                {t("org.drawer.model")}
              </dt>
              <dd className="font-mono text-[11px]">{selected.model}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-ink-soft font-semibold">
                {t("org.drawer.status")}
              </dt>
              <dd className="capitalize">{selected.status}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-ink-soft font-semibold">
                {t("org.drawer.openIssues")}
              </dt>
              <dd>{selectedOpenIssues}</dd>
            </div>
          </dl>
          <Link
            to={`/agents/${selected.id}`}
            className="mt-5 block text-center text-xs px-3 py-2 bg-brand text-white rounded font-semibold"
          >
            {t("org.drawer.openAgent")}
          </Link>
        </aside>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Smoke test visual**

(Sidebar link e route serão adicionados em Task 16 — por ora pode navegar via `#/org` no DevTools.)

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/org/OrgNode.tsx apps/renderer/src/routes/Org.tsx
git commit -m "feat(m7c): Org chart route — SVG vertical tree + click drawer"
```

---

## Task 15: Org chart — drag + `ReassignConfirmModal`

**Files:**
- Create: `apps/renderer/src/components/org/ReassignConfirmModal.tsx`
- Modify: `apps/renderer/src/routes/Org.tsx`

- [ ] **Step 1: Criar `ReassignConfirmModal.tsx`**

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  childName: string;
  newParentName: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};

export const ReassignConfirmModal: FC<Props> = ({
  childName,
  newParentName,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center">
      <div className="bg-surface-card rounded-lg shadow-xl w-[400px] p-5">
        <h2 className="text-sm font-bold text-brand-dark mb-3">{t("org.reassign.title")}</h2>
        <p className="text-xs text-ink-muted mb-5">
          {t("org.reassign.message", { child: childName, parent: newParentName })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
            disabled={busy}
            className="text-xs px-3 py-1 bg-brand text-white rounded disabled:opacity-50"
          >
            {busy ? "…" : t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Adicionar drag-state em `Org.tsx`**

No topo do `Org` component, depois dos hooks existentes, adicionar:

```typescript
  const setReportsTo = useAgentsStore((s) => s.setReportsTo);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [pendingReassign, setPendingReassign] = useState<{ childId: string; parentId: string } | null>(null);
```

- [ ] **Step 3: Implementar handlers de drag**

Dentro do `Org` component, antes do `return`, adicionar:

```typescript
  const onDragStart = (id: string, e: React.PointerEvent<SVGGElement>): void => {
    setDraggingId(id);
    setDragPos({ x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (draggingId === null) return;
    setDragPos({ x: e.clientX, y: e.clientY });
    // Hit-test: find which node the cursor is over (in SVG coords).
    const svgEl = e.currentTarget;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgEl.getScreenCTM();
    if (ctm === null) return;
    const local = pt.matrixTransform(ctm.inverse());
    // Adjust for the outer translate(24,24) wrap.
    const lx = local.x - 24;
    const ly = local.y - 24;
    let foundId: string | null = null;
    for (const n of layout.nodes) {
      if (n.id === draggingId) continue;
      if (
        lx >= n.x &&
        lx <= n.x + NODE_DIMENSIONS.width &&
        ly >= n.y &&
        ly <= n.y + NODE_DIMENSIONS.height
      ) {
        foundId = n.id;
        break;
      }
    }
    setHoverTargetId(foundId);
  };

  const onDragEnd = (): void => {
    if (draggingId !== null && hoverTargetId !== null) {
      setPendingReassign({ childId: draggingId, parentId: hoverTargetId });
    }
    setDraggingId(null);
    setHoverTargetId(null);
    setDragPos(null);
  };

  const childName = pendingReassign !== null
    ? agents.find((a) => a.id === pendingReassign.childId)?.name ?? "?"
    : "";
  const parentName = pendingReassign !== null
    ? agents.find((a) => a.id === pendingReassign.parentId)?.name ?? "?"
    : "";
```

- [ ] **Step 4: Conectar handlers no SVG**

No `<svg>` adicionar `onPointerMove={onDragMove}` e `onPointerUp={onDragEnd}`:

```tsx
        <svg
          width={svgWidth}
          height={svgHeight}
          className="bg-surface-card rounded shadow-sm select-none"
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
        >
```

Trocar o `onPointerDown` do `<OrgNode>`:

```tsx
              <OrgNode
                key={n.id}
                node={n}
                selected={n.id === selectedId || n.id === hoverTargetId}
                dragging={n.id === draggingId}
                onPointerDown={(e) => onDragStart(n.id, e)}
                onClick={() => {
                  if (draggingId === null) setSelectedId(n.id);
                }}
              />
```

E renderizar o modal antes do `</div>` final:

```tsx
      {pendingReassign !== null && (
        <ReassignConfirmModal
          childName={childName}
          newParentName={parentName}
          onCancel={() => setPendingReassign(null)}
          onConfirm={async () => {
            await setReportsTo(pendingReassign.childId, pendingReassign.parentId);
            setPendingReassign(null);
          }}
        />
      )}
```

Importar `ReassignConfirmModal` no topo do arquivo.

- [ ] **Step 5: Smoke test visual**

```bash
pnpm dev
```

Navegar `#/org`, hire alguns agentes, fazer drag de um. Confirm modal aparece — confirmar — node move pra novo parent. Tentar drag em si próprio (não deve abrir modal — hit-test ignora). Cancel funciona.

Test edge case: drag pra um descendente (ciclo). Backend rejeita; UI mostra erro via window.alert ou silently fails? Hoje a action `setReportsTo` no store fará `throw` se o IPC handler throw. Adicionar try/catch no `onConfirm`:

```typescript
onConfirm={async () => {
  try {
    await setReportsTo(pendingReassign.childId, pendingReassign.parentId);
  } catch (err) {
    alert(t("org.reassign.cycleError"));
  }
  setPendingReassign(null);
}}
```

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/components/org/ReassignConfirmModal.tsx apps/renderer/src/routes/Org.tsx
git commit -m "feat(m7c): org chart drag-to-reassign + confirm modal + cycle error toast"
```

---

## Task 16: Sidebar link + route + i18n

**Files:**
- Modify: `apps/renderer/src/App.tsx`
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`

- [ ] **Step 1: Adicionar import e route em `App.tsx`**

No `App.tsx`, no import block:

```typescript
import { Org } from "./routes/Org.js";
```

Adicionar NavLink no Sidebar (entre `/issues` e `/skills`):

```tsx
        <NavLink
          to="/org"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.orgChart")}
        </NavLink>
```

Adicionar `<Route>` (similar a outros, antes do `*` catch-all):

```tsx
        <Route
          path="/org"
          element={
            hasToken ? (
              <Layout>
                <Org />
              </Layout>
            ) : (
              <Navigate to="/setup" replace />
            )
          }
        />
```

- [ ] **Step 2: Adicionar keys i18n em `pt-BR.json`**

Em `apps/renderer/src/i18n/pt-BR.json`:

No `nav`:
```json
    "orgChart": "Organograma",
```

Adicionar (no top-level, pode ser ao fim, antes do `}`):
```json
  "common": {
    "cancel": "Cancelar",
    "confirm": "Confirmar",
    "delete": "Excluir"
  },
  "org": {
    "empty": "Nenhum agente contratado ainda.",
    "drawer": {
      "model": "Modelo",
      "status": "Status",
      "openIssues": "Issues abertas",
      "openAgent": "Abrir agente →"
    },
    "reassign": {
      "title": "Mudar reporting line",
      "message": "Mover {{child}} para reportar a {{parent}}?",
      "cycleError": "Não é possível: criaria um ciclo na hierarquia."
    }
  },
  "agent": {
    "...": "...",
    "panel": {
      "tabs": {
        "config": "Config",
        "issues": "Issues",
        "stats": "Stats"
      }
    },
    "config": {
      "role": {
        "label": "Papel",
        "change": "Mudar...",
        "modalTitle": "Mudar papel do agente",
        "modalWarning": "Trocar o papel reinicia o agente. Skills e modelo serão atualizados conforme o template.",
        "selectLabel": "Novo papel",
        "preserveModel": "Manter o modelo atual (não usar default do papel)"
      },
      "model": {
        "label": "Modelo",
        "custom": "Customizado...",
        "invalid": "Model id inválido"
      },
      "persona": {
        "label": "Persona",
        "saved": "Salvo"
      },
      "projects": {
        "label": "Projetos",
        "add": "+ adicionar",
        "removeTitle": "Remover acesso",
        "allAccess": "(acesso a todos os projetos)"
      },
      "skills": {
        "label": "Skills",
        "empty": "Nenhuma skill atribuída.",
        "hint": "Skills são definidas pelo papel. Mude o papel para atualizar."
      }
    },
    "issues": {
      "empty": "Sem issues atribuídas."
    },
    "stats": {
      "turns": "Turnos",
      "tokensIn": "Tokens entrada",
      "tokensOut": "Tokens saída",
      "lastActivity": "Última atividade",
      "m8Note": "Tracking disponível em M8."
    }
  }
```

(Note: integrar com `agent` existente sem duplicar — abrir o JSON e mergear no nível certo. As keys `agent.tabs.chat` etc. já existem; **NÃO** sobrescrever.)

- [ ] **Step 3: Adicionar keys i18n em `en-US.json`**

Mesmo shape em inglês. Cópia mental:

```json
  "common": {
    "cancel": "Cancel",
    "confirm": "Confirm",
    "delete": "Delete"
  },
  "org": {
    "empty": "No agents hired yet.",
    "drawer": {
      "model": "Model",
      "status": "Status",
      "openIssues": "Open issues",
      "openAgent": "Open agent →"
    },
    "reassign": {
      "title": "Change reporting line",
      "message": "Move {{child}} to report to {{parent}}?",
      "cycleError": "Cannot: would create a hierarchy cycle."
    }
  },
```

E o `agent.panel`, `agent.config`, `agent.issues`, `agent.stats`:

```json
    "panel": {
      "tabs": { "config": "Config", "issues": "Issues", "stats": "Stats" }
    },
    "config": {
      "role": {
        "label": "Role",
        "change": "Change...",
        "modalTitle": "Change agent role",
        "modalWarning": "Changing the role restarts the agent. Skills and model are updated per template.",
        "selectLabel": "New role",
        "preserveModel": "Keep current model (don't use role default)"
      },
      "model": {
        "label": "Model",
        "custom": "Custom...",
        "invalid": "Invalid model id"
      },
      "persona": { "label": "Persona", "saved": "Saved" },
      "projects": {
        "label": "Projects",
        "add": "+ add",
        "removeTitle": "Remove access",
        "allAccess": "(access to all projects)"
      },
      "skills": {
        "label": "Skills",
        "empty": "No skills assigned.",
        "hint": "Skills are determined by role. Change the role to update."
      }
    },
    "issues": { "empty": "No assigned issues." },
    "stats": {
      "turns": "Turns",
      "tokensIn": "Tokens in",
      "tokensOut": "Tokens out",
      "lastActivity": "Last activity",
      "m8Note": "Tracking available in M8."
    }
```

E `nav.orgChart`: `"Org Chart"`.

- [ ] **Step 4: Validar i18n parity test**

```bash
pnpm --filter @prospero/renderer test -- i18n
```

Expected: PASS — se o suite tem um test que checa as keys são as mesmas em PT-BR e EN-US, ele vai pegar inconsistências. Se falhar, alinhar as keys.

Se não houver i18n test, esse passo só verifica typecheck:

```bash
pnpm --filter @prospero/renderer typecheck
```

- [ ] **Step 5: Smoke test full pass**

```bash
pnpm dev
```

Conferir:
- Sidebar tem link "Organograma" / "Org Chart" (conforme idioma)
- `/org` carrega
- `/agents/:id` tem right panel funcional (todas as 3 tabs)
- Toggle de language (Settings) muda os strings

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/App.tsx apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json
git commit -m "feat(m7c): sidebar link + /org route + i18n keys (pt-BR + en-US)"
```

---

## Task 17: Verification

- [ ] **Step 1: Run full lint**

```bash
pnpm lint
```

Expected: 0 errors.

- [ ] **Step 2: Run full typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass. Compare contagem com baseline (memory: ~260 tests). Esperar acrescentar ~10-15 novos.

- [ ] **Step 4: Build production**

```bash
pnpm build
```

Expected: build limpo.

- [ ] **Step 5: Smoke test final**

```bash
pnpm dev
```

Roteiro:
1. Hire 3 agentes (CEO + 2 engineers via `hire_agent`).
2. Abrir `/org` — ver tree com CEO no topo.
3. Drag um engineer pra outro engineer — confirm modal — confirm — node move.
4. Drag em si mesmo — não deve fazer nada (hit-test ignora self).
5. Tentar drag CEO pra engineer (ciclo) — confirm modal aparece, mas backend rejeita — alert aparece "criaria ciclo".
6. Voltar `/agents/:id` do CEO — right panel mostra Config tab.
7. Mudar model do CEO via dropdown — escolher Haiku — observar status virar "idle" (runner morreu).
8. Enviar mensagem — re-spawn ocorre transparentemente — resposta volta.
9. "Change role..." → escolher Engineer → confirm — agent é restarted.
10. Tab Issues — lista issues atribuídas ao agent (vazio se nenhuma).
11. Tab Stats — mostra `turns` real (>0 se mandou mensagens) e `lastActivity` recente; `tokens` placeholder "—".
12. Trocar language Settings → PT-BR ↔ EN-US — strings novas mudam.

Se algo falhar, debug e fix antes de commit final.

---

## Task 18: Commit final + atualização de memory + ROADMAP

- [ ] **Step 1: Marcar PR-C como mergeado no ROADMAP**

Em `ROADMAP.md`, na seção M7, marcar como `✅` os itens de PR-C:
- `[x] Org Chart` (todos os 4 sub-bullets)
- `[x] Em /agents/:id right panel: campo "Skills"` (se mostrado)
- `[x] Right panel em /agents/:id`

E atualizar o header da M7:
```
**M7 — Org Chart + Skills + Model Selection — ✅ MERGEADO**
```

Adicionar entry de progress no topo:
```
> **Última atualização:** YYYY-MM-DD (M7 PR-C mergeado — `<sha>`)
```

- [ ] **Step 2: Commit ROADMAP**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): m7 pr-c mergeado — org chart + right panel done"
```

- [ ] **Step 3: Atualizar memory `project_m7_progress.md`**

Editar `C:\Users\hever\.claude\projects\d--Projetos-pessoais-Prospero\memory\project_m7_progress.md`:

- Header: "M7 completo (PR-A + PR-B + PR-C mergeados)"
- Adicionar PR-C ao **Status**:
  ```
  - **PR-C (`<sha>` em master)** — Org chart + right panel: rota `/org` SVG handcrafted com drag-to-reassign + confirm modal, AgentConfigPanel 3-tab (Config/Issues/Stats), 5 IPC handlers novos (setModel/setRole/setSystemPrompt/setReportsTo/stats), `restartIfRunning` helper. ~18 commits.
  ```
- Atualizar **Próximo trabalho** para **M7.5 (adapter foundation)**.

- [ ] **Step 4: Salvar memory + criar memory M7 lessons (opcional)**

Se houver lições técnicas notáveis (e.g. SVG hit-test edge cases, ciclo de re-render do AgentConfigPanel após setRole, etc.), criar `project_m7_lessons.md` no diretório memory e adicionar entrada no `MEMORY.md` index.

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| `/org` route com tree vertical | Task 13–14 |
| CEO no topo via `reports_to` | Task 13 layoutTree (roots = reportsTo null) |
| Click node abre drawer | Task 14 |
| Drag pra mudar `reports_to` | Task 15 |
| Confirm modal | Task 15 ReassignConfirmModal |
| Anti-cycle | Task 4 backend + Task 15 try/catch UI |
| Right panel 320px em `/agents/:id` | Task 12 (w-80 = 320px) |
| 3 tabs Config/Issues/Stats | Task 10–12 |
| Config: role dropdown + warning | Task 10 ChangeRoleModal |
| Config: model dropdown + custom | Task 10 ConfigTab |
| Config: persona edit-in-place | Task 10 ConfigTab |
| Config: AllowlistEditor | Task 9 AgentProjectsEditor |
| Issues tab | Task 11 IssuesTab |
| Stats tab placeholder | Task 11 StatsTab |
| IPC `agents:setRole` | Task 6 |
| IPC `agents:setModel` | Task 6 |
| IPC `agents:setSystemPrompt` | Task 6 |
| IPC `agents:listIssues` | **Omitido** (renderer usa `issues.list` existente — decisão registrada no header) |
| IPC `agents:stats` | Task 6 |
| Kill runner + zerar session_id + broadcast | Task 5 `restartIfRunning` |
| Sidebar link `🌳 Org Chart` | Task 16 |

**Placeholder scan:** Nenhum "TBD", "fill in details", "add error handling" sem código. Cada step tem snippet completo. Edge case de ciclo coberto em backend (Task 4) e UI (Task 15).

**Type consistency:**
- `Agent.reportsTo` adicionado em Task 13 — usado em Task 4 (`setReportsTo`), Task 13 (layoutTree), Task 14 (Org.tsx), Task 15 (drag).
- `AgentStats` definido em Task 1 — usado em Task 6 (handler), Task 11 (StatsTab), Task 8 (store).
- `setRole(id, roleTemplateId, opts?: { preserveModel? })` signature consistente entre Task 3 (repo), Task 6 (handler), Task 7 (preload), Task 8 (store), Task 10 (ChangeRoleModal).
- `MODEL_ID_REGEX` reuso de shared (já existe).
- `NO_ACCESS_SENTINEL` reuso de shared (já existe).

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-05-11-m7-pr-c-org-chart-right-panel.md`.

**Recomendação:** **Inline execution** (per memory `feedback_subagent_worktree_cwd`: subagents falharam em commitar no worktree em M7-A/M7-B; inline > subagent pra tasks mecânicas com plano detalhado). Tarefas têm steps TDD com snippets completos — execução direta com checkpoints (commit ao fim de cada task) já dá granularidade suficiente para review entre passos.
