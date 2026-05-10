# M5 — Multi-Agent Orchestration + Security Hardening — Design Doc

**Data:** 2026-05-10
**Autor:** Heverson + Claude (Opus 4.7)
**Status:** Spec aprovado — pronto para implementation plan
**Spec mãe:** `docs/superpowers/specs/2026-05-09-dashboard-agent-design.md` (referenciado como "spec v1")

> ⚠ **Não-regressão (spec v1 §10):** segurança, testes e tokens (≤ 1.3x baseline) não podem regredir entre releases. M5 adiciona suite de regression-guard tests específicos da §6.4 e §7.1 deste doc.

## 1. Goal

Após M5, o usuário pode:

1. Conversar com o CEO sobre uma necessidade ("preciso de um Frontend Engineer pra trabalhar em login")
2. CEO entrevista, sintetiza nome/role/system_prompt detalhados, chama `hire_agent` — sub-agente surge na sidebar com badge "idle"
3. Usuário pede ao CEO: "manda Alice começar"
4. CEO chama `message_agent(Alice, "build login form...")` → Alice acende status "working", começa a executar (Bash/Edit/Read/Write no workspace)
5. Cada Edit/Bash/Write da Alice (modo `supervised` default) gera um **approval card inline no chat + item na Inbox**; usuário aprova um a um
6. Tentativas de acesso fora do `workspace_cwd` ou matchings de blocklist (§6.2) são **automaticamente negadas**, com inbox kind=`security_alert`
7. Alice usa `notify_user("Login pronto, revise")` → badge da Inbox no sidebar mostra "1"
8. Alice usa `message_agent(CEO, "task done")` → CEO vê na próxima vez que processar uma turn (async puro, sem await)
9. Usuário pode clicar em qualquer agente na sidebar, ver thread completa unificada (todas as fontes em ordem cronológica, com sender label), digitar input direto

## 2. Não-goals (M5)

| Item | Spec v1 ref | Onde vai |
|---|---|---|
| Issues CRUD (kanban, subtasks, ticket detail) | §5.2, §6.4 `/issues` | M6 |
| Projects CRUD + per-project allowlist | §5.3 projects table, §6.4 `/projects`, §8.2 `allowed_projects_json` real | M6 |
| Org Chart visual (`/org`) | §6.4 | M7 |
| Skills catalog UI | §6.4 `/skills` | M7 |
| Costs UI + token tracking detalhado | §6.4 `/costs`, §9 detalhes | M8 |
| Auto mode timer expira em 24h | §8.4 | M8+ |
| "Auto degradado para Bash" toggle | §8.4 | M8+ |
| Anti-prompt-injection avançado (rate limit, diff suspeito) | §8.6 | v2 |
| Backend HTTP Fastify para localhost | §5.1 D2 | só se necessário |
| File watcher de `~/.claude/projects/` | §5.1 D10 | M7+ |
| Tray icon que sobrevive janela fechada | §5.1 D1 | M8+ |
| Scopes de auto ("auto pra Read, supervised pra Bash") | §5.5 | v2 |
| `await_agent` MCP tool | considerado em brainstorming, dropped pra cumprir spec v1 §5.4 (async puro) | v2 se demanda |
| Tabs separados por thread em /agents/:id | YAGNI: stream cronológica unificada cobre v1 | v2 |

## 3. Constraints reforçados

- **Max 4 agents concorrentes** (já enforced em `lifecycle.ts:60`, baseado em ToS Anthropic single-user OAuth)
- **Token budget ~1x do uso normal** (≤ 1.3x baseline, spec v1 §10.3) — sub-agentes herdam sandbox lockdown M3 (CLAUDE_CONFIG_DIR isolado, sem hooks/skills/MCP globais que vazam tokens)
- **OAuth-only auth** (sem ANTHROPIC_API_KEY)
- **Async puro** (spec v1 §5.4 — agentes não bloqueiam esperando outro)

## 4. Data model

Schema do M1 já tem todas as tabelas necessárias (`agents`, `threads`, `messages`, `inbox_items`). Sem tabela nova.

### 4.1 Estender `AppSettings` (sem migration nova)

Settings já são serializadas como JSON sob a key `app-settings` (ver [apps/main/src/settings/repository.ts](apps/main/src/settings/repository.ts)). Adiciona campo opcional ao type + schema:

```ts
// packages/shared/src/types/settings.ts
export type AppSettings = {
  language: Language;
  theme: Theme;
  workspaceCwd: string | null;   // null = use default <homedir>/DashboardAgent-Workspace
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
};
```

