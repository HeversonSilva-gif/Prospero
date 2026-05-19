# M14 — Vitrine Matinal & Escada de Confiança

> **Status:** documento de design (2026-05-18). Base para o milestone **M14**, a ser executado **depois do M13**.
>
> **Fontes:** brainstorm 2026-05-18 (com companion visual — mockups em `.superpowers/brainstorm/`) · análise de lacunas da V2 (mesma sessão) · [docs/superpowers/specs/2026-05-18-m13-outcome-verification-spine-design.md](2026-05-18-m13-outcome-verification-spine-design.md) · código atual do Prospero (M1–M12) · [project_v2_vision](../../../README.md).
>
> **Pergunta original:** "o que falta para a V2 ficar pronta? O que já está planejado cobre tudo, ou temos lacunas grandes?"

---

## TL;DR

A análise de lacunas da V2 concluiu: o **motor** está bem planejado (agentes inteligentes via M11/M12, outcomes verificáveis via M13, cold-start via Plays, leverage assíncrono via Routines). A lacuna real é o **lado humano do loop** — o que acontece na fronteira entre a empresa autônoma e o usuário que "abre o app uma vez por dia". O plano construiu o carro inteiro e sub-planejou o painel que o motorista olha.

O **M14** fecha essa fronteira com duas peças que formam um loop único:

1. **Escada de Confiança** — um agente que acumula track record verificado (M13) sobe degraus de autonomia: o gate de segurança o interrompe menos, e a Run Policy dele migra de `supervised` para `auto`. *Corta o ruído* que chega até você.
2. **Vitrine Matinal** — a tela inicial do app: um resumo de triagem do que rodou enquanto você dormia, com "Precisa de você" no topo. *Organiza o que sobrou.*

A Escada reduz o volume; a Vitrine organiza o resto e mostra os próprios eventos da Escada. Sem uma das duas, a promessa "abre o app uma vez por dia" não se sustenta.

**Custo estimado:** ~12-18 dias (~4 PRs). **Pré-requisito:** M13 (a Escada precisa do histórico de outcomes verificados; a Vitrine usa os buckets de verificação). **Posição:** V2, logo após o M13.

---

## 1. O problema — o lado humano do loop não foi planejado

A tese V2 é "**delegação de outcomes que você só revisa** — você abre o app uma vez por dia pra olhar o que rodou enquanto dormia, não 20× pra empurrar trabalho" (`project_v2_vision`).

Para isso ser real, **revisar precisa ser barato e confiável**. O plano V2 cobre o lado da produção (M11/M12/M13 + Routines + Plays), mas deixa dois buracos no lado do consumo:

**Buraco 1 — não há onde "olhar o que rodou".** A tese diz que você abre o app e *olha*. Olha onde? Hoje existem Dashboard (widgets, M9), Activity stream (feed cru, M7.7) e Inbox (fila de tarefas). Nenhum é um **resumo diário curado**: "a empresa fechou 3 outcomes, 1 falhou na verificação, 2 coisas precisam de você". O M13 produz o *conteúdo* desse resumo (ISC passou/falhou, goal `achieved`); falta a *superfície*.

**Buraco 2 — a autonomia é estática.** "Delegação" implica que, com o tempo, você confia mais e revisa menos. As peças de autonomia existem (Run Policy `mode` do M12, gate de segurança do M5), mas são *settings manuais*. Um agente que entregou 20 outcomes verificados é interrompido exatamente como um recém-contratado. Falta o **compounding**: o agente *ganhar* autonomia pelo histórico — que é literalmente o que a tese promete ("uma empresa de agentes que aprende com a experiência"). O M13 passa a produzir o track record verificado; nada o consome.

Os dois buracos são o mesmo loop visto de dois lados: a autonomia mal-calibrada *gera* ruído, e sem uma vitrine esse ruído não tem onde ser triado. O M14 resolve os dois juntos.

---

## 2. A fronteira com M11 / M12 / M13

O M14 é puramente **consumidor** — ele não cria inteligência nova, ele fecha o loop sobre a que já existe.

