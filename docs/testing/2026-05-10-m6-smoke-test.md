# M6 Smoke Test — Issues + Projects CRUD

> **Quando rodar:** após pull/merge de M6, antes de declarar produção-pronto.
> **Tempo estimado:** ~30 minutos pra rodar tudo.
> **Pré-requisito:** OAuth Max funcionando (M2 setup completo). DB pode estar vazio (cria empresa demo) ou com state M5.

---

## 0. Pré-flight

Antes de abrir o app:

```powershell
# Garantir build limpa
pnpm install
pnpm typecheck         # esperado: 0 errors
pnpm lint              # esperado: 0 errors
pnpm --filter @dashboard-agent/main test   # esperado: 187 passing, 37 files
pnpm --filter @dashboard-agent/main build
pnpm --filter @dashboard-agent/renderer build
```

Se algum passo falhar, **NÃO continuar**. Abrir issue.

---

## 1. Migration auto-cria Default Workspace

Cenário: você tinha M5 rodando com um `workspaceCwd` configurado no Settings.

### Setup
- Se DB existe pré-M6 (com workspaceCwd): mantenha como está
- Se DB novo: instale OAuth, crie empresa demo, configure workspaceCwd no Settings (M5 fluxo), feche o app

### Teste
1. Abra o app (rodar `pnpm dev` ou o .exe buildado)
2. Vá em **Sidebar → Projects**

### Esperado
- ✅ Aparece exatamente **1 project** chamado **"Default Workspace"** com cor azul (`#1D5DD7`)
- ✅ Path mostrado é o mesmo que estava em `settings.workspaceCwd`
- ✅ Lista esquerda destaca o project como selecionado por padrão
- ✅ Detail à direita mostra o path mono + counts (`0 agents · 0 issues · 0 doing` se nenhuma agent existir, ou populated)

### Falha?
- Se aparecer 0 projects: post-migration não rodou. Verifique `apps/main/src/db/post-migrations/0002.ts` está sendo invocado em `client.ts`
- Se aparecer 2+ projects "Default Workspace": idempotência quebrou. Bug.

---

## 2. Projects CRUD via UI

### 2.1 Criar novo project

1. Em **/projects**, clique **`+ New project`** (botão azul no rodapé da lista)
2. Modal abre. Preencha:
   - **Name:** `Test Project`
   - **Folder path:** clique `Choose folder...` → selecione qualquer pasta existente no seu disco (ex: `C:\Temp` ou `~/Documents`)
   - **Color:** clique numa cor diferente (verde por exemplo)
3. Clique **Save**

### Esperado
- ✅ Modal fecha
- ✅ Novo item aparece na lista esquerda com a cor escolhida
- ✅ É auto-selecionado (lista mostra borda azul à esquerda)
- ✅ Detail à direita mostra os dados que você preencheu

### 2.2 Editar project

1. Selecione o `Test Project` criado
2. Clique **Edit** (botão azul no rodapé do detail)
3. Mude o **Name** pra `Test Project Renamed`
4. Mude a **Color**
5. Save

### Esperado
- ✅ Lista esquerda atualiza nome + cor imediato
- ✅ Detail à direita atualiza

### 2.3 Detectar path missing

1. Crie um project com path **inválido**: edite manualmente um path pra `C:\does\not\exist\xyz`
   - Ou: crie um project pra `C:\Temp\test-folder-m6`, depois delete a pasta no Explorer
2. Aguarde **30 segundos** (o `refreshPaths` roda em interval)
   - Atalho: clique noutro project e volte (force refresh manual via re-mount)

### Esperado
- ✅ Lista esquerda: o item ganha **opacity-60** + ícone **⚠️**
- ✅ Detail à direita: badge vermelho **"Path indisponível"** no topo

### 2.4 Open in Explorer

1. Selecione um project com path válido
2. Clique **Open in Explorer**

### Esperado
- ✅ Windows Explorer / Finder abre na pasta do project
- ✅ Se path missing: nada acontece (silently fails — esperado v1)