```ts
// apps/main/src/settings/schema.ts
export const AppSettingsSchema = z.object({
  language: z.enum(["pt-BR", "en-US"]),
  theme: z.enum(["light", "dark"]),
  workspaceCwd: z.string().nullable(),
});
```

`parseSettings` faz merge com DEFAULT_SETTINGS, preservando backward-compat com settings antigos sem o campo. Sem migration SQL.

### 4.2 Estado em memória (não persistido)

`pendingDelegations: Map<agentId, AgentRouterState>` no orchestrator router, onde:

```ts
type AgentRouterState = {
  currentTurnThreadId: string | null;        // thread sendo processada agora
  messageQueue: Array<{
    threadId: string;
    content: string;
    sender: { kind: 'user' | 'agent'; id: string | null; name: string };
  }>;
};
```

Reseta no restart do main. Mensagens persistidas em `messages` table — agente pode `read_thread` pra recuperar contexto.

### 4.3 Thread key canônico

Já implementado em `apps/main/src/messages/thread-key.ts` (M3). Reusa: ordena participants lexicograficamente + concatena.

### 4.4 Agent status semantics

Coluna `agents.status` (já existe, valores: `'idle'|'thinking'|'working'|'waiting'|'error'`). Transições no router:

| Trigger | status | current_action |
|---|---|---|
| Spawn ou primeiro message após idle | `thinking` | `null` |
| `tool_use` event | `working` | `Using <tool_name>` (truncado 80 chars) |
| `permission-request` rcvd (nosso watcher) | `waiting` | `Awaiting approval: <tool>` |
| `turn-complete` event | `idle` | `null` |
| `exit code !== 0` | `error` | `null` |

## 5. MCP tools — implementação real

Substitui os 5 stubs em [apps/main/src/mcp/tools.ts](apps/main/src/mcp/tools.ts).

MCP child abre conexão própria ao SQLite via `better-sqlite3` em modo WAL (multi-process safe). DB path passado via env (`DB_PATH`) no `mcp-config`. Side-effects que requerem orchestrator agir (spawn target, kill runner) são emitidos via stderr JSONL como antes; main listener atua.

| Tool | Input (zod) | Comportamento | Aprovação? |
|---|---|---|---|
| `list_agents` | `{}` | SELECT WHERE company_id = ctx.companyId. Retorna `[{id, name, role, status, current_action}]` | não (read-only) |
| `hire_agent` | `{name, role, system_prompt, mode?, reports_to?}` | INSERT em `agents` (id=uuid, mode default 'supervised', reports_to default ctx.agentId, claude_session_id=null, status='idle'). Cria thread `[ctx.agentId, newId]` | **sim** se ctx.agent.mode='supervised' (gate via permission-prompt-tool) |
| `fire_agent` | `{agent_id}` | Emit control event `agent.kill <id>` pra main; main mata runner. DELETE em `agents` (cascade nas threads/messages) | **sim** se supervised |
| `message_agent` | `{agent_id, content}` | Resolve thread `[ctx.agentId, agent_id]` (cria se nova). INSERT message com sender. Emit control event `agent.deliver <target> <content_with_sender_prefix>` pra main; main faz `ensureRunner` + enqueue na fila do target | não (visível na thread) |
| `read_thread` | `{other_agent_id, since?}` | SELECT messages da thread `[ctx.agentId, other_agent_id]` ORDER BY created_at, opcional WHERE created_at > since | não (read-only) |
| `notify_user` | `{title, body?, kind?, requires_action?}` | INSERT inbox_item, kind ∈ `['completed','suggestion','error','security_alert']` (default `'completed'`) | não (visível na inbox) |

**Convenções:**
- `message_agent` sempre formata o stdin com prefixo `[from: <senderName>] <content>` antes de escrever pro target. Sub-agentes têm system prompt com instrução pra interpretar essa convenção.
- `notify_user` registra `actor_id = ctx.agentId` em todas as inserções.
- Side-effects organizacionais (`hire_agent`, `fire_agent`) requerem aprovação porque mudam o catálogo de agentes — visível na sidebar/inbox como side-effect.

## 6. Security layer (§5.5 + §8.2 + §8.3)

A camada que torna M5 seguro o suficiente pra spawning sub-agentes com Bash/Edit/Read/Write.

### 6.1 `--permission-prompt-tool` sempre passado

