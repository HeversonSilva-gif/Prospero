# M13 — Espinha de Outcome & Verificação

> **Status:** documento de design (2026-05-18). Base para o milestone **M13**, a ser executado **depois do M12** (PR-E2 a fechar).
>
> **Fontes:** brainstorm 2026-05-18 · investigação do repo [danielmiessler/Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure) (PAI v5.0.0) · código atual do Prospero (M1–M12) · [docs/m12-agent-org-definition-layer.md](../../m12-agent-org-definition-layer.md) · [docs/hermes-memory-learning-system.md](../../hermes-memory-learning-system.md) · [project_v2_vision](../../../README.md).
>
> **Pergunta original:** "o que podemos pegar do PAI para incrementar o Prospero, com a melhor estrutura possível, tornando a visão de futuro V2 real e extremamente alcançável?"

---

## TL;DR

O **PAI** ("Personal AI Infrastructure" / "Life OS" do Daniel Miessler) e o **Prospero** são primos: single-user, Claude-native, text-based, *filesystem-as-context* (busca via `rg`, sem RAG). O PAI resolveu bem uma coisa que o Prospero ainda tem como aposta vaga: **transformar "feito" de uma opinião num fato verificável**.

O Prospero, em 14+ milestones de v1 e dois de V2 (M11, M12), construiu a **máquina de orquestração** e a **camada de definição de agente/organização**. O que falta para a tese V2 ("delegação de outcomes que você só revisa") virar real: **o outcome não tem um alvo mensurável nem uma doutrina de verificação**. Hoje o "feito" de um goal é `goals.success_criteria` — um único campo de texto livre — e o "feito" de um issue é mover um card para a coluna `done`.

O **M13** importa quatro mecanismos do PAI, adaptados ao modelo de dados do Prospero, formando **uma espinha única — do nível-empresa ao nível-tarefa**:

1. **ISA (Ideal State Artifact)** — o `success_criteria` do goal evolui para um artefato estruturado de 8 seções + uma lista de **ISCs** (Ideal State Criteria — critérios verificáveis).
2. **Verification engine** — o "Enforced Outcomes" do V2 Tier 1, concretizado: um goal não vira `achieved` enquanto cada ISC não passar (determinístico via gate runner; de julgamento via revisor).
3. **TELOS** — o "ideal state" no nível da empresa: missão, metas de longo prazo, princípios. O pai contra o qual todo ISA é checado.
4. **The Algorithm** — o loop operacional de 7 fases (OBSERVE→…→VERIFY→LEARN) que o agente roda; entregue como skill, com VERIFY ligado ao engine e LEARN ligado ao M11.

Mais um PR de segurança: **Containment Zones** — zonas de privacidade declaradas + guard estrutural.

**Custo estimado:** ~22-30 dias (~6 PRs). **Pré-requisito:** M11 + M12. **Posição:** V2, logo após o M12; **absorve e concretiza o bet "Enforced Outcomes"** do V2 Tier 1.

---

## 1. O problema — por que o outcome ainda é uma opinião

A tese V2 (ver `project_v2_vision`) é "delegação de outcomes que você só revisa — você abre o app uma vez por dia". Isso só funciona se **revisar for barato e confiável**. Hoje não é, por três causas.

**Causa 1 — "Feito" não é estruturado.** Um `Goal` tem um campo `success_criteria TEXT` (migration `0012_goals.sql`, linha 24). É uma frase. Não tem itens, não tem como checar item a item, não distingue "o que é checável por máquina" de "o que precisa de julgamento humano". O agente lê uma frase e *decide sozinho* se cumpriu.

**Causa 2 — Não existe gate de verificação.** Mover um issue para `done` é uma escrita de status. O comentário no topo de `0008_issue_artifacts.sql` chega a dizer que artifacts são *"a soft pre-condition for status=done"* — mas é **soft**: nada bloqueia. O V2 Tier 1 lista "Enforced Outcomes — `done` que significa `done`" como aposta, mas a descreve só como "gates executáveis (tests/build/lint/bench)" — sem desenho. É a aposta mais vaga e mais importante da V2.

**Causa 3 — Não existe um norte no nível-empresa.** O Prospero tem charter por-agente (M12), Manual Operacional (M12 PR-B), `company memory` (M11) e `goals`. Mas não tem **um artefato único, durável, que diga para que o negócio existe**. O CEO-arquiteto (M12 PR-D) projeta uma organização a partir de uma frase do usuário e perde esse contexto depois. Sem isso, não há contra o que medir se um goal "vale a pena" — só se ele "foi feito".

> O PAI formula isso de forma direta: *"Without TELOS, your DA has nothing to optimize against."* O Prospero tem o mesmo buraco, um nível acima.

### 1.1 O que o PAI faz e o Prospero não

| # | Mecanismo do PAI | O que é | Dono no Prospero |
|---|---|---|---|
| 1 | **ISA** (Ideal State Artifact) | Formato universal de "o que feito significa" para qualquer tarefa: 12 seções + critérios (ISCs) que *populam o doc e funcionam como itens de verificação*. | ❌ **M13 Peça 1** |
| 2 | **Verificação** (build verification + done condition) | Os ISCs são checados; "done" é medido contra critérios explícitos, não avaliação subjetiva. | ❌ **M13 Peça 2** |
| 3 | **TELOS** | Missão/metas/crenças capturadas num `/interview`. O norte contra o qual tudo é otimizado. | ❌ **M13 Peça 3** |
| 4 | **The Algorithm** | Loop de 7 fases (OBSERVE→THINK→PLAN→BUILD→EXECUTE→VERIFY→LEARN), modelado no método científico. | ❌ **M13 Peça 4** |
| 5 | **Containment Zones** | Cada diretório declara sua zona de privacidade; um hook PreToolUse bloqueia vazamento cross-zone. | 🟡 **M13 Peça 5** (parcial — há sandbox CWD) |
| 6 | Skills como código + memória + loop de aprendizado | "Prompts wrap code; code doesn't wrap prompts." | ✅ **M11** + **M12** |
| 7 | DA / identidade / charter | Identidade autorada por agente. | ✅ **M12** |

O M13 é dono das peças **1–5**.

### 1.2 As "cinco identidades" do ISA — e onde cada uma cai no Prospero

O PAI descreve o ISA como tendo cinco papéis simultâneos. É um bom mapa do que o M13 entrega:

