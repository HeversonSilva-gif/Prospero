# M7 — Org Chart + Roles/Skills + Model Selection · Design

**Status:** Design aprovado · pendente plan + implementação
**Data:** 2026-05-11
**Spec base:** [docs/superpowers/specs/2026-05-09-prospero-design.md](2026-05-09-prospero-design.md) §6.4 (Dashboard widgets), §6.5 (right panel), §8 (sandbox)
**Roadmap entry:** [ROADMAP.md](../../../ROADMAP.md) §M7
**Memória aplicada:** tokens não inflar, segurança não regredir, Paperclip referência ativa

---

## §1 · Escopo

Três features bundled num milestone, com fronteiras de implementação independentes (PRs sequenciais não bloqueantes):

1. **Model selection** (urgente) — coluna `agents.model`, dropdown UI, `--model` no spawn, default global.
2. **Roles & skills hard-gate** — seed `role_templates`, gate via `--allowedTools` no spawn, página `/skills` master-detail.
3. **Org Chart** — rota `/org` com vertical tree (React Flow + dagre), click node abre drawer com detalhes.
4. **Right panel em `/agents/:id`** — 3 tabs (Config / Issues / Stats) consolidando os pontos acima.

**Total estimado:** ~8-10 dias úteis (similar M5/M6). **Ordem de PRs:** 1 → 2 → 3+4.

**Fora de escopo (v1.5+ ou outros milestones):**
- Custom role creation pela UI (só os 5 seedados).
- Drag-to-reassign no org chart (read+click only).
- Lista `/agents` cards (vai pra M9).
- Token persistence em `costs_log` (M8).
- Edição de `skills_json` por skill individual (só por troca de role).

---

## §2 · Schema (migration 0003)

### 2.1 SQL

```sql
-- apps/main/src/db/migrations/0003_m7_roles_model.sql

ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';
ALTER TABLE role_templates ADD COLUMN default_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';

CREATE INDEX IF NOT EXISTS idx_agents_template ON agents(template_id);
```

`agents.template_id` já existe no schema inicial — passa a ser usado como FK lógica pra `role_templates(id)` (sem constraint formal porque role_templates pode ser substituído entre versões).

### 2.2 Post-migration TS

`apps/main/src/db/postMigrate.ts` (segue padrão M6 do "Default Workspace" project):

1. **Seed `role_templates`** se tabela vazia (idempotente): insere os 5 roles definidos em §3.1.
2. **Backfill** agentes existentes:
   - Se `template_id IS NULL` e `reports_to IS NULL` → é o CEO (raiz da árvore, único garantido por seed M3). Set `template_id = 'role-ceo'`, `skills_json = <CEO skills>`, `model = 'claude-opus-4-7'`.
   - Outros agentes legacy com `template_id IS NULL` (defensivo, não esperado em prod single-user M6) → `template_id = 'role-engineer'`, skills/model copiados desse role.

### 2.3 Settings key

Nova key em `settings`: `default_model_for_new_agents` (TEXT, default `'claude-sonnet-4-6'`). Lida no `hire_agent` quando role e input não definem model.

---

## §3 · Roles e mapeamento skill → tools

### 3.1 Roles seedados (5)

| id | nome | default_model | default_skills_json | descrição |
|---|---|---|---|---|
| `role-ceo` | CEO | `claude-opus-4-7` | `["delegation","issues","inbox","chat","fs-read"]` | Recebe requests do user, delega. Não escreve código. |
| `role-engineer` | Engineer | `claude-sonnet-4-6` | `["shell","fs-read","fs-write","issues","chat"]` | Escreve código, roda testes, fecha issues. |
| `role-qa` | QA | `claude-sonnet-4-6` | `["shell","fs-read","issues","chat"]` | Testa features, abre issues de bug. Não edita código. |
| `role-designer` | Designer | `claude-haiku-4-5-20251001` | `["fs-read","web","issues","chat"]` | Sugere mockups/copy. Sem shell/fs-write. |
| `role-pm` | PM | `claude-sonnet-4-6` | `["delegation","issues","web","chat"]` | Coordena, abre/prioriza issues. Sem shell/fs. |