[apps/main/src/orchestrator/lifecycle.ts](apps/main/src/orchestrator/lifecycle.ts) `buildClaudeArgs` ganha:
```ts
"--permission-prompt-tool", "dashboard.request_permission",
```

Sempre, em qualquer modo. A decisão (allow / deny / request_user) acontece no main, não no claude.

### 6.2 Always-blocked patterns — versionadas no código

Novo `apps/main/src/security/blocklist.ts`:

```ts
export const ALWAYS_BLOCKED = {
  bash: [
    /\bcurl\b.*(-d\s*@|-F\s+\w+=@)/,
    /\bwget\b.*--post-file=/,
    /\b(nc|ncat)\b\s+\S+\s+\d+/,
    /\.credentials\.json/i,
    /[\\/]\.(ssh|aws|docker)([\\/]|$)/,
    /\brm\s+-rf\s+\/\s*$/,
    /\bdel\s+\/s\s+\/q/i,
    /\bgit\s+(reset\s+--hard|clean\s+-fdx)\b/,
    /\bformat\s+[a-z]:/i,
  ],
  pathPrefix: [
    /\.claude[\\/]/,
    /\.ssh[\\/]/,
    /\.aws[\\/]/,
    /\.docker[\\/]/,
    /AppData[\\/]Roaming[\\/]Microsoft[\\/]Credentials/i,
  ],
};
```

Lista é **read-only no app** — usuário pode ADICIONAR mais via settings (futuro), nunca remover do core. Match contra qualquer pattern → tool call requer approval mesmo em modo `auto`.

### 6.3 Permission gate — função pura

Novo `apps/main/src/security/gate.ts`:

```ts
export type GateInput = {
  toolName: string;
  toolInput: unknown;
  agent: Agent;
  workspaceCwd: string;
};

export type GateDecision =
  | { action: 'allow'; reason?: string }
  | { action: 'deny'; reason: string }
  | { action: 'request_user'; reason: string };

export const evaluatePermission = (input: GateInput): GateDecision => { ... };
```

Lógica:

```
1. Match ALWAYS_BLOCKED (bash regex OR path-extracted pattern)?
   → { action: 'request_user', reason: 'always-blocked pattern' }
   (mesmo em auto mode — §8.4 spec)

2. tool toca filesystem (Read/Write/Edit/Glob/Grep)?
   resolve path → absoluto
   se !path.startsWith(workspaceCwd) → { action: 'deny', reason: 'outside workspace' }
   se ALWAYS_BLOCKED.pathPrefix matches → { action: 'request_user', reason: 'sensitive path' }

3. tool é Bash?
   tokenize naive (split por whitespace + operadores ;|&)
   pra cada token path-like (/, ~, .., drive letter):
     resolve absoluto
     mesmo check do passo 2

4. agent.mode === 'auto'?
   → { action: 'allow' }

5. default supervised:
   → { action: 'request_user', reason: 'supervised mode' }
```

### 6.4 Permission watcher — file-based fence

Novo `apps/main/src/security/permission-watcher.ts`:

- Watch `<userData>/permissions/` via `chokidar` (já dep) ou `fs.watch`.
- `<id>.req.json` aparece (escrito pelo MCP child) → lê → load agent + workspaceCwd → `evaluatePermission`:
  - `allow` → escreve `<id>.res.json` com `{behavior: 'allow'}`
  - `deny` → escreve `<id>.deny.json` com `{behavior: 'deny', message: reason}` + INSERT inbox_item kind=`security_alert`
  - `request_user` → broadcast `permission-request` IPC event + INSERT inbox_item kind=`approval` requires_action=1; aguarda action do user
- Cleanup do diretório no app start (limpa req.json órfãos de crashes anteriores).
- IPC handler `permission:resolve` (chamado pelo renderer): user clica approve/reject → escreve `<id>.res.json` ou `<id>.deny.json`.

### 6.5 MCP tool `request_permission`

Adicionado a `apps/main/src/mcp/tools.ts`. `PERMISSIONS_DIR` é passado via env (`PERMISSIONS_DIR`) no `mcp-config`, apontando para `<userData>/permissions/` (cliente Electron) ou um tmpdir (testes):