| Identidade (PAI) | O que significa | Onde mora no M13 |
|---|---|---|
| **Articulation** | A descrição estruturada do estado ideal. | As 8 seções narrativas do `isa.md` (§4.1). |
| **Test harness** | Os critérios que serão checados. | A tabela `goal_criteria` — os ISCs (§5). |
| **Build verification** | O ato de rodar os checks. | O verification engine (§6). |
| **Done condition** | O gate que decide `achieved`. | A transição `verifying → achieved` (§6.4). |
| **System of record** | O histórico versionável de decisões. | As seções `Decisões` + `Changelog` do `isa.md`, em disco, versionável (§4.1). |

---

## 2. A fronteira M11 / M12 ↔ M13

O Prospero V2 tem três camadas, e o M13 é a terceira:

- **M11 = inteligência *aprendida*.** O agente fica mais esperto ao longo do tempo (memória, skills auto-derivadas, derivation pipeline).
- **M12 = inteligência *autorada*.** O agente nasce esperto: charter de 8 seções, Manual Operacional, instruções como dado, CEO-arquiteto.
- **M13 = trabalho *verificável*.** O agente agora sabe **contra o que** está trabalhando e o sistema sabe **se ele chegou lá**. M11/M12 deixam o agente bom; M13 torna o *resultado dele* confiável o suficiente para o usuário só revisar.

**Dependência técnica (por isso M13 vem por último):**

- A **Peça 4 (Algorithm)** é entregue como skill bundled sobre a infra do M12 PR-B (Manual Operacional) — mesmo mecanismo: constante compilada + entrada L0 sintética + `skill_read` por fallback ([project_m12_pr_b_lessons](../../../README.md)).
- A fase **LEARN** do Algorithm é o derivation pipeline do **M11** (`apps/main/src/derivation/`) — o M13 não constrói loop de aprendizado novo, ele *alimenta* o do M11 com um sinal mais rico (ISC passou/falhou).
- A **geração assistida de ISA/TELOS** reusa o runner headless `claude -p` do M12 PR-D1 (`derivation/runner.ts` + `buildAuthEnv`).
- A verificação determinística reusa a infra de spawn sandboxed (sandbox CWD per-agente, M6.1).

**Sinergia com o M12:** o CEO-arquiteto (M12 PR-D) ganha o TELOS como contexto-pai — ele projeta a organização *a serviço de* um estado ideal de empresa explícito, em vez de uma frase volátil. O `submit_org_plan` e o `submit_goal_plan` passam a propor ISCs (§5.3).

**Separação de segurança:** o ISA e o TELOS são **autorados/aprovados por humano**, igual aos charters do M12. O que o agente aprende sozinho continua indo pelos canais de memória/skill do M11 (sanitizer + review). O agente **não edita o próprio ISA** — isso evita que ele afrouxe os critérios contra os quais é medido (vetor de prompt injection — ver §13).

---

## 3. Visão geral — a espinha

Tudo que a empresa faz passa a ter um alvo mensurável e uma doutrina de verificação, do topo à base:

```
TELOS                          — 1 por empresa. "Para que este negócio existe."
  │                              Missão · Metas de longo prazo · Princípios · Estado ideal · Não-objetivos
  │
  └─ Goal + ISA                — a unidade de outcome. Accountable ao TELOS.
       │   8 seções narrativas (isa.md em disco)
       │
       ├─ ISCs                 — Ideal State Criteria. Os critérios verificáveis.
       │    kind: deterministic | judgment
       │
       └─ Issues               — o trabalho. Cada issue referencia o(s) ISC que avança.
            │
            └─ Algorithm       — o loop que o agente roda ao trabalhar um issue.
                 OBSERVE → THINK → PLAN → BUILD → EXECUTE → VERIFY → LEARN
                                                              │        │
                                            checa os ISCs ────┘        └──── alimenta o derivation
                                            (verification engine)             pipeline do M11
```

A **transição que materializa o "Enforced Outcomes"**: quando todos os issues de um goal chegam a `done`, o goal entra no status novo **`verifying`**; o verification engine roda; só com **todo ISC verde** o goal vira `achieved`. Qualquer ISC vermelho devolve o goal a `in_progress` com um inbox apontando o critério e o output que falhou.

As 5 peças, detalhadas nas seções 4–8.

---

## 4. Peça 1 — O artefato ISA

### 4.1 As 8 seções

O PAI usa **12 seções** (Problem → Vision → Out of Scope → Principles → Constraints → Goal → Criteria → Test Strategy → Features → Decisions → Changelog → Verification). O M13 adota **8** — quatro das doze já existem no modelo do Prospero e duplicariam:

| Seção PAI | Decisão M13 | Por quê |
|---|---|---|
| Goal | ⬇️ fundida | É `goals.title` + `goals.description`. |
| Principles | ⬇️ fundida | Já é o charter do agente (M12) + o TELOS (Peça 3). |
| Features | ⬇️ fundida | É o `GoalPlan.issues_to_create` (M8.5). |
| Test Strategy | ⬇️ fundida em "Plano de verificação" | Evita duas seções sobre a mesma coisa. |

As **8 seções do ISA do Prospero**, gravadas como headings markdown em `isa.md`:

1. **Problema** — por que este outcome existe; o problema ou a oportunidade, em 1-2 parágrafos.
2. **Visão** — como é o mundo quando isto estiver feito; o estado ideal em prosa.
3. **Fora de escopo** — o que explicitamente **não** está incluído (a fronteira que evita scope-creep do agente).
4. **Restrições** — limites de orçamento, prazo, técnicos, de marca/compliance. Espelha narrativamente `goals.budget_max_tokens` e `goals.deadline`.
5. **Critérios (ISCs)** — a lista de critérios verificáveis. **A seção operativa.** Renderizada a partir da tabela `goal_criteria` (§5), não escrita à mão no markdown — o markdown só tem um marcador `<!-- ISCs -->`.
6. **Plano de verificação** — para cada ISC, *como* ele é checado: o comando, a métrica + limiar, ou quem é o revisor. Também renderizada da tabela.
7. **Decisões** — log append-only de decisões tomadas durante a execução do goal (ex.: "optamos por X em vez de Y porque Z"). É o "system of record".
8. **Changelog** — log append-only de mudanças no próprio ISA (escopo alterado, ISC adicionado/removido), com timestamp e autor.

**Alvo:** ~40-90 linhas de prosa por ISA (seções 1-4, 7, 8). As seções 5 e 6 são geradas da tabela.