CEO usa Opus por raciocínio caro (delegação). Engineer/QA usam Sonnet por volume. Designer usa Haiku (texto leve). User pode overridear no hire ou no right panel `/agents/:id`.

### 3.2 Mapeamento `skillsToTools()`

Função pura em `packages/shared/src/skills.ts`. Lista canônica:

| Skill ID | Built-in tools | MCP tools |
|---|---|---|
| `shell` | `Bash` | — |
| `fs-read` | `Read`, `Glob`, `Grep` | — |
| `fs-write` | `Edit`, `Write`, `NotebookEdit` | — |
| `web` | `WebFetch`, `WebSearch` | — |
| `delegation` | — | `mcp__dashboard__hire_agent`, `mcp__dashboard__fire_agent`, `mcp__dashboard__list_agents`, `mcp__dashboard__message_agent`, `mcp__dashboard__read_thread` |
| `issues` | — | `mcp__dashboard__create_issue`, `mcp__dashboard__update_issue`, `mcp__dashboard__assign_issue`, `mcp__dashboard__list_issues`, `mcp__dashboard__check_status` |
| `inbox` | — | `mcp__dashboard__notify_user`, `mcp__dashboard__report_to_user` |
| `chat` | — | `mcp__dashboard__request_permission` |

**Safety net:** `chat` skill é auto-injected em `buildClaudeArgs` mesmo se ausente do `skills_json`, porque `request_permission` é mandatory pro permission-prompt-tool funcionar (M5).

### 3.3 Defesa em profundidade

`--allowedTools` complementa o gate de M5, não substitui:

- **`--allowedTools`** = whitelist do que o Claude vê (filtro de descoberta).
- **`permissions.ask` em settings.json** (M5) = approval gate runtime (Bash/Edit/Write).
- **`gate.ts` file-fence** (M5/M6) = sandbox de path.

Agente sem `shell` simplesmente não vê o tool Bash no system prompt — não chega no approval gate.

---

## §4 · Spawn & MCP

### 4.1 `buildClaudeArgs` ([lifecycle.ts:128](../../../apps/main/src/orchestrator/lifecycle.ts#L128))

Adições:

```typescript
export const buildClaudeArgs = (agent: Agent, mcpConfigPath: string): string[] => {
  const skills = ensureChatSkill(JSON.parse(agent.skillsJson) as string[]);
  const allowedTools = skillsToTools(skills);

  const args = [
    "--system-prompt", buildAgentSystemPrompt(agent.systemPrompt, skills),
    "--model", agent.model,
    "--allowedTools", allowedTools.join(","),
    "--input-format", "stream-json",
    // ... resto inalterado
  ];
  // ...
};
```

`buildAgentSystemPrompt` ganha 2º param `skills: string[]`. Injeta no final do system prompt: `"You have these skills: <list>. Available tools: <resolved>."` — sem isso, agente fica confuso ao chamar tool que "não existe" do ponto de vista dele.

### 4.2 `hire_agent` MCP tool ([tools.ts](../../../apps/main/src/mcp/tools.ts))

Params novos opcionais:

```typescript
input: z.object({
  name: z.string(),
  role: z.string(),
  system_prompt: z.string().optional(),
  reports_to: z.string().optional(),
  role_template_id: z.string().optional(),  // NOVO
  model: z.string().optional(),              // NOVO
})
```

**Resolução de model** (ordem de precedência):
1. `input.model` se passado e válido (regex)
2. `role_templates.default_model` do role resolvido
3. `settings.default_model_for_new_agents`
4. Fallback `'claude-sonnet-4-6'`

**Resolução de skills:**
1. Do role_template_id se passado.
2. Fallback: array vazio. Agente fica funcional só pra chat (auto-injected). Usuário corrige no right panel ou via re-hire.

### 4.3 Novos IPC handlers

`apps/main/src/ipc/`:

| Channel | Args | Returns | Side-effects |
|---|---|---|---|
| `agents:setModel` | `{agentId, model}` | `{ok}` | UPDATE agents.model · restart runner se ativo · broadcast roster |
| `agents:setRole` | `{agentId, roleTemplateId}` | `{ok}` | UPDATE agents.{template_id, skills_json, model} atomicamente · restart runner se ativo · broadcast |
| `agents:setSystemPrompt` | `{agentId, systemPrompt}` | `{ok}` | UPDATE agents.system_prompt · restart runner se ativo |
| `roles:list` | — | `Array<{id, name, default_model, agent_count, ...}>` | — |
| `roles:get` | `{id}` | `{role, resolvedTools, agentsUsing[]}` | — |
| `agents:listIssues` | `{agentId}` | `Issue[]` | — (read) |
| `agents:stats` | `{agentId}` | `{turns, tokensIn?, tokensOut?, lastActivity}` | — (read; tokens placeholder até M8) |

### 4.4 Restart de runner ao trocar model/role/persona

`--model` e `--allowedTools` são lidos só na inicialização do claude CLI. Trocar exige novo spawn:

- **Agente `idle`** (sem runner ativo) → só UPDATE no DB. Próximo spawn pega valor novo.
- **Runner ativo** → `runner.kill('SIGTERM')` + `UPDATE agents SET claude_session_id = NULL WHERE id = ?` + broadcast `roster-changed`. Próxima mensagem do user re-spawna com config nova.
- **Race**: mensagem em flight → terminate mata claude → mensagem retorna erro → user retenta. UI mostra banner "Agente reiniciado com novas configurações."

Alternativa de `--resume` foi descartada: claude ignora flags de config quando resume herda sessão antiga.

---

## §5 · UI

### 5.1 Right panel em `/agents/:id` (3 tabs · 320px)

`apps/renderer/src/routes/Agent.tsx` ganha `<aside>` à direita do chat. Tabs em `components/AgentConfigPanel.tsx`.

**Tab Config** (default):
- **Role** — label readonly + botão "Change role..." abre modal com dropdown dos 5 roles + warning de restart.
- **Model** — dropdown com presets (Opus 4.7 / Sonnet 4.6 / Haiku 4.5) + opção "Custom..." revela `<input>`. Validação regex `/^[a-z0-9-]+$/` no submit.
- **Persona** — `<textarea>` edit-in-place do `system_prompt` + botão "Save" (debounced 500ms).
- **Allowed projects** — chip toggle reusando `AllowlistEditor` extraído de [Projects.tsx](../../../apps/renderer/src/routes/Projects.tsx).

**Tab Issues** — lista de issues assignee=agent. Item: status pill + title + project. Click → navega `/issues` com modal aberto pelo id (padrão M6).

**Tab Stats** — 4 metrics inline: total turns, tokens in, tokens out, last activity. Hoje só `turns` (count messages); resto "—" até M8.

### 5.2 `/skills` (master-detail)

Layout espelha `/projects` (memória M6: pattern conhecido):

- **Left (240px)** — lista de roles. Item = ícone + nome + count `(N agentes)`.
- **Right** — detalhes do role selecionado:
  - Header: ícone + nome + descrição
  - **Tools** — chips agrupados por skill (ex: "shell → Bash", "fs-write → Edit, Write, NotebookEdit")
  - **Default model** — read-only label
  - **Agents using** — lista linkando pra `/agents/:id`

**V1 read-only.** Nenhum CRUD de role.

### 5.3 `/org` (vertical tree)

Lib: **`reactflow` + `dagre`** (~50kb gzip combinado). Ambos npm packages standalone (sem CDN), compatíveis com offline-first.

- Container full-page com pan/zoom.
- **Node** (180×80px): avatar (2 iniciais), nome, role, status pill (cores M5 idle/thinking/working/waiting/error).
- **Layout** `dagre` direction `TB` (top-bottom). CEO no topo (`reports_to` null).
- **Click** num node → drawer lateral 320px à direita com:
  - Nome + role + model
  - Status atual
  - # issues open
  - Link "Open agent →" pra `/agents/:id`
