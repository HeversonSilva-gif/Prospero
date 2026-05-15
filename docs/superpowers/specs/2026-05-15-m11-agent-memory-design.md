# M11 — Agent Memory & Learning Loop — Design

> **Status:** design aprovado (2026-05-15). Base para os planos de execução `docs/superpowers/plans/2026-05-15-m11-pr-*`.
>
> **Origem:** pesquisa Hermes Agent (`docs/hermes-memory-learning-system.md`) + decisão V2 (ROADMAP.md §"Visão V2"). M11 é a **âncora da V2** — primeira feature pós-v1.
>
> **Pré-requisitos:** M10 (v1 fechado), M8 (cost budget), M8.5 (Goals → retrospectivas), M7.6 (terminate → modal), M7.7 (activity stream), M9 (inbox, compaction).

---

## 1. Contexto e objetivo

V1 entrega "um time de IA gerenciado via chat". M11 muda a natureza do produto: agentes ganham **memória persistente cross-sessão** e a empresa ganha um **loop fechado de aprendizagem** — depois de cada issue concluído, o sistema extrai automaticamente um "skill" (procedimento testado) do trabalho real, o usuário revisa, e o conhecimento passa a transferir entre funcionários do mesmo role.

Sem M11, as outras apostas V2 (Enforced Outcomes, Routines, Plays) funcionam mas são estáticas — não compoundam.

### 1.1 As três inflexões deliberadas vs Hermes

1. **Skills > MEMORY.md.** Foco em memória procedural (skills, ~4 KB de budget L0) sobre declarativa (MEMORY.md cai pra ~1 KB). "User prefere tabs" é território de CLAUDE.md/persona; "como migrar schema X em 12 passos" é skill — valor 4× maior e carrega só quando precisa.
2. **Memória derivada do Activity stream, não auto-narrada.** O Hermes pede o agente narrar lições (viés de auto-narração + bloat). Nós temos trilha objetiva (`activity_events` M7.7, `issue_artifacts` M7.5, `cost_events` M8). Um pipeline de derivação assíncrono lê a trilha e propõe skill candidates; o agente não decide o que lembrar.
3. **Company-wide memory + role-based inheritance desde o dia 1.** Hermes é single-agent. Nós temos org-chart + role templates: skills e memories com `applies_to_role` são herdados em `hire_agent`. Demitir o BackendEng e contratar outro pro mesmo role transfere o conhecimento institucional.

### 1.2 Arquitetura — matriz 3×2

3 camadas cognitivas × 2 níveis, fluxo bidirecional:

| Camada | Individual (agente) | Coletivo (company) |
|---|---|---|
| **Declarativa** | `memory.md` do agente (~1 KB) | `memory.md` da company (~1.5 KB) + `user.md` global |
| **Procedural** | skills privados do agente | skills company-shared (role-scoped) |
| **Episódica** | `session_search(query, agent_id=X)` | `session_search(query)` cross-agente |

- **Descendente** (company → agente): `hire_agent` carrega skills + memories com `applies_to_role` correspondente.
- **Ascendente** (agente → company): `skill_promote` (aprovação via inbox) + `memory_add({applies_to_role})` + retrospectivas do CEO em `goal.achieved`.

---

## 2. Decisões em aberto resolvidas

A ROADMAP §M11 deixou três pontos sem definição. Resolvidos assim:

### 2.1 Mecanismo do derivation worker

Um job de derivação precisa de uma chamada LLM one-shot headless (lê o trail de um issue → propõe um SKILL.md). **Decisão:** reusar o adapter existente em vez de criar um caminho LLM novo.

- Um *derivation runner* faz um `claude -p` (print mode), modelo **`claude-sonnet-4-6`** (mais barato que o Opus default dos agentes), com `--strict-mcp-config` e config MCP vazia — o prompt de derivação não precisa de tools.
- O trail (issue comments + tool history + artifacts, ou os últimos turns antes de um recovery, ou o snapshot de um Goal) é montado do SQLite pelo worker e **embutido no prompt**. Nenhum acesso a filesystem/tools é concedido.
- O `stream-json` de saída fornece o token usage → vira um `cost_event` no orçamento do agente (M8). Funciona igual em OAuth Max e API-key: o budget é contado em tokens (`maxTokensPerDayPerAgent`).
- Execução: in-process, async, fila throttled. Hard cap **3 derivações/dia/agente** (configurável em Settings).
- Falha (timeout, exit≠0, output não-parseável): **drop silencioso + log**. Nunca bloqueia o activity write que originou o job.