### 4.2 Storage — markdown + SQLite (padrão do projeto)

Consistente com charter (M12 PR-A) e instruction bundle (M12 PR-C): a prosa em disco, os dados estruturados em tabela.

```
~/.prospero/companies/<cid>/goals/<gid>/
└── isa.md          # seções 1-4, 7, 8 (prosa) + marcador <!-- ISCs --> para 5/6
```

- `goals` ganha a coluna `isa_path TEXT` apontando para o arquivo.
- **Materialização lazy** (padrão `ensureBundle` do M12 PR-C): um goal sem ISA explícito não tem arquivo. `ensureIsa(goalId)` cria `isa.md` a partir de um esqueleto (ou da geração assistida, §4.4) na primeira escrita. Goals pequenos (`level='task'`) sem ISCs simplesmente não pagam custo nenhum — **não-regressão garantida** (§6.5).
- Guarda de path-traversal: o resolver só abre caminhos dentro de `companies/<cid>/goals/<gid>/` (mesma guarda do bundle de instruções, M12 PR-C).

### 4.3 Migração do `success_criteria`

`goals.success_criteria` (texto livre, existente) **não é apagado** — vira coluna legada e semente:

- **Pós-migração** (padrão do M12 PR-C, que materializou `agent.system_prompt`): para cada goal existente com `success_criteria` não-nulo, `ensureIsa` é chamado e o texto é colocado na seção **Visão** do `isa.md` novo. Nenhum ISC é criado automaticamente — texto livre não vira critério estruturado sem revisão humana.
- A coluna `success_criteria` permanece para back-compat de leitura; deixa de ser escrita.

### 4.4 Geração assistida de ISA

Escrever 8 seções na mão é fricção. Reusa o padrão do M12 PR-D1 (geração de charter):

1. Ao criar um goal, ou por um botão "Gerar ISA" no editor, o usuário fornece a descrição do goal (ou ela já existe).
2. Uma **chamada one-shot `claude -p`** (runner headless do M12 PR-D1, `derivation/runner.ts`) gera as seções 1-4 + uma lista *proposta* de ISCs. O prompt de geração inclui: o esqueleto das 8 seções, o **TELOS da empresa** (para a Visão sair alinhada ao norte do negócio), e 1 ISA existente como few-shot.
3. O usuário **revisa e edita** no editor de ISA antes de salvar. Os ISCs propostos chegam como rascunho — o usuário confirma `kind` (determinístico/julgamento) e o `check_spec` de cada um.
4. A saída passa pelo **sanitizer** do M11 antes de gravar (defense-in-depth: é geração LLM — §17).

Custo gravado em `cost_events` com `adapter_name='isa-generation'` (padrão M12 PR-D1, que usou `'charter-generation'`).

---

## 5. Peça 2 — O modelo de ISC

### 5.1 Tabela `goal_criteria`

```sql
-- migration M13-01 — PR-A (numeração relativa: ver §14)
PRAGMA defer_foreign_keys = 1;

CREATE TABLE goal_criteria (
  id            TEXT PRIMARY KEY,
  goal_id       TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL,
  statement     TEXT NOT NULL,                       -- "o que tem que ser verdade"
  kind          TEXT NOT NULL
                  CHECK (kind IN ('deterministic','judgment')),
  check_type    TEXT                                 -- só para kind='deterministic'
                  CHECK (check_type IN ('command','metric','artifact_exists')),
  check_spec    TEXT,                                -- JSON; shape depende de check_type
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','passed','failed','waived')),
  last_checked_at   INTEGER,
  last_result_json  TEXT,                            -- JSON: { exitCode, stdout, stderr, ... }
  verified_by   TEXT REFERENCES agents(id) ON DELETE SET NULL,  -- só para kind='judgment'
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_goal_criteria_goal ON goal_criteria(goal_id);

ALTER TABLE goals ADD COLUMN isa_path TEXT;

-- migration M13-02 — PR-B: o join issue ↔ ISC.
-- Vem no PR-B porque é o executor de plano que o popula (§5.3).
CREATE TABLE issue_criteria (
  issue_id      TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  criterion_id  TEXT NOT NULL REFERENCES goal_criteria(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, criterion_id)
);
```

> **Nota sobre o status do goal:** `goals.status` é `TEXT NOT NULL DEFAULT 'draft'` **sem CHECK constraint** (ver `0012_goals.sql`). Adicionar o valor `'verifying'` é, portanto, uma mudança **só no tipo TypeScript** (`GoalStatus`) — sem migração de recriação de tabela. O inbox kind novo (§6.4) **precisa** de migração própria, porque inbox kinds *são* CHECK-constrained (padrão das migrations `0019`–`0022`).

### 5.2 ISC determinístico vs. de julgamento

A distinção é o coração da Peça 2 — é o que torna "Enforced Outcomes" possível **sem** exigir um humano em cada checagem.

**`kind='deterministic'`** — checável por máquina, sem julgamento. Três `check_type`:

```typescript
// packages/shared/src/types/isa.ts (novo)

export type CriterionCheckType = "command" | "metric" | "artifact_exists";

/** check_type='command' — roda um comando no sandbox; passa se exit code bate. */
export interface CommandCheckSpec {
  command: string;              // ex.: "pnpm test"
  expectedExitCode: number;     // default 0
  timeoutMs: number;            // default 600_000
  // cwd é sempre a raiz do sandbox do dono do goal — não é configurável (segurança §17)
}

/** check_type='metric' — chama uma MCP tool, compara um campo numérico. */
export interface MetricCheckSpec {
  tool: string;                 // ex.: "ads_get_insights"
  params: Record<string, unknown>;
  field: string;                // caminho do campo numérico no retorno, ex.: "data.cpa"
  operator: "lt" | "lte" | "gt" | "gte" | "eq";
  threshold: number;            // ex.: 50  →  ISC "CPA < 50"
}

/** check_type='artifact_exists' — checa a tabela issue_artifacts. */
export interface ArtifactCheckSpec {
  artifactKind: "file_path" | "commit_sha" | "pr_url" | "snapshot" | "output_text";
  refPattern?: string;          // regex opcional sobre issue_artifacts.ref
}

export type CriterionCheckSpec =
  | ({ checkType: "command" } & CommandCheckSpec)
  | ({ checkType: "metric" } & MetricCheckSpec)
  | ({ checkType: "artifact_exists" } & ArtifactCheckSpec);
```

