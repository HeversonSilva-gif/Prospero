# M6 — Issues + Projects CRUD (design)

**Status:** spec — pendente plano de implementação
**Data:** 2026-05-10
**Spec base:** [2026-05-09-dashboard-agent-design.md](2026-05-09-dashboard-agent-design.md)
**Roadmap:** [ROADMAP.md](../../../ROADMAP.md) — M6 (próximo natural)
**Lições prévias:** [project_m5_lessons.md](memory) — file-fence, router, settings.json `permissions.ask`, request_permission key=`input`, roster broadcast

---

## 1. Objetivo

Levar **Projects** e **Issues** de stub a feature-complete contra o spec §4. Sem isso, agentes só conversam mas não geram artefatos rastreáveis (issues), e a sandbox de filesystem é limitada a um `workspaceCwd` global (impede múltiplos projetos paralelos).

**Por que junto:** Issues são ancoradas em Projects (`issues.project_id`). Não tem como entregar Issues sem Projects primeiro. Faseamos dentro do mesmo milestone para um único PR coeso.

**Out of scope (vai pro M9 ou v2+):**
- AGENTS.md import/export (M9 wishlist)
- Agent reviews UX rica (diff side-by-side) — só status='review' básico aqui
- Routines / scheduled issues (v2)

---

## 2. Decisões consolidadas (brainstorming 2026-05-10)

| # | Decisão | Justificativa |
|---|---|---|
| 1 | M6 único, faseado: Projects → Issues → polish; mergeado de uma vez | Coerente com M3/M5 (PR grande coeso). Permite migração de sandbox no meio sem ficar com app meio-quebrado entre PRs. |
| 2 | Auto-cria project "Default Workspace" do `settings.workspaceCwd` existente no startup post-migration | Zero fricção pra usuário atual. Setting `workspaceCwd` vira deprecated/read-only (mantém valor pra rollback). |
| 3 | `agents.allowed_projects_json = []` ⇒ allow all projects da company | Default permissivo. Restringir = listar subset explicitamente via UI. |
| 4 | Issues MCP tools (5x) auto-allow via `permissions.allow` | Coerente com M5 — DB writes são observáveis em `/issues` + inbox notification em status=done. Reverter pra `permissions.ask` é trivial. |
| 5 | `/issues/:id` completo: comments + tool call history + sub-tasks | Spec original pedia. Custo: nova tabela `issue_comments`, derivação SQL pra tool history. |
| 6 | `/projects` master/detail (sem rota `:id` separada) | Lista esquerda + painel direita numa view única. Reduz código + cognição. |
| 7 | `/issues` kanban + modal centralizado (URL `?selected=<id>`) | Modal preserva contexto do board, query param garante shareability/refresh. |

---

## 3. Data model (schema deltas)

### 3.1 Migration `0002_m6_issues_projects.sql`

```sql
CREATE TABLE IF NOT EXISTS issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('user','agent')),
  sender_id TEXT,                    -- agent_id se sender_kind='agent'; NULL se 'user'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_comments_issue
  ON issue_comments(issue_id, created_at);

CREATE TABLE IF NOT EXISTS issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'created','status_changed','assignee_changed','priority_changed','reparented'
  )),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','agent','system')),
  actor_id TEXT,                     -- agent_id se 'agent'; NULL caso contrário
  payload_json TEXT NOT NULL,        -- shape varia por kind (ver §3.3)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_events_issue
  ON issue_events(issue_id, created_at);
```

**Sem alterações em tabelas existentes.** `issues`, `projects`, `agents.allowed_projects_json` já têm tudo necessário desde M1.

### 3.2 Tool call history — derivado, sem nova tabela

```sql
-- Bounds (start/end) do período "doing":
SELECT created_at, payload_json FROM issue_events
 WHERE issue_id = ? AND kind = 'status_changed'
 ORDER BY created_at;
-- Em JS: percorre eventos, marca start = primeiro to='doing', end = primeiro to IN ('review','done','cancelled')
-- Múltiplas passagens por doing = união de intervalos.

-- Tool calls do assignee no período:
SELECT m.created_at, m.tool_calls_json
  FROM messages m
 WHERE m.sender_kind = 'agent'
   AND m.sender_id = ?           -- assignee atual da issue
   AND m.tool_calls_json IS NOT NULL
   AND m.created_at BETWEEN ? AND ?;
```

