# M12 — Agent & Org Definition Layer

> **Status:** documento de design (2026-05-15). Base para o milestone **M12**, a ser executado **depois do M11**.
>
> **Fontes:** brainstorm 2026-05-15 · investigação do código do Paperclip (`D:/tmp/paperclip`, canary `v2026.511.0`) · [docs/paperclip-comparison.md](paperclip-comparison.md) §14 · [docs/hermes-memory-learning-system.md](hermes-memory-learning-system.md) · código atual do Prospero (M1–M10).
>
> **Pergunta original:** "por que os nossos agentes parecem mais burros e menos configuráveis que os do Paperclip, e como transformamos isso numa máquina de criar 1-person business de qualquer ramo?"

---

## TL;DR

O Prospero construiu, em 14 milestones, uma **máquina de orquestração excelente** — mas os agentes dirigem ela com um **manual de um parágrafo**. Os `role_templates` shipam com prompts de 1-2 frases; a única instrução editável por agente é uma textarea. O agente tem as *ferramentas* (MCP tools) mas não tem o *playbook*: nada diz **quando**, **como** e **com que padrão** usar cada uma.

O **M11** resolve a inteligência **aprendida** (memória, skills auto-derivadas, loop). O **M12** resolve a inteligência **autorada**: o agente já nasce esperto e o usuário consegue moldá-lo a fundo — para **qualquer ramo de negócio**, não só software house.

M12 entrega **4 peças**:

1. **Autoria de papéis & organização** — charters estruturados, biblioteca de papéis editável, geração assistida, e um CEO que projeta a empresa inteira a partir de uma descrição.
2. **Procedimento operacional** — o manual "como esta empresa opera", amarrando cada ação a uma tool concreta.
3. **Instruções como dado** — bundle multi-arquivo editável por agente, com aba dedicada.
4. **Runs · Budget · Run Policy** — histórico de execução, teto de tokens/USD por agente, e consolidação de permissões.

**Custo estimado:** ~18-24 dias (~6 PRs). **Pré-requisito:** M11 (a Peça 2 roda sobre a infra de skills do M11).

---

## 1. O problema — por que os agentes parecem "burros"

São **três causas**, e a intuição do usuário está correta — não é impressão.

**Causa 1 — Não copiamos o modelo de execução heartbeat.** A checklist de 50+ linhas do Paperclip (`HEARTBEAT.md`) existe *porque* o agente deles é stateless entre execuções: a checklist **é** o programa. O Prospero usa sessão persistente, chat-first — o agente nunca "acorda frio", então nunca precisou de um runbook de wake-up. Decisão consciente ([paperclip-comparison.md §5](paperclip-comparison.md)).

**Causa 2 — Instruções vivem no código, não como dado.** No Paperclip a instrução é um arquivo que o usuário possui e edita. No Prospero o system prompt é montado em `composeSystemPrompt` a partir de um `preamble.md` (encanamento de ambiente) + `role_templates.default_system_prompt` (1-2 frases) + `agent.system_prompt` (textarea de 6 linhas). O único pedaço editável e específico do papel tem ~1-5 frases.

**Causa 3 — O ponto cego de planejamento.** Os 14 milestones do v1 construíram a *máquina* (orquestração, MCP, segurança, issues, costs, goals, multi-empresa, adapters — 973 testes). **Nenhum milestone teve como alvo a qualidade da instrução do agente.** Os `role_templates` entraram com prompts placeholder no M7 e nunca foram revisitados.

### 1.1 O que faz um agente do Paperclip parecer "completo"

> Correção de uma premissa comum: o bundle de 4 arquivos (AGENTS/SOUL/HEARTBEAT/TOOLS) é **exclusivo do CEO**. Todo agente IC do Paperclip roda com **um `AGENTS.md`** (~50-150 linhas) **+ uma skill compartilhada `paperclip` de 366 linhas** que é o procedimento operacional de verdade. O padrão real é **arquivo de papel enxuto + skill operacional gorda e compartilhada**.

A "inteligência completa" deles é um *sistema* de 6 peças:

| # | Peça | Dono no Prospero |
|---|---|---|
| 1 | Charter do papel (identidade + missão + workflow + padrão de qualidade) | ❌ **M12** |
| 2 | Skill de procedimento operacional (cada ação ligada a uma tool) | ❌ **M12** |
| 3 | Instruções como dado editável (multi-arquivo) | ❌ **M12** |
| 4 | Superfície de configuração (Runs, Budget por agente, Run Policy) | 🟡 **M12** |
| 5 | Skills como conteúdo + memória + loop de aprendizado | ✅ **M11** |
| 6 | Loop operacional (acordar por schedule/evento) | ✅ **Routines** (V2 Tier 1) |