- **Do M13** consome o sinal mais importante: um goal que chegou a `achieved` foi *verificado* (todos os ISCs verdes). É isso que a função de track record da Escada lê — o agente **não consegue se auto-certificar**, porque o verification engine do M13 é quem decide. Esse é o alicerce de segurança da Escada (§13).
- **Do M12** consome a Run Policy (`mode` supervised/auto — PR-E2) e reusa o runner headless `claude -p` (`derivation/runner.ts` + `buildAuthEnv`, M12 PR-D1) para a manchete da Vitrine.
- **Do M11** a Vitrine lê os `skill_candidates` (a seção "Aprendeu").
- **Do M5/M6** consome o gate de segurança (`request_permission` / file-fence) — a Escada adiciona uma regra ao gate, não o reescreve.

**Não-regressão como princípio:** todo agente nasce no degrau `novato`, cujo comportamento é **idêntico ao de hoje**. A Escada só *adiciona* caminhos de auto-aprovação para agentes que sobem; nenhum agente fica menos seguro por causa do M14 (§12).

---

## 3. Visão geral — o loop

```
   A empresa autônoma                                          Você, 1× ao dia
   (M11 · M12 · M13 · Routines)                                 ┌──────────────────┐
        │                                                       │  Vitrine Matinal │
        │  produz outcomes, verifica, aprende                    │   (tela inicial) │
        ▼                                                       │                  │
   ┌─────────────────────┐                                      │  ⚠ Precisa de    │
   │ Escada de Confiança │  ── corta o ruído ──────────────────► │     você   (2)   │
   │  novato→confiável   │     menos interrupções                │  ─────────────── │
   │  confiável→autônomo │     supervised → auto                 │  ✓ ✗ ⏳ 📚 (faixa)│
   └─────────────────────┘                                      │  💰 custo da noite│
        │                                                       └──────────────────┘
        └── eventos de promoção/rebaixamento ──────────────────────────▲
                          aparecem na Vitrine ─────────────────────────┘
```

As duas peças, detalhadas nas seções 4 e 5.

---

## 4. Peça 1 — Escada de Confiança

### 4.1 Os 3 degraus

Mecanismo escolhido (brainstorm): **degraus discretos** (vs. score contínuo, vs. unlock por tipo de ação). Legível — o usuário vê um degrau nomeado, não um número.

| Degrau | Desbloqueia | Como se chega | Promoção |
|---|---|---|---|
| **🌱 Novato** | Nada — comportamento de hoje. O gate pergunta sobre toda ação sensível. | Degrau inicial de todo agente recém-contratado. | — |
| **✓ Confiável** | O gate auto-aprova tools **read-only** (Read, Search, `list_*`, MCP tools não-destrutivas). Write / Bash / destrutivas continuam supervisionadas. | N outcomes verificados sem nenhuma falha de verificação no período. | **Automática** (baixo risco). |
| **⚡ Autônomo** | A Run Policy do agente vira `mode='auto'` — ele trabalha sem pausar para o usuário. | Histórico sustentado de outcomes verificados, alta taxa de ISC de primeira, sem rebaixamento no período. | **Sugerida** — o usuário aprova no inbox. |

### 4.2 `trust_tier` + `trust_events`

```sql
-- migration M14-01 — PR-A (numeração relativa: ver §7)
PRAGMA defer_foreign_keys = 1;

ALTER TABLE agents ADD COLUMN trust_tier TEXT NOT NULL DEFAULT 'novato';
-- valores: 'novato' | 'confiavel' | 'autonomo'. Sem CHECK constraint — segue a
-- convenção de goals.status (M13 §5.1): novo valor é mudança só no tipo TS.

CREATE TABLE trust_events (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL
                CHECK (kind IN ('promoted','demoted','promotion_suggested')),
  from_tier   TEXT NOT NULL,
  to_tier     TEXT NOT NULL,
  reason      TEXT NOT NULL,           -- human-readable; alimenta a Vitrine
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_trust_events_agent ON trust_events(agent_id);
```

`trust_events` é o log de auditoria **e** a fonte que a Vitrine lê para mostrar promoções/rebaixamentos. Não há tabela de "score" — ver §4.3.

### 4.3 A função de track record

O score **não é armazenado** — é uma **função pura** computada sob demanda a partir de dados que já existem. Isto evita a calibração frágil de um score contínuo (a Abordagem 2 descartada) e elimina estado que pode ficar stale.