Exemplos, mostrando que o modelo é **agnóstico de ramo**:

| Ramo | ISC (`statement`) | `kind` | `check_type` + `check_spec` |
|---|---|---|---|
| Software house | "A suíte de testes passa." | deterministic | `command`: `pnpm test`, exit 0 |
| Software house | "O bundle de produção builda." | deterministic | `command`: `pnpm build`, exit 0 |
| Agência de tráfego | "O CPA da campanha está abaixo de R$50." | deterministic | `metric`: tool de insights, `cpa lt 50` |
| Estúdio de conteúdo | "O artigo final foi entregue como arquivo." | deterministic | `artifact_exists`: `file_path` |
| Qualquer | "A copy da landing está on-brand." | judgment | — (revisor) |
| Firma de pesquisa | "Os achados foram revisados pelo lead." | judgment | — (revisor) |

**`kind='judgment'`** — precisa de avaliação humana ou de um agente revisor. Sem `check_type`/`check_spec`. Resolvido por: (a) o usuário aprova na UI do ISA, ou (b) um agente revisor chama a MCP tool `criterion_judge` (§12).

### 5.3 O join `issue_criteria` — verificação que cascateia

Quando o CEO planeja um goal (`submit_goal_plan`, M8.5), cada `IssueToCreate` ganha um campo novo `advancesCriteria: number[]` — os índices dos ISCs que aquele issue avança. Na execução do plano (M8.5/M8.6 executor), as linhas de `issue_criteria` são criadas junto.

Isso dá duas coisas de graça:
- **Cobertura:** a UI mostra se algum ISC não tem nenhum issue trabalhando nele ("critério órfão") — um sinal de plano incompleto.
- **Foco do agente:** ao trabalhar um issue, o agente vê (no Algorithm, fase OBSERVE) exatamente quais critérios aquele trabalho precisa satisfazer.

---

## 6. Peça 2 (cont.) — O verification engine

Módulo novo `apps/main/src/verification/`, espelhando a estrutura de `apps/main/src/derivation/` (M11).

### 6.1 Disparo

O engine roda quando **todos os issues** ligados a um goal (`issues.goal_id = X`) atingem status `done` ou `cancelled`. O gatilho vive no handler de atualização de issue (`issues-handlers.ts`): ao mover um issue para `done`, checa se foi o último do goal; se sim, transiciona o goal `in_progress → verifying` e enfileira `runGoalVerification(goalId)`.

### 6.2 O loop de verificação

```typescript
// apps/main/src/verification/engine.ts

export interface CriterionResult {
  criterionId: string;
  status: "passed" | "failed" | "waived" | "pending";
  detail: string;                 // resumo human-readable
  resultJson: unknown;            // gravado em goal_criteria.last_result_json
}

export interface VerificationReport {
  goalId: string;
  allPassed: boolean;
  results: CriterionResult[];
  pendingJudgment: string[];      // ids de ISCs de julgamento ainda não decididos
}

export async function runGoalVerification(
  goalId: string,
  ctx: VerifyContext,
): Promise<VerificationReport> {
  const criteria = goalCriteriaRepo.listByGoal(goalId);

  // Back-compat: goal sem ISCs verifica trivialmente (§6.5).
  if (criteria.length === 0) {
    return { goalId, allPassed: true, results: [], pendingJudgment: [] };
  }

  const results: CriterionResult[] = [];
  for (const c of criteria) {
    if (c.kind === "judgment") {
      // Julgamento não é "rodado" — só lê o status já decidido pelo revisor.
      results.push({ criterionId: c.id, status: c.status, detail: "...", resultJson: null });
      continue;
    }
    results.push(await checkDeterministic(c, ctx));   // §6.3
  }

  for (const r of results) goalCriteriaRepo.applyResult(r);

  const pendingJudgment = results
    .filter((r) => r.status === "pending")
    .map((r) => r.criterionId);
  const allPassed = results.every(
    (r) => r.status === "passed" || r.status === "waived",
  );
  return { goalId, allPassed, results, pendingJudgment };
}
```

### 6.3 Checagem determinística

```typescript
async function checkDeterministic(
  c: GoalCriterion,
  ctx: VerifyContext,
): Promise<CriterionResult> {
  const spec = parseCheckSpec(c.checkSpec);   // valida com zod (apps/main/src/schemas)
  switch (spec.checkType) {
    case "command":         return checkCommand(c, spec, ctx);
    case "metric":          return checkMetric(c, spec, ctx);
    case "artifact_exists": return checkArtifact(c, spec, ctx);
  }
}

async function checkCommand(
  c: GoalCriterion, spec: CommandCheckSpec, ctx: VerifyContext,
): Promise<CriterionResult> {
  const run = await runSandboxedCommand({
    command: spec.command,
    cwd: ctx.sandboxRoot,                  // sandbox do dono do goal — fixo (§17)
    timeoutMs: spec.timeoutMs,
    env: minimalVerificationEnv(),         // sem segredos, sem rede salvo opt-in
  });
  const passed = !run.timedOut && run.exitCode === spec.expectedExitCode;
  return {
    criterionId: c.id,
    status: passed ? "passed" : "failed",
    detail: passed
      ? `exit ${run.exitCode}`
      : run.timedOut ? `timeout ${spec.timeoutMs}ms` : `exit ${run.exitCode}, esperado ${spec.expectedExitCode}`,
    resultJson: { exitCode: run.exitCode, stdout: run.stdout.slice(-4000), stderr: run.stderr.slice(-4000), timedOut: run.timedOut },
  };
}
```

`checkMetric` chama a MCP tool nomeada, extrai `spec.field`, aplica `spec.operator`/`spec.threshold`. `checkArtifact` consulta `issue_artifacts` dos issues do goal.

### 6.4 O gate de `achieved` + status `verifying`

`GoalStatus` ganha um valor:

```typescript
// packages/shared/src/types/goal.ts
export type GoalStatus =
  | "draft" | "planning" | "proposed" | "approved"
  | "in_progress" | "verifying" | "achieved" | "cancelled";
//               ^^^^^^^^^^^^ novo
```

Fluxo da transição:

```
in_progress  ──(último issue → done)──►  verifying
                                            │
                              runGoalVerification()
                                            │
                 ┌──────────────────────────┼───────────────────────────┐
            allPassed                 pendingJudgment              algum failed
                 │                          │                           │
                 ▼                          ▼                           ▼
            achieved              fica em verifying,            volta a in_progress
        dispara goal.achieved     inbox p/ o revisor             inbox verification_failed
        (M11 retrospectiva)       (kind verification_review)     (ISC + output que falhou)
```