- **Real-time**: subscribe em `agents.onEvent('roster-changed')` (já existente M5) → re-render com novo status.

### 5.4 Sidebar — 2 links novos

`Sidebar.tsx` adiciona entre "Issues" e "Inbox":
- `🌳 Org Chart` → `/org`
- `🛠 Skills` → `/skills`

### 5.5 Settings — "Default model for new agents"

Section nova em [Settings.tsx](../../../apps/renderer/src/routes/Settings.tsx) abaixo de Language/Theme. Dropdown idêntico ao do right panel. Persistido em `settings.default_model_for_new_agents` via IPC `settings:set`.

### 5.6 i18n

Todos os strings novos em `apps/renderer/src/i18n/{en,ptBR}.ts`. Regra M2 (sem mistura, cobertura 100%) mantida. Test `i18n.test.ts` re-rodando garante paridade.

---

## §6 · Testes

### 6.1 Unit · `packages/shared`

- `skillsToTools(['shell', 'fs-write'])` retorna `['Bash', 'Edit', 'Write', 'NotebookEdit', 'mcp__dashboard__request_permission']` (chat auto-injected).
- `skillsToTools([])` retorna `['mcp__dashboard__request_permission']` (safety net).
- Skill ID desconhecido → log warning, ignora (não quebra spawn).
- `ensureChatSkill(['shell'])` retorna `['shell', 'chat']`.

### 6.2 Unit · `apps/main`

- `buildClaudeArgs` injeta `--model` e `--allowedTools` com valores corretos.
- `hire_agent` resolve model pela precedência declarada em §4.2.
- `agents:setRole` copia skills_json e model do role atomicamente (transaction).
- `agents:setModel` valida regex; rejeita `"; rm -rf"` etc.

### 6.3 Integration · `apps/main/tests`

- **Hard gate (unit, spawn args level)**: spy em `child_process.spawn` no test do orchestrator. Cria agent com `skills_json=["fs-read"]`, dispara `ensureRunner`, asserta que args contém `--allowedTools "Read,Glob,Grep,mcp__dashboard__request_permission"` e NÃO contém `Bash`. Trust claude CLI pra enforcement runtime (mockar binary não vale o overhead conforme M3 lessons).
- **Restart on role change**: `agents:setRole` em agent ativo → runner morto + session_id zerado + `roster-changed` emitido.
- **Backfill**: post-migration cria CEO com template_id válido + skills_json não vazio + model Opus.
- **`hire_agent` com role_template_id**: agent novo tem skills/model do role.

### 6.4 Regression guards (M4/M5/M6 — devem continuar verdes)

- **Token leak** (M4) — model/skills no IPC não vaza OAuth.
- **Sandbox escape** (M5) — gate.ts continua rejeitando paths fora de allowedProjectPaths mesmo com fs-write.
- **File-fence** — fence segura.
- **Token budget** — `--allowedTools` reduz surface; baseline esperado menor ou igual ao M6.

---

## §7 · Segurança

| Vetor | Mitigação |
|---|---|
| Custom model id command injection | Regex `/^[a-z0-9-]+$/` validada no IPC handler antes do UPDATE. Spawn nunca recebe id não validado. |
| Skill ID desconhecida no DB | Validação contra lista canônica em `packages/shared/src/skills.ts`. Log warning, ignora — nunca quebra spawn. |
| Tool nova adicionada sem categorização | Unit test em `packages/shared/skills.test.ts`: array constante `KNOWN_CLAUDE_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'NotebookEdit', 'WebFetch', 'WebSearch']` (lista manual mantida no shared package). Test percorre constantes e verifica que toda tool tem skill mapping; nova tool adicionada force-falha o test, lembrete pra categorizar. |
| `request_permission` removido por DB direto | `ensureChatSkill` safety net força inclusão em `buildClaudeArgs`. Test cobre. |
| Custom model id que claude rejeita → crash do runner | Spawn error capturado em `lifecycle.ts onExit` → emit `inbox:error` + banner em `/agents/:id`. |