```typescript
// packages/shared/src/types/trust.ts (novo)

export type TrustTier = "novato" | "confiavel" | "autonomo";

/** Tudo lido de tabelas existentes — verification (M13), approvals, activity. */
export interface TrackRecord {
  verifiedOutcomes: number;       // goals 'achieved' (ISCs verdes) que o agente trabalhou
  iscFirstPassRate: number;       // 0..1 — ISCs que passaram sem retrabalho
  approvalsAccepted: number;      // o usuário aprovou sem mudar
  approvalsRejected: number;
  verificationFailures: number;   // falhas de ISC no período de janela
  demotedInWindow: boolean;
}

export interface TierEvaluation {
  current: TrustTier;
  eligible: TrustTier;            // o degrau que o histórico justifica
  blockedReason: string | null;   // por que não sobe mais (ex.: "1 falha recente")
}
```

```typescript
// apps/main/src/trust/evaluate.ts (novo)

// Limiares — concretos mas tunáveis; ajustar com uso real.
const CONFIAVEL_MIN_OUTCOMES = 5;
const AUTONOMO_MIN_OUTCOMES  = 15;
const AUTONOMO_MIN_PASS_RATE = 0.9;

export function evaluateTier(r: TrackRecord, current: TrustTier): TierEvaluation {
  let eligible: TrustTier = "novato";
  let blockedReason: string | null = null;

  if (r.verifiedOutcomes >= CONFIAVEL_MIN_OUTCOMES && r.verificationFailures === 0) {
    eligible = "confiavel";
  } else if (r.verificationFailures > 0) {
    blockedReason = `${r.verificationFailures} falha(s) de verificação no período`;
  }

  if (eligible === "confiavel"
      && r.verifiedOutcomes >= AUTONOMO_MIN_OUTCOMES
      && r.iscFirstPassRate >= AUTONOMO_MIN_PASS_RATE
      && !r.demotedInWindow) {
    eligible = "autonomo";
  }

  return { current, eligible, blockedReason };
}
```

A coleta de `TrackRecord` é um repo read-only (`trust/track-record.ts`) que faz `JOIN`s sobre `goals`/`goal_criteria` (M13), `approvals` (M7.5), `activity_events` (M9). Sem escrita.

### 4.4 A regra no gate de segurança

O gate existente (`request_permission` / file-fence, M5/M6) ganha **uma** regra nova, aplicada antes do prompt ao usuário:

```typescript
// no caminho de decisão do gate
if (agent.trustTier !== "novato" && isReadOnlyTool(toolName)) {
  return { decision: "allow", reason: "trust:confiavel-readonly" };
}
```

- `isReadOnlyTool(toolName)` — classificador puro: `true` para Read, Glob/Grep, `list_*`, `isa_read`, `telos_read`, e MCP tools marcadas não-destrutivas; `false` para Write, Edit, Bash, e qualquer tool de efeito colateral.
- A regra **só** auto-aprova read-only. Write/Bash/destrutivas **nunca** passam pela Escada — só pela Run Policy em `auto` (degrau Autônomo, §4.5).
- Toda auto-aprovação por trust é registrada em `activity_events` (auditoria — `reason: "trust:confiavel-readonly"`).

### 4.5 Acoplamento com a Run Policy

O degrau `autonomo` **é** `mode='auto'`. A Run Policy (M12 PR-E2) continua dona do campo `mode`; a Escada o dirige assim:

- Promoção para `autonomo` (aprovada pelo usuário) → o motor seta o campo `mode` da Run Policy do agente para `auto`.
- Rebaixamento de `autonomo` → o motor seta `mode = 'supervised'` imediatamente.
- O usuário **continua podendo** setar `mode` na mão na aba Config (M12). A Escada *sugere e dirige*, não remove o controle manual. Se o usuário forçar `auto` num agente `novato`, isso vale — a Escada não reverte um override manual; só registra a divergência na UI.

### 4.6 O motor de promoção/rebaixamento

Módulo `apps/main/src/trust/engine.ts`. Roda **reativamente**, nas bordas onde o track record muda:

- após `goal.achieved` / `goal.verified` (M13);
- após uma decisão de aprovação (aceita ou rejeitada);
- após um `verification_failed` (M13).

Fluxo a cada disparo, para o agente afetado:

```
record  = collectTrackRecord(agentId)
ev      = evaluateTier(record, agent.trustTier)

se ev.eligible > ev.current:
   novato → confiavel:    promove já. trust_event 'promoted'.            (item informativo na Vitrine)
   confiavel → autonomo:  trust_event 'promotion_suggested'
                          + inbox kind 'trust_promotion_suggested'.       (item de AÇÃO na Vitrine)
                          A promoção efetiva ocorre na aprovação do usuário.

se ev.eligible < ev.current:
   rebaixa já, sem perguntar. trust_event 'demoted'.                      (item informativo na Vitrine)
   se saiu de 'autonomo': o `mode` da Run Policy → 'supervised'.
```

- **Rebaixamento é imediato e não-bloqueante** — segurança vem antes de UX (§13). Promoção *para baixo* nunca espera o usuário.
- **Promoção para `autonomo` é a única que bloqueia** — vira `trust_promotion_suggested` no inbox; aprovar aplica a mudança de degrau + o flip de `mode`.
- A promoção `novato→confiavel` é automática mas **visível** — aparece na Vitrine como informativo, então o usuário nunca é surpreendido.

---

## 5. Peça 2 — Vitrine Matinal

### 5.1 Modelo de conteúdo e layout

Decididos no brainstorm (companion visual):

- **Modelo C — híbrido:** uma frase-manchete curta gerada por IA + blocos estruturados. Humano de ler, sem o custo de gerar um parágrafo todo dia (modelo A) e mais acolhedor que um rollup puro (modelo B).
- **Postura — triagem:** "⚠ Precisa de você" **domina** o topo da tela; o resto ("✓ Verificados · ✗ Falhou · ⏳ Em andamento · 📚 Aprendeu") fica numa faixa fina **colapsável**; rodapé com o custo da noite. A tese é "abre, resolve as pendências, sai" — a tela é uma fila de triagem, não um painel.

### 5.2 As seções e suas fontes

A Vitrine é majoritariamente um **read-model** — ela agrega dados que já existem.

| Seção | Fonte | Papel |
|---|---|---|
| **⚠ Precisa de você** | aprovações pendentes (`approvals`, M7.5) + inbox `verification_failed`/`verification_review` (M13) + inbox `trust_promotion_suggested` (M14) + agentes travados/escalados (M9 error handling) | Itens de ação — o que trava o dia do usuário. **Sempre no topo.** |
| **✓ Verificados** | goals que chegaram a `achieved` desde o cursor (M13) | Informativo. |
| **✗ Falhou / travou** | `verification_failed` + erros de agente desde o cursor | Informativo. |
| **⏳ Em andamento** | issues/agentes rodando agora | Informativo. |
| **📚 Aprendeu** | `skill_candidates` criados desde o cursor (M11) | Informativo. |
| **💰 Custo da noite** | soma de `cost_events` desde o cursor (M8) | Rodapé. |

### 5.3 O read-model

```typescript
// packages/shared/src/types/briefing.ts (novo)

export interface BriefingItem {
  id: string;
  label: string;             // ex.: "Verificação falhou — Goal 'Landing v2'"
  detail: string;            // ex.: "ISC 'build passa' falhou 3×"
  route: string;             // deep-link para a tela de resolução
  agentName: string | null;
}

export interface Briefing {
  headline: string;          // a manchete gerada (§5.4)
  needsYou: BriefingItem[];
  verified: BriefingItem[];
  failed: BriefingItem[];
  inProgress: BriefingItem[];
  learned: BriefingItem[];
  costCents: number;
  generatedAt: number;
  reviewedAt: number | null; // o cursor (§5.5)
}
```

```typescript
// apps/main/src/briefing/build.ts (novo)
export function buildBriefing(companyId: string, sinceTs: number): Briefing;
```

`buildBriefing` é puro-ish (queries de leitura + a manchete cacheada). Sem tabela própria — exceto o cursor (§5.5).

### 5.4 A manchete

A frase-manchete (modelo C) é gerada por **uma chamada `claude -p` curta** — reusa o runner headless do M12 PR-D1 (`derivation/runner.ts` + `buildAuthEnv`). O prompt recebe só os contadores estruturados (3 verificados, 1 falhou, 2 precisam de você, custo) e devolve **uma frase**.

Disciplina de token (regra dura `feedback_token_efficiency`):

- A manchete é **cacheada** junto com um hash dos contadores de entrada. `buildBriefing` só regenera se o hash mudou — abrir a Vitrine 5× no mesmo estado custa **zero** chamadas.
- Custo gravado em `cost_events`, `adapter_name='briefing-headline'` (padrão M12 PR-D1).
- Degradação graciosa: se a chamada falhar, a Vitrine mostra uma manchete determinística montada dos contadores ("3 outcomes fechados · 2 precisam de você"). A Vitrine nunca quebra por causa da manchete.