- **`verification_failed`** — inbox kind novo (precisa de migração, §5.1). Card mostra qual ISC falhou e o `last_result_json` (stdout/stderr truncados). CTA: reabrir o goal / editar o ISC.
- ISC de julgamento pendente mantém o goal em `verifying` e gera um inbox `verification_review` para o usuário ou roteia para um agente revisor. Quando o último julgamento é decidido, o engine reavalia (`allPassed`).
- **`waived`** — o usuário pode dispensar manualmente um ISC (ex.: critério ficou obsoleto). É gravado com autor + timestamp na seção `Decisões` do `isa.md` — auditável.

### 6.5 Não-regressão — goals que já existem

Crítico: **nenhum goal existente pode quebrar.** Garantias:

- Goal sem nenhum ISC → `runGoalVerification` retorna `allPassed: true` na primeira linha (§6.2). O fluxo `verifying → achieved` é instantâneo e invisível.
- O status `verifying` é transitório; nenhuma UI antiga assume um conjunto fechado de status que ele quebre (auditar os `switch (status)` no renderer — lição recorrente da família [project_m12_pr_a_lessons](../../../README.md): `Record<UnionLiteral,X>` vaza exaustividade).
- `success_criteria` continua legível (§4.3).

---

## 7. Peça 3 — TELOS

### 7.1 O artefato

Um artefato **company-scoped**, um por empresa. **Não é um goal** — goals são outcomes com prazo; o TELOS é a identidade durável do negócio contra a qual os goals são julgados.

```
~/.prospero/companies/<cid>/
└── telos.md
```

`companies` ganha `telos_path TEXT`. Sem tabela dedicada — é 1-por-empresa, o markdown basta (mesma decisão do Manual Operacional no M12 PR-B: documento, não row).

Seções do `telos.md`:

1. **Missão** — para que o negócio existe, em um parágrafo.
2. **Metas de longo prazo** — onde o negócio quer chegar (horizonte de 6-24 meses).
3. **Princípios** — as crenças/regras inegociáveis (ex.: "nunca prometemos prazo que não cumprimos").
4. **Estado ideal** — como é o negócio funcionando perfeitamente; a "Visão" no nível-empresa.
5. **Não-objetivos** — o que o negócio explicitamente **não** quer ser.

### 7.2 Fluxo de entrevista

Espelha o `/interview` do PAI e reusa o padrão de geração do M12 PR-D1:

- Rota nova **`/telos`** — visualiza e edita o TELOS da empresa ativa.
- Primeiro preenchimento: um **fluxo de entrevista guiado** — uma sequência de perguntas (form), e ao final uma chamada one-shot `claude -p` sintetiza as 5 seções a partir das respostas. O usuário revisa e edita.
- Edição posterior: editor markdown direto (reusa o editor multi-arquivo do M12 PR-C).
- Saída da síntese passa pelo sanitizer (§17). Custo em `cost_events`, `adapter_name='telos-synthesis'`.

### 7.3 Injeção e o link ISA → TELOS

- **Injeção no system prompt:** o TELOS pleno entra no contexto do **CEO** (ele precisa do norte para planejar). Para os ICs, entra só um **pointer de 1 linha** ("O TELOS da empresa está em `telos.md` — leia com `telos_read` se precisar do contexto do negócio"). Disciplina de token (§11).
- **Geração de ISA é TELOS-aware** (§4.4): a seção "Visão" do ISA sai alinhada ao "Estado ideal" do TELOS.
- **O CEO-arquiteto (M12 PR-D) lê o TELOS** como contexto-pai ao montar a organização e ao planejar goals — `submit_org_plan`/`submit_goal_plan` recebem o TELOS no prompt.
- MCP tool nova `telos_read()` (§12) serve o corpo sob demanda.

---

## 8. Peça 4 — The Algorithm

### 8.1 As 7 fases

O loop do PAI, modelado no método científico, adaptado ao vocabulário do Prospero:

| Fase | O que o agente faz | Amarração ao Prospero |
|---|---|---|
| **OBSERVE** | Lê o issue, o ISA do goal-pai, os ISCs que este issue avança (`issue_criteria`), memória relevante (M11). | `isa_read`, `list_issue`, memória M11. |
| **THINK** | Forma uma explicação do problema. Régua: *hard-to-vary* (§8.4). | — |
| **PLAN** | Decide os passos; em trabalho grande, propõe sub-issues. | `create_issue`. |
| **BUILD** | Produz o trabalho. | tools do ramo. |
| **EXECUTE** | Aplica/entrega; grava artifacts. | `record_artifact`. |
| **VERIFY** | Auto-checa os ISCs **antes** de marcar `done`. | `criterion_check` (§12). **Fase dura** (§8.3). |
| **LEARN** | Registra o que funcionou/falhou. | derivation pipeline do M11. |

### 8.2 Entregue como skill — não como state machine forçada

Decisão de design (confirmada no brainstorm): o Algorithm é **instrução**, não um state machine que o orquestrador força a cada turno.

**Por quê:** os agentes do Prospero são *chat-first, sessão persistente* — não são stateless entre execuções (ao contrário do Paperclip; ver M12 doc §1, Causa 1). Forçar 7 fases em todo turno trivial seria peso morto e brigaria com o modelo de chat. O próprio PAI usa um *mode classifier* que só liga o Algorithm completo para trabalho substancial.

**Como:** o Algorithm é entregue **exatamente como o Manual Operacional do M12 PR-B** — uma constante compilada `apps/main/src/skills/algorithm.ts`, exposta como entrada **L0 sintética** no `buildMemoryBlock`, com o corpo servido por `skill_read` sob demanda. O Manual Operacional ganha uma frase: *"Ao pegar um issue, rode o Algorithm (skill `algorithm`). Em turnos de conversa triviais, não precisa."* — é o "mode classifier" do Prospero, sem custo de um modelo classificador separado.

> **Alinhamento M11:** isto reusa o mecanismo do M12 PR-B verbatim. Não há enum `skills.source` novo nem row no banco — é constante compilada + L0 sintético.

### 8.3 VERIFY é a fase dura

As fases 1-5 e 7 são guia. A fase **VERIFY** é diferente: ela é *respaldada por enforcement*.

