# Hermes Agent — Memória & Loop de Aprendizagem

> **Status:** documento de pesquisa (2026-05-12). Base para o milestone **M11 — Agent Memory & Learning Loop** (post-v1).
>
> **Fontes:** [hermes-agent](https://github.com/NousResearch/hermes-agent) (NousResearch), [docs site](https://hermes-agent.nousresearch.com/docs/), issues #346 (Structured Memory), #10355 (Living Memory), #22612 (Memory Routing), [memory-providers.md](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory-providers.md), [hermes-agent-claude-code adaptation](https://github.com/paphavitmooc/hermes-agent-claude-code).
>
> **Pergunta original:** "como o Hermes faz cada agente ter memória própria e aprender com o tempo, e como replicamos isso no Prospero?"

---

## TL;DR — o que o Hermes faz, em uma página

O Hermes Agent (Nous Research) é "o único agente com um **closed learning loop** embutido". Ele combina **5 mecanismos** que juntos dão ao agente memória persistente e capacidade de aprender:

1. **Memória declarativa estática** — dois arquivos markdown injetados no system prompt no início de cada sessão (`MEMORY.md` 2200 chars + `USER.md` 1375 chars), com delimitador `§` por entrada. O agente edita via tool `memory {add|replace|remove}`. Snapshot frozen — sem ação "read".
2. **Skills como memória procedural** — `~/.hermes/skills/<skill-name>/SKILL.md` em markdown com YAML frontmatter. Agentes podem criar, atualizar e deletar próprios skills via tool `skill_manage`. Carregamento progressive disclosure: L0 (nome+descrição, ~3k tokens) → L1 (conteúdo completo) → L2 (arquivos referenciados).
3. **Session search FTS5** — todas conversações em SQLite com índice FTS5. Tool `session_search` permite recall keyword em histórico. LLM summariza resultados antes de injetar.
4. **Nudges periódicos** — sistema "cutuca" o agente lembrando de persistir aprendizados quando completa tarefa complexa (5+ tool calls), descobre workflow não-trivial, recupera de erro, ou recebe correção do user.
5. **Memory providers plugáveis** (8 backends externos opcionais) — Honcho (user modeling dialético), Mem0 (extração LLM server-side), Hindsight (knowledge graph), Holographic (SQLite + FTS5 + HRR algebra local), Supermemory, RetainDB, ByteRover, OpenViking. Apenas um ativo de cada vez, sempre lado-a-lado com built-in.

**Loop fechado:**

```
Sessão começa
  ↓
System prompt inclui MEMORY.md + USER.md (frozen snapshot) + skill index L0
  ↓
Agente conversa, usa tools, completa tarefa
  ↓
Sistema detecta: complex task / recovery / correção → emite nudge
  ↓
Agente decide:
   • Atualizar MEMORY.md (memory.add/replace)        ← declarativa
   • Criar/atualizar skill em ~/.hermes/skills/      ← procedural
   • Provider externo recebe sync do turn            ← se ativo
  ↓
Próxima sessão: novo snapshot inclui o aprendizado
```

---

## 1. Memória declarativa — MEMORY.md + USER.md

### 1.1 Estrutura física

Localização: `~/.hermes/profiles/<profile>/memories/MEMORY.md` e `USER.md`.

| Arquivo | Limite | Propósito |
|---|---|---|
| `MEMORY.md` | 2200 chars | Notas do agente sobre ambiente, convenções, lições aprendidas |
| `USER.md` | 1375 chars | Perfil do usuário (preferências, estilo de comunicação) |

Formato de entrada: separadas por `§` (section sign). Cada entrada é uma linha (ou bloco curto) com fato/regra.

Exibição: ao listar (`memory --list` ou similar), mostra usage percentual ("MEMORY.md 84% full").

### 1.2 Ciclo de vida

- **Read:** não existe ação "read" — conteúdo é **automaticamente injetado** no system prompt no início da sessão. Frozen snapshot, não muda no meio da conversa.
- **Write:** tool `memory` com 3 ações:
  - `memory.add(text)` — adiciona entrada nova
  - `memory.replace(old_text, new_text)` — substitui
  - `memory.remove(text)` — remove
- **Consolidation:** quando memória chega perto do limite, sistema avisa agente pra consolidar/mesclar entradas.
- **Validation:** toda escrita passa por scan de prompt injection / exfiltration patterns. Memória vira parte do system prompt → vetor de ataque crítico.

### 1.3 Limitações reconhecidas pela comunidade

A própria issue #346 reconhece limitações da abordagem flat-markdown:

> "The current memory system uses flat text files (MEMORY.md and USER.md) with character limits and delimiter-separated entries, which while functional and simple, **cannot express relationships between memories, distinguish between types of knowledge, decay stale information, or perform semantic search**."

Por isso surgem 3 issues de evolução (§5 desse doc) — graph edges, vector embeddings, indexed routing.

### 1.4 Variante "Indexed Memory Architecture" (issue #22612, em produção)

Já deployed em produção do Hermes com 5 sub-documentos. Substitui o monolito `MEMORY.md` por um índice + sub-arquivos:

```
~/.hermes/profiles/<profile>/
├── memories/MEMORY.md          # Índice (831 chars), totalmente injetado
└── memory/
    ├── infrastructure.md        # Rede, containers, topologia
    ├── philosophy.md            # Preferências, hábitos de trabalho
    ├── milestones.md            # Timeline, eventos-chave
    ├── rules.md                 # Princípios de troubleshooting
    └── commitments.md           # Dados relacionais
```

**Como funciona:**
1. `MEMORY.md` injetado no system prompt contém **tabela de navegação** (tópico → arquivo).
2. Quando agente precisa de detalhe, lê o sub-documento via `read_file`.
3. Resultado: overhead do system prompt cai 37% (2200 → ~831 chars), memória escala ilimitadamente.

**Sintaxe proposta para `[include:]` directives:**
```markdown
# MEMORY.md - Index
| Tópico | Arquivo |
|---|---|
| Infrastructure | [include:memory/infrastructure.md] |
```

`MemoryStore` pode então pre-load com char limit OU registrar pra acesso on-demand.

> **Nota:** esse padrão é praticamente idêntico ao que já usamos no Claude Code via `~/.claude/projects/<dir>/memory/MEMORY.md` + sub-files. Convergência de design.

---

## 2. Skills — memória procedural

### 2.1 Conceito

Skills são "on-demand knowledge documents that agents load when needed". Seguem **progressive disclosure pattern** (3 níveis) e padrão aberto [agentskills.io](https://agentskills.io).

Localização canônica: `~/.hermes/skills/<skill-name>/SKILL.md`. Direção única — mesmo skills instalados de hub ou criados por agente vão pra esse path.

### 2.2 Progressive disclosure (3 níveis)

| Nível | Conteúdo | Tokens |
|---|---|---|
| **L0** | Nome, descrição, categoria de cada skill | ~3k (todos skills do agente) |
| **L1** | SKILL.md completo + metadata | varia (kbytes) |
| **L2** | Arquivos de referência mencionados no SKILL.md | varia |

Agente só carrega L1/L2 quando **realmente precisa** — economiza contexto.

### 2.3 Formato SKILL.md

```yaml
---
name: skill-name
description: O que o skill faz (1 linha — mostra em L0)
version: 1.0.0
platforms: [macos, linux]  # opcional, restringe OS
metadata:
  hermes:
    tags: [category, tags]
    requires_toolsets: [tool_names]
---

# Conteúdo do skill em markdown
...
```

### 2.4 Auto-criação por agente

**Tool `skill_manage`** permite ao agente criar/editar/deletar próprios skills. Critérios típicos de quando criar:

- **Tarefa complexa concluída com sucesso** (5+ tool calls)
- **Workflow não-trivial descoberto** (resolveu problema novo)
- **Recovery de erro** — encontrou solução para algo que falhou
- **Correção do user** — usuário corrigiu approach, agente extrai regra

Esse é o **coração do "self-improving"**: o agente cristaliza experiência em skill reutilizável que serve sessões futuras.

### 2.5 Diretórios externos + hub

```yaml
# ~/.hermes/config.yaml
skills:
  external_dirs:
    - ~/.agents/skills
    - /home/shared/team-skills
```

External directories são **read-only** — modificações sempre escrevem em `~/.hermes/skills/` local.

**Hub integrations:**
- Official optional skills (repo Hermes, builtin trust)
- skills.sh (Vercel public directory)
- `/.well-known/skills/index.json` endpoints
- GitHub repos
- ClawHub, LobeHub, marketplaces tipo Claude

**Trust levels:**
- `builtin` (ships com Hermes) → sempre confiável
- `official` (repo optional-skills) → builtin trust
- `trusted` (OpenAI/Anthropic registries)
- `community` → tudo o resto, requer `--force` para findings não-críticos

Todo skill de hub passa por security scan (exfiltration, prompt injection, destructive commands).

### 2.6 Invocação

Slash commands no chat:
```
/gif-search funny cats
/plan design a rollout for auth migration
/excalidraw
```

Ou natural: `"What skills do you have?"` → agente lista L0.

---

## 3. Session search — FTS5 sobre histórico

Todas mensagens persistidas em SQLite. Tool `session_search` faz keyword search via FTS5. Quando agente quer relembrar conversa anterior sem gastar slot da MEMORY.md, busca aqui.

**LLM summarization step:** resultados raw passam por LLM summarizer antes de virar contexto — evita injetar megabytes de transcript.

---

## 4. Nudges — o gatilho do loop

O termo "nudge" aparece como "agent-curated memory with **periodic nudges**" e "**nudges itself to persist knowledge**". Mecanismo:

- **Triggers detectados pelo sistema:**
  - Conclusão de tarefa marcada como "complex"
  - Recovery após erro (agente encontrou caminho que funcionou)
  - User correction (agente errou, user redirecionou)
  - Discovery (agente fez algo não-trivial pela primeira vez)
  - **Compaction event** — quando contexto é comprimido, oportunidade de extrair

- **System message ao agente:** "Você acabou de completar X. Vale persistir algum aprendizado? (memory / skill)"

- **Periódico:** se a sessão é longa e nenhum nudge disparou, sistema injeta nudge time-based.

> **Compaction integration (issue #346):** "When the Compactor summarizes old context, it doesn't just create a text summary — it also calls `memory_save` to extract and persist facts, decisions, and preferences as typed memory nodes." — mesmo passo que oportuniza skill creation.

---

## 5. Evolução proposta — 3 issues abertos

A comunidade já mapeou 3 direções de evolução além do flat-markdown.

### 5.1 Structured Memory System — typed nodes + graph edges (issue #346)

Propõe upgrade pra estrutura tipada com grafo:

**8 Memory Node Types** (default importance score):

| Tipo | Importância | Propósito |
|---|---|---|
| Identity | 1.0 | Fatos centrais do agente ou user |
| Goal | 0.9 | Objetivos ativos |
| Decision | 0.8 | Escolhas + rationale |
| Todo | 0.8 | Action items |
| Preference | 0.7 | Likes/dislikes/style |
| Fact | 0.6 | Conhecimento geral |
| Event | 0.4 | Coisas que aconteceram |
| Observation | 0.3 | Padrões/inferências |

**6 Graph Edge Types** (search multiplier):

| Relation | Multiplier | Propósito |
|---|---|---|
| Updates | 1.5x | Supersedes outra memória |
| CausedBy | 1.3x | Relação causal |
| ResultOf | 1.3x | Outcome de outra |
| RelatedTo | 1.0x | Associação geral |
| PartOf | 0.8x | Componente |
| Contradicts | 0.5x | Conflito |

**Schema SQLite:**
- `memories` — entries tipadas com importance, timestamps, access tracking, soft-delete
- `associations` — edges entre memories com relation type + peso

**Hybrid Search (Reciprocal Rank Fusion, k=60):** 3 sinais merged:
1. **Full-text** — LanceDB FTS, keyword
2. **Vector similarity** — all-MiniLM-L6-v2 (384-dim), HNSW, cosine
3. **Graph traversal** — BFS de seeds high-importance (>0.8) que matcham query, seguindo edges com multipliers

**Memory maintenance:**
- **Decay:** `importance *= age_decay * access_boost`. Identity é exempt.
- **Pruning:** delete < 0.1 importance após 30 dias staleness.
- **Auto edge-building:** similarity check periódico cria `RelatedTo` em 0.85, `Updates` em 0.95.

**Memory Bulletin (Cortex):** geração **horária** que sintetiza memórias em 8 seções → briefing conciso (max 1500 words) → injetado em todo system prompt da sessão. É o "active recall" do agente.

**Implementação faseada:**
1. Typed + importance em SQLite
2. Graph edges + relationship-aware search
3. Vector search + hybrid retrieval
4. Memory bulletin + compaction integration

### 5.2 Living Memory — vector embeddings + metacognition (issue #10355)

Propõe transformar "passive logging into an active, living memory system with semantic search, emotional salience weighting, and self-model evolution".

**3 conceitos novos:**

- **Metacognition** — sistema rastreia qualidade do próprio raciocínio (accuracy, efficiency, blind spots). Examina padrões de decisão, não só outcomes.
- **Identity evolution** — personalidade/preferências cumulativas, estilos de comunicação contextualmente apropriados. "Sense of self" coerente que adapta com history.
- **Vector embedding** — Zhipu AI embedding-3 (2048-dim) com batch. Tabela `message_vectors` paralela aos messages.

**Implementação faseada:**

**Phase 1 — Vector infrastructure:**
- Embedding client com fallback
- RRF hybrid search (BM25 + cosine)
- Target < 100ms latency

**Phase 2 — Active memory behavior:**
- **Learning Engine** — extrai padrões de estratégia indexados por tipo de problema
- **Memory Temperature** — peso dinâmico de importância baseado em failure salience + frequência
- **Dream Consolidator** — processa memórias offline, integra fragmentos, resolve contradições

**Phase 3 — Self-model:**
- Quality metrics por sessão (reasoning accuracy)
- Behavioral memory (por que estratégias funcionaram/falharam)
- Communication style adaptativo

Princípios: opt-in, backward-compatible migrations, async non-blocking, **human-auditable** (every memory decision can be inspected).

### 5.3 Indexed Memory Routing (issue #22612)

Já coberto em §1.4. Em produção no Hermes oficial.

---

## 6. Memory providers — 8 backends plugáveis

Quando ativo, qualquer provider externo automaticamente:

1. Injeta contexto provider-specific no system prompt
2. **Prefetch** de memórias relevantes antes de cada turn (background, non-blocking)
3. **Sync** de turns ao provider após cada response
4. **Extrai** memórias on session end (providers que suportam)
5. Espelha writes built-in pro external
6. Adiciona tools provider-specific

Comparação dos 8:

| Provider | Storage | Custo | Tools | Deps | Feature única |
|---|---|---|---|---|---|
| **Honcho** | Cloud | Pago | 5 | honcho-ai | Dialectic user modeling + session context |
| **OpenViking** | Self-hosted | Free | 5 | openviking + server | Filesystem hierarchy + tiered loading |
| **Mem0** | Cloud | Pago | 3 | mem0ai | Server-side LLM extraction |
| **Hindsight** | Cloud/Local | Free/Pago | 3 | hindsight-client | Knowledge graph + reflect synthesis |
| **Holographic** | **Local** | **Free** | 2 | **Nenhuma** | **HRR algebra + trust scoring** |
| **RetainDB** | Cloud | $20/mês | 5 | requests | Delta compression |
| **ByteRover** | Local/Cloud | Free/Pago | 3 | brv CLI | Pre-compression extraction |
| **Supermemory** | Cloud | Pago | 4 | supermemory | Context fencing + session graph |

### 6.1 Honcho — dialectic user modeling

Conceitualmente o mais sofisticado para nosso caso (single-user, multi-agent):

- **Workspace** = ambiente compartilhado (= nossa company)
- **User peer** = humano (global cross-profiles)
- **AI peer** = um por profile (= por agente nosso)
- **Observation modes:**
  - `directional` (default) — todos 4 flags on, mutual full observation
  - `unified` — single-observer pool, AI modela user mas não a si

**Two-layer context injection:**
- **Base layer** (session summary + representation + peer card) → refresh por `contextCadence` turns
- **Dialectic supplement** (LLM reasoning sobre query atual) → refresh por `dialecticCadence` turns

**5 tools:** `honcho_profile`, `honcho_search`, `honcho_context`, `honcho_reasoning`, `honcho_conclude`.

**Configuração crítica:**
- `dialecticReasoningLevel: low|medium|high|max` (custo direto)
- `recallMode: hybrid|context|tools`
- `writeFrequency: async|turn|session|N`
- `sessionStrategy: per-directory|per-repo|per-session|global`

### 6.2 Holographic — SQLite + FTS5 + HRR (mais relevante pra nós)

**Único provider 100% local, zero dependencies além do SQLite built-in.**

- DB path: `$HERMES_HOME/memory_store.db`
- Tool `fact_store` com **9 actions:** add, search, probe, related, reason, contradict, update, remove, list
- Tool `fact_feedback` (helpful/unhelpful → trust score training)

**Features únicas:**
- **probe** — entity-specific algebraic recall (qual fato sobre X?)
- **reason** — compositional AND queries cross-entity (X AND Y?)
- **contradict** — detecção automática de conflitos
- **Trust scoring assimétrico:** +0.05 helpful / -0.10 unhelpful

**HRR (Holographic Reduced Representations)** — opcional via NumPy, permite queries algébricas compositivas estilo `role:engineer ⊗ project:backend → recall`.

### 6.3 Profile isolation

- **Local** (Holographic, ByteRover) — paths `$HERMES_HOME/<profile>/`
- **Config-file** (Honcho, Mem0, Hindsight, Supermemory) — config separado por profile
- **Cloud** (RetainDB) — project name auto-derived
- **Env-var** (OpenViking) — `.env` por profile

---

## 7. Tradução pro Prospero — proposta arquitetural

### 7.1 O que copiar direto

| Hermes | Prospero | Justificativa |
|---|---|---|
| `~/.hermes/profiles/<profile>/memories/MEMORY.md` | `~/.prospero/agents/<agent_id>/memory/MEMORY.md` | Cada agente é um "profile" (CEO ≠ Backend Eng) |
| Tool `memory {add/replace/remove}` | MCP tool `agent_memory` mesma assinatura | Padrão consolidado |
| Indexed memory architecture (#22612) | **Default desde dia 1** — não monolito | Já sabemos limitação; pula uma migration |
| Session search FTS5 | FTS5 sobre `messages` (já temos a tabela) | Schema mínimo — add FTS5 virtual table |
| Skills auto-criados como markdown | `~/.prospero/agents/<id>/skills/<name>/SKILL.md` | Convergência com agentskills.io |
| Progressive disclosure L0/L1/L2 | Mesmo padrão; L0 entra no system prompt, L1+L2 via `read_skill` tool | Economia de tokens crítica (memory `feedback_token_efficiency`) |
| Nudges em compaction + complex-task triggers | Hook no nosso `turn-complete` quando `tool_use_count > 5` ou status pós-erro | Reusa stream existente |
| Trust scoring assimétrico (+0.05 / −0.10) | User pode marcar entrada de memória "helpful/wrong" | Calibração barata |

### 7.2 O que adaptar (não copiar idêntico)

| Hermes | Adaptação | Razão |
|---|---|---|
| Vector embeddings (Zhipu, OpenAI etc.) | **PULAR no v1.1** | Custa $ extra (não coberto por OAuth Max), embedding model local seria 100+ MB no install. Postergar pra v1.2. |
| 8 memory providers | **Só built-in local** | Single-user, offline-first, sem cloud (`project_prospero`). Holographic é referência. |
| Honcho dialectic | **Capturar a ideia (peer-card + session-summary)** mas inline em SQLite | Sem dependência externa. Schema próprio. |
| Memory bulletin horário (#346) | **Trigger em open-session** + manual `agent_memory.bulletin` | Geração horária em desktop offline-first é wasteful |
| Graph edges genéricos | **Subset:** só `Updates`, `Contradicts`, `RelatedTo` v1 | YAGNI; 6 edges é over-engineering pro nosso escopo |
| Importance decay | **Implementar** mas com TTL conservador (90 dias) | Permite memória limpar sozinha sem perder identity |
| Hub de skills externos | **Pular v1.1** | Skills criados por agente + bundled seedados bastam. Hub vira v2+. |

### 7.3 O que NÃO copiar

| Hermes feature | Por que pular |
|---|---|
| Cloud providers (Honcho, Mem0 cloud, RetainDB, Supermemory) | Cloud é proibido (`project_prospero`: local-only, offline-first) |
| Skill hub download remoto | Threat model (memory `feedback_security_priority`: sem download/exec de código remoto) — mesma razão que pulamos Paperclip skill source sync |
| Identity evolution / self-model (#10355 Phase 3) | Filosoficamente interessante mas escopo muito grande pra um milestone. Considerar v2+. |
| Dream consolidator offline | Sem worker background (Electron); poderia rodar em idle mas complica muito |
| `--print` style sub-agentes do Hermes | Já temos nosso adapter pattern + 4 agentes paralelos limite |

### 7.4 Decisões arquiteturais críticas

**D1 — Per-agent vs. shared memory?**
- **Decisão:** per-agent + shared "company memory" + `USER.md` global.
- Razão: CEO precisa saber coisas diferentes de Backend Eng. Mas regra de compliance, paths bloqueados, segurança = compartilhado.
- Implementação: 3 níveis injetados no system prompt — USER.md global (~/.prospero/user.md) → company memory (`companies/<id>/memory.md`) → agent memory.

**D2 — SQLite ou markdown files?**
- **Decisão:** híbrido. Markdown para conteúdo (humano edita); SQLite para metadata (importance, trust, edges, FTS5 índices).
- Schema:
  ```sql
  CREATE TABLE memories (
    id, agent_id (NULL = company-wide), kind ENUM, body TEXT, source_file TEXT,
    importance REAL, trust REAL, created_at, last_accessed, access_count,
    soft_deleted INTEGER, embedding BLOB NULL  -- futuro v1.2
  );
  CREATE TABLE memory_edges (
    src_id, dst_id, relation ENUM (Updates|Contradicts|RelatedTo), weight REAL
  );
  CREATE VIRTUAL TABLE memories_fts USING fts5(body, content=memories);
  ```

**D3 — Security: memory como vetor de prompt injection.**
- Toda escrita passa por sanitizer: detecta padrões de injection (instruções tipo "ignore previous", URLs com curl exfil, paths sensíveis).
- Mesma blocklist do `gate.ts §8.3` aplica em memory body — defense-in-depth.
- User pode editar manual via UI Settings; agente escreve via MCP tool com rate limit (max 5 entries/turn).

**D4 — Token budget.**
- Hard cap: 4 KB total injetado no system prompt por agente (MEMORY.md 2 KB + USER.md 1 KB + company 1 KB).
- Skills L0: hard cap 3 KB (~30 skills × 100 chars).
- Excede? Sistema avisa agente pra consolidar (igual Hermes); UI mostra usage bar.
- Memory `feedback_token_efficiency` exige métrica: token overhead novo ≤ 5% do baseline.

**D5 — UI surface.**
- Rota `/agents/:id` ganha tab **"Memory"** (4ª tab além de Config/Issues/Stats):
  - Sub-tabs: `MEMORY.md` (markdown editor) · `Skills` (lista L0 + click expand) · `History` (FTS5 search box sobre messages)
- Rota `/settings` ganha seção "USER.md global" (markdown editor).
- Activity events novos: `memory.added`, `memory.replaced`, `memory.removed`, `skill.created`, `skill.updated`.

**D6 — MCP tools novos (6):**
- `memory_read(agent_id?, kind?)` — lista entries (não confiamos no "no read" do Hermes; pra debugging vale)
- `memory_add(body, kind, importance?)` — adiciona
- `memory_replace(id, new_body)` — substitui
- `memory_remove(id)` — soft-delete
- `memory_search(query, limit?, agent_id?)` — FTS5 search
- `skill_manage(action, name, body?)` — CRUD de skill

**D7 — Backward compat com memory `MEMORY.md` do Claude Code.**
- Nossa memória local (`C:\Users\hever\.claude\projects\.../memory/`) é coisa **do Claude Code** (este harness), não do app Prospero. Sistemas separados — não tentar unificar.
- Mas: importar via "Settings → Import Claude Code memory as USER.md global" seria UX win opcional.

---

## 8. Comparação com o que já temos

| Capability | Hoje (Prospero v1) | Hermes | Gap |
|---|---|---|---|
| Persona estática | ✅ `agents.system_prompt` em SQLite, editável UI | ✅ via persona/personality | Paridade |
| System prompt composable | ✅ M7.5 PR-A (`composeSystemPrompt`) | ✅ | Paridade |
| Skills declarativos | ✅ M7 — `skills_json` + tools whitelist | ✅ | Paridade básica; falta L1/L2 progressive |
| Cross-session memory | ❌ Nada além do persona | ✅ MEMORY.md/USER.md | **Gap total** |
| Procedural memory (skills auto-criados) | ❌ Skills só pre-seedados, agente não cria | ✅ skill_manage tool | **Gap total** |
| Session search histórico | 🟡 Existe `messages` table, sem FTS5 | ✅ session_search FTS5 | **Gap parcial** — FTS5 falta |
| Nudges pós-tarefa | ❌ | ✅ | **Gap total** |
| Vector / semantic search | ❌ | ✅ providers tem | Postergar pra v1.2 |
| Trust scoring | ❌ | ✅ Holographic | Gap; trivial de adicionar |
| Importance decay | ❌ | ✅ proposed #346 | Gap; opcional v1.2 |
| Graph edges | ❌ | ✅ proposed #346 | Gap parcial; subset v1.1 |

**Resumo:** temos a infra (SQLite, IPC, MCP tools, system prompt composable, activity stream). Falta o **conceito** de memória cross-sessão e o **loop** que cristaliza aprendizado.

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| **Prompt injection via memória.** Agente compromise escreve "ignore previous" no MEMORY.md → contamina todas sessões futuras. | (a) Sanitizer no write (regex + blocklist `gate.ts`). (b) Memory writes só em supervised mode V1; auto mode pede approval. (c) User pode pinar/freezar entradas (read-only flag). |
| **Token bloat.** Memória cresce sem controle → custo +50%. | Hard caps (D4). Consolidation prompt automático. Métrica não-regressão. |
| **Agente "esquece" coisa importante.** Consolidation merge errada → user perde info. | Soft-delete + undo 30 dias. Activity event `memory.removed` mostra preview do removido. |
| **Memória vira lixão.** User não revisa, agente acumula entries irrelevantes. | TTL 90 dias com decay. UI mostra "stale" badge. Botão "review old entries". |
| **Skills mal-feitos pelo agente.** Procedural memory ruim faz agente piorar. | `fact_feedback` thumbs-up/down. Trust score asymétrico (igual Hermes). Skills com trust < 0.2 desabilitam auto-load. |
| **Conflito entre memórias.** Identidade contraditória ao longo de meses. | Edge `Contradicts` flagga; UI mostra "conflict" badge; agente é prompted a resolver na próxima sessão. |
| **Performance.** FTS5 lento com 100k+ messages. | Index correto + LIMIT 50 default + paginated. SQLite FTS5 lida com milhões de docs. |
| **Backup/portability.** Memória vira ativo crítico — perde tudo se DB corromper. | Backup automático diário (já listado no v2+); export/import por agent. |

---

## 11. As 3 inflexões deliberadas vs Hermes

> **Status:** decisão adicionada 2026-05-12 (turn 2 da pesquisa). Refinamento sobre §7 — aproveita vantagens estruturais do nosso codebase que o Hermes não tem.

O design da §7 deste doc era "Hermes-like adaptado pra Electron". Repesando: temos 3 vantagens estruturais que justificam **desviar deliberadamente** do padrão Hermes, não só adaptá-lo. A versão atual do M11 no ROADMAP.md reflete essas inflexões.

### Inflexão 1 — Skills > MEMORY.md (inverter a ênfase)

**Hermes:** equilibra declarativa (MEMORY.md/USER.md 2200+1375 chars) e procedural (skills). Skills L0 entra no system prompt junto com tudo, ~3 KB. Trata os dois como peers.

**Nosso desvio:** **skills entrega 80% do valor, declarativa entrega 20%.** Justificativa:

- "User prefere tabs sobre spaces" é declarativa. **Já cobrimos isso via CLAUDE.md / persona** — não precisa estar em MEMORY.md também. Duplicação que ocupa system prompt.
- "Como migrar schema X em 12 passos validados sem quebrar Y" é skill. **Valor 4× maior** porque captura procedimento testado, não preferência. E carrega apenas quando precisa (progressive disclosure L0/L1) — não polui contexto.

**Implementação do desvio:**
- Skills L0 budget sobe pra ~4 KB (~40 skills × 100 chars de descrição)
- MEMORY.md cai pra ~1 KB (só identity + rules duras; tudo o resto vira skill)
- 5 MCP tools de skill (search/read/create/update/promote) vs 4 tools de memory
- Rate limit declarative writes mais agressivo (3/turn) que skill writes (5/turn) — desestimular ativamente
- UI tab "Learning" coloca Skills antes de Memory na ordem das sub-tabs

**Trade-off:** se feedback do usuário disser "queria persistir mais notas curtas", relaxar cap MEMORY.md em PR follow-up. Mas começamos restritivos — easier afrouxar que apertar.

### Inflexão 2 — Activity-stream-derived memory, não auto-narrada

**Hermes:** o agente decide quando lembrar. Nudge dispara, agente avalia e chama `memory.add` se quiser. **Problema:** dois vieses sistemáticos:

1. **Self-narration bias** — agente narra o que ele acha que aprendeu, não o que objetivamente fez. Pode glorificar acertos, esconder erros.
2. **Bloat bias** — agente em dúvida tende a salvar (custa nada pra ele, custa tokens pro user). Memória vira lixão de notas pouco discriminativas.

**Nossa vantagem estrutural:** já temos **3 sinais objetivos** que o Hermes não tem:
- `activity_events` (M7.7) — todo evento estruturado: quem fez o quê, quando, em que entity
- `issue_artifacts` (M7.5) — outputs concretos por issue (commits, files, PRs)
- `cost_events` (M8) — quanto custou cada turn (proxy de "valeu a pena")

**Implementação do desvio:** derivation pipeline em vez de auto-narração:

```
activity_events writer
  ↓
  detect: action ∈ {issue.done, agent.recovery, goal.achieved, user.correction}
  ↓
  enqueue derivation job (async, throttled, cost-budgeted)
  ↓
  dedicated derivation prompt (Sonnet) lê:
    - trail do issue (comments + tool history + artifacts)
    - ou últimos 5 turns antes do recovery
    - ou snapshot do Goal completo
  ↓
  produz skill_candidate (ou descarta com motivo)
  ↓
  inbox kind `skill.candidate_pending` — user revisa
  ↓
  Accept → row em skills + activity event + system prompt
  Edit → user refina antes de aceitar
  Reject → registra motivo (treina derivation futura)
```

**Defense-in-depth crítico:** derivation pipeline gera body via LLM → **passa pelo MESMO sanitizer** que writes manuais. Não confiar.

**Cost budget:** derivations contam contra orçamento diário (M8 enforcement). Hard cap default 3/dia/agente. User pode aumentar via Settings se quiser ser mais agressivo.

**Nudge manual vira fallback:** se `tool_use_count > 5` E nenhuma derivation foi enfileirada nesse issue → emit nudge. Cobre buracos (ex: agente fez 10 tool calls mas issue ainda não foi marcado done).

**Por que isso é melhor que Hermes:**
- Sinal/ruído maior — trilha objetiva vs narrativa
- Less bloat — só dispara em eventos discretos, não em "qualquer turn longo"
- Auditável — cada candidate aponta pro `source_event_id`, dá pra ver o que originou
- Aprende com o reject — UI captura motivo, pipeline melhora

### Inflexão 3 — Company-wide memory + role-based inheritance desde dia 1

**Hermes:** single-agent fundamentalmente. Cada profile (= agente) tem seus arquivos. Cross-profile sharing é feature externa (Honcho workspace, OpenViking shared knowledge base).

**Nossa vantagem estrutural:** já temos **multi-agent + org chart + role templates**. CEO supervisiona engenheiros; engenheiros têm role estável; quando demite um e contrata outro pro mesmo role, **a empresa devia herdar o que aprendeu**.

A wishlist marca isso como "Automatic Organizational Learning" v3+. Aqui entregamos **versão mínima já no M11** porque a infra existe.

**Implementação:**

- **Memories e skills com 3 escopos:**
  - `agent_id IS NOT NULL` → privado do agente
  - `agent_id IS NULL AND applies_to_role IS NOT NULL` → company-shared, herdado por role
  - `agent_id IS NULL AND applies_to_role IS NULL` → company-shared global
- **Inheritance no `hire_agent`:** quando spawn novo engineer, query carrega skills + memories com `(agent_id=NULL AND applies_to_role IN (NULL, 'engineer'))` no system prompt.
- **Promotion flow:** skill privado vira company-shared via tool `skill_promote` → inbox `skill.promotion_requested` → user aprova com modal mostrando body + escolha de `applies_to_role`.
- **Terminate flow (M7.6 hook):** quando user clica Terminate, modal "Promover skills privados antes?" mostra lista com checkboxes. Itens não-promovidos vão pra cascade soft-delete com TTL 30 dias.
- **Goal retrospectives (M8.5 hook):** quando `goal.achieved`, CEO recebe trigger especial pra escrever post-mortem → vira memory `kind='retrospective'`, scope company-wide. Captura: "plano estimou X, gastou Y, lição Z". Próximo Goal o CEO já lê retrospectivas anteriores no system prompt.

**UI surface "Org Learnings"** (M9 dependency): card no `/dashboard` mostra:
- Últimas 5 retrospectivas (link pra Goal original)
- Top 10 skills compartilhadas por usage count
- Sinal claro de que a empresa "aprende além do indivíduo"

**Por que isso é o diferencial principal:**

Sem inflexão 3, M11 é "Hermes em Electron". **Com** inflexão 3, é "uma empresa AI que aprende organizacionalmente". Hermes não pode entregar isso (single-agent). Paperclip não pode (não tem nudges/derivation). É território próprio.

### Impacto agregado das 3 inflexões

| Métrica | Design original (§7) | Design refinado (§11) |
|---|---|---|
| Foco principal | Per-agent MEMORY.md indexed | Skills auto-derivados + org memory |
| Fonte primária de write | Agente auto-narra | Activity stream deriva, user revisa |
| Escopo de aprendizado | Individual | Individual + organizacional |
| MCP tools | 6 (memory-heavy) | 10 (skills-first + memory fallback + session) |
| Hard cap system prompt extra | 4 KB | 7.5 KB (skills 4 + memory 3.5) |
| Schema adicional | `memories`, `memory_edges`, `memories_fts`, `memory_skills` | `skills`, `memories`, `memories_fts`, `messages_fts`, **`skill_candidates`** |
| Custos estimados | 8-12 dias | 10-14 dias (vale o gasto) |
| Diferencial vs Hermes | Marginal (adaptação) | Estrutural (org learning) |

A complexidade adicional é localizada na derivation pipeline e no role-inheritance resolver — dois componentes auto-contidos, testáveis isoladamente. Não polui o resto do sistema.

---

## 12. Referências canônicas

- [Hermes Agent repo](https://github.com/NousResearch/hermes-agent)
- [Memory Providers docs](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory-providers.md)
- [Issue #346 — Structured Memory System](https://github.com/NousResearch/hermes-agent/issues/346) (typed nodes + graph)
- [Issue #10355 — Living Memory](https://github.com/NousResearch/hermes-agent/issues/10355) (vector + metacognition)
- [Issue #22612 — Indexed Memory Architecture](https://github.com/NousResearch/hermes-agent/issues/22612) (em produção)
- [Honcho dialectic user modeling](https://github.com/plastic-labs/honcho)
- [agentskills.io open standard](https://agentskills.io)
- [hermes-agent-claude-code adaptation patterns](https://github.com/paphavitmooc/hermes-agent-claude-code)