### 5.5 Cursor "desde a última revisão"

```sql
-- migration M14-03 — PR-C
ALTER TABLE companies ADD COLUMN briefing_reviewed_at INTEGER;
```

A Vitrine mostra o que é novo **desde `briefing_reviewed_at`**. Um botão "Marcar como revisado" avança o cursor para `now()`. Assim a Vitrine é sempre relevante — não importa se o usuário abre o app de manhã, à noite, ou pula um dia. NULL (estado inicial) = mostra tudo da janela padrão (ex.: últimas 24h).

### 5.6 Tela inicial

A Vitrine vira a **rota inicial** do app — é literalmente o que a tese descreve ("abre o app e olha"). O Dashboard atual (M9) continua acessível como segunda tela (rota `/dashboard`). Mudança no router do renderer; o Dashboard não é apagado nem reescrito.

---

## 6. Como as duas peças se cruzam

Não são duas features soltas num milestone — são um loop:

- A **Escada corta o volume** da seção "Precisa de você": cada agente que sobe para `confiavel`/`autonomo` gera menos aprovações pendentes. Com o tempo, a Vitrine de manhã fica mais curta — esse é o sinal de que a delegação está funcionando.
- A **Vitrine mostra os eventos da Escada:** `promotion_suggested` é um **item de ação** ("Ana merece subir para Autônomo — aprovar?"); `promoted`/`demoted` automáticos são **itens informativos**. O usuário acompanha a calibração da confiança sem precisar caçar.

Tirar uma das duas quebra o loop: a Escada sem a Vitrine esconde as próprias decisões; a Vitrine sem a Escada nunca encurta. Por isso são um milestone só.

---

## 7. Dados & migração

Migrações (numeração relativa — sequencial após as do M13):

- **M14-01** (PR-A) — `agents.trust_tier` (coluna) + `trust_events` (tabela). Ver §4.2.
- **M14-02** (PR-A) — inbox kind `trust_promotion_suggested` (recriação da tabela inbox com CHECK estendido — padrão das migrations `0019`–`0022`).
- **M14-03** (PR-C) — `companies.briefing_reviewed_at` (coluna). Ver §5.5.

Sem tabela pesada nova: `trust_events` é um log enxuto; a Vitrine é read-model. **Sem CHECK** em `trust_tier` (convenção do M13 §5.1: novo valor de enum é mudança só no tipo TS).

**Tipos compartilhados:** `packages/shared/src/types/trust.ts` e `briefing.ts` (novos). Zod schemas correspondentes em `apps/main/src/schemas/` (zod **nunca** em `shared` — lição `project_m7_6_lessons`).

---

## 8. Token efficiency

Regra dura (`feedback_token_efficiency`): o uso não pode inflar.

- **Escada de Confiança** — `evaluateTier` é função pura; `collectTrackRecord` são queries SQL. **Zero IA.**
- **Vitrine** — `buildBriefing` são queries SQL + **uma** chamada `claude -p` curta para a manchete, cacheada por hash dos contadores (§5.4). Abrir a Vitrine repetidamente no mesmo estado custa zero.
- **Nada é injetado no system prompt dos agentes** — o M14 é tudo orchestrator-side e UI. Não há overhead por-turno-de-agente.

**Alvo:** custo incremental por dia ≈ uma frase de IA. Desprezível.

---

## 9. IPC novos

| Canal | O que faz |
|---|---|
| `briefing:get` | Retorna a `Briefing` da empresa ativa (desde o cursor). |
| `briefing:mark-reviewed` | Avança `briefing_reviewed_at` para `now()`. |
| `trust:get-history` | Histórico de `trust_events` de um agente (para o painel na aba Config/Stats). |
| `trust:approve-promotion` | Aplica uma promoção `confiavel→autonomo` sugerida (chamado pela ação do inbox). |

Sem MCP tools novas — o M14 não dá capacidade nova aos agentes; ele governa e exibe. (O teste de contagem de canais IPC é atualizado junto — lição M9 PR-F.1.)

---

## 10. UI