O M12 é dono das peças **1–4**.

---

## 2. A fronteira M11 ↔ M12

- **M11 = inteligência *aprendida*.** O agente fica mais esperto **ao longo do tempo** (memória declarativa/procedural/episódica, skills auto-derivadas, derivation pipeline).
- **M12 = inteligência *autorada*.** O agente já nasce esperto **no dia 1** e o usuário consegue **moldá-lo a fundo**.

**Dependência técnica (por isso M12 vem depois):** a Peça 2 (skill de procedimento operacional) é entregue **como uma skill bundled** sobre a infra de skills do M11 (formato `SKILL.md`, progressive disclosure L0/L1/L2, role-based inheritance). M12 *consome* o investimento do M11 — não é trabalho paralelo.

**Sinergia com M11:** um papel que o usuário criou no M12 vira entidade de primeira classe que acumula memória e skills role-scoped via o `applies_to_role` do M11 (inflexão 3). Contrata-se outro agente para o mesmo papel customizado → ele já chega sabendo o que a empresa aprendeu.

**Separação de segurança:** as instruções do M12 são **autoradas por humano**. O que o agente aprende sozinho continua indo pelos canais de memória/skill do M11 (que têm sanitizer + review humano). Não misturar os dois evita que o agente reescreva o próprio charter — vetor de prompt injection.

---

## 3. Escopo do M12 — visão geral

```
System prompt do agente, montado em camadas:

[ Contrato operacional core ]  Peça 2a — conciso, sempre injetado (preamble evoluído)
  + [ Charter do papel ]        Peça 1 — quem ele é, missão, padrão de qualidade
  + [ Instruções do agente ]    Peça 3 — arquivos editáveis (charter + extras)
  + [ Memórias M11 ]            (USER.md / company / agente)
  + [ Skills L0 ]               inclui o Manual Operacional (Peça 2b) — sob demanda
```

As 4 peças, detalhadas nas seções 4–7.

---

## 4. Peça 1 — Autoria de papéis & organização

O erro do desenho inicial: assumir 5 papéis fixos de software house (CEO, Engenheiro, QA, Designer, PM). Para uma **agência de tráfego**, uma **firma de pesquisa** ou um **estúdio de conteúdo**, isso não serve — e shippar mais templates não resolve, porque é impossível prever todo ramo. A correção: a Peça 1 não é um **catálogo fixo** — é um **sistema de autoria**.

### 4.1 Estrutura universal de charter (8 seções)

Todo charter — de "Engenheiro" ou de "Gestor de Tráfego" — segue o mesmo esqueleto de 8 seções. É isso que torna a geração viável: **esqueleto fixo, conteúdo variável**.

1. **Identidade** — quem o agente é, em um parágrafo.
2. **Missão & escopo** — o que ele possui; explicitamente o que ele **não** faz.
3. **Workflow operacional** — como ele faz o trabalho no dia a dia, passo a passo.
4. **Lentes do domínio** — checklist/heurísticas específicas do ofício (ex.: um gestor de tráfego sempre olha CPA, CTR, sobreposição de público).
5. **Padrão de qualidade ("output bar")** — o que "bom" significa; a régua antes de declarar feito.
6. **Colaboração & handoffs** — com quem trabalha, como roteia trabalho, quem revisa a saída dele.
7. **Segurança & limites** — o que ele nunca deve fazer; regras de escalada.
8. **Definição de "feito"** — critérios concretos de conclusão.

Alvo: **~60-120 linhas** por charter. Os 5 papéis de software são reescritos como **charters-exemplo ricos** e passam a ser apenas pontos de partida (deletáveis).

### 4.2 Biblioteca de papéis (`role_templates` editável)

Hoje `role_templates` tem 5 linhas seedadas, read-only. No M12 vira **CRUD de primeira classe**:

- Novos IPCs: `roles:create`, `roles:update`, `roles:delete`, `roles:clone` (`roles:list` já existe).
- O charter é armazenado como arquivo markdown em `~/.prospero/role-library/<role-id>/charter.md`; a linha em `role_templates` guarda metadata (nome, descrição, ícone, `default_model`, `default_skills`, `charter_path`, `is_seed_example`). Híbrido markdown+SQLite, consistente com o M11.
- Nova rota **`/roles`** — Biblioteca de Papéis, master/detail: criar, clonar, editar, apagar, com o editor de charter (reusa o editor multi-arquivo da Peça 3).
- Quem monta uma agência cria "Gestor de Tráfego", "Mídia", "Criação", "Analista" — e reusa esses papéis em quantas contratações quiser.

### 4.3 Assistente de geração de charter

Em vez de escrever ~100 linhas na mão:

1. O usuário **descreve o papel em linguagem natural** (ex.: "agente que pesquisa concorrentes e entrega achados para o revisor"), opcionalmente escolhendo um papel existente como base.
2. Uma **chamada one-shot ao Claude** (nível-app, não ocupa slot de agente) gera o charter completo nas 8 seções. O prompt de geração inclui: a spec das 8 seções, 1-2 charters existentes como few-shot, a descrição do usuário, e **o contexto da empresa** (papéis já existentes) — para que os handoffs (seção 6) já saiam cruzados.
3. O usuário **revisa e edita** no editor de charter antes de salvar.

Notas de implementação: a chamada one-shot pode usar o adapter existente em modo `--print`; é transiente, conta no cost tracking (M8) e respeita o limite de 4 execuções paralelas (enfileira se necessário).

### 4.4 CEO arquiteto de organização

A autoria sobe do nível **papel** para o nível **organização**. Dois caminhos complementares:

**(a) CEO desenha a empresa.** O usuário diz "quero uma agência de tráfego" (no chat ou num fluxo "Projetar empresa") → o CEO usa uma capability nova de arquiteto + tools MCP novas para propor o **org chart inteiro**: papéis (cada um com charter gerado), hierarquia (`reports_to`), modelo/skills por papel, projetos. Como a geração é *org-aware*, o charter do "Revisor de Pesquisa" já sai sabendo que existe um "Pesquisador" e acerta o handoff sozinho.

- A proposta volta numa **tela de revisão reaproveitando o padrão do `GoalPlanReview` (M8.5 PR-B)**: árvore de papéis/agentes propostos com checkboxes include/exclude, editável, com estimativas.
- Aprovação → **contratação em massa**, reusando o executor atômico de goal-plan (M8.5/M8.6) e o padrão **two-pass hire** (cria papéis + agentes, depois liga `reports_to` — padrão do M9 PR-F.2.2).
- Novas tools MCP para o CEO: `submit_org_plan({ roles[], agents[], hierarchy })` (espelho de `submit_goal_plan`). Novo inbox kind: `org_proposed`.

**(b) Org-as-code via `AGENTS.md`.** O import/export de `AGENTS.md` que já existe (M9 PR-F.2.2 — `gray-matter` + zod) é **estendido para carregar os charters dentro**. Uma empresa inteira vira um arquivo único — versionável, compartilhável — e o assistente de geração pode *cuspir* esse arquivo. Importar recria a organização com os charters.

---

## 5. Peça 2 — Procedimento operacional

Hoje o `preamble.md` (~83 linhas) ensina **ambiente** (sandbox CWD, caminhos absolutos, `list_projects`, noções de delegação) — mas não ensina o **produto**: o ciclo de vida de um issue, quando gravar um artifact, o protocolo de delegação completo, disciplina de custo, mecânica de goal plan. O agente tem as tools, não tem o manual.

O M12 entrega o procedimento operacional em **dois níveis**, por eficiência de token:

**2a — Contrato operacional core (sempre injetado).** O `preamble.md` evolui para um contrato conciso e bem-estruturado: o essencial absoluto que todo agente precisa em todo turno (como delegar, como mexer em issues, convenções de caminho/identificador, o gate de segurança). Continua enxuto.

**2b — Manual Operacional (skill, sob demanda).** Um documento único — "Como esta empresa opera" — entregue como **skill bundled** na infra do M11. Conteúdo:

- **Ciclo de vida do issue** — estados (backlog→todo→doing→review→done), quando assinar, quando mover, quando comentar.
- **Artifacts** — quando e como gravar (`record_artifact`) antes de marcar `done`.
- **Protocolo de delegação** — `message_agent`, threads, kinds (`proposal`/`question`/`confirmation`/`observation`), `read_thread`.
- **Disciplina de custo** — budgets, quando pausar, quando escalar.
- **Mecânica de goal plan** — como o CEO planeja, como a execução narrada funciona.
- **Convenções** — caminhos absolutos, identificadores `PRJ-7`, o gate de segurança.