### 2.2 Trigger `agent.recovered` (novo evento)

Não existe evento de "recovery após erro" hoje. **Decisão:** adicionar a activity action `agent.recovered`.

- Emitida quando um turn de agente conclui com sucesso **e** o turn imediatamente anterior do mesmo agente no mesmo issue terminou em erro.
- O orchestrator mantém estado in-process por `(agentId, issueId)`: flag `lastTurnErrored`. Próximo turn bem-sucedido → emite `agent.recovered`, limpa a flag.
- Emissão ampla; o derivation worker (e seu cap de 3/dia) filtra o que vira skill — o prompt de derivação pode retornar "descartar, não é skill-worthy".

### 2.3 `user.correction` por sinais objetivos

A ROADMAP propunha heurística NLP sobre mensagens ("user: not X, do Y") — frágil e propensa a falso-positivo. **Decisão:** substituir por sinais inequívocos que já existem:

- **`approval.rejected`** — usuário rejeitou um request de permissão / decisão do agente.
- **Regressão de status de issue feita pelo usuário** — issue movido para trás (`done`/`review` → `in_progress`/`todo`) pelo ator `user`.

O worker lê o artefato rejeitado + o motivo → deriva um fragmento de **`memory`** declarativo (`kind='preference'`) — correção é preferência, não procedimento. Zero código de NLP.

### 2.4 Os 4 triggers de derivação consolidados

| Trigger | Fonte | Saída |
|---|---|---|
| `issue.status_changed` → `done` | M6 kanban | `skill_candidate` (procedural) |
| `agent.recovered` | novo evento §2.2 | `skill_candidate` ("como evitar X") |
| `goal.status_changed` → `achieved` | M8.5 | `memory` `kind='retrospective'` em company scope |
| `approval.rejected` + regressão de issue | M8 / M6 | `memory` `kind='preference'` (agent scope) |

A retrospectiva de `goal.achieved` é gerada pelo **mesmo derivation runner headless** (§2.1) — não interrompe o agente CEO com um turn extra. O prompt é escrito da perspectiva da company; o resultado é atribuído ao company scope, não consome o budget de nenhum agente individual (consome o budget da company, se houver, ou um budget de derivação dedicado).

---

## 3. Correções factuais sobre a ROADMAP §M11

A ROADMAP foi escrita antes da reconciliação com o código. Correções aplicadas neste design:

| ROADMAP §M11 dizia | Correção |
|---|---|
| Filesystem em `~/.prospero/...` | `userData/memory/...` via Electron `app.getPath("userData")` — junto de `prospero.db`, `permissions/`, `events/` |
| Migration "M11-01" | `0017` (rename) + `0018` (schema M11). Última migration existente é `0016` |
| Tab "Learning" 4ª (além de Config/Issues/Stats) | `/agent/:id` só tem tabs `chat`/`delegations`; Config é side-panel. Learning vira a **3ª tab** |
| `/skills` recebe conteúdo M11 | `/skills` hoje renderiza **roles** (`RoleListItem`/`RoleDetail`) → renomear pra `/roles`. Skills M11 vivem na tab Learning + card no `/dashboard` |
| `issue.done` event | Não existe. Hook em `issue.status_changed` com `to === "done"` |
| Inbox kinds dotted | Padrão do código é snake_case + migration (ver `0013_inbox_goal_kinds.sql`) |

### 3.1 Filesystem layout (`userData/memory/`)

```
<userData>/memory/
├── user.md                              # USER.md global (1 KB cap)
├── companies/<companyId>/
│   ├── memory.md                        # company-wide (1.5 KB cap)
│   ├── skills/<skillName>/SKILL.md       # skills company-shared
│   └── agents/<agentId>/
│       ├── memory.md                    # agent-specific (1 KB cap)
│       └── skills/<skillName>/SKILL.md   # skills privados do agente
```

Body em markdown (human-editable); metadata em SQLite. O `body_path` da tabela `skills` aponta pro `SKILL.md`; o `memory.md` é o conteúdo declarativo de cada escopo.

---

