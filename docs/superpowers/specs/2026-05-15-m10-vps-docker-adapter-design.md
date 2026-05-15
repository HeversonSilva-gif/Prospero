# M10 — VPS Docker Remote Adapter — Design

> **Status:** design aprovado 2026-05-15. Fecha o v1 (14/14 milestones).
> **Adapter:** `claude-oauth-remote-docker` — 3º adapter, depois de
> `claude-oauth-local` (M1–M7) e `claude-api-key-local` (M9 PR-D).
> **Doc relacionado:** `docs/m10-adapter-wire-protocol.md` (wire protocol;
> revisado por este M10 — ver §4).

## 1. Contexto e objetivo

O roadmap promete: *"rodar agentes numa VPS remota (Docker) — escolha
per-agent: local (CEO, latência baixa) ou remoto (engenheiros, isolamento)"*.
O adapter pattern (foundation M7.5) foi desenhado pra absorver esse 3º
lifecycle sem rewrite — o registry em `adapters/index.ts` já tem
`"claude-oauth-remote-docker": undefined, // M10`, e o union `AdapterName` já
inclui o nome.

**Driver duplo:** isolamento (rodar trabalho de agente dentro de container) e
offload de compute (tirar carga do desktop). Ambos valem.

### 1.1 O problema central

O wire protocol já está desenhado (`docs/m10-adapter-wire-protocol.md`). A
parte difícil **não** é o protocolo — é que hoje o **MCP server** (que dá as
ferramentas ao agente) roda como filho stdio do `claude` e **abre o arquivo
SQLite do host diretamente**, escreve eventos num `EVENTS_DIR` local e lê/grava
num `PERMISSIONS_DIR` local (ver `apps/main/src/mcp/server.ts`). Um processo
`claude` numa VPS remota não tem acesso a nada disso.

Logo, "rodar o agente remoto" é, de fato, decidir **como as ferramentas do
agente remoto alcançam os dados do dashboard**.

## 2. Decisões tomadas (2026-05-15)

| Decisão | Escolha | Razão |
|---|---|---|
| **Transporte** | **SSH stdio** (não WSS+mTLS) | SSH já entrega auth + criptografia + pipe. Sem porta aberta, sem ciclo de vida de certificado X.509. Mais simples e mais seguro pra ferramenta single-user. |
| **Escopo de validação** | **Local Docker primeiro**, VPS documentada | Adapter + runner + imagem validados com container nesta máquina via o caminho idêntico ao remoto. SSH-para-VPS real é cabeado e documentado, smoke manual feito pelo usuário depois. |
| **Arquitetura MCP/DB** | **Host-authoritative** — MCP tunelado pelo wire protocol | DB nunca sai do host; nada exposto na rede; local e remoto usam o caminho idêntico (validação local de-risca o remoto de verdade). |

### 2.1 Alternativas rejeitadas

- **Bind-mount do `userData` do host no container** — funciona pra Docker
  local mas é impossível numa VPS real; validação local não exercitaria o
  caminho remoto. Rejeitada: duas fiações de MCP, confiança falsa.
- **MCP server remoto contra cópia sincronizada do DB** — dois escritores,
  conflito de sync, DB exposto fora do host. Rejeitada de saída.

## 3. Arquitetura

Só o processo `claude` roda remoto. Tudo que tem estado fica no host.

```
HOST (Electron main)                          CONTAINER (Docker local / VPS)
┌──────────────────────────────┐              ┌───────────────────────────────┐
│ ClaudeRemoteDockerAdapter    │              │  agent-runner (app novo)       │
│  ├ connection manager (1x)   │◄══ SSH /═════►│   ├ wire-protocol server       │
│  ├ wire-protocol client      │  docker-run   │   ├ spawna+gerencia `claude`   │
│  ├ spawna mcp/server.js      │  pipe stdio   │   ├ sandbox container-side     │
│  │   (host, SQLite direto)   │               │   └ mcp-bridge (stdio↔wire)    │
│  └ EVENTS_DIR + PERMISSIONS  │               │              ▲                 │
│     _DIR do host             │               │     claude ── MCP stdio ───────┘
│         ▲                    │               └───────────────────────────────┘
│  chokidar watcher (inalterado)│
└──────────────────────────────┘
```

**Princípio:** o runner é um gerente de processo + multiplexador de stdio
"burro". Toda lógica com estado — `mcp/server.ts`, `stream-parser.ts`,
`gate.ts`, o watcher chokidar, o handshake de permissão — fica **inalterada** no
host. O SQLite nunca sai do host. Nada é exposto na rede (um único canal SSH).

### 3.1 Transporte unificado: `docker run` embrulhado por `ssh`

O adapter lança um processo-filho cujo stdin/stdout **é** o canal do wire
protocol:

- **Docker local** (validação): `docker run -i prospero/agent-runner`
- **VPS remota**: `ssh <user>@<host> -- docker run -i prospero/agent-runner`

Mesma imagem, mesmo runner, mesmo protocolo. O transporte difere **só pelo
prefixo `ssh`**. Isso é o que faz a validação local de-riscar o caminho remoto.

### 3.2 Um runner, vários agentes

Um container = um runner = até `MAX_CONCURRENT_AGENTS` (4) processos `claude`.
O host abre **uma** conexão wire (um `docker run`/`ssh`) e multiplexa todos os
agentes remotos por ela, roteando notificações por `agent_id`. Isso casa com o
modelo do wire doc (`health` retorna `active_agents`). O cap de 4 da ToS OAuth
continua valendo, contado no host.

## 4. Mudanças no wire protocol

`docs/m10-adapter-wire-protocol.md` é revisado pelo **PR-A**. Mudanças vs. o
rascunho atual:

1. **Transporte:** `wss` sai do caminho de produção; produção usa **`stdio`
   sobre SSH**. O doc descreve `stdio` como o único transporte (local Docker e
   VPS são ambos "um comando lançado cujo stdio carrega o protocolo").
2. **`stdout` substitui `event`:** o runner encaminha **linhas cruas** de
   stdout do `claude` (`{ "method": "stdout", "params": { agent_id, line } }`).
   O host parseia com o `stream-parser.ts` existente. Mantém o runner burro e
   evita extrair código pra um pacote compartilhado.
3. **`spawn.params.args` é o argv do `claude` montado host-side, menos o
   tripleto MCP:** o host reusa `buildClaudeArgs` (compõe system prompt, model,
   `allowedTools`, `--resume` etc.) mas omite `--mcp-config` /
   `--strict-mcp-config` / `--permission-prompt-tool`. O runner anexa esse
   tripleto com o caminho container-local do `mcp.json`. Reusar `buildClaudeArgs`
   evita duplicar `composeSystemPrompt` no runner (sem acoplamento cross-app).
4. **Novo canal MCP relay** (ver §6): `mcp-data` (notificação bidirecional,
   carrega uma linha de JSON-RPC do MCP), `mcp-open` / `mcp-close`.

`handshake`, `stdin-write`, `kill`, `stderr`, `exit`, `health`, envelope,
versionamento (`protocol_version: 1`) e error codes continuam como no doc.

## 5. Componentes

### 5.1 `apps/agent-runner/` — app novo

App Node autocontido, empacotado na imagem Docker. Roda o wire-protocol server
sobre o próprio stdin/stdout (transport-agnóstico). Responsabilidades:

- **Wire server:** despacha `handshake` / `spawn` / `stdin-write` / `kill` /
  `health`.
- **Gestão de processos `claude`:** spawna até 4 filhos, encaminha stdout cru
  como `stdout`, stderr como `stderr` (redação de tokens antes), `exit` no fim.
- **Sandbox container-side:** monta `CLAUDE_CONFIG_DIR` + `settings.json`
  per-agent + work dir em `/var/lib/agent-state/<agentId>`. Lógica pequena e
  específica do container (paths Linux); o runner tem a própria — sem
  acoplamento cross-app.
- **`mcp-bridge`** (entry separado): o `mcp.json` do `claude` aponta o `command`
  pra cá. Relaya o stdio JSON-RPC do MCP pro runner via um **unix socket
  interno do container** (path passado por env). O runner muxa no canal wire.
- **Credenciais:** OAuth token chega no `handshake`, vira env
  `CLAUDE_CODE_OAUTH_TOKEN` do `claude` (igual ao `claude-api-key-local`: env,
  sem seeding de credencial em disco).
- **Doubles de teste:** `FakeClaude` próprio (espelha o padrão de
  `claude-oauth-local/fake-claude.ts`).

### 5.2 Host: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/`

- **`adapter.ts`** — `ClaudeRemoteDockerAdapter implements AgentAdapter`.
  Instância per-agente (encaixa em `ensureAdapter` / mapa por `agentId`).
  Implementa `start`/`sendInput`/`onEvent`/`onStderr`/`onExit`/`kill`/
  `isAlive`/`getUsage`/`getCurrentAction` traduzindo pra mensagens wire.
- **Connection manager** (singleton) — dono de um processo de transporte + um
  wire client, compartilhado por todos os agentes remotos. Roteia notificações
  por `agent_id`. Rastreia liveness per-agente a partir de `exit` + `health`.
- **`transport.ts`** — monta o comando de lançamento (`docker run -i …` local,
  `ssh … -- docker run -i …` VPS). Função pura, testável.
