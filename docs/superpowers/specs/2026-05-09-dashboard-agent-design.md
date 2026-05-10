# Dashboard Agent — Design Doc

**Data:** 2026-05-09
**Autor:** Heverson
**Status:** Spec aprovado — pronto para plano de implementação

> ⚠ **Regra de não-regressão (dura)**: as métricas de **segurança** (testes da §10.2), **testes** (cobertura e suite canônica) e **eficiência de tokens** (multiplicador ≤ 1.3x da §10.3) **não podem regredir** entre releases. Qualquer PR que reduza qualquer uma é bloqueado por CI até justificativa explícita. Vale para v1, v2 e além.

## 1. Problema

O usuário trabalha com múltiplos agentes Claude Code simultaneamente em projetos diferentes (Windows 11, terminal + VS Code + outras IDEs) e perde o controle de:
- **Qual agente está em qual projeto** — esquece o que abriu onde
- **O que cada um está fazendo agora** — fica trocando janela pra checar status
- **Quem é responsável pela task** — sem hierarquia visível

Soluções existentes resolvem só parte. **Paperclip** (https://github.com/paperclipai/paperclip) é o que mais se aproxima do desejado — tem org chart, agentes hierárquicos, issues e custos — mas exige `ANTHROPIC_API_KEY`, e o usuário já paga assinatura **Claude Max** e não quer pagar API por cima.

## 2. Solução proposta

Um **app desktop Windows** estilo Paperclip que orquestra agentes hierárquicos localmente, **usando exclusivamente o login OAuth do Claude Code** (sem `ANTHROPIC_API_KEY`). Cada "agente" é uma sessão real do `claude` CLI com persona customizada, ferramentas via MCP e contexto persistente. O usuário fala com um agente CEO; ele delega para sub-agentes que executam o trabalho. Tudo visível em tempo real.

## 3. Restrições

- **Auth**: nunca exigir `ANTHROPIC_API_KEY`. Usa `CLAUDE_CODE_OAUTH_TOKEN` gerado por `claude setup-token` (válido 1 ano)
- **Plataforma**: Windows nativo (PowerShell, Windows Terminal, VS Code, JetBrains, Cursor — não usa WSL)
- **Single-user**: instala localmente, único usuário (o dono da máquina)
- **Idiomas**: pt-BR (padrão) e en-US, com seletor — sem mistura de idiomas em tela
- **Temas**: claro (padrão) e escuro, com seletor

## 4. Escopo da v1

| Módulo | Inclui | Notas |
|---|---|---|
| **Multi-empresa** | ✓ | Dropdown topo da sidebar; cada empresa isolada |
| **Dashboard** | ✓ | Overview: agentes ativos, issues, inbox, custos |
| **Inbox** | ✓ | Notificações que requerem atenção do usuário |
| **Issues** | ✓ | Tickets com status (Backlog / Todo / Doing / Review / Done) |
| **Projects** | ✓ | Pastas/repos git que agentes operam; cada projeto tem cor + path |
| **Agents** | ✓ | Lista + chat 1-1 com cada agente; persona, skills, projetos, stats |
| **Org Chart** | ✓ | Visualização hierárquica de quem reporta a quem |
| **Skills** | ✓ | Catálogo de tools/MCP disponíveis pra atribuir a agentes |
| **Costs** | ✓ | Tokens consumidos por agente/projeto + % do limite Max |
| **Settings** | ✓ | OAuth token, paths default, idioma, tema, defaults de execução |

**Fora da v1** (v2+): Routines (tasks recorrentes), Goals (objetivos longos), Activity Log audit-grade, "New Issue" como atalho global de teclado, suporte a Cursor/Codex/outros agents (só Claude Code na v1).

## 5. Arquitetura

```
┌────────────────────── Electron App ───────────────────────────┐
│                                                                │
│  ┌── Main Process (Node) ────────────────────────────────┐    │
│  │  • Tray icon (sobrevive janela fechada)               │    │
│  │  • Backend HTTP local (Fastify) + IPC                 │    │
│  │  • SQLite (better-sqlite3) — single .db por usuário   │    │
│  │  • Agent Orchestrator — gerencia ciclo de vida        │    │
│  │  • MCP Server interno — expõe tools de orquestração   │    │
│  │  • File watcher de ~/.claude/projects/ (telemetria)   │    │
│  │  • OAuth token store (criptografado at rest)          │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌── Renderer (React + Vite) ─────────────────────────────┐   │
│  │  Sidebar + main area + right panel · Poppins · i18n   │   │
│  │  Tema claro (padrão) / escuro · paleta Subido PRO     │   │
│  └────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                             │ spawn child processes
                             ▼
       ┌──────── Agentes (Claude Code headless) ───────┐
       │  $ claude -p \                                │
       │      --system "<persona system prompt>" \     │
       │      --resume <session_id> \                  │
       │      --mcp-config <path-para-nosso-mcp.json>  │
       │  env: CLAUDE_CODE_OAUTH_TOKEN herdado         │
       └────────────────────────────────────────────────┘
```

### 5.1 Decisões técnicas

| # | Decisão | Razão |
|---|---|---|
| D1 | **Electron + tray icon** | Tray garante que agentes 24/7 sobrevivam ao fechar janela. Stack maduro pra Windows. |
| D2 | **Backend Node embutido** (Fastify) | Renderer fala com main via IPC ou HTTP localhost. MCP server compartilha o mesmo processo. |
| D3 | **SQLite (better-sqlite3)** | Single-user local, zero setup, transactional, super rápido. Postgres seria overkill. |
| D4 | **Cada agente = sessão Claude Code real** (`claude -p --resume`) | Aproveita TODO o ecossistema (MCP, skills, plugins, hooks). Sem reinventar inteligência. |
| D5 | **MCP Server interno expõe tools de orquestração** | Padrão type-safe oficial do Claude. Cada agente recebe `--mcp-config` apontando pro server local. |
| D6 | **Modelo híbrido de agentes** | Toggle 24/7 por agente. Default = sob demanda (recriado quando precisa trabalhar). |
| D7 | **Comunicação via threads de chat 1-1 + issues** | Agentes conversam livre (DM-style); tasks formais ficam como issues. |
| D8 | **Modos `supervised` e `auto` por agente** | Padrão = supervised (pede aprovação antes de side-effect). Auto = roda sem perguntar. |
| D9 | **OAuth via `CLAUDE_CODE_OAUTH_TOKEN`** | Único setup manual: usuário cola o token (gerado por `claude setup-token`) em Settings na primeira vez. |
| D10 | **File watcher de `~/.claude/projects/`** | Observa sessões Claude Code mesmo iniciadas fora do dashboard, populando activity feed. |

### 5.2 MCP Tools de orquestração

O Dashboard expõe um MCP server interno via **stdio** (cada agente spawnado recebe um stdio child process do server, gerenciado pelo Orchestrator). Cada `claude -p` recebe `--mcp-config` apontando pra um JSON gerado dinamicamente com o agent_id no env, pra o server identificar quem está chamando. Tools disponíveis:

| Tool | Função | Quem chama |
|---|---|---|
| `list_agents()` | Lista agentes da empresa atual | Qualquer agente |
| `hire_agent(role, name?, persona?)` | Cria novo agente (usa template do role se persona omitida) | Tipicamente CEO |
| `fire_agent(agent_id)` | Remove agente | Tipicamente CEO |
| `create_issue(project, title, description, assignee, priority)` | Cria issue formal | CEO / qualquer agente |
| `update_issue(id, status?, description?, assignee?)` | Atualiza issue | Assignee da issue |
| `assign_issue(issue_id, agent_id)` | Atribui issue | CEO |
| `list_issues(filter)` | Lista issues (por projeto, status, assignee) | Qualquer agente |
| `message_agent(agent, content)` | Envia mensagem direta na thread | Qualquer agente |
| `read_thread(thread_id, since?)` | Lê mensagens de uma thread | Qualquer agente |
| `check_status(issue_id)` | Pega status atual de uma issue | Qualquer agente |
| `notify_user(title, body, requires_action?)` | Cria item na Inbox | Qualquer agente |

> Permissão: cada tool checa se o agente pode operar no projeto/recurso. ACL definido no agente.

### 5.3 Modelo de dados (SQLite)

```sql
-- Empresas (multi-tenant local)
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}'
);

-- Projetos (pastas/repos)
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  path TEXT NOT NULL,           -- absolute path Windows
  color TEXT NOT NULL DEFAULT '#1D5DD7',
  created_at INTEGER NOT NULL
);

-- Agentes
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,            -- ex: "FoundingEngineer"
  role TEXT NOT NULL,            -- ex: "Frontend Engineer"
  template_id TEXT,              -- referencia template usado (nullable se editado)
  system_prompt TEXT NOT NULL,
  skills_json TEXT NOT NULL,     -- array de tool names que o agente pode usar
  allowed_projects_json TEXT NOT NULL,  -- array de project ids
  mode TEXT NOT NULL DEFAULT 'supervised',   -- 'supervised' | 'auto'
  always_on INTEGER NOT NULL DEFAULT 0,      -- 0/1
  reports_to TEXT REFERENCES agents(id),     -- pra org chart
  claude_session_id TEXT,        -- session_id atual do `claude -p --resume`
  status TEXT NOT NULL DEFAULT 'idle',       -- 'idle' | 'thinking' | 'working' | 'waiting' | 'error'
  current_action TEXT,                        -- texto curto: "Editando login.tsx"
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Issues
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT REFERENCES projects(id),
  parent_id TEXT REFERENCES issues(id),       -- subtasks
  title TEXT NOT NULL,
  description TEXT,
  assignee_id TEXT REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'todo',         -- 'backlog'|'todo'|'doing'|'review'|'done'|'cancelled'
  priority TEXT NOT NULL DEFAULT 'medium',     -- 'low'|'medium'|'high'|'urgent'
  created_by TEXT REFERENCES agents(id),       -- nullable se criado pelo user
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Threads de chat (user-agent ou agent-agent)
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  participants_json TEXT NOT NULL,             -- ["user", "agent_id_1", "agent_id_2"]
  created_at INTEGER NOT NULL
);

-- Mensagens
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  sender_kind TEXT NOT NULL,                   -- 'user' | 'agent' | 'system'
  sender_id TEXT,                              -- agent_id (null se user/system)
  content TEXT NOT NULL,
  tool_calls_json TEXT,                        -- tool calls inline (renderizado como cards)
  created_at INTEGER NOT NULL
);

-- Inbox (notificações pro usuário)
CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL,                          -- 'approval'|'completed'|'suggestion'|'error'
  actor_id TEXT REFERENCES agents(id),
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT,                           -- contexto da ação se requires_action
  requires_action INTEGER NOT NULL DEFAULT 0,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Custos (uso de tokens)
CREATE TABLE costs_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  agent_id TEXT REFERENCES agents(id),
  project_id TEXT REFERENCES projects(id),
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  model TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL
);

-- Catálogo de skills (definições estáticas)
CREATE TABLE skills_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  mcp_tools_json TEXT NOT NULL                 -- tool names que essa skill agrupa
);

-- Templates de papel (CEO, Frontend Eng, etc.)
CREATE TABLE role_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  default_system_prompt TEXT NOT NULL,
  default_skills_json TEXT NOT NULL,
  icon TEXT
);

-- Settings (key-value global)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Chaves: oauth_token (encrypted), default_mode, default_always_on, theme, language,
--         claude_binary_path, projects_root_default
```

Índices: `idx_issues_company_status`, `idx_messages_thread_created`, `idx_inbox_company_unread`, `idx_costs_company_date`.

### 5.4 Fluxo: usuário pede, CEO delega, agente executa

> **Comunicação assíncrona**: agentes não bloqueiam esperando outro agente terminar. Mensagens entre agentes são entregues e cada agente continua na sua execução. Atualizações de status chegam via `notify_user`, mudanças de issue ou novas mensagens na thread, processadas no próximo turno do agente.

1. Usuário abre chat com CEO (sidebar > Agents > CEO)
2. Usuário: "Conserta o bug de login no Onboarding"
3. Renderer envia mensagem ao Main via IPC
4. Orchestrator: garante que sessão do CEO está rodando (always-on, então já está). Acrescenta a mensagem do usuário ao stdin do `claude -p` resumido com `--resume`
5. CEO (Claude) processa com seu system prompt e MCP tools. Decide:
   - Tool call `list_agents()` — vê que tem FoundingEngineer
   - Tool call `create_issue(project="Onboarding", title="Bug de login", assignee=FE_id)`
   - Tool call `message_agent(FoundingEngineer, "Olha #42, foco em src/auth/google.ts")`
6. Tool calls vão pro MCP Server interno (mesmo processo Main)
7. Orchestrator processa cada tool: cria issue no SQLite, cria mensagem na thread, e **(se modo=supervised do CEO):** mostra confirmação na UI antes de executar a tool de side-effect
8. Quando `message_agent` é chamada, Orchestrator spawna `claude` do FoundingEngineer com a mensagem como input inicial (se ele estiver idle) ou injeta a mensagem na sessão dele (se já estiver rodando)
9. FoundingEngineer trabalha — cada tool call dele (Read, Edit, Bash) passa pelo modo dele (supervised/auto). UI mostra status em tempo real (current_action atualizado pelo Orchestrator a partir do stdout do claude)
10. Quando FE termina, ele chama `update_issue(id=42, status='review')` + `notify_user(title="Bug resolvido", ...)` ou `message_agent(CEO, "...")`
11. CEO recebe a mensagem na próxima execução, atualiza usuário

### 5.5 Aprovação humana (modo supervised)

Toda chamada de tool com side-effect (Edit, Write, Bash, e tools MCP de orquestração que afetam estado) fica pendente até o usuário aprovar/rejeitar via:
- Card inline no chat ("aprovar / editar / rejeitar")
- Item na Inbox
- Notificação do tray icon

Modo `auto` pula aprovações para esse agente — útil pra trabalhadores confiáveis.
Existem **escopos de auto** (v2 — não na v1): "auto pra Read, supervised pra Bash". Na v1, é binário por agente.

### 5.6 Catálogo de templates de papel (v1 inicial)

> **Seed**: o que vem populado por seed na primeira execução é APENAS o catálogo abaixo (`role_templates` table). **Não há seed de empresas, agentes ou projetos** — o usuário cria tudo via UI. Quando ele cria a primeira empresa, o sistema automaticamente cria um agente CEO a partir do template CEO (pode editar/remover depois).

| Template | system_prompt resumido | Skills default |
|---|---|---|
| **CEO** | "Você é o CEO da empresa {company}. Recebe demandas do dono, decide quais agentes contratar e como delegar. Sempre delega trabalho técnico, não executa diretamente." | hire_agent, create_issue, assign_issue, message_agent, list_agents, list_issues, check_status, notify_user, read_files |
| **Backend Engineer** | "Engenheiro back-end. Implementa APIs, banco, jobs. Foco em qualidade, testes, performance." | Read, Write, Edit, Bash, create_issue, update_issue, message_agent, notify_user |
| **Frontend Engineer** | "Engenheiro front-end. Constrói UIs, integra com APIs. Cuida de UX, acessibilidade, design system." | Read, Write, Edit, Bash, create_issue, update_issue, message_agent, notify_user |
| **DevOps Engineer** | "Cuida de CI/CD, infra, deploy, observabilidade." | Read, Bash, create_issue, update_issue, message_agent, notify_user |
| **QA Engineer** | "Garante qualidade. Escreve testes, valida fluxos, encontra bugs." | Read, Write, Edit, Bash, create_issue, update_issue, message_agent, notify_user |
| **Product Manager** | "Define requisitos, prioriza, acompanha entregas." | create_issue, update_issue, list_issues, message_agent, notify_user, read_files |
| **Designer** | "UX/UI design. Cria mockups, define tokens, acessibilidade." | Read, Write, message_agent, notify_user |
| **Security Engineer** | "Auditoria de segurança, code review, compliance." | Read, Bash, create_issue, message_agent, notify_user |

Usuário pode editar tudo após criar.

## 6. UI

### 6.1 Estrutura de tela

Layout em 3 colunas:
- **Sidebar (220px)**: dropdown empresa, nav items, listas (Projetos, Agentes), seção Empresa, footer (idioma + tema)
- **Main area (fluida)**: dependendo da rota — Dashboard (4 widgets), Issues (kanban), Agente (chat), Settings (form), etc.
- **Right panel (280px, opcional)**: contexto da view atual (persona do agente, detalhes da issue)

### 6.2 Identidade visual

- **Tipografia**: Poppins (primária), monospace para code/tool calls
- **Paleta clara** (padrão):
  - Primária `#1D5DD7` (azul vibrante — ações)
  - Marca `#001D5A` (azul marinho profundo — headers, dropdown empresa)
  - Pálido `#BEE0FE` / `#EAF2FE` (background suave / hover)
  - Acento `#5bc4e7` (azul celeste)
  - Bg `#FFFFFF` / `#F5F5FA`
  - Bordas `#E8E8E8`
  - Texto `#070C27` / muted `#48484A` / soft `#969696`
  - Semânticas: success `#16a34a`, warning `#FFC520`, danger `#E83838`, purple-thinking `#7c3aed`
- **Paleta escura**: mesmas relações invertidas — bg `#070C27` / soft `#0F1733`, primária mantida `#1D5DD7`, etc. (especificado no implementation plan)

### 6.3 i18n

- Padrão pt-BR
- Toggle EN no footer da sidebar
- Estratégia: `react-i18next` + arquivos JSON `pt-BR.json` / `en-US.json`. Persistido em `settings.language`
- **Regra dura**: tela inteira em UM idioma. Sem mistura. CI lint pode validar (v2)

### 6.4 Telas (rotas)

| Rota | Conteúdo |
|---|---|
| `/dashboard` | 4 widgets: Agentes Ativos, Issues em Andamento, Inbox, Custos hoje |
| `/inbox` | Lista de inbox_items, agrupada por kind, com ação inline (aprovar/rejeitar/marcar lido) |
| `/issues` | Kanban (colunas: Backlog, Todo, Doing, Review, Done) com filtro por projeto/assignee |
| `/issues/:id` | Detalhe da issue, comentários, tool call history, sub-tasks |
| `/projects` | Lista cards, "+" abre modal pra adicionar pasta + cor |
| `/projects/:id` | Detalhe do projeto, agentes com acesso, issues do projeto |
| `/agents` | Lista cards com "+" abrindo galeria de templates |
| `/agents/:id` | Chat 1-1 + right panel (persona, skills, projetos, issues, stats) |
| `/org` | Visualização hierárquica (D3 ou React Flow) |
| `/skills` | Catálogo de skills disponíveis, drag&drop pra agente |
| `/costs` | Gráficos por agente, por projeto, por dia. Limite Max e progress |
| `/settings` | OAuth token, paths, idioma, tema, defaults de modo |

## 7. Tratamento de erros

| Cenário | Comportamento |
|---|---|
| OAuth token expirado/inválido | Banner global vermelho, sugere `claude setup-token`, agentes pausam até resolver |
| Agente trava (timeout > 5min sem heartbeat) | Status muda pra `error`, item na Inbox, botão "reiniciar" |
| Bate rate limit do Max | Backoff exponencial + banner amarelo. Agentes em fila. Inbox notifica |
| Tool call falha | Erro inline no chat + retry option. Agente tenta no máximo 3x antes de parar |
| Crash do main process | Tray icon mostra ícone vermelho. Auto-restart em 5s. Sessões resumem do `claude_session_id` salvo |
| DB corrompido | Backup automático diário. Restore via Settings |
| Caminho de projeto não existe | Marca projeto como "indisponível"; agentes não podem usar `--cwd` nele |

## 8. Segurança (defesa em camadas)

Segurança é prioridade dura. Os agentes têm acesso a Bash/Edit/Write na máquina do usuário com OAuth do Claude Max. Um agente comprometido por **prompt injection** (ler arquivo malicioso) pode tentar exfiltrar credenciais. Defesa em múltiplas camadas:

### 8.1 Credenciais

- **OAuth token** criptografado at-rest com **DPAPI** (Windows Data Protection API). Chave derivada do user/machine — descriptografável só no contexto do mesmo usuário Windows.
- Token **nunca logado** (filtros em logger). Logs com strings parecidas com token são redacted.
- **Pre-commit hook** (gitleaks/git-secrets) bloqueia qualquer commit com padrão de token. CI roda mesmo scan.
- **Rotação**: Settings mostra dias até expiração; banner avisa 30 dias antes.

### 8.2 Sandbox de filesystem (camada Orchestrator)

`allowed_projects_json` é traduzido em **filesystem allowlist** aplicada antes de cada tool call:
- **Read/Write/Edit/Glob/Grep**: path do parâmetro é resolvido para absoluto e checado contra allowlist. Path fora = rejeitado **antes** do `claude` executar.
- **Bash**: tokenização do comando + heurística estática rejeita acessos a paths sensíveis (`~/.claude/`, `~/.ssh/`, `%APPDATA%\Microsoft\Credentials`, `*.credentials.json`). Comandos com `cd` que escapam são reescritos ou rejeitados.
- **Working directory**: agente sempre roda com `--cwd` num projeto permitido. Não confia só no `--cwd`; reforça em cada tool call.

> **Em milestones anteriores ao Projects CRUD (M5..M5.x):** o allowlist é o `settings.workspaceCwd` único — todos os agentes da company compartilham este root. Quando Projects CRUD aterriza (M6), migra-se para `agents.allowed_projects_json` resolvido via `projects.path` por agente.

### 8.3 Lista de comandos sempre-bloqueados

Mesmo em modo `auto`, comandos abaixo **sempre** exigem aprovação (não bypass):
- Network exfiltration: `curl -d @`, `curl -F file=@`, `wget --post-file=`, `nc`, `ncat` enviando dados
- Acessos a credenciais: leituras a `~/.claude/.credentials.json`, `~/.ssh/`, `~/.aws/`, `~/.docker/config.json`, env vars sensíveis
- Operações destrutivas amplas: `rm -rf /`, `del /s /q`, `git reset --hard`, `git clean -fdx`, `format`, drops de schema
- Modificação do próprio app: writes em `<app-data>`, `<install-dir>`, registry do app
- Lista é **versionada no código** (não editável em Settings) — usuário pode adicionar mais via allowlist mas nunca remover do core.

### 8.4 Modo `auto` ainda tem freios

- Modo `auto` por agente NÃO concede acesso irrestrito; comandos da §8.3 ainda exigem aprovação.
- **Default conservador**: agentes recém-criados começam em supervised. Mudar pra auto requer toggle explícito + aviso.
- **Auto degradado para Bash**: opção (default ligado) "agente em auto ainda confirma Bash". Reduz risco mantendo eficiência em Read/Write/Edit.
- Modo auto **expira**: 24h de auto sem interação humana → sistema volta pra supervised automaticamente. Reativa-se com 1 click.

### 8.5 MCP server local

O MCP server roda como stdio child do `claude` (parent). stdio é um pipe privado entre parent e child — outros processos no host não podem se conectar nem injetar mensagens. Por isso, **não há auth aplicacional** sobre cada chamada de tool: o canal já é privado por construção do SO.

O MCP child recebe `AGENT_ID` e `COMPANY_ID` via env do parent, usados para escopo de queries (filtra por company, identifica agent). Isso não é segurança — é apenas escopo.

**Se transport mudar para HTTP/WS no futuro**: reintroduzir token validation por sessão. Documentado como debt em milestone futuro.

### 8.6 Anti-prompt-injection (camada Orchestrator)

Quando um tool call (especialmente após Read de arquivo externo) propõe ações suspeitas, Orchestrator detecta:
- **Heurística estática** sobre tool inputs: padrões como "ignore previous", "system override", base64 longo em parâmetro, comandos contradizendo o pedido original do usuário.
- **Diff suspeito**: se agente em modo auto que estava editando `src/auth/login.tsx` tenta de repente Bash `cat ~/.claude/.credentials.json`, divergência → rebaixa pra supervised.
- **Tool call rate**: pico anormal de tool calls em curto período → pause + Inbox alerta.
- Detecção entra na Inbox como item `kind='security_alert'` requires_action.
- **v1 entrega heurística básica**; v2 evolui pra modelo dedicado se necessário.

### 8.7 Supply chain

- **Lockfile commit obrigatório** (pnpm-lock.yaml ou package-lock.json).
- **CI roda `npm audit --production`** + Renovate/Dependabot.
- **Subset confiável**: deps preferidas são as da TAB de dependências mantida na spec/plano (electron, fastify, better-sqlite3, react, vite, zustand ou similar). Add de nova dep requer justificativa.
- **Electron com `contextIsolation: true`**, `nodeIntegration: false`, CSP restritivo no renderer.

### 8.8 Rede

- Backend HTTP só escuta em `127.0.0.1`.
- Sem auto-update via rede na v1 (atualização manual). v2 considera assinatura/notarização.
- Telemetria opcional, **default OFF**, opt-in. Nunca envia conteúdo de mensagens — só métricas anônimas (versão, contagem de erros, perf).

### 8.9 Runbook de incidente

Documento `SECURITY.md` no repo descreve: como rotacionar OAuth token, como identificar agente comprometido (logs do orchestrator), como abrir issue privada de segurança (se vira open-source).

## 9. Eficiência de tokens (restrição dura)

Restrição de design: **consumo total não pode crescer muito além do que custaria fazer a mesma tarefa em uma única sessão Claude Code**. Alvo: ~1x do uso normal, idealmente ≤ 1.3x. Sem isso, o usuário bate o limite Max e o produto perde o sentido.

### 9.1 Mecanismos obrigatórios

| Mecanismo | Detalhe | Economia esperada |
|---|---|---|
| **Prompt cache** | Anthropic prompt caching ativo em system prompts e MCP tool schemas. System prompts e definições de tools são parte cacheável (não muda turn a turn). | ~30-50% redução em input tokens repetidos |
| **MCP tools por papel** | Cada agente recebe SOMENTE as MCP tools relevantes ao papel (Engineer não recebe `hire_agent`). `--mcp-config` é gerado por agente. | ~20% redução no system prompt size |
| **Histórico curto + summary** | Cada agente mantém só últimas N=20 mensagens em contexto. Mais antigas viram summary auto-gerado pelo próprio agente em turn de "compaction" (1 turn a cada 50). | Constante em vez de O(n) crescente |
| **Tool-call batching** | Agente é instruído (system prompt) a batchar múltiplas tool calls em UMA turn quando independentes. Especialmente CEO ao delegar (create_issue + message_agent + assign no mesmo turn). | ~40% menos turns em delegações |
| **Direct-execute** | CEO (e PM se existir) tem heurística no system prompt: "se a task pode ser respondida em <2 turns sem código, responda direto sem delegar". Reduz overhead de coordenação para perguntas simples. | Variável; alto pra tasks pequenas |
| **Sessão única quando possível** | Se uma issue não envolve múltiplos papéis, atribui a UM agente sem coordenação. Não força orquestração. | Mantém custo ~1x do baseline |
| **Limite duro de turns por issue** | Default 15 turns por issue. Excedeu → pause + Inbox alerta. Configurável. | Previne runaway loops |
| **Compactação cross-thread** | CEO não recebe hist completo de cada thread filho; só os summary entries `notify_user` que vêm pela inbox. | CEO context fica compacto |
| **No "always-on poll"** | Agentes always-on NÃO acordam sozinhos. Eles ficam suspensos (processo dormindo, não consumindo) até receberem mensagem real. Tokens só são gastos quando há trabalho. | Zero tokens em idle |
| **Reuso de session** | Mesmo agente, sessão `--resume` mantida; não cria session nova a cada mensagem. | Evita re-load de contexto |

### 9.2 Métrica visível

- Widget Costs do Dashboard mostra **multiplicador efetivo** comparando ao baseline estimado (single-session equivalent). Se passar de 1.5x consistentemente, banner amarelo.
- Por issue resolvida: relatório de tokens gastos vs estimativa baseline. Histórico permite calibrar limites.

### 9.3 Budget caps (Settings)

Hard limits configuráveis pelo usuário (defaults conservadores):
- `max_tokens_per_day_per_agent` (default 2M)
- `max_tokens_per_issue` (default 200k)
- `max_concurrent_running_agents` (default 3)
- `max_turns_per_issue` (default 15)

Excedeu = pausa o agente + Inbox alerta. Usuário decide retomar.

### 9.4 Não-objetivo na v1

- **Não** implementar caching customizado além do oferecido nativamente pela Anthropic.
- **Não** rodar fine-tune ou modelo local.
- **Não** usar modelos diferentes por papel (todos rodam mesmo Claude do plano Max). v2 pode usar Haiku pra coordenação.

## 10. Testabilidade

### 10.1 Pirâmide de testes

- **Unit**: Orchestrator (estado/transições de agentes, parsing de tool calls, allowlist de paths), schema do DB, redutores de UI, sanitizadores de Bash
- **Integration**: MCP server (cada tool com input válido/inválido + sem token), DB migrations, fluxo completo "user → CEO → tool call → SQLite → renderer"
- **E2E**: Playwright contra app Electron — cenário "criar empresa → criar agente CEO → mandar mensagem → ver tool call render → trocar tema/idioma"
- **Manual**: testes contra Claude Code real (não mockado) numa pasta de teste antes de cada release

### 10.2 Testes de segurança (obrigatórios)

Não opcionais — fazem parte do gate de release:

| Cenário | Esperado |
|---|---|
| Agente em modo `auto` tenta `cat ~/.claude/.credentials.json` via Bash | Bloqueado pela §8.3 antes de executar |
| Agente Read absoluto fora do `allowed_projects_json` | Rejeitado pela §8.2 |
| Outro processo local chama MCP server sem token | 401 (§8.5) |
| Arquivo de teste com prompt injection é lido por agente em auto | Detector da §8.6 dispara, agente rebaixa pra supervised |
| Token OAuth é committed acidental | Pre-commit hook bloqueia (§14.2) |
| Comando `curl -F file=@~/.claude/...` em Bash auto | Bloqueado pela §8.3 |
| Agente atinge limite de turns (§9.3) | Pausa + Inbox alerta |

### 10.3 Métricas de eficiência de tokens

- Cada release roda **suite de cenários canônicos** medindo tokens consumidos:
  - "Usuário pede CEO refactorar função" → mede tokens vs baseline single-session
  - "Usuário pede CEO contratar Frontend Eng e fazer task UI" → idem
  - "Issue trivial respondida pelo CEO direto (direct-execute)" → idem
- Resultado vai pro CHANGELOG. Regressão >20% bloqueia release.
- Multiplicador alvo: ≤ 1.3x do baseline. Se passar, ajusta mecanismos da §9.

## 11. Estrutura de pastas (proposta)

```
DashboardAgent/
├── apps/
│   ├── main/                 # Electron main process
│   │   ├── src/
│   │   │   ├── orchestrator/ # spawn, lifecycle, MCP bridge
│   │   │   ├── mcp-server/   # internal MCP exposing orchestration tools
│   │   │   ├── db/           # SQLite, migrations
│   │   │   ├── watcher/      # ~/.claude/projects/ filesystem watcher
│   │   │   ├── ipc/          # bridge to renderer
│   │   │   └── auth/         # OAuth token storage (DPAPI)
│   │   └── package.json
│   └── renderer/             # React + Vite
│       ├── src/
│       │   ├── routes/       # Dashboard, Agents, Issues, etc.
│       │   ├── components/
│       │   ├── theme/        # tokens light + dark
│       │   ├── i18n/         # pt-BR.json, en-US.json
│       │   └── stores/       # state (Zustand ou similar)
│       └── package.json
├── packages/
│   ├── shared/               # types compartilhados main/renderer
│   └── role-templates/       # seed dos templates de papel
├── docs/
│   └── superpowers/specs/    # design docs
└── package.json              # workspaces
```

## 12. Critérios de sucesso

A v1 é "pronta" quando o usuário consegue:

1. Subir o app, colar OAuth token, criar empresa "Kronos"
2. Ver CEO pré-criado, conversar com ele em pt-BR
3. Pedir pro CEO contratar um Frontend Engineer e abrir issue de bug
4. Ver issue criada (tool call renderizado), agente sub-criado, e mensagem despachada
5. Frontend Engineer (rodando real) lê código de um projeto registrado, edita e responde
6. Issue muda de status no kanban
7. Inbox notifica conclusão
8. Custos mostram tokens consumidos
9. Trocar tema e idioma sem recarregar app — sem mistura de idiomas em nenhuma tela
10. Fechar janela e reabrir — agentes always-on continuam rodando
11. **Cenário de segurança**: rodar suite §10.2 — todos os 7 testes passam (prompt injection bloqueado, comandos sensíveis rejeitados, MCP exige token)
12. **Cenário de eficiência**: completar tarefa canônica "refactor de função simples" usando overhead ≤ 1.3x do baseline single-session (medido em release CI §10.3)
13. **Open-source ready**: clonar repo limpo + rodar gitleaks → zero achados; `pnpm audit --production` → sem high/critical

## 13. Riscos conhecidos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| **Prompt injection** comprometendo agente em auto e exfiltrando OAuth token | alta se sem defesa | §8.2 sandbox + §8.3 comandos bloqueados + §8.6 detector + §8.4 freios em auto |
| Plano Max bate limite | média | §9 mecanismos de eficiência + §9.3 budget caps + métrica visível |
| Token OAuth commitado acidental | média | §14.2 pre-commit + §8.1 logger redact |
| MCP local explorado por outro processo na máquina | baixa-média | §8.5 token efêmero por agente |
| `CLAUDE_CODE_OAUTH_TOKEN` expira em 1 ano | certa | §8.1 banner 30 dias antes + doc renovação |
| Atualizações do Claude Code CLI quebram contrato (`--resume`, `--system`, `--mcp-config`) | média | CI smoke test contra Claude Code release; pin versão mínima testada |
| Sessão Claude Code corrompe | baixa | Fallback: cria nova sessão preservando system_prompt; histórico vai pro DB próprio |
| Filesystem watcher caro em ~/.claude/projects/ grandes | baixa | Watcher por projeto registrado apenas |
| Multi-empresa cria confusão de contexto | baixa | Dropdown sempre visível + cor única por empresa |
| Loop infinito de agentes em modo auto | média | §9.3 max_turns_per_issue + §8.6 rate detection |
| Supply chain compromise via dep npm | baixa-média | §8.7 lockfile + audit + Renovate + Electron sandbox flags |
| Usuário trocar tema/idioma e ver tela mista | baixa | §6.3 lint de strings + reload de bundle i18n |

## 14. Open-source readiness

O projeto pode ser publicado no GitHub com segurança desde que os controles abaixo estejam aplicados desde o primeiro commit:

### 14.1 .gitignore obrigatório

```
# Build
dist/
out/
release/
build/
.vite/

# Runtime data
*.db
*.db-journal
*.db-wal
*.sqlite
*.sqlite3
data/
app-data/
user-data/
logs/
*.log

# Env / secrets
.env
.env.*
*.pem
*.key
.credentials/

# Brainstorm/design artifacts (locais)
.superpowers/
.claude-flares/

# OS
Thumbs.db
.DS_Store
```

### 14.2 Pre-commit hooks (husky)

- **gitleaks** ou **git-secrets** roda em cada commit. Bloqueia padrões de OAuth token, API key, credenciais.
- **Lint** + **prettier**.
- **Test fast subset** (unit only, sem integration).

### 14.3 CI checks (GitHub Actions)

- Re-roda gitleaks em PRs.
- `pnpm audit --production` falha em high/critical.
- Build matrix Win/Mac/Linux (renderer pelo menos; main process pode focar em Win na v1).
- Lockfile drift check.

### 14.4 Licença e disclaimer

- **License**: MIT (default open). Sem cláusulas patenteais maliciosas.
- `README.md` contém disclaimer:
  > "This app spawns Claude Code agents on your machine using YOUR Claude Max OAuth token. Agents have access to filesystem, shell commands, and network within the limits you configure. You are responsible for reviewing agent permissions and supervising autonomous modes. The authors assume no liability for actions taken by agents on your behalf."

### 14.5 Documentos de suporte no repo

- `README.md` — pitch, screenshots (com dados mockados), quickstart
- `SECURITY.md` — runbook de incidente, como reportar vulnerabilidades (issue privada / email)
- `CONTRIBUTING.md` — fluxo de PR, code style, testes
- `CHANGELOG.md` — keep-a-changelog, versionamento semântico
- `LICENSE` — MIT
- `docs/architecture.md` — derivado deste design doc, sem detalhes pessoais

### 14.6 O que NÃO commitar (mesmo se acidental)

- DB de teste (mesmo limpo — pode conter paths privados em snapshot)
- Settings dump
- Screenshots ou GIFs com nomes reais de projetos / threads reais
- `package-lock.json` com URLs internas (caso venha a usar registry privado no futuro)
- Logs com timestamps + paths absolutos

### 14.7 Issue templates

`.github/ISSUE_TEMPLATE/`: forms que pedem ao reporter remover paths absolutos, nomes de empresa/projeto reais antes de submeter.

## 15. O que **não** está nesta v1

- Routines (cron)
- Goals (objetivos longos com hierarquia)
- Activity Log audit-grade imutável
- Multi-usuário / SaaS
- Suporte a Cursor, Codex, OpenClaw
- Comunicação assíncrona com agentes em pausa profunda
- "New Issue" como atalho global de teclado
- Auto granular por tipo de tool (binário por agente na v1)
- Mobile / acesso remoto
- Plugins/extensões

---

**Próximo passo:** revisão pelo usuário, depois invocação da skill `writing-plans` pra detalhar o plano de implementação.