**Limitações aceitas:**
- Se assignee mudou no meio do período `doing`, só tool calls do assignee atual aparecem. Histórico de assignees anteriores fica em `issue_events` (kind='assignee_changed') mas não traz tool calls retroativos. Aceitável pra v1.
- Tool history é informativo (collapsed accordion), não auditoria forense. Se precisar audit-grade no futuro, criar tabela `issue_tool_calls(issue_id, message_id)` ligando explicitamente.

### 3.3 Shapes de `issue_events.payload_json`

| kind | payload |
|---|---|
| `created` | `{title, project_id, assignee_id, priority}` |
| `status_changed` | `{from: status, to: status}` |
| `assignee_changed` | `{from: agent_id\|null, to: agent_id\|null}` |
| `priority_changed` | `{from: priority, to: priority}` |
| `reparented` | `{from: issue_id\|null, to: issue_id\|null}` |

Renderização da timeline lê `payload_json` + resolve nomes (agent_id → agent.name) em tempo de UI.

---

## 4. IPC + MCP tools

### 4.1 Novos IPC channels

Adicionar em `packages/shared/src/ipc-channels.ts`:

```ts
// Projects
"projects:list"                  // → Project[]
"projects:create"                // {name, path, color} → Project
"projects:update"                // {id, name?, path?, color?} → Project
"projects:delete"                // {id} → {ok: true}
"projects:open-folder"           // {id} → {opened: bool}  (shell.openPath)
"projects:check-paths"           // → Record<projectId, 'available'|'missing'>

// Issues
"issues:list"                    // {projectId?, assigneeId?, status?, priority?} → Issue[]
"issues:get"                     // {id} → IssueDetail
"issues:create"                  // {projectId, title, description?, assigneeId?, priority?, parentId?} → Issue
"issues:update"                  // {id, title?, description?, status?, assigneeId?, priority?, parentId?} → Issue
"issues:delete"                  // {id} → {ok: true}
"issues:add-comment"             // {issueId, content} → IssueComment

// Agent allowlist (per-project)
"agents:set-allowed-projects"    // {agentId, projectIds: string[]} → Agent
```

**Tipos compartilhados** (`packages/shared/src/types.ts`):

```ts
type IssueDetail = {
  issue: Issue;                  // colunas da tabela issues
  comments: IssueComment[];
  events: IssueEvent[];
  subtasks: Issue[];             // children via parent_id
  toolHistory: ToolCallRef[];    // {toolName, input, createdAt} flat list
  assignee: Pick<Agent,'id'|'name'|'role'> | null;
  project: Pick<Project,'id'|'name'|'color'> | null;
};
```

### 4.2 MCP tools — substituir stubs em `apps/main/src/mcp/tools.ts`

| Tool | Schema (Zod) | Comportamento |
|---|---|---|
| `create_issue` | `{project: string, title: string, description?: string, assignee?: string, priority?: enum, parent_id?: string}` | `project` aceita ID **ou** nome (lookup case-insensitive dentro da company). Ambíguo (>1 match) ⇒ erro `"multiple projects match"`. Insere issue + event `created`. Emite `issue.created` (renderer atualiza kanban). |
| `update_issue` | `{id, status?, description?, title?, assignee?, priority?}` | UPDATE + um event por campo mudado. Status virando `'done'` ⇒ inbox `completed` pro user com título `"{issue.title} — done"` e payload `{issueId, byAgent: caller.name}`. |
| `assign_issue` | `{issue_id, agent_id}` | Equivalente a `update_issue` com só `assignee`. Mantido por clareza no spec original. |
| `list_issues` | `{project?, status?, assignee?}` | SELECT com filtros opcionais. Retorna até 100 (LIMIT). |
| `check_status` | `{issue_id}` | `{id, status, assignee, updated_at}` apenas. |

**Permission gate:** as 5 tools acima vão pra `permissions.allow` no settings.json sandbox per-spawn (`apps/main/src/orchestrator/sandbox.ts`). Não passam pelo `request_permission`. Coerente com M5 (M5 lessons §"approval gate dropped").

### 4.3 Repositories (novos)