- O Algorithm instrui o agente a chamar `criterion_check` nos ISCs do seu issue antes de marcar `done` — é o auto-check.
- Mas o gate de verdade é o **verification engine** (§6): mesmo que o agente pule ou minta na auto-checagem, o goal não vira `achieved` sem o engine rodar tudo verde.

É o desenho "loop mole, gate duro": o agente é guiado, o resultado é garantido. Isto é o que o V2 Tier 1 chamava de "Enforced Outcomes".

### 8.4 "Hard-to-vary explanations" como régua de qualidade

O PAI usa o critério de David Deutsch — uma boa explicação é *difícil de variar*: específica o bastante para que mudá-la a quebre. O M13 embute isso como **heurística textual nas fases THINK e VERIFY** da skill `algorithm` (ex.: *"Antes de declarar feito: sua explicação do porquê isto resolve o problema é difícil de variar, ou encaixaria em qualquer solução? Se encaixa em qualquer uma, você não entendeu o problema."*). Sem modelo, sem código — é régua de qualidade autorada, igual ao "padrão de qualidade" das seção 5 dos charters do M12.

### 8.5 LEARN — alimentando o loop do M11

A fase LEARN **não constrói loop novo** — ela alimenta o derivation pipeline do M11 (`apps/main/src/derivation/`). O que o M13 adiciona é **sinal mais rico**:

- O derivation pipeline já dispara em `issue.done` e `goal.achieved`. Com o M13, esses eventos carregam **o resultado dos ISCs** (quais passaram de primeira, quais falharam e foram corrigidos). Uma skill derivada de um goal cujo ISC "build passa" falhou 3× é mais afiada do que uma derivada de um `issue.done` cego.
- O evento `verification_failed` (§6.4) vira um gatilho de derivação opcional: um padrão de falha repetida pode propor uma skill de "como evitar falhar o ISC X" (revisão humana via inbox, como todo `skill_candidate` do M11).

> Sem trigger novo proliferado: o M13 enriquece o *payload* dos triggers existentes do M11, e marca `verification_failed` como gatilho elegível. A retrospectiva de `goal.achieved` (M11 PR-E2) passa a incluir o histórico de ISCs.

---

## 9. Peça 5 — Containment Zones

PR de segurança, independente das peças 1-4. Importa o mecanismo de privacidade estrutural do PAI.

**O que o PAI faz:** `containment-zones.ts` declara a zona de privacidade de cada diretório; um hook PreToolUse (`ContainmentGuard`) bloqueia qualquer operação que vaze dados cross-zone.

**O que o Prospero tem hoje:** sandbox CWD per-agente (M6.1) + o gate de segurança / file-fence (M5/M6). Cada agente roda com um CWD próprio, mas a checagem é por-agente, não há um mapa explícito e auditável de zonas — e com **multi-empresa** (M9) o risco real é um agente da empresa A tocar `~/.prospero/companies/B/...`.

**O que o M13 adiciona:**

```typescript
// apps/main/src/security/containment-zones.ts (novo)

export type ZoneId =
  | { kind: "company"; companyId: string }
  | { kind: "agent"; companyId: string; agentId: string }
  | { kind: "shared" }       // role-library, skills company-shared
  | { kind: "system" };      // binários, config do app — read-only p/ agentes

/** Resolve a zona de um caminho absoluto. */
export function zoneOf(absPath: string): ZoneId | null;

/** Um agente pode acessar uma zona? */
export function canAccess(actor: { companyId: string; agentId: string }, target: ZoneId): boolean;
```

- Um check novo no caminho do gate de segurança existente (o file-fence): toda operação de arquivo de um agente resolve a zona do alvo via `zoneOf` e passa por `canAccess`. Cross-zone → bloqueado **e auditado** (um `activity_event` `security.zone_blocked`).
- Regras: um agente acessa só a própria zona `agent`, a zona `company` da sua empresa, e `shared` (read). `system` é read-only. Nunca a zona de outra empresa ou de outro agente.
- É *defense-in-depth* — soma-se ao sandbox CWD, não o substitui.

---

## 10. Montagem do system prompt

`composeSystemPrompt` / `buildClaudeArgs` (M7.5 → M11 → M12) ganham, no M13:

| Slot | M12 | M13 |
|---|---|---|
| Ambiente | Contrato operacional core | igual |
| Papel | Charter (8 seções) | igual |
| Instruções | Bundle de instruções | igual |
| Memórias | Slots M11 | igual |
| **Outcome** | — | **ISA header** do goal ativo (Goal + ISCs + status) — se o agente tem issue ligado a um goal |
| **Norte** | — | **TELOS** (pleno p/ CEO, pointer p/ IC) |
| Skills L0 | Manual Operacional + skills | **+ skill `algorithm`** (L0 sintético) |

**Ordem de injeção:** contrato core → charter → instruções → TELOS → memórias M11 → ISA header → skills L0.

O **ISA header** é só a parte operativa (título/descrição do goal — já injetados via contexto do issue — + a lista de ISCs com status). As 8 seções narrativas completas ficam sob demanda via `isa_read`.

---

## 11. Token efficiency

Regra dura (`feedback_token_efficiency`): o uso não pode inflar.

- **ISA** — só o *header* (lista de ISCs + status, ~600-900 chars para ~10 ISCs) é injetado, e só para agentes com issue ligado a um goal. As 8 seções (~1-3 KB) só via `isa_read`. É prefixo estável → **prompt cache** → custo marginal é cache-read.
- **TELOS** — CEO recebe o corpo (~1-2 KB, cacheado); IC recebe pointer de ~1 linha.
- **Algorithm** — entra como L0 (~100 chars). Corpo via `skill_read`. Zero inflação (idêntico ao Manual Operacional do M12 PR-B).
- **Verification engine** — roda *orchestrator-side* (processo filho + queries SQL). Custo de token para o agente: **zero**. Métricas (`check_type='metric'`) fazem 1 tool call — negligível.
- **Geração assistida** (ISA/TELOS) — chamadas one-shot, transientes, contadas no cost tracking, sujeitas ao limite de 4 execuções paralelas.

**Alvo:** o system prompt "core" injetado por agente cresce **≤ ~2 KB** vs. baseline pós-M12, majoritariamente cacheado. Profundidade fica on-demand.

---

## 12. MCP tools novas

