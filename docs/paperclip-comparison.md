# Prospero x Paperclip — Comparação feature-a-feature

> **Data:** 2026-05-11
> **Nossa base:** M1–M6 mergeados em `master` (ver [ROADMAP.md](../ROADMAP.md))
> **Referência:** [github.com/paperclipai/paperclip](https://github.com/paperclipai/paperclip) (snapshot clonado em `D:/tmp/paperclip`)
> **Memory:** [reference_paperclip.md](../memory) — Paperclip é referência ativa do projeto
>
> **Propósito:** mapear cada feature já implementada, comparar com Paperclip, e elencar **melhorias concretas** com o porquê. Não é um plano de implementação — é matéria-prima para os próximos milestones (M7+) e para débito técnico.

---

## TL;DR

Paperclip e Prospero compartilham a **visão de produto** ("CEO chat orquestrando time de agentes"), mas divergem em quase tudo no nível de execução:

| Eixo | Prospero (nós) | Paperclip |
|---|---|---|
| **Distribuição** | Electron desktop, single-user | Server Express + UI web, multi-tenant capable |
| **Auth → Anthropic** | OAuth Max (flat-rate) via `safeStorage` | BYO API key, agent autenticado por JWT local |
| **Modelo de execução** | claude CLI persistente (`--input-format stream-json`), 1 processo por agente | Heartbeat polling — agente "liga" só pra pegar task |
| **Provider** | Claude Code only | Adapter pattern (9 adapters: claude-local, openclaw, codex, cursor, …) |
| **DB** | better-sqlite3 + SQL raw + Zod (9 tabelas) | Postgres (embedded) + Drizzle ORM (~60 tabelas) |
| **MCP** | Servidor MCP interno (stdio child do agente) | Wrapper MCP em volta da API REST (`packages/mcp-server`) |
| **Sandbox** | `CLAUDE_CONFIG_DIR` isolado + `--strict-mcp-config` + file-fence permissions + workspace gate | Execution workspaces (git worktree ou plugin: e2b/Cloudflare/Daytona) + permissions JSONB application-level |
| **Extensibilidade** | Hard-coded (escopo deliberado v1) | Plugin SDK rodando em worker threads (~20K linhas) |
| **LoC backend** | ~4.2K linhas | ~36K linhas server + 28K db + 20K plugins |

**Resumo qualitativo:** Paperclip é uma plataforma genérica de orquestração multi-provider; o Prospero é um cliente desktop **opinionado e enxuto** para Claude Code OAuth Max. As decisões de simplicidade nossas (1 provider, sqlite, sem plugin) são **conscientes** e alinhadas com [project_prospero.md](../memory) e a restrição de ToS Anthropic (máx 4 agentes paralelos, 1× volume normal). **Não devemos imitar Paperclip em escopo — devemos selecionar onde ele resolve melhor um problema que nós também temos.**

---

## Estrutura desta análise

Para cada feature já implementada (M1–M6) mais o que está planejado (M7–M9), comparamos em quatro dimensões:

1. **Como nós fazemos** — arquivos, abstrações, tamanho
2. **Como Paperclip faz** — idem
3. **Por que diverge** — restrição/decisão de design por trás
4. **Onde podemos melhorar** — ações concretas com prioridade

Prioridade das melhorias:
- **🔴 Alta** — ROI claro, escopo pequeno, faz sentido na próxima janela (M7–M9)
- **🟡 Média** — boa ideia mas custa milestone próprio ou refatoração relevante
- **🟢 Baixa** — só v2+, ou só se o problema aparecer
- **⚪ Não fazer** — arquitetura/escopo de Paperclip que não cabe no nosso v1

---

## 1. Arquitetura geral

**Nós** ([apps/main/src/index.ts](../apps/main/src), [apps/renderer](../apps/renderer), [apps/main/src/ipc/preload.ts](../apps/main/src/ipc/preload.ts))

Electron 33 com `contextIsolation: true`. Main expõe IPC bridge em namespaces (`window.prospero.{auth,agents,messages,inbox,permissions,projects,issues,settings}`). Comunicação bidirecional: renderer chama via `invoke`, main empurra via `webContents.send` (`AGENT_EVENT`, `ISSUES_CHANGED`, `INBOX_UPDATE`, `PERMISSION_REQUEST`). ~307 linhas no core (index + preload + handlers + window).

**Paperclip** (`server/src/index.ts`, `ui/src/App.tsx`)

Express 5.1 + Drizzle + WebSocket (`ws`) + React + Vite. Server e UI são processos separados — UI consome REST + WebSocket. Embedded Postgres é default (não exige Docker; `embedded-postgres` detecta porta livre e armazena em `~/paperclip/data/pglite`). Suporta deploy cloud ou self-hosted via `PAPERCLIP_*` env vars.

**Por que diverge**

Foco de produto. Nosso target é "desktop app pessoal, sem servidor, sem cloud" (memory: `project_prospero`). Paperclip nasceu como server justamente para abrir o caminho de cloud/multi-user — coisas que estão **out-of-scope explicitamente** pra nós (ToS Anthropic Max é single-user).

**Onde podemos melhorar**

- 🟢 **WebSocket-like granular events em vez de broadcast IPC chato.** Nosso `roster broadcast em todo turn-complete` (M5 lesson) é grosso. Paperclip tem `live-events-ws.ts` com tipos `issue.updated`, `approval.pending`, etc. **Não muda arquitetura, só refina o protocolo IPC**: criar um discriminated union por evento e mandar deltas, não snapshots completos. Reduz churn no renderer. Custo: ~1 dia. Cabe num polish do M9.
- ⚪ **Não adotar arquitetura server.** Já é regra (`project_prospero`). Reafirmar aqui para futuras tentações.

---

## 2. Database & migrations

**Nós** ([apps/main/src/db/client.ts](../apps/main/src/db/client.ts), [apps/main/src/db/migrations/](../apps/main/src/db/migrations))

better-sqlite3 + WAL + `synchronous=NORMAL` + `foreign_keys=ON`. Pragma `user_version` para versionar migrations. Aplicação em transação atômica. 2 migrations SQL raw (`0001_initial.sql` 135 linhas + `0002_m6_issues_projects.sql` 26 linhas) + hooks pós-migration TS (`0002.ts`, `0003.ts`). Total 9 tabelas (companies, projects, agents, issues, issue_comments, issue_events, messages, settings, inbox).

**Paperclip** (`packages/db/src/schema/`, `packages/db/src/migrations/`)

Drizzle ORM com schema-as-TypeScript (75+ arquivos por tabela) + migrations SQL numeradas (0000…0015+). Postgres com `jsonb` usado liberalmente (adapterConfig, executionPolicy, runtimeConfig, payload). ~60 tabelas (incluindo plugin_*, heartbeat_*, budget_*, routine_*, sandbox_*, approval_*). Reconciliação automática on boot.

**Por que diverge**

Quantidade de features. Paperclip carrega o peso de plugin system, routines, sandbox providers, multi-adapter — cada um traz seu cluster de tabelas. Nós deliberadamente preferimos few-tables-rich-JSON quando faz sentido (`agents.skills_json`, `agents.allowed_projects_json`).

Drizzle dá tipos automáticos mas paga em mágica e bundle. Nosso `Zod + SQL raw` é mais simples mas perde refactor safety quando renomeamos coluna — precisamos lembrar de atualizar tipos manuais em `packages/shared/src/types/*.ts`.

**Onde podemos melhorar**

- 🟡 **Type-safe prepared statements sem ORM full-blown.** Hoje vemos `db.prepare<...>(...)` com generics manuais. Risco: typo em SQL só explode em runtime. Uma camada lite — sem Drizzle — daria autocomplete:
  - Opção 1: adotar Kysely (10× menor que Drizzle, query builder type-safe, mas é nova dep)
  - Opção 2: gerar tipos de SQL via `@better-sqlite3/types` ou similar (mais nicho)
  - Opção 3: deixar como está e investir em testes de integração
  - Recomendação: **opção 3** por enquanto. Esperar dor real antes de adicionar dep. Marcar como débito técnico.
- 🟡 **Rollback / dry-run de migration.** Paperclip também não tem rollback de verdade, mas tem `migration-status.ts` que mostra estado. Nosso `migrations.ts` (43 linhas) é silencioso. Adicionar log estruturado de qual migration foi aplicada e timestamp em uma tabela `_migration_log` ajuda debugging futuro. Custo: ~2h.
- 🔴 **Identifier humano em issues (`PRJ-123`).** Paperclip tem `issues.issueNumber` + `identifier` (slug com prefixo do projeto). Nossas issues hoje são UUIDs longos no UI — péssima UX. Migration leve (counter por projeto + texto derivado). Cabe em M9 polish.

---

## 3. OAuth & Auth

**Nós** ([apps/main/src/auth/token-storage.ts](../apps/main/src/auth/token-storage.ts), [apps/main/src/auth/token-detect.ts](../apps/main/src/auth/token-detect.ts))

`safeStorage.encryptString` (DPAPI no Windows, libsecret Linux, Keychain macOS). Auto-detect lê `~/.claude/.credentials.json` e extrai `claudeAiOauth.accessToken`. **Token nunca cruza pra renderer** — IPC `auth:token-detect` retorna só `{found, maskedPrefix}` (lição M4 SEC-01). Setup wizard com dois caminhos: paste manual ou import detectado. 154 linhas no auth core + setup wizard de 161 linhas no renderer.

**Paperclip** (`server/src/auth/better-auth.ts`, `server/src/agent-auth-jwt.ts`, `server/src/middleware/auth.ts`)

**Two-actor model:**
- **Users** autenticam via Better-Auth (email/senha + sessões em DB). OAuth-ready mas não wired para Anthropic.
- **Agents** autenticam via JWT HS256 assinado localmente. O agente recebe `PAPERCLIP_API_KEY` (que é um JWT) e usa pra chamar a API.

Middleware `actorMiddleware` extrai `req.actor = { type: "board"|"agent", userId?, agentId?, source }`. Não fala com Anthropic — Anthropic creds são responsabilidade do adapter (BYO).

**Por que diverge**

Modelos de monetização diferentes. Paperclip não toca em creds do provider (você traz a sua chave Claude/OpenAI/etc); eles cuidam só de autorizar quem-pode-falar-com-o-paperclip. Nosso valor é justamente o oposto — somos o **cliente OAuth Max**, então gerenciar o token é parte central.

Multi-user vs single-user. Better-Auth faz sentido se a UI vai ser usada por mais de uma pessoa. No nosso caso é desktop pessoal.

**Onde podemos melhorar**

- 🔴 **Two-actor mental model é útil mesmo pra single-user.** Quando M9 adicionar suporte a API key, vamos precisar saber "qual modo está ativo" e "qual cred passar pro spawn". Paperclip nos mostra que vale ter um único getter `getActiveAuthMode(): 'oauth' | 'api-key'` (já planejado em [ROADMAP.md M9](../ROADMAP.md)). **Borrowar do Paperclip:** colocar isso em `apps/main/src/auth/` desde já como `auth-mode.ts` retornando só `'oauth'` por ora, sem if-else espalhado. Custo: 1h. Reduz risco quando M9 plugar API key.
- 🟢 **Token expiry tracking.** Hoje guardamos `KEY_AT` mas não exibimos quando expira. OAuth Max tem refresh — podemos detectar e dar banner amarelo (já listado no M9 da roadmap). Não copia nada do Paperclip, mas é boa hora para incluir.

---

## 4. Settings + i18n

**Nós** ([apps/renderer/src/i18n/index.ts](../apps/renderer/src/i18n/index.ts), [apps/main/src/settings/](../apps/main/src/settings))

react-i18next com 2 línguas (pt-BR default, en-US). Zustand store com `i18next.changeLanguage()` no setter. `AppSettingsSchema` (Zod) com 3 campos: `language`, `theme`, `workspaceCwd`. Repository pattern (39 linhas) que merge parcial com defaults. Tudo em uma tabela `settings (key, value)`.

**Paperclip** (`server/src/config.ts`, `server/src/instance-settings.ts`)

**Sem i18n.** Tudo em inglês — não está no roadmap. Config split em duas camadas:
- **Boot config**: env vars (`.env`, `~/paperclip/.env`) — `DATABASE_URL`, `PORT`, `STORAGE_PROVIDER`, `SECRET_PROVIDER`, `BETTER_AUTH_SECRET`, deployment mode (cloud/self-hosted).
- **Instance settings**: tabela `instance_settings` (singleton por instância) — preferences runtime que UI pode mudar.

**Por que diverge**

Paperclip é cloud-aware desde o início; precisa de boot config externa pra apontar pra Postgres real ou embedded. Nós já decidimos local-only — não temos esse split.

i18n é decisão de UX nossa (PT-BR + EN-US). Paperclip vai EN-only e ninguém reclama.

**Onde podemos melhorar**

- 🟡 **Separar settings "boot" de settings "runtime".** Hoje `settings.workspaceCwd` está na mesma tabela que `language`. Mas `workspaceCwd` foi migrado pra `projects` (lição M6 post-migration). Talvez valha definir explicitamente: o que muda em runtime via UI vai pra `settings`; o que precisa de relaunch vai pra config file (`~/.prospero/config.json` ou similar). Pequeno e ajuda no M9 quando adicionar "default model" e "default mode".
- ⚪ **Não adicionar Better-Auth equivalente.** Nosso modelo single-user dispensa.

---

## 5. Orchestrator / Agent runtime

Esta é a divergência **mais importante** entre os dois projetos. Vale parar e detalhar.

**Nós** ([apps/main/src/orchestrator/lifecycle.ts:1-383](../apps/main/src/orchestrator/lifecycle.ts), [stream-parser.ts](../apps/main/src/orchestrator/stream-parser.ts), [router.ts](../apps/main/src/orchestrator/router.ts), [events-watcher.ts](../apps/main/src/orchestrator/events-watcher.ts), [mcp-config.ts](../apps/main/src/orchestrator/mcp-config.ts))

**Modelo: claude CLI persistente.** Cada agente é um processo `claude` rodando com `--input-format stream-json --output-format stream-json --include-partial-messages`. O processo fica vivo durante toda a sessão; nós escrevemos turnos via stdin e parseamos turnos via stdout. Sandbox via `CLAUDE_CONFIG_DIR` per-agent persistente (pra `--resume` funcionar across spawns) + `--strict-mcp-config` (sem MCP global, sem hooks, sem skills do host). Max 4 concurrent enforced (ToS).

Pipeline:
1. `spawnAgent()` resolve binário (Win prefere `.exe` direto, lição M3), escreve `mcp.json` temporário com 1 servidor (`dashboard`), monta CLAUDE_CONFIG_DIR.
2. `readline` em stdout → `parseStreamLine` → eventos tipados (`session-init`, `assistant-message`, `tool-result`, `turn-complete`, `api-retry`).
3. Router FIFO per agent com `currentTurnThreadId` evita interleaving (lição M5).
4. Cross-thread routing: prefix `[from: name]` adicionado pelo router quando mensagens entre agentes.
5. Events MCP→main via **arquivos JSON em diretório watched por chokidar** (lição M5: stderr unreliable no Windows).

LoC: ~776 linhas.

**Paperclip** (`server/src/services/heartbeat.ts:1-9800`, `server/src/services/agents.ts`, `packages/adapters/*`)

**Modelo: heartbeat polling.** O agente é um cliente HTTP que `POST /api/heartbeat` periodicamente. Server retorna:
- `{ task: { issueId, ... } }` — vai executar
- `{ pause: true }` — budget estourou, fique parado
- `{ null }` — nada pra fazer

Agente executa, retorna `{ result, usage }`, server persiste em `heartbeat_runs` + `heartbeat_run_events`. Cada `adapterType` (claude-local, openclaw-gateway, cursor-local, codex-local, gemini-local, etc.) implementa `ServerAdapter.execute(context, request)` no server-side.

Não é daemon. O agente não fica ligado entre tasks. Workspace é provisionado dinamicamente por execução (git worktree ou plugin de sandbox provider — e2b, Cloudflare, Daytona).

LoC: `heartbeat.ts` sozinho tem ~9.8K linhas (monolito da execução). 9 adapters em `packages/adapters/`.

**Por que diverge**

Modelo de produto:
- Paperclip precisa rodar 24/7, agente pode estar em outra máquina/cloud, conexão pode cair → polling é resiliente. Adapter multi-provider é a feature de venda.
- Nós precisamos de latência baixa (chat ao vivo com o CEO), 1 máquina, OAuth Max — daemon persistente é o caminho certo. ToS Anthropic Max requer max 4 paralelos e ~1× volume; polling vazio gasta nada vs streaming sempre ligado, mas streaming dá UX de chat real.

**Onde podemos melhorar**

- 🟡 **Quebrar `lifecycle.ts` (383 linhas) cedo, antes de inflar mais.** Paperclip foi pro outro extremo — `heartbeat.ts` 9.8K linhas é um pesadelo de leitura. Nosso lifecycle ainda está navegável mas o M7a (model selection) e M9 (api key) vão adicionar branches. Sugestão: extrair `buildClaudeArgs`, `prepareSandbox`, `resolveBinary` em arquivos próprios já em M7. Custo: 2h. Não quebra nada e reduz risk de virarmos um `heartbeat.ts`.
- 🔴 **Adapter pattern preparation.** Hoje hard-coded Claude. M9 vai adicionar API key — já é uma "variante de adapter" disfarçada (mesmo binário, env var diferente, talvez sem `--strict-mcp-config`?). v2 promete Cursor/Codex. Em vez de espalhar `if (mode === 'api-key')` por `lifecycle.ts`, definir uma interface mínima:
  ```ts
  interface AgentAdapter {
    name: 'claude-oauth' | 'claude-api-key' | future-providers;
    buildArgs(agent, env): string[];
    parseStream(line): ParsedEvent | null;
    estimateUsage(events): { input, output, cache_read, cache_creation };
  }
  ```
  Bem mais magro que `ServerAdapter` do Paperclip (que carrega test-environment, model-profiles, etc.) mas dá o mesmo benefício. Custo: ~1 dia. Cabe no M9 quando o segundo modo entrar.
- 🟢 **Heartbeat-like fallback para `always_on` agents.** Hoje nossa stream persistente vai segurar um turno trancado se o agente "quietar" — `currentTurnThreadId` nunca limpa (lição M5). Paperclip não tem esse problema: cada execução é discreta. **Não vamos mudar pra polling**, mas vale ter um timeout watchdog: se agente fica > N minutos sem `turn-complete`, gerar inbox `error` e dar opção de restart. Já está listado como "Heartbeat do agente (5min timeout → status='error' + inbox + restart button)" no M9. Confirmar prioridade.
- ⚪ **Não adotar heartbeat puro.** Perderíamos a UX de streaming live, e nossa restrição de 4 paralelos OAuth Max já casa com daemon.

---

## 6. MCP Server

**Nós** ([apps/main/src/mcp/server.ts](../apps/main/src/mcp/server.ts), [tools.ts](../apps/main/src/mcp/tools.ts))

MCP server interno, stdio child do processo claude (filho-do-filho). Servidor é spawnado por Electron com `ELECTRON_RUN_AS_NODE=1`. 14 tools (`list_agents`, `list_projects`, `hire_agent`, `fire_agent`, `message_agent`, `read_thread`, `notify_user`, `request_permission`, `report_to_user`, `create_issue`, `update_issue`, `assign_issue`, `list_issues`, `check_status`). Tools usam Zod pra validação. `request_permission` faz file-based polling esperando resolução (lição M5: stderr inviável no Windows). 592 linhas total.

**Paperclip** (`packages/mcp-server/src/`)

**Wrapper sobre REST API.** O `mcp-server` é um processo separado que roda em paralelo do server Express. Tools são thin proxies que fazem fetch HTTP em `PAPERCLIP_API_URL` com `PAPERCLIP_API_KEY` (JWT agent). Adapter Claude pode opcionalmente apontar pro MCP — mas a maioria dos adapters fala HTTP direto contra o server.

LoC: ~200 linhas (thin layer).

**Por que diverge**

Topologia. Nosso MCP é o canal **primário** (e único) entre agente e dashboard — direta integração stdio-criança garante baixa latência e auth implícita (pipe privado). Paperclip o MCP é **acessório** — agentes podem nem usá-lo; a comunicação real é HTTP. Eles têm MCP como compatibilidade com clientes externos que querem se plugar no Paperclip via stdio.

**Onde podemos melhorar**

- 🟡 **Tools.ts (502 linhas) precisa modularizar antes de M7.** Já vai crescer com `hire_agent` aceitando `model` (M7a), `update_skills`, `update_reports_to` (M7), `set_budget` (M8). Pattern Paperclip: 1 tool = 1 arquivo. Sugestão: dividir em `mcp/tools/agents.ts`, `mcp/tools/issues.ts`, `mcp/tools/messages.ts`, `mcp/tools/permissions.ts`. Custo: 2h refactor. **Por que importa:** lição M5 já mostrou que erro em uma tool dá pra contaminar outras (chave `input` vs `tool_input`). Arquivos menores facilitam isolamento.
- 🟢 **Tool schemas documentados em um lugar.** Hoje cada Zod schema fica inline. Vale exportar tudo para `packages/shared/src/mcp-tools.ts` e gerar markdown auto pra docs/agents-tools.md. Útil pra futuro AGENTS.md (M9) e pra usuário consultar.
- ⚪ **Não dual-purpose MCP.** Nossa MCP servir clientes externos não tem caso de uso (single-user, single-host).

---

## 7. Multi-agent orchestration

**Nós** ([apps/main/src/orchestrator/router.ts:1-58](../apps/main/src/orchestrator/router.ts), [apps/main/src/ipc/orchestrator-handlers.ts](../apps/main/src/ipc/orchestrator-handlers.ts))

Mensagens entre agentes ficam em `messages` table com `thread_id` (uuid) + `participants_json` (array de "user" e agent IDs). Router FIFO per agent: `enqueue(agentId, threadId, content, sender)` → escreve stdin se livre, senão fila. `currentTurnThreadId` evita interleaving. Sender object `{kind: "user"|"agent", id, name}` vira prefixo `[from: name] ` no stdin do agente alvo. MCP child emite eventos `agent.deliver` via arquivo JSON → chokidar → orchestrator handler → router.

Total: ~446 linhas.

**Paperclip** (`server/src/services/issues.ts:1-4200`, `server/src/services/issue-thread-interactions.ts:1-1200`, `server/src/services/issue-tree-control.ts:1-1200`)

**Modelo: issues como conversação.** Não tem "messages" como entidade separada. Tudo passa por issues:
- Agente A delega → cria child issue com `parentId=X` e `assigneeAgentId=B`
- Quando A precisa perguntar algo a B → `issueComments` na issue compartilhada
- Coordenação estruturada via `issue_thread_interactions` com `kind` em {proposal, question, confirmation, observation, …}

Single-assignee model (agent XOR user). Atomic checkout (issue lock semântico).

**Por que diverge**

Modelo conceitual. Paperclip é **task-first**: comunicação só existe ancorada a uma issue. Nós somos **chat-first**: comunicação é o canal, issue é uma das informações trocadas. Ambos válidos. Vantagens cruzadas:
- Paperclip: tudo auditável (linha do tempo da issue = tudo). Coordenação estruturada (proposal → confirmation).
- Nós: agente pode trocar ideia sem precisar abrir ticket. Melhor pra brainstorm / fast iteration.

**Onde podemos melhorar**

- 🔴 **Pegar emprestado o conceito de `thread_interactions.kind`.** Hoje toda mensagem é só `content: string`. Adicionar campo opcional `kind: 'message' | 'proposal' | 'question' | 'confirmation' | 'observation'` em `messages` permite:
  - System prompt pedir ao agente: "use kind=question quando estiver esperando resposta, kind=confirmation quando estiver fechando algo"
  - UI badge visual diferenciando proposta vs message comum
  - Heuristic anti-stuck: se thread tem question pendente sem confirmation há > N turns, gera inbox suggestion
  - Reverso (LLM já gera structured output bem).

  Custo: ~1 dia (migration + tipo + system prompt update + render UI). Cabe em M7 ou M9. **Why-it-matters:** nossa coordenação multi-agente hoje depende de prosa livre; isso adiciona um vocabulário comum sem tornar rígido.

- 🟡 **Substituir `participants_json LIKE %agentId%` por junction table** (`thread_participants`). Listado como débito M5 no roadmap. Paperclip resolveu desde o dia 0 (não usa thread shape — cada issue é o "thread"). Pra nós é refactor sério mas pequeno em LoC. Quando? Quando dor de query lentidão aparecer (não aparece ainda; <100 messages típico).
- ⚪ **Não unificar message+issue.** Nosso chat-first model é diferenciador vs Paperclip e parte da identidade do produto (clone Paperclip via OAuth — mas com **CEO chat real-time**, não task-board-first).

---

## 8. Sandbox & Permissions

**Nós** ([apps/main/src/security/gate.ts](../apps/main/src/security/gate.ts), [blocklist.ts](../apps/main/src/security/blocklist.ts), [permission-watcher.ts](../apps/main/src/security/permission-watcher.ts))

Defense-in-depth local:
1. **`CLAUDE_CONFIG_DIR`** isolado per-agent (sem MCP global, sem hooks, sem skills do host).
2. **`--strict-mcp-config`** garante que só o servidor `dashboard` é visível.
3. **`--permission-prompt-tool mcp__dashboard__request_permission`** + per-spawn `settings.json` `permissions.ask` força gating de Bash/Edit/Write.
4. **`gate.ts evaluatePermission()`** classifica tool inputs:
   - Bash: tokeniza shell respeitando aspas, extrai paths, checa blocklist regex (`§8.3` lista versionada — curl exfil, `.credentials.json`, `rm -rf /`, `git reset --hard`, etc.), checa se path está dentro de `allowedProjectPaths`.
   - FS tools: path checked against blocklist + workspace fence.
5. **Modo `auto` vs `supervised`**: auto bypassa request_user para inputs já cleared.

LoC: 269 linhas.

**Paperclip** (`server/src/services/execution-workspaces.ts:1-780`, `server/src/services/sandbox-provider-runtime.ts`, `packages/plugins/sandbox-providers/`)

**Defense-in-depth via isolamento de processo, não filtragem de comandos.** Cada issue executa em `execution_workspace` que é git worktree (local) ou plugin sandbox provider (e2b, Cloudflare, Daytona, exe-dev — VMs / containers / serverless). Permissions em `agent.permissions JSONB` checadas em service-level. Não há blocklist de comandos shell — confia no isolamento.

Adapter Claude usa `dangerouslySkipPermissions: true` por default (headless, não pode prompts interativos).

**Por que diverge**

Threat model diferente:
- Paperclip: agente pode estar rodando em containers efêmeros — se ele faz `rm -rf /`, só destrói o sandbox. Foco: caro escalar isolamento por provider.
- Nós: agente roda no mesmo host que o usuário. `rm -rf /` é catastrófico. **Filtragem de comando + workspace fence é necessária.** Memory `feedback_security_priority.md` reforça.

**Onde podemos melhorar**

- 🔴 **Manter blocklist + adicionar revisão periódica.** O risco é blocklist ficar stale. Já temos `§8.3` versionada — vale adicionar test que falha se PR não atualizar o test snapshot quando blocklist muda. Custo: 1h.
- 🟡 **Path tokenization tem caso edge (lição M6: quoted-paths bypass).** Continuar fuzzing — quando entrar M9, considerar substituir tokenizer artesanal por `shell-quote` (lib battle-tested). Custo: meio dia.
- 🟢 **Execution workspace per issue** (pegar emprestado de Paperclip): hoje todos agentes podem mexer no mesmo `projects.path`. Se 2 agentes editam o mesmo arquivo simultaneamente → merge conflict invisível. Solução Paperclip: git worktree por execução. Pra nós isso é v2 — exige redesenho de `allowedProjectPaths`. Anotar em débito.
- ⚪ **Não adotar plugin sandbox providers (e2b/Cloudflare/Daytona).** Out-of-scope (local-only).
- ⚪ **Não usar `dangerouslySkipPermissions`.** Paperclip pode porque tem sandbox de processo. Nós não temos.

---

## 9. Issues CRUD + UI

**Nós** ([apps/main/src/issues/repository.ts](../apps/main/src/issues/repository.ts), [apps/renderer/src/routes/Issues.tsx](../apps/renderer/src/routes/Issues.tsx))

Schema: `issues + issue_comments + issue_events`. Repository com event writer (audit log em `issue_events`), tool history derivation (`getToolHistory` extrai MCP calls que mencionaram a issue). 7 IPC channels. UI:
- `/issues` kanban com 5 colunas (backlog, todo, doing, review, done) + @dnd-kit drag-drop + filtros project/assignee/priority.
- `IssueDetailModal` com comments timeline + sub-tasks + tool call history accordion + reassign dropdown.

MCP tools: `create_issue`, `update_issue`, `assign_issue`, `list_issues`, `check_status`. `update_issue status=done` dispara inbox `completed`.

LoC: ~634 backend + ~418 frontend.

**Paperclip** (`packages/db/src/schema/issues.ts`, `server/src/services/issues.ts:1-4200`, `ui/src/pages/IssueDetail.tsx`)

Schema bem mais rico:
```
issues {
  identifier (PRJ-123 human-readable!),
  parentId, projectId, projectWorkspaceId, executionWorkspaceId,
  goalId (vinculado a "goal" da company),
  status, priority, workMode,
  assigneeAgentId, assigneeUserId (single-assignee),
  checkoutRunId, executionRunId (atomic lock semantics),
  originKind (manual | routine_execution | …),
  billingCode, executionPolicy (JSONB),
  monitorNextCheckAt, monitorWakeRequestedAt,
  startedAt, completedAt, cancelledAt, hiddenAt
}

issue_approvals { issueId, approvalId } (link table para gates de governança)
issue_work_products { ... } (deliverables tangíveis - arquivos, PRs, snapshots)
issue_relations { issueId, otherId, type } (depends_on, related_to, …)
issue_thread_interactions { ... } (Q&A estruturado, vide §7)
issue_comments
```

UI muito mais ampla (40+ pages no ui/src). LoC service: 4200 linhas só em `issues.ts`.

**Por que diverge**

Escopo. Paperclip é uma **organização** — issues são o veículo central de governança (goal alignment, deliverables, billing, approvals). Pra nós, issues são um módulo entre outros (chat, inbox, projects).

`identifier` (PRJ-123) é só UX. `work_products`, `goals`, `monitors`, `relations` são domínio de governance que conscientemente está fora do nosso v1.

**Onde podemos melhorar**

- 🔴 **Identifier humano** (`PRJ-123`). Já citado em §2. Migration trivial. Vai melhorar todo log/UI/MCP message ("agente assigned to ISSUE-7" vs "agente assigned to f3a2b1c8…").
- 🔴 **Work products / artefatos** ligados a issues. Hoje agente termina uma issue e o output some — só sobra a mensagem dele dizendo "feito". Schema mínimo: `issue_artifacts (issue_id, kind, path|url|content, created_at, created_by)`. Kinds: `file_path`, `commit_sha`, `pr_url`, `snapshot`. Tools MCP: `record_artifact` chamada antes de `update_issue status=done`. Custo: 1 dia (migration + tool + UI accordion). Cabe em M9 polish.
- 🟡 **`issue.kind = 'task' | 'review' | 'spike'`** ou similar. Hoje status="review" é só status. Paperclip distingue `originKind` + `workMode`. Reduz overload semântico do status.
- 🟢 **Issue relations** (depends_on). Útil mas não urgente. v2.
- 🟢 **Goals** (objetivos longos que se decompõem em issues). Já listado em v2.
- ⚪ **Approvals decoupled como entidade** — discutido em §11 abaixo.
- ⚪ **Monitors** (issue auto-recheck on schedule). Casa com routines (v2).

---

## 10. Projects / Workspaces

**Nós** ([apps/main/src/projects/repository.ts](../apps/main/src/projects/repository.ts), [apps/renderer/src/routes/Projects.tsx](../apps/renderer/src/routes/Projects.tsx))

Schema: `projects (id, company_id, name, path, color, created_at)`. Allowlist per agent via `agents.allowed_projects_json`. CRUD via 6 IPC channels. UI master/detail com folder picker + color picker. Post-migration auto-cria "Default Workspace" a partir do `settings.workspaceCwd` legado. `checkPaths` valida existência via `fs.existsSync`.

LoC: ~338.

**Paperclip** (`packages/db/src/schema/projects.ts`, `project_workspaces.ts`, `execution_workspaces.ts`)

Três níveis:
1. `projects` — name, description, parentProjectId (nested!), color, icon.
2. `project_workspaces` — strategy/config (qual sandbox provider, qual repo, runtime services).
3. `execution_workspaces` — instância realizada **por execução de issue** (git worktree concreto, lease de sandbox).

LoC service: ~1100.

**Por que diverge**

Paperclip precisa abstrair "como rodar isso" porque suporta git_worktree + e2b + Cloudflare + Daytona. Pra nós, "como rodar" é sempre "no host, dentro do path do project" — não precisa abstração.

Nested projects: feature de organização que faz sentido em "company" com 10+ projects; em uso típico nosso fica overkill.

**Onde podemos melhorar**

- 🟢 **Cor + ícone** (Paperclip tem). Já temos cor. Ícone é trivial (emoji picker ou lucide-react set fixo). Cabe em polish M9.
- 🟢 **Status do project** (`active|archived`). Hoje só DELETE. Archive sem cascading drop é mais seguro. Cabe em M9.
- 🟡 **Git worktree per issue execution** — discutido em §8 melhoria 3. v2.
- ⚪ **Nested projects** (`parentProjectId`). Out-of-scope (não temos uso real).

---

## 11. Inbox / Notifications + Approvals

**Nós** ([apps/main/src/inbox/repository.ts](../apps/main/src/inbox/repository.ts), [apps/renderer/src/routes/Inbox.tsx](../apps/renderer/src/routes/Inbox.tsx))

Tabela `inbox` única com `kind in (approval, completed, suggestion, error, security_alert)`. Approval items carregam `payload_json` com `{toolUseId, toolName, toolInput, reason}`. UI: filter pills + inline approve/reject buttons (chama `permissions.resolve(toolUseId, {behavior})`). Auto-mark-read no resolve. Sidebar badge unread.

LoC: ~249.

**Paperclip** (`packages/db/src/schema/approvals.ts`, `issue_approvals.ts`, `inbox_dismissals.ts`, `server/src/realtime/live-events-ws.ts`)

**Approvals como entidade decoupled:**
```
approvals { id, type (string), requestedBy{Agent|User}Id, status, payload (JSONB), decidedByUserId, decisionNote }
issue_approvals { issueId, approvalId } (link)
approval_comments { ... } (discussão sobre aprovação)
```

**Inbox como digest real-time:** WebSocket broadcast (`live-events-ws.ts`) com events tipados. Não tem tabela "inbox" — é stream + per-user `inboxDismissals` (mark-read individual). Inbox UI = consumer do stream filtrando por relevance/dismissal.

**Por que diverge**

Multi-user (deles) vs single-user (nós) explica dismissals individuais. Approval decoupled (deles) faz sentido porque approval pode existir sem issue (ex: pre-flight policy approval). Nosso approval só existe pra tool calls de agente.

**Onde podemos melhorar**

- 🔴 **Separar `approvals` de `inbox` no schema.** Hoje uma approval é só uma linha do inbox. Quando M9 trouxer "Agent Reviews UX polish" (PR review-style — agente entrega code change, humano aprova/rejeita com inline comments), vai ser approval **rica** (não 1-clique). Inbox vira **digest**, approvals vira entidade própria com:
  ```ts
  approvals { id, agent_id, kind (tool_call | code_review | hire_confirm | …), payload, status, decided_by, decision_note, created_at, resolved_at }
  ```
  Inbox passa a referenciar approval por ID. Custo: 1 dia migration + IPC update. Cabe em M9.
- 🟡 **WebSocket-like granular events em IPC** — já mencionado em §1. Reduz roster broadcast atual.
- 🟢 **Pagination / archive da inbox.** Hoje cresce sem fim. Inbox > 1000 items vai ficar lenta.
- ⚪ **Per-user dismissal.** Não precisamos (single-user).

---

## 12. Sidebar / Agent List / Agent Chat (unified stream)

**Nós** ([apps/renderer/src/routes/Agent.tsx](../apps/renderer/src/routes/Agent.tsx), [components/MessageList.tsx](../apps/renderer/src/components/MessageList.tsx), [components/DelegationsPanel.tsx](../apps/renderer/src/components/DelegationsPanel.tsx))

Sidebar lista agentes com 5 status colors (idle/thinking/working/waiting/error) + currentAction text + inbox link com badge. `/agents/:id` tem 2 tabs: **Chat** (todas mensagens com participant=user, unified cross-thread) e **Delegations** (threads agente↔agente). Composer + send. Tool calls renderizadas inline como `ToolCallCard`. Approval cards inline.

LoC: ~506 frontend.

**Paperclip** (`ui/src/pages/AgentDetail.tsx`, `ui/src/components/`)

Sem chat-first — UI é orientada a issues. Agente tem página de detail mas o foco está em "que issues ele tem", "performance", "config". 40+ pages no ui/src.

**Por que diverge**

Chat-first vs task-first (já elaborado em §7).

**Onde podemos melhorar**

- 🟡 **Right panel em `/agents/:id`** (persona/skills/projects/issues/stats). Listado no M9 como gap explícito do v1. Quando entrar, considerar: Paperclip tem isso em uma page separada (`/agents/:id/config`), separação clara. Nós podemos manter como right-panel no chat — UX mais "Cursor-like" — desde que não polua o chat. Decidir em design (frontend-design skill quando for hora).
- 🔴 **Currentaction granular.** Hoje status `working` é binário. Paperclip rastreia `heartbeat_run_events` (linha do tempo de tools chamadas). Nós já temos os eventos em memória (router + stream-parser). Falta refletir em UI: "Editing src/foo.ts" / "Running pytest" / "Waiting for permission". Custo: 1 dia. Big UX win pra confiança.
- 🟢 **Status idle "since N min"** — quando agente terminou last turn, mostrar há quanto tempo está idle. Polish.

---

## 13. Tray icon

**Nós** ([apps/main/src/tray/index.ts](../apps/main/src/tray/index.ts), 41 linhas)

Tray simples: clique toggle visibility, menu Open/Quit, ícone fixo.

**Paperclip**

N/A (web app).

**Onde podemos melhorar**

- 🟢 **Badge no ícone tray quando há inbox unread** (já listado no roadmap débito como "Tray icon completo"). Trivial via `tray.setImage` com variantes ou `tray.setTitle` no macOS / superscript no Windows (limitação).
- 🟢 **Submenu de quick actions** (Open Inbox, Open Issues, Pause All Agents, Resume). 

---

## 14. System prompts / MCP tool instructions

**Nós** ([apps/main/src/orchestrator/system-prompt.ts](../apps/main/src/orchestrator/system-prompt.ts), 45 linhas)

PREAMBLE hardcoded prepended a qualquer agente:
- Sandbox CWD intentionally empty → use `list_projects` to discover paths
- Always absolute paths
- Fire-and-forget delegation via `message_agent`
- `report_to_user` para visibilidade no chat user

**Paperclip** (`AGENTS.md` root + skill markdowns)

Sistema de prompt-as-data muito mais elaborado. AGENTS.md root tem 8333 linhas (documentação + estrutura declarativa). Adapters lêem AGENTS.md do projeto target + montam system prompt dinâmico com:
- Skills relevantes injetadas como markdown
- Permissions explicitadas
- Goals da company contextualizados
- Workspace info (qual branch, qual worktree)

**Por que diverge**

Maturidade do pattern + adapter pluggability. Paperclip evoluiu "how to instruct an agent" como first-class concern. Nós ainda mantemos prompt em código.

**Onde podemos melhorar**

- 🔴 **PREAMBLE em arquivo `.md` versionado e carregado em runtime.** Hoje editar PREAMBLE = recompilar Electron. Mover pra `apps/main/src/orchestrator/preamble.md` lido com `fs.readFileSync`. Custo: 30 min. Benefício: muito mais fácil iterar prompt (lição comum: 50% do efeito de "melhorar agente" é prompt). Bonus: usuário pode override via `~/.prospero/preamble.md` (caso queira tunar).
- 🟡 **System prompt composable** (M7 lookahead). Quando adicionar skills (M7) e model-aware behavior (M7a), o prompt vai depender de:
  - PREAMBLE comum
  - Role-specific (CEO vs engenheiro)
  - Skills assigned (cada skill traz instrução curta)
  - Model-specific (Opus é melhor seguir instruções negativas; Haiku precisa mais exemplos)
  
  Sugestão: builder `composeSystemPrompt({preamble, role, skills[], model})` em vez de string concat. Custo: 4h durante M7.
- 🟢 **AGENTS.md export do nosso lado.** Já está no M9 wishlist ("Export AGENTS.md"). Paperclip mostra que isso é principalmente texto humano-legível com tabela de agents + skills + projects. Não copiar o formato deles diretamente (8K linhas é excessivo), mas inspiração de estrutura sim.

---

## 15. Testes

**Nós** (`packages/shared/tests/*.test.ts` + alguns inline)

3 arquivos: `ipc-channels.test.ts`, `m3-types.test.ts`, `settings.test.ts`. Vitest. Cobertura: validações de tipo, parsing de settings, invariantes de IPC. Mais smoke-tests de regressão (lição M6.1). ~185 tests passando total mas concentrados em poucos arquivos.

**Paperclip** (`tests/e2e/`, `server/src/__tests__/`, `packages/db/src/*.test.ts`)

Vitest (unit) + Playwright (e2e). ~200 test files. E2E flows: onboarding, multi-user, signoff-policy, planning-mode-visual-verification.

**Por que diverge**

Maturidade do projeto + número de devs. Paperclip tem time. Nós somos single-developer.

**Onde podemos melhorar**

- 🟡 **E2E mínimo com Playwright + Electron** (`@playwright/test` + `electron-playwright-helpers`). Cenários:
  - Onboarding (setup wizard com token detectado)
  - Hire agent → send message → receive response
  - Create issue → assign → status transitions
  
  Custo: 1-2 dias setup + 1 dia de cenários. Reduz drasticamente risco de regressão visual entre milestones. **Por que importa pra nós:** já temos memory `feedback_no_regression.md` (regra dura entre releases) e o smoke test manual de M6.1 mostrou ROI alto. E2E automatiza o smoke.
- 🔴 **Cobertura de orchestrator + MCP tools.** São o miolo do produto e não têm teste de integração. Mocking de claude CLI é factível (stream stdin/stdout) — outros projetos fazem (smoke-test do Paperclip claude-local adapter). Custo: 1 dia. Cabe entre M7 e M8.
- 🟢 **Snapshot tests da blocklist** — se um pattern muda, falhar.

---

## Features ainda não implementadas (M7+) vs Paperclip

Esta seção mapeia o que está planejado nosso roadmap com como Paperclip já implementou, para informar decisões de design **antes** de começar cada milestone.

### M7 — Org Chart + Skills + Model selection

**Org Chart**

Paperclip: server-rendered **SVG** (`server/src/routes/org-chart-svg.ts`, ~500 linhas). Walks `agents.reportsTo`, renderiza com 5 temas visuais (monochrome, nebula, circuit, warmth, schematic), suporta collapse, exporta PNG via `sharp`.

Nós: nada. Opções de tech: D3 / React Flow / SVG handcrafted / Mermaid.

**Recomendação 🔴:** seguir o approach Paperclip (**SVG handcrafted**) mas no client. Razões:
- React Flow é overkill (org chart é read-mostly tree, não graph editor)
- D3 traz curva de aprendizado para zero ganho de UX
- SVG handcrafted em ~300 linhas dá controle total, zero deps, fácil de extrapolar com transitions CSS
- Não vamos exportar PNG (out-of-scope local-only), então `sharp` desnecessária

Drag-pra-mudar-`reports_to` listado no roadmap pode ser feito com `pointermove` listener simples; não precisa lib.

**Skills**

Paperclip: `company_skills` table riquíssima — skill = pacote de código (bash/python/markdown) sincronizado de GitHub/NPM/local com trust levels + file inventory + compatibility matrix. Adapter Claude lê AGENTS.md do projeto e sincroniza skills. ~2.5K linhas de service.

Nós: `skills_catalog + role_templates` tabelas seeded, `agents.skills_json` string array. Sem UI.

**Recomendação 🔴:** **não imitar Paperclip aqui.** Mantém nosso modelo "skill = string tag declarativo" — muito mais simples, alinha com nosso threat model (single host, sem download de código). Skills no nosso v1 são "hints para system prompt" + "tools que o agente pode chamar" (hard-gate via MCP whitelist).

Especificamente:
- `skills_catalog` continua read-only display de cards (UI cards no `/skills`)
- `agents.skills_json` continua array de strings
- Hard-gate via system prompt + MCP tool whitelist (já planejado)
- **Não** suportar source sync. Se queremos v2 algum dia, adicionar a tabela. Por enquanto, ignorar.

**Model selection** (M7a, urgente)

Paperclip: `agents.adapterConfig JSONB` carrega model + provider. `getModelProfiles()` por adapter expõe presets.

Nós (planejado): coluna `agents.model TEXT default 'claude-sonnet-4-6'`, dropdown UI, `--model` flag em `buildClaudeArgs`.

**Recomendação 🔴:** plano atual está bem. Considerar:
- Preset enum em `packages/shared` (`['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']`) + escape "custom" como input livre
- Mostrar custo estimado relativo no dropdown (Opus 5×, Sonnet 1×, Haiku 0.2× — referência simbólica, não absoluta) — Paperclip tem `getModelProfiles()` com cost hints, nós podemos copiar a ideia mesmo sem cobrar (OAuth Max é flat)
- Memory `feedback_token_efficiency`: dropdown deve **avisar** quando user seleciona Opus pra subagente leve

### M8 — Costs + Token Tracking

Paperclip: `cost_events + budget_policies + budget_incidents` tables. Soft-stop at heartbeat — agente pausa quando estoura mês. ~1K linhas service.

Nós (planejado): persistir `result.usage` em `costs_log`, calcular % do limite Max via `rate_limit_event`, UI `/costs` com gráficos.

**Recomendação 🔴:** schema mínimo igual deles (`cost_events`), mas enforcement é diferente — não temos heartbeat. Em vez disso:
- Hook em `onTurnComplete` que verifica budget de agent/company
- Se estourou: enviar `notify_user(kind=security_alert)` + setar `agents.status='paused'` + bloquear próximo `enqueue` no router
- UI: progress bar do Max no Settings + por-agent stats

Custo: M8 fica menos sobre tracking (4h) e mais sobre **enforcement + UI charts** (3-4 dias).

### M9 — Dashboard + Multi-empresa + Polish + AGENTS.md + companies.sh + Reviews UX

**Dashboard widgets:** projetos web típicos fazem com recharts. Paperclip tem complexa Dashboard page (1500+ linhas) com cards modulares. **Nós:** começar simples — 4 widgets fixos do spec §6.4. Não imitar densidade Paperclip.

**Multi-empresa UI:** trivial. Paperclip multi-tenant não traz lições aqui (multi-tenant deles é multi-user-per-company, não-aplicável).

**Right panel `/agents/:id`:** ver §12. Decisão de design quando for hora.

**AGENTS.md import** 🟡: Paperclip "Easy AGENTS.md configurations" está mais documentado que implementado (roadmap deles também). Formato deles é texto livre + markdown — não consumível por parser confiável. **Definir nosso próprio formato YAML front-matter**:
```yaml
---
company: Acme
projects:
  - name: backend
    path: ./apps/backend
agents:
  - name: CEO
    role: orchestrator
    model: claude-opus-4-7
    skills: [planning, delegation]
  - name: BackendEng
    role: engineer
    model: claude-sonnet-4-6
    reports_to: CEO
    skills: [typescript, postgres]
    projects: [backend]
---
# Agents.md
... (texto humano-livre depois do front-matter)
```
Parser usa `gray-matter` (já comum). Validação Zod. Import via setup ou IPC `import:agents-md`.

**companies.sh import/export** 🟡: Paperclip resolveu como **ZIP com JSONs aninhados** (`company-portability.ts` 4676 linhas, exporta agents + projects + issues + comments + costs + skills + traces). **Pra nós:** mais simples — JSON único (sem ZIP), nosso DB é menor. Schema:
```ts
{
  companyId: ..., exportedAt: ..., schemaVersion: 1,
  company: { ... },
  projects: [...], agents: [...], issues: [...], 
  comments: [...], inbox: [...], costs: [...],
  // NÃO: messages (volume alto, opcional via flag)
}
```
Custo M9: 2 dias backend (serializer + validator) + 1 dia UI buttons. Casos de uso: backup, share, snapshot pré-experimento.

**Agent Reviews UX polish** 🟡: ver §11 — separar approvals de inbox. Diff side-by-side aproveita componentes como `react-diff-viewer-continued` (battle-tested). Não precisa imitar Paperclip stack (que ainda é wishlist nele também).

---

## Features de Paperclip que ⚪ não devemos copiar

Lista explícita pra evitar tentação futura:

| Feature Paperclip | Por que não |
|---|---|
| **Plugin system (worker threads + JSON-RPC + capability manifest, ~20K linhas)** | Out-of-scope v1. Adiciona attack surface (capability check fácil de regressar). v2+ talvez, e mesmo aí é big architectural change. |
| **Multi-tenancy / multi-user (Better-Auth, sessions)** | ToS Anthropic Max single-user. Não. |
| **Embedded Postgres** | sqlite serve perfeitamente desktop. Migrar custaria 1-2 semanas e ganharia 0 valor pro nosso uso. |
| **Heartbeat polling model** | Perdemos UX de chat streaming live. Nossa daemon-arch + watchdog timeout cobre o caso de "agente travado". |
| **Adapter para OpenClaw / Codex / Cursor / Gemini / Pi / Acpx / OpenCode** | Out-of-scope v1 (somos cliente Claude). v2 adiciona 1-2 adapters relevantes (Codex, Cursor) mas não todos. |
| **Sandbox providers (e2b, Cloudflare, Daytona, exe-dev)** | Out-of-scope (local-only). Memory `project_prospero` reforça. |
| **SVG export server-side via `sharp`** | Out-of-scope (sem server, sem export PNG). Manter SVG só no DOM. |
| **`dangerouslySkipPermissions: true` default** | Threat model deles assume sandbox de processo (eles têm); nosso threat model é "agente roda no host" e blocklist é necessária. |
| **Skill = code module com source sync (GitHub/NPM)** | Threat model: download e execução de código remoto. Memory `feedback_security_priority`. Skill = tag é suficiente pra nós. |
| **Routines (cron scheduling)** | v2. Não bater com 4-paralelos OAuth Max sem cuidado. |
| **Plugin webhooks / outbound HTTP** | Out-of-scope local-only. |

---

## Resumo das melhorias propostas, por prioridade

### 🔴 Alta (cabe nas próximas 2-3 milestones)

1. **Issue identifier humano (`PRJ-123`)** — migration trivial, ganho UX enorme. M9.
2. **Two-actor model preparation** (`auth-mode.ts`) — preparar M9 dual-auth desde já. 1h.
3. **Adapter pattern preparation** — interface `AgentAdapter` antes de M9. ~1 dia.
4. **Modularizar `mcp/tools.ts`** (502 linhas → arquivos por domínio). 2h. Antes de M7.
5. **Modularizar `lifecycle.ts`** (extrair `buildClaudeArgs`, `prepareSandbox`, `resolveBinary`). 2h. Antes de M7.
6. **`thread_interactions.kind`** (proposal/question/confirmation tags). 1 dia. M7 ou M9.
7. **Work products / artefatos** ligados a issues. 1 dia. M9 polish.
8. **PREAMBLE em arquivo `.md`** (não recompilar pra editar prompt). 30 min.
9. **Approvals decoupled** do inbox (preparar Reviews UX). 1 dia. M9.
10. **Current action granular** (refletir tool calls em UI). 1 dia. M8 ou M9.
11. **SVG handcrafted client-side para org chart** (não React Flow, não D3). M7.
12. **Skills como tag (não imitar Paperclip code-module)** — reaffirm decision. M7.
13. **Cobertura de testes em orchestrator + MCP tools** (integração com claude CLI mocked). 1 dia.

### 🟡 Média (cabe pós-v1 ou refactor próprio)

14. **Right panel `/agents/:id`** com design decision (full page vs side panel). M9.
15. **System prompt composable** builder (`composeSystemPrompt`). 4h durante M7.
16. **Path tokenization usando `shell-quote`** em vez de artesanal. M9.
17. **WebSocket-like granular IPC events** (deltas em vez de snapshots). 1 dia. M9 polish.
18. **Separar boot config de runtime settings**. Pequeno. M9.
19. **AGENTS.md format próprio (YAML front-matter)**. M9.
20. **companies.sh import/export JSON**. 3 dias. M9.
21. **`issue.kind`** (task/review/spike — reduzir overload do status). M9 ou v2.
22. **E2E mínimo com Playwright + Electron**. 2-3 dias.
23. **Junction table `thread_participants`** (substitui `LIKE %`). Quando dor aparecer.

### 🟢 Baixa (v2+ ou só se aparecer)

24. **Execution workspace per issue** (git worktree). v2.
25. **Goals + issue relations**. v2.
26. **Issue monitors** (auto-recheck). v2.
27. **Project icons + status (archived)**. Polish.
28. **Tray badge + submenu**. Polish.
29. **Pagination inbox**. Quando crescer.
30. **Token expiry banner**. M9.
31. **Skill source sync (GitHub)**. v3 only se feedback pedir.

### ⚪ Não fazer (consciente)

Plugin system, multi-tenancy, embedded Postgres, heartbeat polling como substituto de daemon, sandbox providers, AGENTS.md no formato deles (8K linhas), skill como código com download, sharp/server-side render.

---

## Próximos passos práticos

1. **Antes de iniciar M7:** fazer os refactors 🔴 4, 5, 8 (modularização + PREAMBLE.md). Custo total: ~3-4 horas. Reduz risco quando M7 inflar.
2. **Durante M7:** aplicar recomendações 11, 12, 15 (Org Chart SVG handcrafted, skills como tag, system prompt composable).
3. **Durante M7a:** validar plano de model selection contra item 13 (cost hints no dropdown).
4. **Durante M8:** schema cost_events + enforcement at turn-complete (não heartbeat).
5. **Antes de M9:** decidir item 14 (right panel vs full page) via frontend-design skill.
6. **Durante M9:** itens 1, 2, 3, 6, 7, 9, 10 (UX polish + dual auth + approvals + reviews UX + companies.sh + AGENTS.md import).
7. **Pós-v1 backlog:** itens 🟡 24-30 priorizar quando feedback do uso real chegar.

---

## Apêndice: arquivos-âncora pra inspeção rápida

### Nossa codebase (M1–M6 em master)

- Orchestrator: [apps/main/src/orchestrator/lifecycle.ts](../apps/main/src/orchestrator/lifecycle.ts), [stream-parser.ts](../apps/main/src/orchestrator/stream-parser.ts), [router.ts](../apps/main/src/orchestrator/router.ts)
- MCP server: [apps/main/src/mcp/server.ts](../apps/main/src/mcp/server.ts), [tools.ts](../apps/main/src/mcp/tools.ts)
- Security: [apps/main/src/security/gate.ts](../apps/main/src/security/gate.ts), [blocklist.ts](../apps/main/src/security/blocklist.ts)
- Issues: [apps/main/src/issues/repository.ts](../apps/main/src/issues/repository.ts), [apps/renderer/src/routes/Issues.tsx](../apps/renderer/src/routes/Issues.tsx)
- DB: [apps/main/src/db/migrations/](../apps/main/src/db/migrations/)

### Paperclip (referência em `D:/tmp/paperclip`, pode atualizar com `git pull`)

- Heartbeat orchestrator: `server/src/services/heartbeat.ts` (~9.8K linhas, monolito)
- Adapters: `packages/adapters/{claude-local,openclaw-gateway,...}/`
- Issues: `server/src/services/issues.ts` (~4.2K linhas)
- Org chart SVG: `server/src/routes/org-chart-svg.ts` (~500 linhas) ← **excelente reference para nosso M7**
- Skills: `server/src/services/company-skills.ts` (~2.5K linhas) ← anti-reference (over-engineered pra nosso uso)
- Company portability: `server/src/services/company-portability.ts` (~4.7K linhas) ← reference pra M9 companies.sh
- Plugin SDK: `packages/plugins/sdk/src/` (~2K linhas)
- DB schema: `packages/db/src/schema/` (75 files)
- MCP wrapper: `packages/mcp-server/src/` (~200 linhas)

---

> **Atualizar este documento** ao fechar cada milestone seguinte, marcando quais melhorias foram absorvidas e quais foram refutadas (com motivo).