Cada ação é amarrada à **tool MCP concreta** — é exatamente o "wiring ao sistema" que falta hoje. Carregado por **progressive disclosure**: só a descrição L0 (~100 chars) entra no system prompt; o conteúdo completo é lido sob demanda. É uma skill `bundled` company-shared, herdada por todos os agentes (mecanismo de inheritance do M11).

> **Nota de dependência M11:** o enum `skills.source` do M11 precisa de um valor `bundled` (ou a skill é shipada como `user_authored` company-shared). Alinhar ao iniciar o M12.

A Peça 2 é **agnóstica de ramo** — ciclo de issue, delegação e custo são mecânica de produto, iguais para uma software house e uma agência de tráfego.

---

## 6. Peça 3 — Instruções como dado + aba Instructions

**Modelo escolhido (opção C do brainstorm):** bundle gerenciado, **sem** modo "external" (apontar para repo git arbitrário fica no backlog).

- Cada agente tem um **bundle de instruções** em disco: `~/.prospero/companies/<cid>/agents/<aid>/instructions/`. Arquivo de entrada `charter.md` (copiado do role template na contratação, depois editável) + arquivos extras que o usuário adiciona (notas, procedimentos custom).
- Tabela nova `agent_instruction_files` (id, agent_id, filename, body_path, is_entry, sort_order, timestamps) — conteúdo no `.md`, a tabela rastreia o bundle. Guarda de path-traversal (rejeita `..`).
- **Aba Instructions** nova em `/agents/:id`: file-tree à esquerda + editor markdown à direita, botão `+` para adicionar arquivo, delete por arquivo (entry protegido). A seção "Persona" sai do ConfigTab e o `InstructionsFullScreenModal` existente é absorvido aqui.
- `composeSystemPrompt` é refatorado para **ler o charter de entrada + arquivos extras do disco**, em vez de concatenar strings hard-coded.
- Migração: o conteúdo atual de `agent.system_prompt` de cada agente existente é materializado como um arquivo no bundle.

---

## 7. Peça 4 — Runs · Budget · Run Policy

**Runs.** Histórico de execução por agente. No modelo de sessão persistente, um "run" = um turno. Tabela nova `agent_runs` (id, agent_id, started_at, ended_at, model, adapter_name, tokens_in, tokens_out, cache_tokens, status, trigger), populada pelo orquestrador nas bordas de turno; liga-se a `cost_events` (M8). Aba **Runs**: lista de runs → drill-in (tool calls do turno, via tool history). Substitui o `RunsModal` atual.

**Budget por agente (tokens + USD).** Colunas novas em `agents`: `budget_tokens_limit`, `budget_usd_limit` (só relevante para adapters `claude-api-key`), `budget_period` (`daily`|`monthly`).

- **Teto de tokens** — universal, funciona para os dois tipos de adapter.
- **Teto em USD** — derivado de tokens × pricing (M8 já tem pricing por modelo); exibido e aplicável quando o adapter tem custo real (API key). Agentes OAuth Max mostram USD como referência informativa.
- **Enforcement** — reusa o soft-stop do M8: a 80% → aviso (inbox); a 100% → pausa o agente (`status='paused'`, bloqueia `enqueue` no router).

**Run Policy.** Consolida numa seção só: `mode` (supervised/auto), `always_on`, e **permissões explícitas** novas — `can_hire` (criar/demitir agentes) e `can_assign` (atribuir issues), booleans que reforçam o gate das skills `delegation`/`issues` com uma camada de UX clara.

---

## 8. Montagem do system prompt

`composeSystemPrompt` (foundation M7.5, estendido pelo M11) muda assim no M12:

| Slot | Hoje | M12 |
|---|---|---|
| Ambiente | `preamble.md` (~83 linhas, encanamento) | Contrato operacional core (Peça 2a) — conciso |
| Papel | `role_templates.default_system_prompt` (1-2 frases) | **Charter** (Peça 1, ~60-120 linhas), arquivo de entrada do bundle |
| Persona | `agent.system_prompt` (textarea) | **Bundle de instruções** (Peça 3) — charter + extras, lido do disco |
| Memórias | — | Slots do M11 (USER.md / company / agente) |
| Skills L0 | skills declaradas | + Manual Operacional (Peça 2b) + skills role-inherited |