| Tool | Quem usa | O que faz |
|---|---|---|
| `isa_read({ goal_id, section? })` | qualquer agente | Lê o ISA do goal (seção específica ou tudo). Progressive disclosure. |
| `criterion_check({ criterion_id })` | agente trabalhando o issue | Roda a checagem determinística de **um** ISC, retorna passou/falhou. É o auto-check da fase VERIFY. |
| `criterion_judge({ criterion_id, verdict, note })` | agente revisor | Decide um ISC de julgamento (`verdict: 'passed'|'failed'`). Grava `verified_by`. |
| `telos_read()` | qualquer agente | Lê o TELOS da empresa. |

`submit_goal_plan` (M8.5) e `submit_org_plan` (M12 PR-D2) são **estendidos**, não novos: o plano passa a carregar ISCs propostos e o `advancesCriteria` por issue (§5.3). O agente **não** tem tool para criar/editar ISC fora de um plano aprovado — ISCs nascem de planos revisados por humano (§17).

---

## 13. UI — rotas e telas

| Onde | O quê |
|---|---|
| **Goal detail** (existente) | Painel **ISA**: as 8 seções (editor markdown para 1-4,7,8) + o **checklist de ISCs** com status ao vivo (✓/✗/⏳) e o output da última checagem. Botão "Gerar ISA". |
| Goal detail | Badge de status `verifying`; quando falha, o ISC vermelho destacado + link pro inbox. |
| `GoalPlanReview` (M8.5 PR-B) | Estendida: a árvore de issues mostra os ISCs propostos e qual issue avança qual (checkbox de cobertura). |
| **`/telos`** (rota nova) | Visualiza/edita o TELOS; primeiro acesso dispara o fluxo de entrevista. |
| **Inbox** | Cards novos: `verification_failed`, `verification_review`. |
| Settings → Segurança | Painel read-only das Containment Zones (transparência; mostra o mapa de zonas). |

IA fina decidida pela skill `frontend-design` na implementação.

---

## 14. Dados & migração (consolidado)

**Migrações** (numeração sequencial após as do M12 — `0025` é a última conhecida; M12 PR-E2 pode adicionar mais, então os números são relativos):

- **M13-01** (PR-A) — `goal_criteria` (nova) + `goals.isa_path` (coluna). Ver §5.1.
- **M13-02** (PR-B) — `issue_criteria` (nova) — o join issue ↔ ISC.
- **M13-03** (PR-B) — inbox kinds `verification_failed` + `verification_review` (recriação da tabela inbox com CHECK estendido — padrão das migrations `0019`–`0022`).
- **M13-04** (PR-C) — `companies.telos_path` (coluna).

**Sem migração** (mudança só em tipo TS): `GoalStatus` ganha `'verifying'` — `goals.status` não tem CHECK constraint.

**Layout de filesystem** (adições às do M11/M12):

```
~/.prospero/companies/<cid>/
├── telos.md                          # Peça 3
└── goals/<gid>/
    └── isa.md                        # Peça 1
```

**Pós-migração:** para cada goal existente com `success_criteria` não-nulo, materializar `isa.md` com o texto na seção "Visão" (§4.3). Nenhum ISC criado automaticamente.

**Tipos compartilhados:** `packages/shared/src/types/isa.ts` (novo) — `CriterionCheckSpec`, `GoalCriterion`, `CriterionResult`, `VerificationReport`. Zod schemas correspondentes em `apps/main/src/schemas/` (zod **nunca** em `shared` — lição `project_m7_6_lessons`).

---

## 15. Faseamento (PRs)

| PR | Escopo | Depende de |
|---|---|---|
| **A** | **ISA.** Migração M13-01 (`goal_criteria` + `goals.isa_path`) · repo de `goal_criteria` · módulo de leitura/escrita do `isa.md` (8 seções, lazy `ensureIsa`, guarda de path-traversal) · pós-migração do `success_criteria` · tool `isa_read` · painel ISA no goal detail · geração assistida (`isa-generation`). | M12 |
| **B** | **Verification engine.** Migração M13-02 (`issue_criteria`) + join no executor de plano · módulo `apps/main/src/verification/` (`runGoalVerification`, `checkCommand/Metric/Artifact`) · `runSandboxedCommand` · status `verifying` + gate de `achieved` · inbox `verification_failed`/`verification_review` (migração M13-03) · tools `criterion_check`, `criterion_judge` · checklist de ISC ao vivo na UI. | A |
| **C** | **TELOS.** Migração M13-04 (`companies.telos_path`) · `telos.md` + fluxo de entrevista · rota `/telos` · síntese `claude -p` (`telos-synthesis`) · injeção no system prompt · tool `telos_read` · TELOS-awareness na geração de ISA e no `submit_org_plan`/`submit_goal_plan`. | A |
| **D** | **The Algorithm.** Skill `algorithm` (constante compilada, L0 sintético — padrão M12 PR-B) · pointer no Manual Operacional · VERIFY ligado ao `criterion_check` · LEARN: payload enriquecido nos triggers do M11 + `verification_failed` como gatilho de derivação. | B |
| **E** | **Containment Zones.** `containment-zones.ts` · `zoneOf`/`canAccess` · check no gate de segurança · `activity_event` `security.zone_blocked` · painel read-only em Settings. | (independente) |
| **F** | **Consolidação.** Polish da UI (`frontend-design`) · `SECURITY.md` (seção de verificação como vetor) · `ROADMAP.md` + `roadmap.html` · não-regressão completa. | A–E |

**Custo estimado:** ~22-30 dias.

---

## 16. Testes & não-regressão

**Testes:**

- Unit: parser do `isa.md` (8 seções); resolver de path-traversal; zod de `CriterionCheckSpec` (as 3 variantes); `canAccess` das zonas.
- Unit: `runGoalVerification` — goal sem ISC (back-compat pass), todos passam, um falha, julgamento pendente.
- Unit: `checkCommand` (exit bate / não bate / timeout), `checkMetric` (operadores), `checkArtifact`.
- Integration: `goal_criteria` CRUD round-trip; `issue_criteria` criado pelo executor de plano.
- Integration: fluxo completo `in_progress → verifying → achieved` e `→ in_progress` (falha) com inbox correto.
- Integration: geração de ISA/TELOS one-shot → saída válida e sanitizada.
- Integration: TELOS injetado pleno no CEO, pointer no IC.
- E2E: criar goal → gerar ISA → planejar com ISCs → trabalhar issues → verificação roda → goal `achieved`; depois forçar falha de ISC e ver o devolução.

**Não-regressão:**