- `apps/main/src/projects/repository.ts` — `createProjectsRepository(db)` com `listByCompany`, `getById`, `create`, `update`, `delete`, `checkPaths` (existsSync em batch)
- `apps/main/src/issues/repository.ts` — `createIssuesRepository(db)` com `list`, `getDetail` (joins comments+events+subtasks), `create`, `update` (escreve event), `delete` (cascade), `addComment`
- `apps/main/src/issues/tool-history.ts` — função pura `getToolHistory(db, issueId): ToolCallRef[]` implementando o algoritmo §3.2

---

## 5. UI — Projects

### 5.1 Sidebar nav

Adicionar entrada **Projects** em `apps/renderer/src/components/Sidebar.tsx`, logo abaixo de **Inbox** e antes da lista de agents. Sem badge de count na v1 (mantém visual limpo).

### 5.2 Rota `/projects` (master/detail)

```
┌──────────────────────────────────────────────────┐
│  Projects                              [+ New]   │
├──────────────┬───────────────────────────────────┤
│ ● DashboardA.│  ● DashboardAgent          [⋯]   │
│   Marketing  │  ─────────────────────────────────│
│   Old API ⚠️ │  📁 d:\Projetos pessoais\Dashboar│
│              │  4 agents · 12 issues · 3 doing  │
│ + New Project│                                   │
│              │  Agents com acesso                │
│              │  [Aurora·CEO][Dev1][Dev2][QA]    │
│              │                                   │
│              │  Issues recentes                  │
│              │  ⚙ Refactor API endpoints  doing │
│              │  ○ Login bug              todo   │
│              │                                   │
│              │  [Open in Explorer]  [Edit]      │
└──────────────┴───────────────────────────────────┘
```

### 5.3 Componentes

| Arquivo | Responsabilidade |
|---|---|
| `apps/renderer/src/routes/Projects.tsx` | Container; useState pra `selectedId`; dispara `projects:list` + `projects:check-paths` em mount + interval 30s |
| `apps/renderer/src/components/projects/ProjectListItem.tsx` | Dot colorido + nome + warn icon ⚠️ se path missing; selected = bg-brand/10 + border-l |
| `apps/renderer/src/components/projects/ProjectDetail.tsx` | Header (dot+nome+menu ⋯), path (mono), counts, agents chips, issues recentes (top 5), botões Open/Edit |
| `apps/renderer/src/components/projects/ProjectFormModal.tsx` | Form: name (text, required, ≥1 char, unique within company), path (folder picker reusa M5 dialog, required, warn-only se path missing — não bloqueia save), color (picker fixo, required, default `#1D5DD7`). Reusado pra "+ New" e "Edit". Submit chama `projects:create` ou `projects:update` |
| `apps/renderer/src/components/projects/AllowlistEditor.tsx` | Em cada agent chip do detail: click abre dropdown com checkbox dos projects (toggle inclusion). Sem allowlist visível ⇒ "all" implícito; ao primeiro toggle vira explícito com todos exceto o desmarcado |
| `apps/renderer/src/stores/projects.ts` | Zustand store: `projects[]`, `pathStatuses`, `selectedId`, `load()`, `create()`, `update()`, `delete()` |

### 5.4 Color picker fixo

`['#1D5DD7','#10b981','#f59e0b','#dc2626','#8b5cf6','#ec4899','#0ea5e9','#64748b']` — 8 cores ditadas pelo design system (alinhadas com `tailwind.config.ts` `semantic-*`). Sem free-form pra evitar contraste ruim em dark/light mode.

### 5.5 Path "indisponível" UX

- Lista esquerda: project com path missing ganha icon ⚠️ + opacity-60
- Detail à direita: badge vermelho "Path indisponível" no topo do header
- Tentativa de Bash/Edit/Write num path missing pelo agente: sandbox deny + inbox `error` "Project path indisponível: {name}" com link "Edit project path" que abre o ProjectFormModal pré-preenchido

---

## 6. UI — Issues

### 6.1 Sidebar nav

Adicionar entrada **Issues** em `Sidebar.tsx`, logo abaixo de **Projects**.

### 6.2 Rota `/issues` (kanban)