**Ordem de injeção:** contrato core → charter → arquivos extras → memórias (M11) → skills L0.

---

## 9. Dados & migração

**Migração `M12-01`+** (numeração sequencial após as do M11):

- `role_templates` — vira user-managed: add `charter_path`, `is_seed_example`, `created_at`, `updated_at`.
- `agent_instruction_files` (nova) — bundle de instruções por agente.
- `agent_runs` (nova) — histórico de turnos.
- `agents` — add `budget_tokens_limit`, `budget_usd_limit`, `budget_period`, `can_hire`, `can_assign`.
- Inbox — novo kind `org_proposed`.
- **Layout de filesystem** (adições ao do M11):
  ```
  ~/.prospero/
  ├── role-library/<role-id>/charter.md
  └── companies/<cid>/agents/<aid>/instructions/
      ├── charter.md          # entry
      └── *.md                # extras do usuário
  ```
- **Pós-migração:** materializa `agent.system_prompt` de cada agente existente como arquivo no bundle; reescreve os 5 role templates como charters-exemplo ricos.

---

## 10. Token efficiency

Regra dura [`feedback_token_efficiency`](../README.md): o uso não pode inflar.

- O **charter** (~1.5-3 KB) **é** injetado — é a identidade do agente, necessária todo turno. Mas é um **prefixo estável** → entra no **prompt cache** → custo marginal é cache-read (barato), não input cheio.
- O **Manual Operacional** entra como **L0 (~100 chars)**; o corpo completo só carrega sob demanda (progressive disclosure). Não infla o prompt.
- O **assistente de geração** é instruído a ser conciso (cap de ~120 linhas por charter).
- **Alvo:** o system prompt "core" injetado por agente cresce ≤ 3 KB vs. baseline pós-M11, majoritariamente cacheado. Profundidade fica on-demand. Revisitar se uso real mostrar bloat.

---

## 11. Abas do Agent Studio

**Implementado em PR-F.** A tela `/agents/:id` usa um modelo de **dois modos**: **Conversa** (chat, delegações, composer) e **Estúdio** (gestão do agente). A troca de modo é feita por um `TabBar` segmentado abaixo do `AgentHeader` persistente. O Estúdio abre em **tela cheia** — sem o painel lateral de 320px da concepção original.

As **6 abas do Estúdio** são renderizadas em largura total por `AgentStudio.tsx`:

| Aba | Conteúdo |
|---|---|
| **Config** | Identidade, modelo, papel, reports-to, location/adapter, projetos + seção **Run Policy** (mode, always-on, permissões) |
| **Instructions** | Editor multi-arquivo do bundle (charter + extras) |
| **Learning** | M11 — memória + skills |
| **Issues** | Issues atribuídos |
| **Runs** | Histórico de turnos |
| **Stats** | Métricas + seção **Budget** (tetos token/USD + utilização) |

Detalhes de implementação em `docs/agent-studio.md`.

---

## 12. Segurança

- **Instruções são autoradas por humano.** Agentes não editam o próprio bundle de instruções — aprendizado autônomo vai pelos canais do M11 (com sanitizer + review). Evita auto-reescrita do charter como vetor de injection.
- **Geração de charter** — a saída do assistente one-shot passa pelo **mesmo sanitizer** das writes do M11 antes de ser salva (defense-in-depth: é geração LLM).
- **Proposta de org do CEO** — `submit_org_plan` valida via zod; nenhuma contratação acontece sem aprovação do usuário na tela de revisão.
- **Import de `AGENTS.md` com charters** — charters importados passam pelo sanitizer; preview antes de commitar (padrão já usado no M9 PR-F.2.2).
- **Path-traversal** — bundle de instruções rejeita `..`, resolve só dentro da raiz do agente.
- **SECURITY.md** — nova seção "Instruction bundles & charter generation as injection vectors".

---

## 13. Faseamento (PRs)