- **Goals existentes** (sem ISA/ISC) verificam trivialmente e chegam a `achieved` — §6.5.
- Token: overhead do system prompt ≤ ~2 KB/agente vs. baseline M12, majoritariamente cacheado.
- M1–M12 intactos; suíte de segurança verde; o teste de contagem de canais IPC atualizado junto com as tools novas (lição M9 PR-F.1).
- Startup +200 ms máx.
- Mocks de repositório em `apps/main/tests/`: a interface `GoalsRepository`/`IssuesRepository` muda → auditar os mocks literais em `tests/` (lição recorrente da família [project_m12_pr_a_lessons](../../../README.md): mudar interface de repo quebra mock literal em `tests/`, não em `src/`).

---

## 17. Segurança

O M13 introduz **execução de comando** — o vetor mais sensível desde o sandbox do M3/M4. Mitigações:

1. **Comandos de ISC são autorados/aprovados por humano.** Um ISC `check_type='command'` só existe porque entrou num `GoalPlan` ou ISA que o usuário revisou. O agente **não tem MCP tool** para criar ou editar um `check_spec` livremente (§12). Isto fecha o vetor "agente escreve um comando malicioso e o engine o executa".
2. **CWD fixo.** `checkCommand` sempre roda na raiz do sandbox do dono do goal — `cwd` **não** é configurável pelo `check_spec` (§6.3). Sem path-traversal pela porta da execução.
3. **Confirmação na primeira execução.** Um `command` ISC nunca-rodado dispara uma confirmação do usuário no gate de segurança (padrão do `request_permission` do M5) antes da primeira execução. Reexecuções do mesmo comando não repromptam.
4. **Ambiente mínimo.** `minimalVerificationEnv()` — sem segredos, sem credenciais OAuth/API; rede desligada salvo opt-in explícito por ISC.
5. **Timeout + truncamento.** Todo comando tem `timeoutMs`; `stdout`/`stderr` truncados a 4 KB antes de persistir/exibir.
6. **Geração de ISA/TELOS passa pelo sanitizer** do M11 — é geração LLM (defense-in-depth).
7. **Agente não edita o próprio ISA/TELOS.** Igual aos charters do M12: aprendizado autônomo vai pelos canais do M11 (com review). Impede o agente afrouxar os critérios contra os quais é medido — auto-reescrita do alvo é prompt injection.
8. **Containment Zones** (Peça 5) — privacidade estrutural cross-empresa.
9. **`SECURITY.md`** — seção nova: "Verification command execution & ISA/TELOS generation as injection vectors".

---

## 18. Out-of-scope do M13

- ❌ **Mode classifier por modelo** (o PAI usa um classificador Sonnet MINIMAL/NATIVE/ALGORITHM por prompt) — o Prospero usa instrução no Manual Operacional, sem o custo de um modelo classificador (§8.2).
- ❌ **Packs** (capabilities auto-instaláveis do PAI) — mapeia em **Workflow Plays** (V2 Tier 1), milestone separado.
- ❌ **ISA por issue** (Abordagem 3 do brainstorm) — descartado: peso/token altos para issues pequenos.
- ❌ **Voz / daemon Pulse / bridges Telegram-iMessage** do PAI — fora da tese do Prospero.
- ❌ **Knowledge graph tipado** do PAI (People/Companies/Ideas) — é território do Knowledge Base RAG, V2 Tier 2.
- ❌ **Rede ligada por padrão** na verificação — opt-in por ISC apenas.

---

## 19. Decisões em aberto

- **Sandbox da verificação** — rodar `checkCommand` no sandbox do dono do goal (escolhido aqui) vs. um sandbox de verificação dedicado e efêmero. Reavaliar no PR-B se o estado do workspace do agente poluir a checagem.
- **ISC de julgamento — revisor humano vs. agente** — o M13 suporta os dois (`criterion_judge` por agente; aprovação na UI por humano). Qual é o default por ISC? Decisão de UX no PR-B.
- **`verification_failed` como gatilho de derivação** — ligado no PR-D; pode gerar ruído de `skill_candidate`. Avaliar com uso real (espelha a cautela dos nudges do M11 PR-D2).
- **Numeração das migrações** — depende de quantas o M12 PR-E2 adicionar; resolver ao iniciar o M13.

---

## 20. Custo & posição no roadmap

**Custo estimado:** ~22-30 dias (~6 PRs).

**Pré-requisito:** **M11** (derivation pipeline, infra de skill, sanitizer) + **M12** (charter, Manual Operacional, geração `claude -p`, CEO-arquiteto).

**Posição:** V2, **logo após o M12**. O M13 **absorve e concretiza o bet "Enforced Outcomes"** do V2 Tier 1 — que deixa de ser uma aposta vaga ("gates executáveis") e vira um milestone com spec. Isso torna a V2 mais alcançável: troca incerteza por escopo definido.

**Efeito nas apostas V2 seguintes:**

- **Routines** (Tier 1 — agentes acordam sozinhos) fica mais forte: um agente que acorda por schedule roda o Algorithm e produz trabalho verificável sem o usuário olhar.
- **Workflow Plays** (Tier 1 — playbooks pro CEO) fica mais forte: um play configura goals que **já nascem com ISA e ISCs** — o playbook embute o "como medir sucesso".

**Próximo passo quando o M13 começar (pós-M12):** invocar a skill `writing-plans` para gerar o plano de implementação detalhado, PR a PR, a partir deste design.

---

## 21. Referências

- [danielmiessler/Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure) — PAI v5.0.0; fonte do ISA, do Algorithm, do TELOS e das Containment Zones.
- [docs/m12-agent-org-definition-layer.md](../../m12-agent-org-definition-layer.md) — milestone anterior; o M13 consome a infra de skill (PR-B) e de geração `claude -p` (PR-D1) dele.
- [docs/hermes-memory-learning-system.md](../../hermes-memory-learning-system.md) — design do M11; a fase LEARN do Algorithm alimenta o derivation pipeline descrito ali.
- [ROADMAP.md](../../../ROADMAP.md) — §Visão V2 (M13 absorve o bet "Enforced Outcomes" do Tier 1).
- Código atual: `apps/main/src/db/migrations/0008_issue_artifacts.sql`, `0012_goals.sql` · `packages/shared/src/types/{goal,issue}.ts` · `apps/main/src/schemas/goalPlan.ts` · `apps/main/src/derivation/` (referência de estrutura para `verification/`).