| Onde | O quê |
|---|---|
| **Rota inicial** (nova) | A Vitrine Matinal — layout de triagem (§5.1). Vira o landing do app. |
| `/dashboard` | O Dashboard atual (M9), rebaixado para segunda tela. |
| **Agent detail** (Config ou Stats) | Badge do `trust_tier` + painel de histórico de confiança (`trust_events`) + o `blockedReason` ("por que não sobe"). |
| **Inbox** | Card novo: `trust_promotion_suggested` — com CTA Aprovar/Adiar. |
| Lista de agentes | Badge de tier (🌱/✓/⚡) em cada agente. |

IA fina decidida pela skill `frontend-design` na implementação. Os mockups validados no brainstorm estão em `.superpowers/brainstorm/` (modelo de conteúdo, postura de triagem, os 3 degraus).

---

## 11. Faseamento (PRs)

| PR | Escopo | Depende de |
|---|---|---|
| **A** | **Escada — backend.** Migração M14-01 + M14-02 · tipos `trust.ts` · `collectTrackRecord` (read repo) · `evaluateTier` (função pura) · regra `isReadOnlyTool` + hook no gate · `trust/engine.ts` (motor reativo) · acoplamento Run Policy · inbox `trust_promotion_suggested` · IPC `trust:*`. | M13 |
| **B** | **Escada — UI.** Badge de tier na lista e no agent detail · painel de histórico de confiança · fluxo de aprovação da promoção sugerida (card de inbox). | A |
| **C** | **Vitrine Matinal.** Migração M14-03 · tipos `briefing.ts` · `buildBriefing` (read-model) · geração + cache da manchete (`claude -p`) · IPC `briefing:*` · a tela de triagem · cursor "marcar como revisado" · virar rota inicial. | A |
| **D** | **Consolidação.** Polish da UI (`frontend-design`) · `SECURITY.md` (seção da Escada) · `ROADMAP.md` + `roadmap.html` · não-regressão completa. | A–C |

**Custo estimado:** ~12-18 dias.

---

## 12. Testes & não-regressão

**Testes:**

- Unit: `evaluateTier` — todas as transições (novato→confiavel, confiavel→autonomo, rebaixamentos, `blockedReason`).
- Unit: `isReadOnlyTool` — classificação correta de cada categoria de tool.
- Unit: cache da manchete — hash igual não regenera; hash diferente regenera.
- Integration: motor reativo — `goal.achieved` promove; `verification_failed` rebaixa; `confiavel→autonomo` cria o inbox e **não** promove até a aprovação.
- Integration: rebaixamento de `autonomo` reverte `run_policy_mode` para `supervised`.
- Integration: `buildBriefing` agrega cada seção das fontes corretas; o cursor filtra o que é "novo".
- Integration: a regra do gate auto-aprova read-only em `confiavel` e **bloqueia** Write/Bash.
- E2E: agente entrega outcomes verificados → sobe para confiável (visível na Vitrine) → continua → promoção sugerida no inbox → aprovar → vira autônomo, `mode=auto`.

**Não-regressão:**

- **Agente `novato` = comportamento de hoje.** O gate não muda nada para `novato`; a suíte de segurança existente passa intacta.
- A Vitrine é aditiva — o Dashboard antigo continua funcional na rota `/dashboard`.
- Token: nenhum overhead no system prompt dos agentes; custo incremental ≈ uma frase de IA/dia.
- M1–M13 intactos. Startup +200 ms máx.
- Mudança na interface de repos quebra mocks literais em `apps/main/tests/` — auditar (lição recorrente da família `project_m12_pr_a_lessons`).

---

## 13. Segurança

A Escada concede autonomia — então o desenho é conservador por construção:

1. **Rebaixamento é imediato e não-bloqueante.** Uma falha de verificação ou aprovação rejeitada derruba o agente na hora, sem esperar o usuário. Confiança erodida nunca fica pendente.
2. **A promoção mais perigosa passa por humano.** O salto para `autonomo` (que liga `mode=auto`) é a única que vira `trust_promotion_suggested` no inbox. O usuário aprova explicitamente.
3. **O gate nunca auto-aprova efeitos colaterais.** A regra da Escada cobre só read-only. Write/Bash/destrutivas seguem sob a Run Policy — a Escada não as toca.
4. **O agente não se auto-certifica.** A função de track record lê só outcomes **verificados pelo verification engine do M13** — que é orchestrator-side e fora do alcance do agente. Um agente não consegue inflar o próprio track record; isso fecha o vetor "agente mente que entregou para ganhar autonomia".
5. **Trust é por-agente e não-transferível.** Não há herança de confiança por papel nem por empresa.
6. **Tudo é auditável.** `trust_events` registra cada promoção/rebaixamento com motivo; cada auto-aprovação por trust vira `activity_event`.
7. **`SECURITY.md`** — seção nova: "Trust ladder — earned autonomy as an attack surface".