---

## §8 · Riscos & trade-offs

| Risco | Mitigação |
|---|---|
| CEO existente quebra após migration (skills_json vazio) | Backfill cobre. Test integration valida CEO funcional pós-migration. |
| User troca model pra id inválido sem feedback | Validação client + banner de spawn error. |
| Restart em role/model change perde mensagem em flight | Banner UX "Reiniciando..."; user retenta. Documentado. |
| `reactflow`/`dagre` viola offline-first | Ambos são npm standalone. Verificar bundle final pré-merge. |
| `skills_catalog` table fica orphan | V1 deixa como referência. V2 hidrata detalhes por skill. |
| Hard gate quebra tools internas (ex: TodoWrite do claude CLI) | Whitelist explícita das tools **úteis** ao agente. Tools internas do CLI (think, etc.) não exigem entry no whitelist (claude usa por dentro). Test: agent básico ainda fecha turn-complete. |

### Trade-offs aceitos

- **V1 sem custom role creation pela UI** — só 5 seedados. Adicionar custom = DB direto.
- **Restart no role/model change** > continuidade — `--resume` herda config antiga.
- **`/org` sem drag** — read+click only. Mudar `reports_to` continua via MCP `hire_agent` ou DB.
- **Stats tab placeholder** — full tokens em M8.

---

## §9 · Critérios de aceitação

- [ ] Migration 0003 roda clean em DB de M6 fresh + DB de prod (com CEO seedado em M3).
- [ ] Post-migration: 5 roles em `role_templates`; CEO backfilled com `template_id='role-ceo'`.
- [ ] `--model` e `--allowedTools` passados no spawn (verificável via spy de `child_process.spawn` no test integration).
- [ ] Agent sem skill `shell` não consegue chamar Bash (test integration).
- [ ] `/skills`, `/org` renderizam offline (sem rede).
- [ ] Right panel em `/agents/:id` mostra 3 tabs funcionais.
- [ ] Settings "Default model for new agents" persiste e aplica em novos hires.
- [ ] Suite vitest passa (185 + ~20 novos).
- [ ] Lint + typecheck zero erros.
- [ ] Token budget regression test continua verde.
- [ ] M5 sandbox/security tests continuam verdes.

---

## §10 · Implementação · ordem sugerida (PRs)

1. **PR-A · Model selection** (~1-2 dias)
   Migration 0003 (só model column + role_template default_model) + `--model` no spawn + settings "Default model" field. Sem UI no right panel ainda — só settings global. Inclui regression test.

2. **PR-B · Roles & hard gate** (~3-4 dias)
   `skills.ts` em shared + post-migration seed dos 5 roles + backfill CEO + `--allowedTools` no spawn + `hire_agent` ganha `role_template_id` + page `/skills` master-detail + sidebar link Skills. Test de hard gate via spawn args spy.

3. **PR-C · Org chart + right panel** (~3-4 dias)
   `/org` com reactflow/dagre + right panel full em `/agents/:id` (3 tabs incluindo dropdown de model + change-role modal) + sidebar link Org Chart + IPC handlers (setModel, setRole, setSystemPrompt, listIssues, stats) + i18n completo.

PRs sequenciais: cada um merga em master verde antes do próximo. Roadmap atualizado entre cada PR (memória M6: pattern).

---

## §11 · Referências

- **Paperclip** (memória `reference_paperclip`) — "Skills Manager" wishlist; UX de role-based agents.
- **Spec base §6.5** — right panel de agente (persona, skills, projetos, stats).
- **Spec base §8** — sandbox layers (allowedTools complementa, não substitui).
- **M5 lessons** (memória `project_m5_lessons`) — settings.json `permissions.ask`, roster broadcast pattern, `--permission-prompt-tool`.
- **M6 lessons** (memória `project_m6_lessons`) — post-migration pattern, types em `packages/shared`, optimistic UI.