- **`mcp-relay.ts`** — na primeira mensagem MCP de um agente, spawna o
  **`mcp/server.js` real** como subprocesso do host (env do
  `setupMcpHandshake`: `DB_PATH`, `EVENTS_DIR`/`PERMISSIONS_DIR` do host,
  `AGENT_ID`, `COMPANY_ID`) e liga o stdio dele ↔ canal MCP wire.

### 5.3 Shared

`packages/shared/src/types/wire-protocol.ts` — **só tipos** de mensagem. Zod
fica nos apps (regra dura: zod nunca em `packages/shared` — bundle do preload
sandbox). Host (`apps/main`) e runner (`apps/agent-runner`) validam mensagens
de entrada com zod nos próprios bundles.

### 5.4 Imagem Docker

`infra/docker/agent-runner/Dockerfile` vira real: `node:22`, claude CLI
instalado, usuário não-root, `tini` como PID 1, runner empacotado. `compose.yml`
reescrito pra largar as portas WSS (`9700`/`9701`) — o modelo é stdio, o
container é lançado com stdio anexado, não como serviço com portas.

## 6. MCP relay — detalhe

O ponto-chave que faz a arquitetura fechar.

1. O runner escreve um `mcp.json` container-local com
   `command: <caminho do mcp-bridge>` e anexa o tripleto MCP — `--mcp-config
   <path>` / `--strict-mcp-config` / `--permission-prompt-tool
   mcp__dashboard__request_permission` — ao argv do `claude` recebido em
   `spawn.params.args`.
2. `claude` lança o `mcp-bridge` como filho stdio quando precisa do MCP server
   `dashboard`.
3. O `mcp-bridge` não tem lógica de MCP — só conecta no unix socket do runner
   e relaya linhas JSON-RPC nos dois sentidos.
4. Ao aceitar a conexão do bridge no socket, o runner manda `mcp-open` (com
   `agent_id`) pro host; depois empacota cada linha JSON-RPC como notificação
   `mcp-data`. Quando o bridge desconecta, manda `mcp-close`.
5. No host, `mcp-open` faz o `mcp-relay.ts` spawnar o **`mcp/server.js`
   inalterado** como subprocesso e ligar: `mcp-data` do wire → stdin do
   subprocesso; stdout do subprocesso → `mcp-data` pro runner. `mcp-close` (ou
   o `exit` do agente) mata o subprocesso.
6. O `mcp/server.js` roda no host com acesso SQLite direto. Escreve arquivos de
   evento no `EVENTS_DIR` do host → o chokidar watcher pega, **inalterado**.

**Permissões:** a tool `request_permission` está no host MCP server → escreve
no `PERMISSIONS_DIR` do host, o orchestrator do host decide, grava o arquivo de
decisão, a tool lê. Tudo host-side, **inalterado**. O `claude` do container só
chama a tool MCP pela ponte.

**Defense-in-depth:** o blocklist do `gate.ts` continua rodando host-side (a
checagem acontece no host MCP server). Isolamento Docker + gate de comando no
host — exatamente o que a nota da SECURITY.md do M7.5 §8.3 previu.

## 7. Settings e UX

### 7.1 Sem migração de DB

`agents.adapter_name` já existe (migration 0004) e o union já tem
`claude-oauth-remote-docker`. Config da VPS mora no blob JSON `app-settings`.
**M10 não toca em nenhuma migration** — só estende `AppSettings` +
`DEFAULT_SETTINGS` + `AppSettingsSchema` + `parseSettings` + todos os call
sites de `toEqual({...})`.

### 7.2 Settings — seção "Remote execution" (nova)

- Toggle "habilitar execução remota".
- Modo: `Local Docker` | `Remote VPS`.
- Pra VPS: host, usuário SSH, caminho da chave SSH.
- Botão "Testar conexão" — abre uma conexão wire descartável e manda `health`.

### 7.3 Localização per-agente

- Seletor `Local | Remote (Docker)` na criação do agente (fluxo de hire +
  Agent Studio). Define `adapter_name` pra `claude-oauth-remote-docker`.
- Editável depois no Agent Studio — só faz UPDATE da coluna; o próximo spawn
  pega. Espelha como o M9 PR-D trata o auth mode.

### 7.4 Custos

`cost_events.adapter_name` já rotula por adapter. Verificar que o caminho de
spawn remoto grava `claude-oauth-remote-docker`.

### 7.5 i18n

Todas as strings novas em PT-BR + EN-US, com teste de paridade de chaves.

## 8. Segurança

- **OAuth token:** viaja só no `handshake` (criptografado por SSH; localhost no
  Docker local). Vira env `CLAUDE_CODE_OAUTH_TOKEN` do `claude`. Nunca escrito
  em disco no container, nunca logado (redação de tokens no stderr antes de
  encaminhar).
- **Container:** usuário não-root, sem capabilities extras, `--strict-mcp-config`
  aplicado (o `mcp.json` só tem o bridge).