---

## 14. Out-of-scope do M14

- ❌ **Notificações de SO / push** ("sua empresa terminou — venha ver") — a Vitrine é uma superfície *pull* (você abre o app). Push é fast-follow barato, não V1 do milestone.
- ❌ **Score de confiança contínuo** (Abordagem 2) — descartado; o score é detalhe interno da função pura, não interface.
- ❌ **Unlock por tipo de ação** ("auto Read, depois auto Write" — Abordagem 3 / dívida M5 §5.5) — é escopo de milestone próprio.
- ❌ **Confiança herdada por papel** — cada agente constrói o próprio histórico.
- ❌ **Async + Trust governance** (auto mode 24h timeout + smart escalation) — é a *outra* recomendação da análise de lacunas (o re-tiering da V2); milestone separado, não o M14.
- ❌ **Fusão Dashboard ↔ Vitrine** — a Vitrine vira a tela inicial; o Dashboard fica intacto numa segunda rota. Consolidar os dois é decisão futura.

---

## 15. Decisões em aberto

- **Limiares exatos da escada** (`CONFIAVEL_MIN_OUTCOMES`, etc.) — valores concretos mas tunáveis; calibrar com uso real. "Confiança mal calibrada é pior que sem confiança" — começar conservador.
- **Janela do track record** — quantos dias `verificationFailures`/`demotedInWindow` olham para trás. Decidir no PR-A.
- **Cadência de regeneração da manchete** — só por mudança de hash (escolhido) vs. também um TTL. Reavaliar no PR-C.
- **Onde mora o painel de confiança** — aba Config vs. aba Stats do agent detail. Decisão de UX no PR-B.

---

## 16. Custo & posição no roadmap

**Custo estimado:** ~12-18 dias (~4 PRs).

**Pré-requisito:** **M13** — a Escada lê o histórico de outcomes verificados (`goal_criteria` verdes); a Vitrine usa os buckets de verificação (`verification_failed`/`verification_review`). Também depende de **M12 PR-E2** (Run Policy `mode`).

**Posição:** V2, **logo após o M13**. O M14 fecha a "lacuna do lado humano do loop" identificada na análise de lacunas da V2 — é a peça que torna a tese "abre o app uma vez por dia" literalmente verdadeira.

**Relação com as outras apostas V2:**

- **Routines** (Tier 1 — agentes acordam sozinhos) fica seguro: trabalho noturno de um agente `autonomo` roda sem pausar; o que ele produziu aparece triado na Vitrine de manhã.
- **Async + Trust governance** (a outra recomendação da análise — re-tiering) é **complementar, não coberta aqui**: o M14 calibra *quanto* um agente é interrompido; a Async governance trata *como* uma escalada noturna é resolvida sem o usuário. As duas juntas fecham o loop assíncrono — o M14 é metade dele.

**Próximo passo quando o M14 começar (pós-M13):** invocar a skill `writing-plans` para gerar o plano de implementação detalhado, PR a PR.

---

## 17. Referências

- [docs/superpowers/specs/2026-05-18-m13-outcome-verification-spine-design.md](2026-05-18-m13-outcome-verification-spine-design.md) — o M14 consome o histórico de verificação do M13.
- [docs/m12-agent-org-definition-layer.md](../../m12-agent-org-definition-layer.md) — Run Policy (`mode`) e o runner `claude -p` (PR-D1) que o M14 reusa.
- [ROADMAP.md](../../../ROADMAP.md) — §Visão V2; análise de lacunas de 2026-05-18 (esta sessão).
- Mockups validados no brainstorm: `.superpowers/brainstorm/` — modelo de conteúdo, postura de triagem, os 3 degraus da escada.
- Código atual: `apps/main/src/db/migrations/0007_approvals.sql`, `0011_cost_events.sql` · `apps/main/src/derivation/runner.ts` (runner `claude -p`) · gate de segurança (`request_permission`, M5).