### 2.5 Deletar project

1. Selecione o `Test Project Renamed`
2. Clique **Delete project** (botão vermelho)
3. Confirme no `window.confirm`

### Esperado
- ✅ Project some da lista
- ✅ Próximo project (ou Default Workspace) auto-selecionado
- ✅ Issues que estavam vinculadas ao project deletado **continuam existindo** mas com `projectId = null` (FK ON DELETE SET NULL)

---

## 3. Sandbox respeitando project allowlist (REGRESSÃO M4+M5)

Esse é o teste mais crítico — segurança não pode regredir.

### 3.1 Setup

1. Tenha 2 projects criados: `Default Workspace` (path A) + `Test Project` (path B, pasta diferente)
2. Crie a empresa demo se ainda não tem (Sidebar mostra agents)
3. Vá em **/agents/CEO** (clique no CEO na sidebar)

### 3.2 Agent com allowlist vazia (= all) consegue Bash em ambos paths

No chat com CEO, peça:
```
Liste os arquivos da raiz do projeto Default Workspace usando Bash ls.
```

### Esperado
- ✅ CEO usa Bash, retorna listagem da pasta A
- ✅ Sem prompt de aprovação (modo supervised mas Bash ✅ allowed pelo gate)
- Se aparecer prompt: o gate fez `request_user` em vez de `allow` — diagnostique no `apps/main/dist/orchestrator.log`

Repita pedindo path B:
```
Agora liste os arquivos da raiz do projeto Test Project.
```

### Esperado
- ✅ Mesma coisa, listagem da pasta B
- ✅ Sem deny

### 3.3 Restringir CEO a SÓ Default Workspace

1. Vá em **/projects → Default Workspace**
2. Na seção **Agents com acesso**, clique no chip do CEO
3. Marque o checkbox "Has access to Default Workspace" (já está marcado se allowlist=[])
4. Vá em **/projects → Test Project**
5. No chip do CEO ali, **desmarque** "Has access to Test Project"

> **Bug conhecido (débito M9):** o toggle minimal não suporta multi-project picker; ao desmarcar fica como `[]` (allow all). Esse teste vai mostrar comportamento incompleto até M9. Veja `project_m6_lessons.md` "AllowlistEditor é minimal pra v1".

**Workaround pra testar de verdade**: edite o DB diretamente:
```powershell
# Encontre o agent_id do CEO no DB SQLite
# Ferramentas: DB Browser for SQLite, ou via terminal:
# sqlite3 "$env:APPDATA\dashboard-agent\dashboard-agent.db" "UPDATE agents SET allowed_projects_json = json_array('<DEFAULT_PROJECT_ID>') WHERE name = 'CEO'"
```

Substitua `<DEFAULT_PROJECT_ID>` pelo `id` real (consulta: `SELECT id, name FROM projects;`).

Reinicie o app pra o agent recarregar.

### 3.4 Verifica deny do path NÃO autorizado

Volte ao chat do CEO e peça:
```
Liste os arquivos da raiz do projeto Test Project.
```

### Esperado
- ✅ Bash é **denied** automaticamente OU vira request_user (depende se o path absoluto entra na detecção)
- ✅ Se denied: deve aparecer um inbox `error` ou approval na inbox
- ✅ Se request_user: aparece ApprovalCard inline no chat
- ✅ CEO recebe o erro e tenta alternativa ou desiste

### 3.5 Reverter allowlist

```powershell
# sqlite3 ... "UPDATE agents SET allowed_projects_json = '[]' WHERE name = 'CEO'"
```

Reinicie. CEO volta a ter acesso a tudo.

---

## 4. Issues backend via MCP (CEO usa as 5 tools reais)

### 4.1 create_issue (com project name lookup)

No chat com CEO:
```
Crie 3 issues no projeto "Default Workspace":
1. "Setup CI" — descrição "wire GitHub actions", prioridade alta
2. "Login bug" — sem descrição, prioridade urgente
3. "Refactor API endpoints" — descrição "migrar /v1 pra /v2", prioridade média

Atribua as 3 a si mesmo.
```