## 4. Schema (Migration `0018_m11_memory_skills`)

FTS5: as virtual tables são **standalone** (sem `content=` external-content) porque as PKs do schema são `TEXT` e external-content exige rowid inteiro pareado. O repositório mantém os índices em sincronia explicitamente em add/update/remove.

```sql
-- Skills procedurais (memória procedural M11 — distinto das capabilities M7)
CREATE TABLE skills (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id            TEXT REFERENCES agents(id) ON DELETE CASCADE,  -- NULL = company-shared
  name                TEXT NOT NULL,
  body_path           TEXT NOT NULL,                                 -- aponta pro SKILL.md
  description         TEXT NOT NULL,                                 -- L0, entra no system prompt
  version             INTEGER NOT NULL DEFAULT 1,
  applies_to_role     TEXT,                                          -- engineer/designer/ceo/...
  source              TEXT NOT NULL CHECK (source IN
                        ('agent_created','derived_from_issue','derived_from_recovery','user_authored')),
  trust               REAL NOT NULL DEFAULT 0.5,
  use_count           INTEGER NOT NULL DEFAULT 0,
  last_used           INTEGER,
  promoted            INTEGER NOT NULL DEFAULT 0,                     -- 1 = read-only pro agente
  created_at          INTEGER NOT NULL,
  soft_deleted        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_skills_scope_name
  ON skills(company_id, IFNULL(agent_id,''), name) WHERE soft_deleted = 0;
CREATE INDEX idx_skills_role ON skills(company_id, applies_to_role) WHERE soft_deleted = 0;

-- Memórias declarativas
CREATE TABLE memories (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id            TEXT REFERENCES agents(id) ON DELETE CASCADE,  -- NULL = company-wide
  applies_to_role     TEXT,
  kind                TEXT NOT NULL CHECK (kind IN
                        ('identity','rule','preference','retrospective')),
  body                TEXT NOT NULL,
  importance          REAL NOT NULL DEFAULT 0.5,
  trust               REAL NOT NULL DEFAULT 0.5,
  source_event_id     INTEGER REFERENCES activity_events(id),        -- set quando derivada
  pinned              INTEGER NOT NULL DEFAULT 0,                    -- 1 = read-only, isento de decay
  created_at          INTEGER NOT NULL,
  last_accessed       INTEGER,
  access_count        INTEGER NOT NULL DEFAULT 0,
  soft_deleted        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_memories_agent ON memories(agent_id, soft_deleted, importance DESC);
CREATE INDEX idx_memories_role ON memories(company_id, applies_to_role) WHERE soft_deleted = 0;

-- Skill candidates (sugestões pendentes da derivação — sempre passam por review humano)
CREATE TABLE skill_candidates (
  id                       TEXT PRIMARY KEY,
  company_id               TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id                 TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_event_id          INTEGER NOT NULL REFERENCES activity_events(id),
  trigger                  TEXT NOT NULL CHECK (trigger IN ('issue_done','recovery')),
  proposed_name            TEXT NOT NULL,
  proposed_description     TEXT NOT NULL,
  proposed_body            TEXT NOT NULL,
  proposed_applies_to_role TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','accepted','rejected')),
  reviewed_by              TEXT,
  reviewed_at              INTEGER,
  reject_reason            TEXT,
  created_at               INTEGER NOT NULL
);
CREATE INDEX idx_skill_candidates_status ON skill_candidates(status, created_at DESC);
CREATE INDEX idx_skill_candidates_source ON skill_candidates(source_event_id);

-- FTS5 standalone, sincronizado pelo repositório
CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, body);
CREATE VIRTUAL TABLE messages_fts USING fts5(message_id UNINDEXED, agent_id UNINDEXED, content);
```

`messages_fts` é populado por um post-migration que faz backfill de `messages` existentes e, daí em diante, mantido pelo writer de mensagens.

---

## 5. MCP tools (10 — skills-first, refletindo a inflexão 1)

Novo arquivo `apps/main/src/mcp/tools-memory.ts`, registrado em `mcp/server.ts` via spread (padrão de `tools-goals.ts`).