```ts
{
  name: 'request_permission',
  description: '(Internal) Permission gate — claude calls this before each side-effect tool.',
  inputSchema: z.object({
    tool_name: z.string(),
    tool_input: z.unknown(),
    tool_use_id: z.string(),
  }),
  run: async (input, ctx) => {
    const dir = process.env.PERMISSIONS_DIR!;
    const reqPath = path.join(dir, `${input.tool_use_id}.req.json`);
    fs.writeFileSync(reqPath, JSON.stringify({ ...input, agentId: ctx.agentId }));
    // Poll for resolution
    const start = Date.now();
    while (Date.now() - start < 5 * 60_000) {  // 5 min timeout
      const res = path.join(dir, `${input.tool_use_id}.res.json`);
      const den = path.join(dir, `${input.tool_use_id}.deny.json`);
      const safeUnlink = (p: string): void => { try { fs.unlinkSync(p); } catch {} };
      if (fs.existsSync(res)) {
        const r = JSON.parse(fs.readFileSync(res, 'utf8'));
        safeUnlink(res); safeUnlink(reqPath);
        return JSON.stringify(r);
      }
      if (fs.existsSync(den)) {
        const d = JSON.parse(fs.readFileSync(den, 'utf8'));
        safeUnlink(den); safeUnlink(reqPath);
        return JSON.stringify(d);
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return JSON.stringify({ behavior: 'deny', message: 'Approval timeout (5min)' });
  },
}
```

Polling 100ms é simples e suficiente — sem race conditions com fs.watch. 5min timeout previne hang infinito se main crashar.

## 7. Orchestrator router

[apps/main/src/orchestrator/router.ts](apps/main/src/orchestrator/router.ts) (novo) + refactor de [apps/main/src/ipc/orchestrator-handlers.ts](apps/main/src/ipc/orchestrator-handlers.ts).

### 7.1 Per-agent router state

`Map<agentId, AgentRouterState>` (definido em §4.2). Funções:

- `enqueueMessage(agentId, threadId, content, sender)`: se `currentTurnThreadId === null` → seta + escreve stdin. Senão push fila.
- `onTurnComplete(agentId)`: clear `currentTurnThreadId`. Pop fila; se item, processa imediato. Senão status='idle'.
- `routeAssistantMessage(agentId, blocks)`: usa `currentTurnThreadId` pra append no thread certo (em vez do hard-coded `["user", agent.id]`).
- `ensureRunner(agentId)`: idempotent — retorna runner existente ou spawna.

### 7.2 Sender label injection

Quando escreve na stdin do target:
```ts
const formatted = `[from: ${sender.name}] ${content}`;
runner.send(formatted);  // formatted vira o text content do user message JSONL
```

Sub-agentes têm na system_prompt (definido pelo CEO no hire_agent): "Mensagens com prefixo `[from: <name>]` indicam quem está te falando — user, CEO, ou outro agente. Responda apropriadamente."

### 7.3 Wiring com IPC handler

`AGENT_SEND_MESSAGE` (user→agent) e MCP control event `agent.deliver` (agent→agent) chamam ambos `enqueueMessage` no router. O router unifica.

### 7.4 Cwd injection

`spawnAgent` recebe `cwd` do settings (`settingsRepo.get('workspace_cwd')`); fallback pra default `path.join(homedir(), 'DashboardAgent-Workspace')`. Mkdir if missing antes do spawn.

## 8. UI changes (renderer)

### 8.1 Sidebar

[apps/renderer/src/components/Sidebar.tsx](apps/renderer/src/components) (novo — atualmente só `SidebarFooter`):

- Seção "Agents": lista todos da company atual com nome + role + status badge (cor por status: idle=cinza, thinking=azul, working=verde, waiting=amarelo, error=vermelho)
- Click em agente → navega `/agents/:id`
- Badge live via subscribe em IPC `status` event (já implementado no broadcast atual)
- Item "Inbox" na nav com contagem unread (`SELECT count(*) WHERE read_at IS NULL AND company_id=?`)
  - Click → `/inbox`
  - Live update via novo IPC event `inbox-update` broadcast quando inbox_item criado / marcado lido

### 8.2 Route /inbox

[apps/renderer/src/routes/Inbox.tsx](apps/renderer/src/routes) (novo):

- Feed cronológico reverso de inbox_items
- Pills de filtro no topo: All / Approvals / Completed / Suggestions / Errors / Security
- Cada item: actor (agent name), title, preview, timestamp, kind icon
- Items kind=`approval` com `requires_action=1`: botões inline "Approve" / "Reject" → IPC `permission:resolve`
- Items kind=`security_alert`: vermelho com border destacada
- Click item → marca read_at; expande pra mostrar payload_json formatado

### 8.3 ApprovalCard inline no chat