- **Gate host-side:** `gate.ts` blocklist roda no host MCP server → isolamento
  Docker + gate de comando = defense-in-depth.
- **SSH host key:** verificação fixada (host key pinada; não aceitar cega).
- **Work dir do container:** efêmero; removido no teardown do container.
- **SECURITY.md:** a entrada "future" de `claude-oauth-remote-docker` no
  threat-model do M7.5 é promovida pra real e refinada.

## 9. Testes (TDD por task; helpers puros, sem RTL)

- **Unit:** encode/decode/framing do wire, correlação request↔response, error
  codes, builder do comando de transporte, roteamento do `mcp-relay`.
- **Runner:** lógica de spawn com o double `FakeClaude`.
- **Adapter:** contra um transporte fake em memória.
- **Integração:** host adapter ↔ runner fake in-process sobre um duplex stream
  em memória — troca wire ponta-a-ponta incluindo um round-trip MCP fake.
- **Smoke Docker local (manual):** checklist — buildar imagem → agente real num
  container → pega uma issue → reporta de volta.
- **Não-regressão:** os 831 testes continuam verdes.

## 10. Breakdown de PRs (multi-PR, estilo M9)

| PR | Escopo |
|----|--------|
| **A** | Wire-protocol foundation — tipos shared, encode/decode/framing, primitivas client+server, error codes. Revisa `docs/m10-adapter-wire-protocol.md` (SSH stdio, `stdout` cru, `spawn` semântico, canal MCP relay). Puro, sem mudança de comportamento. |
| **B** | `apps/agent-runner` + imagem Docker real — wire server, gestão de `claude`, sandbox container-side, `mcp-bridge`. Testado com `FakeClaude`. Dockerfile real + `compose.yml` reescrito. |
| **C** | Host adapter + MCP relay — `ClaudeRemoteDockerAdapter`, connection manager, transport launcher, `mcp-relay`. Registrado em `adapters/index.ts`. Testes de integração. |
| **D** | Settings + UX de localização per-agente — seção Settings, seletor no Agent Studio, "Testar conexão", i18n PT/EN, checagem do rótulo de custo. |
| **E** | Docs + smoke + roadmap — SECURITY.md, runbook de setup da VPS, checklist de smoke Docker local, roadmap em 3 lugares. |

## 11. Não incluído conscientemente (YAGNI)

| Item | Por quê |
|---|---|
| **WSS + mutual TLS** | SSH stdio cobre auth/cripto/pipe. WSS some do caminho de produção. |
| **Reconexão de agentes remotos após restart do host** | Se o Electron reinicia, o filho `docker run -i` morre → container sai → `claude` morre. Agentes remotos não sobrevivem a restart do host no v1. Limitação documentada; recovery completo é V2. |
| **Múltiplos hosts VPS** | Um alvo remoto, configurado no Settings. Roadmap pede local-vs-remoto per-agente, não multi-VPS. |
| **Persistir artefatos de arquivo grandes do container no host** | Arquivos vivem no work dir efêmero do container; agentes reportam resultado via tools MCP (issue artifacts/comments), consistente com o modelo de colaboração atual. `record_artifact.preview` segue capado em 4KB. Persistência remota = V2. |
| **`claude-oauth-local-docker`** (container na própria máquina como adapter dedicado) | O Docker local do M10 já é o mesmo caminho; um adapter separado não agrega. |

## 12. Riscos

- **Imagem Docker — instalar a claude CLI no Alpine/Linux.** Mitigação: validar
  o método de instalação no PR-B antes de cabear o resto; fallback `node:22`
  (Debian slim) se o Alpine der dor com a CLI.
- **Multiplexação MCP sobre um único canal wire** — race entre linhas de
  agentes diferentes. Mitigação: toda mensagem carrega `agent_id`; o
  `mcp-relay` mantém um subprocesso por agente; testes de integração cobrem 2
  agentes concorrentes.
- **Estimativa.** ~7-10 dias (maior que os "~4-6 dias" do handoff, que
  precedia a percepção do túnel MCP). 5 PRs absorvem o risco incrementalmente.
- **Smoke da VPS real** depende do usuário provisionar o host; fica fora do
  caminho crítico do M10 (decisão §2).

## 13. Definition of done

- Os 5 PRs (A–E) mergeados em `master`.
- `claude-oauth-remote-docker` registrado e funcional; agente roda num
  container Docker local ponta-a-ponta (pega issue, usa tools MCP, reporta).
- Settings + seletor de localização per-agente funcionando.
- 831+ testes verdes (novos somam; nenhum regride).
- Typecheck + lint limpos.
- SECURITY.md + runbook de VPS + roadmap (3 lugares) atualizados.
- Smoke Docker local executado; smoke VPS real documentado pro usuário rodar.
- **v1 fecha: 14/14 milestones.**