**Skills (5 — surface principal):**
- `skill_search(query, scope?)` — lista skills com L0; hot path no início de tarefa.
- `skill_read(name)` — body completo (L1). Incrementa `use_count` / `last_used`; emite `skill.invoked`.
- `skill_create({name, body, description, applies_to_role?})` — cria skill privado. Body validado: size cap 16 KB + sanitizer.
- `skill_update(name, body)` — versiona (incrementa `version`).
- `skill_promote(name)` — propõe tornar company-shared → inbox `skill_promotion_requested` (não aplica direto).

**Memory (4 — fallback, desincentivado):**
- `memory_read(scope?, kind?)` — lista entries.
- `memory_add({body, kind, importance?, applies_to_role?})` — adiciona. Rate limit **3/turn** (mais agressivo que skills).
- `memory_remove(id)` — soft-delete. Rejeita se `pinned=1`.
- `memory_search({query, scope?})` — FTS5 ranked.

**Episódica (1):**
- `session_search(query, agent_id?, limit?)` — FTS5 sobre `messages_fts`. `LIMIT` default 50.

Rate limits: skill writes 5/turn, memory writes 3/turn. Exceder → erro estruturado retornado ao agente.

---

## 6. System prompt injection

`composeSystemPrompt` (`apps/main/src/orchestrator/system-prompt.ts`, foundation M7.5) ganha 4 slots novos, nesta ordem de injeção:

1. `user.md` global — ~1 KB cap
2. Company memory (`memory.md` da company, inclui retrospectivas) — ~1.5 KB cap
3. Agent memory (`memory.md` do agente) — ~1 KB cap
4. Skills L0 (do agente + herdados por role) — ~4 KB cap (~40 skills × 100 chars de description)

- **Hard cap total novo:** ~7.5 KB. Regra `feedback_token_efficiency`: overhead ≤ 5% do baseline pós-M10.
- **Priorização do L0 quando excede cap:** sort por `use_count DESC, trust DESC`. Skills com `trust < 0.2` não entram em L0 (load on-demand via `skill_read`).
- Excesso nos caps de memory dispara consolidation prompt (§8).

---

## 7. Pipeline de auto-derivação (coração da inflexão 2)

```
activity recorder grava evento
  │
  └─▶ action ∈ {issue.status_changed→done, agent.recovered,
                goal.status_changed→achieved, approval.rejected, issue regressão}?
        │ sim
        └─▶ enfileira derivation job (async, throttled, por (agentId|companyId))
              │
              └─▶ derivation worker:
                    1. monta trail do SQLite (comments/tools/artifacts | turns | goal snapshot)
                    2. seleciona prompt por trigger
                    3. claude -p (Sonnet) headless, MCP vazio  (§2.1)
                    4. parseia output → SKILL.md draft | memory fragment | "descartar"
                    5. sanitizer no body produzido  (§9 — defense-in-depth)
                    6. grava cost_event (budget M8, cap 3/dia/agente)
                    7. escreve:
                       • skill_candidate (status=pending) → inbox skill_candidate_pending
                       • memory kind=retrospective → company scope → inbox goal_retrospective_ready
                       • memory kind=preference → agent scope
```

- **Nada vai direto pra `skills`.** Todo `skill_candidate` passa por review humano (Accept / Edit / Reject). Defense-in-depth: a derivação é geração LLM, pode injetar.
- **Reject treina o pipeline:** `reject_reason` é persistido; pode informar prompts futuros.
- **Nudges manuais (fallback):** hook em `turn-complete` — se `tool_use_count > 5` E nenhuma derivação foi enfileirada nesse issue → emite `memory_nudge` no próximo turn. Também: fallback time-based (sessão > 30 turns sem nudge) e em evento de compaction (M9).

---

## 8. Decay, maintenance e trust

- **Decay** (rodado em open-session): `importance *= age_decay(90d) * access_boost(use_count)`. `kind='identity'` e `pinned=1` isentos.
- **Pruning:** soft-delete quando `importance < 0.1 AND last_accessed > 30d`. Inbox `memory_review_needed` avisa antes de expirar.
- **Consolidation:** quando `memory.md` ultrapassa 90% do cap, próximo turn recebe prompt pra mesclar/enxugar entries.
- **Trust feedback:** thumb-up/down do usuário na UI → `+0.05` / `−0.10` (assimétrico, igual Hermes Holographic). Skill com `trust < 0.2` sai do L0 (load on-demand only).

---

## 9. Segurança