### Esperado
- ✅ CEO chama `create_issue` 3x via MCP (visível no chat como tool calls)
- ✅ Tool calls retornam `{id, title}` (NÃO mais `{mocked: true}`)
- ✅ Cada issue gera evento `issue.created` no orchestrator (visível em logs)
- ✅ Cada issue dispara `broadcastIssueChanged` → renderer
- ✅ Se você abrir **/issues** numa nova aba, kanban deve já mostrar as 3 issues na coluna "Todo"

### 4.2 list_issues

```
Use list_issues pra me mostrar todas as issues do projeto Default Workspace.
```

### Esperado
- ✅ CEO retorna lista com 3 issues
- ✅ Shape: `{issues: [{id, title, status, assignee, priority}]}`

### 4.3 update_issue (status → done dispara inbox)

```
Marque a issue "Login bug" como done.
```

### Esperado
- ✅ CEO chama `update_issue` com status='done'
- ✅ Aparece **inbox notification** kind='completed' com título "Login bug — done"
- ✅ Kanban: a card move da coluna "Todo" pra "Done"
- ✅ Detail modal (se aberto) atualiza status

### 4.4 assign_issue + check_status

```
Use assign_issue pra atribuir "Refactor API endpoints" a um agent inválido com id "fake_agent_xyz".
```