[apps/renderer/src/components/ApprovalCard.tsx](apps/renderer/src/components) (novo):

- Renderizado quando recebe IPC event `permission-request` com `agentId === currentRoute.agentId`
- Mostra: tool name (ex "Bash", "Edit"), tool input formatado (cmd ou file diff), botões Approve / Reject
- Click usa o mesmo IPC `permission:resolve` (compartilha com Inbox)
- Some após resolução; ToolCallCard normal aparece quando claude executar

### 8.4 Agent route — unified cross-thread stream

[apps/renderer/src/routes/Agent.tsx](apps/renderer/src/routes/Agent.tsx) refactor:

- Em vez de mostrar só thread `[user, agent.id]`, mostra TODAS as threads que envolvem o agente, em uma stream cronológica unificada com sender label
- Visual: cada mensagem com header `<sender_name> → <recipient_name>` (ex "CEO → Alice", "Alice → User")
- Composer no fundo envia pro thread `[user, agent.id]` (sender = user)
- Decisão YAGNI: sem tabs por thread em M5; tabs viram opção depois se ficar confuso na prática

### 8.5 Settings — workspace folder

[apps/renderer/src/routes/Settings.tsx](apps/renderer/src/routes/Settings.tsx):

- Novo campo "Workspace Folder" com input + botão "Browse..." (dialog do Electron)
- Validação: path deve existir (ou opção de criar)
- Save persiste em `settings.workspace_cwd` via novo IPC `settings:set workspace_cwd`
- Default visível como hint: `<homedir>/DashboardAgent-Workspace`

### 8.6 i18n

Strings novas em `apps/renderer/src/i18n/pt-BR.json` e `en-US.json`:
- `sidebar.agents`, `sidebar.inbox`, `sidebar.inboxUnread` (com count placeholder)
- `inbox.title`, `inbox.empty`, `inbox.filterAll`, `inbox.filterApprovals`, `inbox.filterCompleted`, `inbox.filterSecurity`, etc.
- `approval.toolCall`, `approval.approve`, `approval.reject`, `approval.timeout`
- `settings.workspaceFolder`, `settings.workspaceFolderBrowse`, `settings.workspaceFolderHint`
- `agent.status.idle/thinking/working/waiting/error`

## 9. Testing strategy

### 9.1 Unit tests

| Test file | Coverage |
|---|---|
| `apps/main/tests/security.gate.test.ts` | `evaluatePermission` — cada bash blocklist regex, pathPrefix patterns, path traversal (`..`), auto+supervised modes, tools toca filesystem vs não |
| `apps/main/tests/orchestrator.router.test.ts` | Fila + thread tracking — idle send, busy enqueue, turn-complete pop, route assistant message |
| `apps/main/tests/mcp.tools.test.ts` (estende) | Real implementations — hire/fire/message/read_thread/notify_user com SQLite fixture |
| `apps/main/tests/permission-watcher.test.ts` | File fence — req.json detect → res/deny within 500ms, crash recovery, paralelismo |
| `apps/main/tests/security.regression.test.ts` (novo) | Token leak (M4 invariant), `.credentials.json` Bash sempre approval, `..` traversal sempre deny |

### 9.2 Integration tests

`apps/main/tests/m5.flow.integration.test.ts` — happy path multi-agente com claude mockado:

1. Cria company → seed CEO
2. Mock CEO emite tool_use de hire_agent → verifica DB + thread cross
3. Mock CEO emite message_agent(novo, "do X") → stdin do novo recebe formatado; thread tem mensagem
4. Mock novo emite assistant-message → verifica route na thread correta (cross, não user↔novo)
5. Mock novo emite notify_user → inbox_item criado
6. Cleanup quando ambos exitam

### 9.3 Renderer tests

| Test file | Coverage |
|---|---|
| `apps/renderer/tests/Sidebar.test.tsx` | Lista agents, status badge updates via IPC, inbox unread count |
| `apps/renderer/tests/Inbox.test.tsx` | Items por kind, approve/reject IPC, security alerts destacados |
| `apps/renderer/tests/ApprovalCard.test.tsx` | Render Bash/Edit/Write input, click approve/reject |
| `apps/renderer/tests/Agent.unified-stream.test.tsx` | Mensagens de threads diferentes em stream cronológica unificada |

### 9.4 Manual smoke (golden path)

Documentado no plan, executado antes de declarar M5 completo:

1. `pnpm dev` → wizard → token salvo
2. Setup workspace_cwd nas Settings (criar dir vazio se não existe)
3. Criar demo company → CEO aparece
4. Chat com CEO: "Crie um Frontend Engineer chamado Alice pra trabalhar em login"
5. CEO faz perguntas de detalhe sobre persona/instructions
6. CEO chama hire_agent → ApprovalCard inline no chat (CEO em supervised) → user aprova → Alice na sidebar
7. CEO chama message_agent(Alice, "...") → Alice acende thinking → working
8. Alice tenta `Bash("ls")` → approval card no chat de Alice → aprovar → execução
9. Alice tenta `Read("../../etc/passwd")` → DENY automático + inbox security_alert
10. Alice tenta `Bash("cat ~/.claude/.credentials.json")` → approval requerido (não auto-deny — porque é "request_user" pra user ver), user rejeita
11. Alice termina, chama notify_user → inbox badge atualiza
12. Verificar threads cross-agent visíveis em ambos /agents/CEO e /agents/Alice
13. Tenta criar 5º agente → erro claro "max concurrent reached"

### 9.5 Não-regressão de tokens

- Coverage: comparar cache_creation tokens entre M4 baseline e M5 baseline em sessão padrão (CEO + 1 sub-agente fazendo task simples)
- Aceita até 1.3x (limite duro spec v1 §10.3). Acima = bloqueio de merge.
- Procedimento: roda smoke acima 3x antes de merge, captura `result.usage` do stream-json, registra no PR description

## 10. Order de implementação

Sequência que minimiza dependências circulares e permite testar incrementalmente:

1. **Extend AppSettings type/schema + Settings UI workspace folder field** — base de infraestrutura
2. **Security gate puro** (`evaluatePermission` + blocklist) — testável sem fs
3. **Permission watcher** (file fence) + IPC `permission:resolve` — testável standalone
4. **MCP tools reais** (DB connection da MCP child via env DB_PATH) — testável sem orchestrator
5. **Orchestrator router** (per-agent fila + thread tracking) — refatora handler existente sem multi-agente ainda
6. **`--permission-prompt-tool` integration** — primeiro spawn real testando approval flow
7. **Sidebar list-all + status live + Inbox badge**
8. **Inbox route + ApprovalCard**
9. **Agent route unified stream**
10. **Smoke manual + ajustes spec v1 (§8.5, §8.2 nota) + commit final**

## 11. Spec v1 adjustments

Aplicados como commits separados antes de iniciar implementação:

### 11.1 §8.5 MCP server token — registrar realidade do M4

Texto atual (§8.5) diz cada agente tem token UUID validado. M4 SEC-02 removeu isso. Reescrever:

> ### 8.5 MCP server local
>
> O MCP server roda como stdio child do `claude` (parent). stdio é um pipe privado entre parent e child — outros processos no host não podem se conectar nem injetar mensagens. Por isso, **não há auth aplicacional** sobre cada chamada de tool: o canal já é privado por construção do SO.
>
> O MCP child recebe `AGENT_ID` e `COMPANY_ID` via env do parent, usados para escopo de queries (filtra por company, identifica agent). Isso não é segurança — é apenas escopo.
>
> **Se transport mudar para HTTP/WS no futuro**: reintroduzir token validation por sessão. Documentado como debt em milestone futuro.

### 11.2 §8.2 — explicitar pre-Projects-CRUD behavior

Adicionar nota ao final de §8.2:

> **Em milestones anteriores ao Projects CRUD (M5..M5.x):** o allowlist é o `settings.workspace_cwd` único — todos os agentes da company compartilham este root. Quando Projects CRUD aterriza (M6), migra-se para `agents.allowed_projects_json` resolvido via `projects.path` por agente.

### 11.3 §5.4 — sem mudança

Texto atual já é explicitamente async ("agentes não bloqueiam esperando outro"). M5 cumpre.

## 12. Métricas de não-regressão (spec v1 §10) — checklist

Antes de declarar M5 completo:

- ✅ §10.1 testes: nenhum teste antigo removido sem substituto. Suite total cresce. CI green
- ✅ §10.2 segurança: regression-guard tests adicionados, todos passing. M5 NÃO bypassa nada de M4 (token storage, IPC split, sandbox lockdown, offline fonts)
- ✅ §10.3 tokens: smoke test 3x mostra ≤ 1.3x baseline pré-M5. Documentado no PR

---

**Encerra aqui o spec do M5.** Próximo passo: implementation plan via `superpowers:writing-plans`.