```
┌─────────────────────────────────────────────────────────────────┐
│  Issues                                          [+ New Issue]  │
│  Project: [All ▼]  Assignee: [All ▼]  Priority: [All ▼]       │
├─────────────────────────────────────────────────────────────────┤
│ BACKLOG · 3 │ TODO · 2  │ DOING · 1  │ REVIEW · 1 │ DONE · 5  │
│             │           │            │            │           │
│ ┌─────────┐ │ ┌───────┐ │ ┌────────┐ │ ┌────────┐ │ ┌───────┐ │
│ │● Setup  │ │ │● Login│ │ │⚙ Refac.│ │ │● PR#42 │ │ │✓ Tests│ │
│ │  CI     │ │ │  bug  │ │ │  API   │ │ │  Login │ │ │  unit │ │
│ │ 👤 Dev1 │ │ │ 👤 Dev│ │ │ 👤 Dev1│ │ │ 👤 Dev2│ │ │ 👤 QA │ │
│ │  ⬆ HIGH │ │ │       │ │ │  ⬆HIGH │ │ │        │ │ │       │ │
│ └─────────┘ │ └───────┘ │ └────────┘ │ └────────┘ │ └───────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Drag-drop

Lib: `@dnd-kit/core` + `@dnd-kit/sortable` (~10kb gzipped, MIT, mantido pelo Trello team — accessibility built-in, keyboard navigation).

- Drag entre colunas ⇒ chama `issues:update` com novo status; optimistic update no zustand store; rollback se IPC reject
- Drag dentro da coluna: NO-OP em v1 (sem persist de ordem). Preparado pra v2 adicionar `issues.sort_index`.

### 6.4 Issue card content

`[dot color do project] [title (truncate 2 lines)] · 👤 assignee.name · [badge ⬆ HIGH ou 🔴 URGENT — só pra >medium]`

Hover: outline `ring-1 ring-brand/40`. Selected (modal aberto pra ele): `ring-2 ring-brand`.

### 6.5 Filtros

Top bar: 3 dropdowns (Project, Assignee, Priority). Estado local — não persistido entre sessões. "All" = sem filtro. AND entre filtros.

### 6.6 Modal de detail (`/issues?selected=<id>`)

```
┌──────────────────────────────────────────────────────┐
│  [DOING]  ⬆ HIGH                              [×]   │
│  Refactor API endpoints                              │
│  ────────────────────────────────────────────────── │
│  Atualizar /v1/* pra /v2/* mantendo retrocompat...  │
│  [Edit description]                                  │
│                                                      │
│  Project: ● DashboardAgent     Assignee: 👤 Dev1   │
│  Priority: ⬆ high              Status: doing       │
│                                                      │
│  ── Sub-tasks (2) ─────────────────────────         │
│    ○ Add /v2/users        todo                      │
│    ✓ Add /v2/orders       done                      │
│    [+ Add sub-task]                                 │
│                                                      │
│  ── Comments (3) ──────────────────────────         │
│  CEO (agent) · 2h ago                                │
│  > Prioridade alta, fechar até sexta                │
│                                                      │
│  Dev1 (agent) · 1h ago                               │
│  > Working on it, will update                        │
│                                                      │
│  [Type a comment...]              [Send]            │
│                                                      │
│  ── Tool call history (12) ────── [▶ expand]       │
│  [Read /api/v1/users.ts] [Edit /api/...] [Bash...] │
│                                                      │
│  [Reassign ▼]   [Delete issue]                       │
└──────────────────────────────────────────────────────┘
```

### 6.7 Componentes Issues

| Arquivo | Responsabilidade |
|---|---|
| `apps/renderer/src/routes/Issues.tsx` | Kanban container + filtros + dnd-kit context + leitura de `?selected` |
| `apps/renderer/src/components/issues/KanbanColumn.tsx` | Droppable por status; header `LABEL · count` |
| `apps/renderer/src/components/issues/IssueCard.tsx` | Sortable item (`useSortable` hook); render compact |
| `apps/renderer/src/components/issues/IssueDetailModal.tsx` | Controla `searchParams.selected`; fetch `issues:get`; esc/× close |
| `apps/renderer/src/components/issues/IssueCommentsList.tsx` + `CommentComposer.tsx` | Lista + composer (textarea + Send) |
| `apps/renderer/src/components/issues/ToolCallHistoryAccordion.tsx` | Collapsed default; expand mostra cada tool call (toolName + input compacto) |
| `apps/renderer/src/components/issues/SubtaskList.tsx` | Lista checkbox de sub-tasks; toggle marca done/todo via `issues:update`. "+ Add sub-task" abre IssueFormModal com `parentId` pré-preenchido |
| `apps/renderer/src/components/issues/ReassignDropdown.tsx` | Dropdown com lista de agents da company; click chama `issues:update` com novo assignee. Confirma in-place sem modal |
| `apps/renderer/src/components/issues/DeleteIssueButton.tsx` | Confirma com `window.confirm` (basta pra v1, sem dialog custom); chama `issues:delete` (cascade DELETE comments+events+subtasks) |
| `apps/renderer/src/components/issues/IssueFormModal.tsx` | Modal pra "+ New Issue" (separado do detail) |
| `apps/renderer/src/stores/issues.ts` | Zustand: `issues[]`, `selectedDetail`, `load()`, `create()`, `update()`, `delete()`, `addComment()` |

### 6.8 Atualizações em tempo real

Orchestrator emite eventos via `mainWindow.webContents.send`:
- `issue.created` — após `issues:create` IPC ou MCP `create_issue`
- `issue.updated` — após `issues:update` IPC ou MCP `update_issue`/`assign_issue`
- `issue.deleted` — após `issues:delete`
- `issue.comment-added` — após `issues:add-comment` ou `(futuro)` MCP comment tool

Renderer escuta no zustand store; a cada evento, refresca `issues:list` (afeta kanban) + se modal aberto pra esse id, refresca `issues:get`. Pattern já existe pra roster broadcast no M5 (`agent.spawn`/`agent.exit`/`agent.status`).

---

## 7. Sandbox migration

### 7.1 Arquivo afetado

`apps/main/src/orchestrator/sandbox.ts` (ou onde está o `permission-handler` de Bash/Edit/Write).

### 7.2 Lógica nova (substitui check de `settings.workspaceCwd`)

```ts
// 1. Resolve targetPath do tool input (Bash cwd ou Edit/Write file_path).
// 2. SELECT projects.path FROM projects WHERE company_id = agent.company_id.
// 3. Filtra para projetos onde agente tem acesso:
//    - allowedProjects = JSON.parse(agent.allowed_projects_json);
//    - if (allowedProjects.length === 0) ⇒ permitidos = todos
//    - else ⇒ permitidos = filter(projects, p => allowedProjects.includes(p.id))
// 4. Para cada permitted project:
//    - Se !existsSync(project.path): SKIP + emite inbox 'error' uma vez por sessão
//    - Else: se targetPath está dentro de project.path (path.relative resolvido + verificação de não-escapar com '..'), ALLOW
// 5. Nenhum project autoriza ⇒ DENY.
```

### 7.3 Settings UI delta

`apps/renderer/src/routes/Settings.tsx`:
- Remove campo "Workspace folder" do M5
- Adiciona nota: "Workspaces agora são gerenciados em [Projects](/projects)"
- Mantém `settings.workspaceCwd` no DB (deprecated, somente leitura programática pra rollback eventual)

---

## 8. Migration runtime

### 8.1 SQL

`apps/main/src/db/migrations/0002_m6_issues_projects.sql` — só CREATE TABLE + indexes (ver §3.1).

### 8.2 Post-migration JS

`apps/main/src/db/post-migrations/0002.ts` — novo padrão (introduzido por este milestone). Roda 1x após migration SQL.

```ts
export const postMigration0002 = (db: Database) => {
  const companies = db.prepare("SELECT id FROM companies").all() as {id:string}[];
  const wsCwd = db.prepare("SELECT value FROM settings WHERE key = 'workspaceCwd'")
    .get() as {value:string} | undefined;

  for (const c of companies) {
    const projectCount = (db.prepare(
      "SELECT COUNT(*) as n FROM projects WHERE company_id = ?"
    ).get(c.id) as {n:number}).n;

    if (projectCount === 0 && wsCwd?.value) {
      db.prepare(
        "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES (?,?,?,?,?,?)"
      ).run(crypto.randomUUID(), c.id, "Default Workspace", wsCwd.value, "#1D5DD7", Date.now());
    }
    // agents.allowed_projects_json default '[]' já = "todos" — noop.
  }
};
```

### 8.3 Idempotência

Migration SQL: `CREATE TABLE IF NOT EXISTS` ⇒ rodar 2x = noop. Rodar post-migration 2x: no segundo run, `projectCount > 0` ⇒ skip cria. Test cobrindo isso é mandatório.

### 8.4 Rollback path

Single-user, sem broadcast. Se quebrar:
1. Para o app
2. Restaura DB do backup automático (futuro M-future) ou manual
3. `git checkout v0.5-m5` (tag pré-M6)
4. Restart

Documentar no CHANGELOG entry de M6.

---

## 9. Non-regression checks

| Categoria | Verificação | Como |
|---|---|---|
| **Segurança M4+M5** | Path fora de project = deny; rm -rf blocked; .credentials.json blocked; auto-deny patterns §8.3 spec | `pnpm test` rodando regression-guards existentes + 2 novos: "agente sem allowlist é denied em path fora de qualquer project", "agente com allowlist subset é denied em project não-listado" |
| **Tokens ≤1.3x baseline** | Baseline = total tokens medido na fixture "criar 3 issues + assign + listar" rodada contra o último commit pré-M6. Valor numérico capturado e gravado em `apps/main/tests/fixtures/m6-token-baseline.json` no primeiro commit do milestone. | Fixture nova em `apps/main/tests/m6-token-budget.test.ts` que compara medição atual vs valor do JSON. CI falha se ratio > 1.3 |
| **Suite verde** | 147 tests → 147+novos passing | `pnpm test` antes de cada commit (lint-staged já rodando no M4) |
| **Lint/typecheck zero** | 0 errors em ambos | `pnpm lint && pnpm typecheck` (lint-staged) |
| **Migration idempotente** | Rodar 0002 (SQL+post) 2x = sem erro, sem duplicação | Test `apps/main/tests/migration-0002.test.ts`: reset DB pra "M5 final state" → migrate 2x → assert exatamente 1 "Default Workspace" |
| **i18n cobertura** | Nenhuma string hardcoded em pt-BR ou en-US | Eyeball + grep pelo padrão `>['"][A-Z]` em arquivos novos |
| **Smoke test manual** | Fluxo full: criar project → hire agent → CEO cria issue → agent assigna pra si → agent move pra doing → comment → done | Roteiro no PR description |

---

## 10. Phase order (commits dentro do PR)

1. **chore(m6): migration 0002 + post-migration script + tests**
2. **feat(m6): projects repository + IPC + tests**
3. **feat(m6): /projects route master/detail + ProjectFormModal**
4. **feat(m6): sandbox migration — path check via projects (replaces workspaceCwd)**
5. **feat(m6): issues repository + IPC + 5 MCP tools reais + tests**
6. **feat(m6): /issues kanban + dnd-kit + filters**
7. **feat(m6): IssueDetailModal + comments + sub-tasks + tool history accordion**
8. **chore(m6): i18n cobertura + non-regression run + ROADMAP + CHANGELOG + memory:m6_lessons**

Cada commit deve passar lint+typecheck+tests. PR final mergeado em `master` com squash opcional.

---

## 11. Deps novos

| Dep | Versão | Tamanho | Razão |
|---|---|---|---|
| `@dnd-kit/core` | latest | ~7kb gz | Drag-drop accessible pro kanban |
| `@dnd-kit/sortable` | latest | ~3kb gz | Sortable items dentro/entre columns |

Ambos MIT, mantidos pela Atlassian/Trello team. Sem peer-deps problemáticas.

---

## 12. Open questions / acceptance critérios

Nada open — todas as decisões saíram do brainstorming 2026-05-10. Acceptance critérios:

- [ ] User pode criar/editar/deletar projects via UI
- [ ] Migration auto-cria "Default Workspace" do `workspaceCwd` legado
- [ ] User pode restringir agents per-project via chips no detail de project
- [ ] CEO consegue chamar `create_issue(project="DashboardAgent", title="...")` via MCP e isso aparece no kanban em <2s
- [ ] Drag-drop entre colunas no kanban persiste status mudança
- [ ] Modal de detail abre com `?selected=<id>` na URL e fecha com Esc/×
- [ ] Comments user e agent renderizam ordenados por created_at
- [ ] Tool call history accordion mostra tool calls do assignee no período `doing`
- [ ] Sandbox bloqueia path fora de project allowlist mesmo se path existe
- [ ] 147+novos tests passing, 0 lint/typecheck errors
- [ ] Token usage ≤1.3x baseline em fixture