### Esperado
- ✅ Tool retorna `{ok: false, error: "agent not found"}` (Fix #3 do final review)

```
Agora use check_status pra ver o status atual de todas as 3 issues.
```

### Esperado
- ✅ CEO chama check_status 3x, retorna `{id, status, assignee, updated_at}` cada

### 4.5 Cross-company guard (segurança)

Esse exige criar uma 2ª empresa. Pula se você tem só 1.

Se tiver 2 empresas: pegue o id de uma issue da empresa B, peça pra um agent da empresa A:
```
Use update_issue com id "<issue_id_da_outra_empresa>" e status "done".
```

### Esperado
- ✅ Tool retorna `{ok: false, error: "issue not found"}` (Fix #2 do final review — company-scope guard)

---

## 5. Issues kanban UI

### 5.1 Visualização base

Vá em **/issues**.

### Esperado
- ✅ 5 colunas visíveis: Backlog · Todo · Doing · Review · Done
- ✅ Counts por coluna corretos (ex: "Todo · 2", "Done · 1")
- ✅ Cada card mostra: dot da cor do project + título (truncate 2 linhas) + assignee + priority badge (só pra high/urgent)
- ✅ Filtros (Project / Assignee / Priority) populated com opções

### 5.2 Drag-drop entre colunas

1. Clique e segure uma card em "Todo" (espera 4px de movimento pra ativar — não ativa em click puro)
2. Arraste pra coluna "Doing"
3. Solte

### Esperado
- ✅ Card move imediato (optimistic update)
- ✅ DB persiste status (refresh da página mantém)
- ✅ Inbox NÃO ganha notification (só status='done' notifica)
- ✅ `issues:changed` broadcast atualiza count nas colunas

### 5.3 Filtros

1. Filtre por **Project** (escolha "Default Workspace") → só issues desse project aparecem
2. Combine: **Priority = high** → ainda menos
3. Volte tudo pra "All"

### Esperado
- ✅ Filter é AND entre os 3 selectors
- ✅ Counts das colunas refletem só os filtrados

### 5.4 Subtasks NÃO aparecem como cards top-level (Critical Fix #1 do final review)

Crie uma issue parent + sub-task via UI ou MCP:
```
Crie uma issue "Parent task" no Default Workspace. Depois crie uma sub-task "Sub A" com parent_id sendo o id dessa issue (use create_issue com parent_id).
```

### Esperado
- ✅ "Parent task" aparece no kanban
- ✅ "Sub A" **NÃO aparece** como card top-level
- ✅ Click em "Parent task" → modal mostra "Sub A" na seção Sub-tasks

---

## 6. Issue detail modal

### 6.1 Abrir + URL persiste

1. Click numa card qualquer do kanban
2. Verifique URL no browser ou DevTools (Ctrl+Shift+I → Console)

### Esperado
- ✅ Modal centralizado abre com fundo blur
- ✅ URL muda pra `#/issues?selected=<id>`
- ✅ Header: badge `[STATUS]` + priority + ✕ no canto
- ✅ Title + description (se tem) + project + assignee
- ✅ Esc fecha modal
- ✅ Click no fundo blur fecha modal
- ✅ Click no conteúdo do modal NÃO fecha (event.stopPropagation)

### 6.2 Adicionar comentário (user)

1. Modal aberto, scroll até "Comments"
2. Digite no textarea: "Esse é meu primeiro comentário"
3. Click **Send**

### Esperado
- ✅ Comentário aparece imediato com label "You (user) · just now"
- ✅ Textarea limpa após send
- ✅ DB persiste (refresh modal mantém)

### 6.3 Sub-tasks toggle

Se a issue tem sub-tasks:
1. Click no checkbox de uma sub-task

### Esperado
- ✅ Status muda (todo → done) com strikethrough
- ✅ DB persiste
- ✅ Issue label "X status" atualiza

### 6.4 Tool call history

Pra ver tool history populated:
1. Atribua uma issue a um agent (qualquer um, não CEO)
2. Mude status pra "doing"
3. No chat com esse agent, peça: "trabalhe na issue X. Use Bash, Read, Edit pra simular."
4. Agent vai chamar várias tools enquanto status=doing
5. Mude status pra "done" ou "review"
6. Reabra a issue

### Esperado
- ✅ Modal mostra accordion **"Tool call history (N)"** colapsado
- ✅ Click expande, mostra cada tool call: nome + input truncado
- ✅ Só tool calls do **assignee** durante o período "doing" aparecem

### 6.5 Reassign

1. Click **Reassign ▼**
2. Dropdown lista todos os agents
3. Escolha outro

### Esperado
- ✅ Issue troca assignee imediato
- ✅ Modal label "Assignee" atualiza
- ✅ DB persiste (event 'assignee_changed' escrito em issue_events)

### 6.6 Delete

1. Click **Delete issue** (botão vermelho)
2. Confirma no window.confirm

### Esperado
- ✅ Modal fecha
- ✅ Issue some do kanban
- ✅ Sub-tasks também somem (CASCADE DELETE)
- ✅ Comments também somem

---

## 7. Real-time cross-pane

Teste valida que MCP tool calls do agent atualizam UI em tempo real.

### Setup

1. Abra **/issues** numa aba do app
2. **NÃO** feche, mas abra também **/agents/CEO** numa segunda aba (split window do Electron — atalho Ctrl+T se suportado, ou abrir 2 instâncias)

> Alternativa se Electron só suporta 1 janela: alterne entre rotas com sidebar.

### Teste

1. No chat do CEO: `Crie issue "Realtime test" no Default Workspace.`
2. Imediatamente após CEO chamar create_issue, troca pra /issues

### Esperado
- ✅ Card "Realtime test" aparece no kanban em **<2 segundos** sem refresh manual
- ✅ Se você está em /projects no Default Workspace, o counter "issues" + "Recent issues" também atualiza

### Verificação técnica

No DevTools console, deve ver eventos `issues:changed` chegando via IPC quando agent cria/atualiza issue.

---

## 8. Não-regressão M2-M5

Antes de declarar M6 estável:

| Feature M-x | Como verificar | Esperado |
|---|---|---|
| **M2 OAuth (Settings)** | Abrir /settings | Token mostrado mascarado, language toggle funciona, tema dark/light aplica |
| **M2 i18n** | Trocar pra pt-BR e en-US | Strings mudam (incluindo as novas de M6 — issues, projects) |
| **M3 CEO chat** | Vai em /agents/CEO, manda msg simples | CEO responde em <30s |
| **M3 sandbox** | Pede pra CEO ler `~/.credentials.json` | Bash deny ou request_user (sensitive path block ainda funciona) |
| **M4 token-leak guard** | DevTools → Network → checa que `auth:token-detect` não retorna o raw token | Só `{found, maskedPrefix}` |
| **M5 multi-agente** | `Hire um agent chamado "Dev1" do tipo Backend Engineer` | Agent aparece na sidebar, status colors atualizam, chat funciona |
| **M5 inbox** | Pedir aprovação Bash em modo supervised | Aparece inbox `approval` com Approve/Reject inline |
| **M5 fence file pattern** | Aprovar uma request | Tool executa após approval; fence file removido |

Se qualquer regressão: documente exatamente qual passo falhou e em qual commit.

---

## 9. Edge cases (manual)

### 9.1 Project name ambíguo no MCP

Crie 2 projects com mesmo nome (UI permite isso porque a unicidade é por id, não name):
- `My Project` (path A)
- `My Project` (path B)

Pede pra CEO: `Crie issue "X" no projeto "my project"`.

### Esperado
- ✅ MCP retorna `{ok: false, error: "multiple projects match"}`

### 9.2 Project deletado durante issue ativa

1. Crie issue X no project Y
2. Delete o project Y via UI
3. Vá em /issues e clique em X

### Esperado
- ✅ Modal abre normal
- ✅ Campo "Project" mostra "—" (FK SET NULL)
- ✅ Sandbox: nenhum path autorizado pra essa issue, agent não consegue Bash/Edit nessa pasta

### 9.3 Reload no meio de comentário

1. Abra modal de uma issue
2. Comece a digitar comentário
3. F5 (refresh) — Electron pode interpretar como reload do renderer

### Esperado
- ✅ Modal fecha (estado local perdido — esperado, não há persist do draft)
- ✅ URL `?selected=<id>` persiste, então re-render abre o modal de novo

---

## 10. Performance

Não temos benchmarks formais ainda (M8 vai trazer), mas observe:

- **Boot time:** abrir /issues após 100+ issues criadas → <2s pra renderizar kanban
- **Drag-drop:** sem lag perceptível mesmo com 50+ cards numa coluna
- **Modal open:** abrir issue detail → <500ms (issues:get + render)
- **Token usage:** cada turn do CEO criando 1 issue ≈ X tokens (compare com baseline M5 — deve ser ~1x baseline). Veja `m6-token-baseline.json` (atualmente zero — você precisa rodar fixture pra preencher; depois o test `m6-token-budget.test.ts` valida em CI)

---

## ✅ Checklist de aprovação M6 → master

Marque cada um:

- [ ] Pré-flight (build, tests, typecheck) — todos verdes
- [ ] Migration auto-cria Default Workspace
- [ ] Projects CRUD completo (criar/editar/deletar/open)
- [ ] Path missing detection funciona
- [ ] Sandbox respeitando allowlist (deny path fora)
- [ ] CEO usa create_issue real (não stub)
- [ ] CEO usa update_issue → status=done dispara inbox
- [ ] list_issues retorna estrutura correta
- [ ] check_status funciona
- [ ] assign_issue rejeita agent_id inválido
- [ ] update_issue rejeita issue de outra company
- [ ] Kanban renderiza com 5 colunas + counts
- [ ] Drag-drop persiste status
- [ ] Filtros funcionam
- [ ] Subtasks NÃO aparecem como top-level
- [ ] Modal abre via click + Esc/× fecha
- [ ] Comments adicionam/persistem
- [ ] Sub-tasks toggle
- [ ] Tool history accordion (com agent assignee + status=doing)
- [ ] Reassign dropdown
- [ ] Delete cascade
- [ ] Real-time cross-pane (MCP create → kanban atualiza <2s)
- [ ] M2/M3/M4/M5 não regrediram

Se TODOS marcados → **OK pra merge em master**. Algum falhando → triage.

---

## Bugs encontrados

Liste aqui qualquer comportamento inesperado durante o teste:

| # | Cenário | Esperado | Observado | Prioridade |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