| PR | Escopo |
|---|---|
| **A** | Estrutura de charter (8 seções) + `role_templates` user-managed (CRUD) + rota `/roles` Biblioteca de Papéis + reescrita dos 5 papéis como charters-exemplo + migração. |
| **B** | Contrato operacional core (preamble evoluído) + Manual Operacional como skill bundled (sobre infra M11) + inheritance. |
| **C** | `agent_instruction_files` + bundle gerenciado em disco + refactor de `composeSystemPrompt` + aba Instructions (file-tree + editor). |
| **D** | Assistente de geração de charter (one-shot) + capability "arquiteto de organização" do CEO + `submit_org_plan` + tela de revisão (reusa GoalPlanReview) + contratação em massa + `org_proposed` inbox kind + extensão do `AGENTS.md` para carregar charters. |
| **E** | `agent_runs` + aba Runs + budget por agente (tokens+USD) + enforcement (estende soft-stop M8) + seção Budget no Stats + Run Policy (permissões) no Config. |
| **F** ✅ | Consolidação da IA das 6 abas (dois modos Conversa/Estúdio, 6 abas full-width, primitivos `components/ui/`) + docs + atualização do roadmap. |

---

## 14. Testes & não-regressão

**Testes:**
- Unit: parser/validador do charter de 8 seções; sanitizer na geração; resolver de path-traversal do bundle.
- Unit: enforcement de budget por agente (80% aviso, 100% pausa) para token e USD.
- Integration: `roles:create`/`clone`/`update`/`delete` round-trip; geração one-shot → charter válido.
- Integration: `submit_org_plan` → tela de revisão → aprovação → contratação em massa atômica com `reports_to` correto.
- Integration: export `AGENTS.md` com charters → import recria a org idêntica.
- Integration: `composeSystemPrompt` lendo bundle do disco produz prompt esperado.
- E2E: criar papel custom → contratar → editar charter na aba Instructions → reload → próxima sessão reflete.

**Não-regressão:**
- Token: overhead do system prompt ≤ 3 KB/agente vs. baseline M11, majoritariamente cacheado.
- M1–M11 intactos; suíte de segurança verde; startup +200ms máx.

---

## 15. Out-of-scope do M12

- ❌ **Modo "external"** do bundle de instruções (apontar para repo git) — backlog; opção C explicitamente sem isso.
- ❌ **Blueprints de empresa** (modelos prontos de ramos: agência de tráfego, estúdio de conteúdo, firma de pesquisa) — fast-follow barato via o export `companies.sh` existente; pode virar conteúdo pós-M12 ou compor com Workflow Plays (V2 Tier 1).
- ❌ **Marketplace/hub de papéis** remoto — v3 (mesmo threat model que barra skill hub no M11).
- ❌ **Loop operacional autônomo** (acordar por schedule) — é o milestone **Routines** (V2 Tier 1).

---

## 16. Decisões em aberto

- **Storage de runs** — `agent_runs` dedicada (escolhido aqui) vs. derivar de `cost_events` + `activity_events`. Reavaliar no PR-E se a tabela for redundante.
- **Mecanismo da geração one-shot** — `claude -p` via adapter existente vs. helper de geração dedicado. Decisão de implementação no PR-D.
- **IA final das 6 abas** — confirmar com a `frontend-design` skill no PR-F.
- **`skills.source = 'bundled'`** — alinhar o enum com o M11 ao iniciar o M12 (seção 5).

---

## 17. Custo & posição no roadmap

**Custo estimado:** ~18-24 dias (~6 PRs).

**Pré-requisito:** **M11** — a Peça 2 (Manual Operacional) roda sobre a infra de skills do M11; a Peça 1 compõe com o role-inheritance do M11.

**Posição:** V2, **logo após o M11**, antes das demais apostas V2 Tier 1. Agente bem-instruído é fundação que fortalece **Workflow Plays** (plays configuram orgs e agentes) e **Enforced Outcomes** (o agente precisa saber, pelo Manual Operacional, "como rodar o gate X").

**Próximo passo quando o M12 começar (pós-M11):** invocar a skill `writing-plans` para gerar o plano de implementação detalhado a partir deste design.

---

## 18. Referências

- [docs/paperclip-comparison.md](paperclip-comparison.md) — comparação feature-a-feature (§14 system prompts)
- [docs/hermes-memory-learning-system.md](hermes-memory-learning-system.md) — design do M11 (infra de skills que o M12 consome)
- [ROADMAP.md](../ROADMAP.md) — §M11, §Visão V2, §M12
- Paperclip (`D:/tmp/paperclip`): `server/src/services/agent-instructions.ts`, `default-agent-instructions.ts`, `onboarding-assets/ceo/*`, `skills/paperclip/SKILL.md`, `skills/paperclip-create-agent/references/`, `ui/src/pages/AgentDetail.tsx`