- **Sanitizer compartilhado** (`apps/main/src/memory/sanitizer.ts`), função pura, aplicado em **ambos** write paths — manual (MCP tools) e derivação. Regex anti prompt-injection (`ignore previous`, `disregard instructions`, etc.) + blocklist do `gate.ts §8.3` aplicada ao body.
- **Derivação passa pelo sanitizer antes** de virar `skill_candidate`/`memory` — a derivação é geração LLM, não confiável.
- **Read-only pro agente:** `memories.pinned=1` e `skills.promoted=1` só o usuário altera via UI. Tools rejeitam overwrite.
- **SECURITY.md** ganha seção "Memory + Skills as injection vectors": threat model + mitigações + nota sobre o pipeline de derivação.

---

## 10. UI

- **Tab "Learning"** (3ª tab em `/agent/:id`, ao lado de `chat`/`delegations`):
  - **Skills** — lista (privados + herdados company-shared marcados 🏢), `use_count` + `trust`, botão "Promote to company" nos privados, click expande L1 inline.
  - **Memory** — view markdown do `memory.md` do agente (read-only com toggle edit), link pro `source_event` quando derivada.
  - **History** — search box FTS5 sobre `messages` do agente (`session_search`).
  - **Candidates** — fila de `skill_candidates` pendentes (Accept / Edit / Reject).
- **Card "Org Learnings"** no `/dashboard` — últimas 5 retrospectivas (link pro Goal) + top 10 skills company-shared por `use_count`.
- **Settings** ganha 2 seções: editor `user.md` global (char counter + botão "Import from Claude Code memory") e slider "Derivation budget" (max derivações/dia/agente, default 3).
- **Header do agente:** badge "🎓 N skills · K memories" → link pra tab Learning.
- **Inbox kinds novos** (snake_case, migration estilo `0013`): `skill_candidate_pending` (Accept/Edit/Reject), `skill_promotion_requested` (aprovar private→shared), `memory_review_needed` (decay vai expirar), `goal_retrospective_ready`.
- **Activity events novos:** `skill.created`, `skill.derived`, `skill.promoted_to_company`, `skill.invoked`, `memory.added`, `memory.removed`, `memory.expired`, `memory.retrospective_generated`, `agent.recovered`, `agent.capabilities_changed` (renomeado de `agent.skills_changed`).

---

## 11. Decomposição em PRs (6)

Dependências: A é ortogonal · B depende do baseline · C depende de B · D depende de C · E depende de C · F depende de C+D+E.

### PR-A — Rename skills → capabilities

Desambigua o conceito M7 (bundles de tools) do conceito M11 (knowledge docs). Migration `0017_rename_skills_to_capabilities`.

- `packages/shared/src/skills.ts` → `capabilities.ts`: `SkillId`→`CapabilityId`, `SkillDef`→`CapabilityDef`, `SKILL_CATALOG`→`CAPABILITY_CATALOG`, `skillsToTools`→`capabilitiesToTools`, `resolveSkillTools`→`resolveCapabilityTools`, `ensureChatSkill`→`ensureChatCapability`.
- Migration `0017`: `agents.skills_json`→`capabilities_json`, `role_templates.default_skills`→`default_capabilities`.
- Tipos: `agent.ts` `skills`→`capabilities`, `role.ts` `defaultSkills`→`defaultCapabilities`, `goal.ts` `skills`→`capabilities`.
- Activity action `agent.skills_changed`→`agent.capabilities_changed`.
- Rota `/skills`→`/roles`; `Skills.tsx`→`Roles.tsx`; pasta `components/skills/`→`components/roles/`; i18n keys.
- UI: hire form + agent studio labels.
- **Rename puro — zero mudança de comportamento.** Testes existentes atualizados.

### PR-B — Schema + repositories + sanitizer

- Migration `0018_m11_memory_skills` (§4): `skills`, `memories`, `memories_fts`, `messages_fts`, `skill_candidates` + índices.
- Post-migration: backfill de `messages_fts` a partir de `messages`.
- Helper de filesystem layout (`userData/memory/...`, ensure-dirs).
- Repositórios: `skills-repository`, `memories-repository`, `skill-candidates-repository` — CRUD + queries FTS5 + resolução de escopo (agent / role / company-global).
- `sanitizer.ts` — função pura, anti-injection + blocklist.
- **Camada de dados pura.** Sem comportamento agent-facing; testável isolada.

### PR-C — Memory & skills manuais

- 10 MCP tools (`tools-memory.ts`, §5), registradas em `mcp/server.ts`.
- `composeSystemPrompt` com os 4 slots novos (§6) + guard de token budget + priorização L0.
- Rate limits 3/turn (memory) e 5/turn (skill).
- Tab "Learning" com sub-tabs Skills / Memory / History.
- Badge no header do agente.
- **Dogfoodável:** agente já cria/lê/busca skills e memory manualmente; aparece no system prompt.

### PR-D — Pipeline de auto-derivação

- Hook no activity recorder nos 4 triggers (§2.4).
- Activity action nova `agent.recovered` + emissão no orchestrator (§2.2).
- Derivation worker (§7): fila async throttled + `claude -p` Sonnet runner (§2.1) + sanitizer no output.
- Cost budgeting: `cost_event` por derivação, cap 3/dia/agente (configurável).
- Sub-tab "Candidates" (Accept / Edit / Reject) + inbox `skill_candidate_pending`.
- Nudges fallback (turn-complete, time-based, compaction).

### PR-E — Org learning (herança + fluxo bidirecional)

- `hire_agent` / hire-from-UI carregam skills + memories por `applies_to_role` (+ company-global) no system prompt.
- `skill_promote` → inbox `skill_promotion_requested` + modal (preview do body + picker de `applies_to_role`).
- Terminate modal (M7.6): "promover skills privados?" com checkboxes; não-promovidos → cascade soft-delete TTL 30d.
- Retrospectivas: `goal.status_changed→achieved` dispara derivação headless (§2.1, §2.4) → `memory kind='retrospective'` company scope → inbox `goal_retrospective_ready`.
- Card "Org Learnings" no `/dashboard`.
- Pinned memories + promoted skills = read-only pro agente.

### PR-F — Decay/maintenance + trust + Settings + docs

- Decay open-session + pruning + inbox `memory_review_needed` (§8).
- Consolidation prompt > 90% cap.
- Trust feedback ±0.05/−0.10; `trust < 0.2` sai do L0.
- Settings: editor `user.md` global + "Import from Claude Code memory" + slider derivation budget.
- Docs: `docs/memory-architecture.md`, `docs/skills-format.md`, `docs/derivation-pipeline.md`, seção em SECURITY.md, featurette no README.
- ROADMAP.md + `roadmap.html` atualizados nos 3 lugares (regra `feedback_roadmap_3_lugares`).

---

## 12. Testes

- **Unit:** sanitizer cobre casos de injection nos dois paths; decay function isolada; role-inheritance resolver (`applies_to_role` match); FTS5 ranking + LIMIT (memories + messages); priorização L0 por `use_count/trust`.
- **Integration:** `issue→done` → derivation worker → `skill_candidate` row → inbox event; user aceita candidate → row em `skills` + activity event + L0 no system prompt; `goal→achieved` → retrospectiva em company scope; novo engineer hired → herda skills company-shared role=engineer; agente demitido → modal promote → restantes cascade soft-delete; `approval.rejected` → memory fragment `kind='preference'`.
- **Performance:** FTS5 com 10k messages + 1k memories, query < 50 ms.
- **E2E:** user aceita candidate → reload app → próxima sessão do agente vê skill em L0.

## 13. Não-regressão (verificada em todo PR)

- Token overhead novo ≤ 5% do baseline pós-M10 (`feedback_token_efficiency`).
- Derivações não estouram o budget diário (M8 enforcement aplica).
- Security suite verde.
- Features M1-M10 intactas.
- Startup +200 ms máximo.

## 14. Out-of-scope M11 (postergado pra V2 Tier 2+)

Vector embeddings + semantic search · indexed memory routing (sub-docs) · graph edges genéricos · memory bulletin horário · identity evolution / metacognition · dream consolidator offline · skill hub remoto · providers cloud (Honcho/Mem0/RetainDB) · multi-user partitioning · **AI memory reviewer não-humano** (todo `skill_candidate` passa por review humano em M11).

---

## 15. Custos

10-14 dias estimados. Complexidade concentrada no derivation worker (PR-D) e no role-inheritance resolver (PR-E) — dois componentes auto-contidos, testáveis isoladamente.
