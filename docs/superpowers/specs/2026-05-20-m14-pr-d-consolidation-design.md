# M14 PR-D — Consolidation Design (2026-05-20)

> Last PR of M14. Closes seven follow-ups carried from PR-A/B/C plus the spec §11 row D items: `SECURITY.md`, `roadmap.html`, polish da UI. Não introduz peças novas — só amarra o que ficou aberto.

## 1. Context

M14 entregou três peças até aqui:

- **PR-A** — Escada de Confiança (backend): `trust_tier` + `trust_events` + motor reativo + gate rule + IPC.
- **PR-B** — Escada de Confiança (UI): `TrustTierBadge` + `TrustHistoryPanel` + `TrustPromotionCard`.
- **PR-C** — Vitrine Matinal: `Briefing` read-model + manchete `claude -p` cacheada + vira rota inicial.

Cada PR deixou follow-ups conscientes ("fica pra PR-D" ou "se ficar barulhento na prática"). PR-D coleta esses follow-ups num único PR bundled em `main`, mais o que a spec §11 row D pede explicitamente.

## 2. Scope

Sete itens, ordenados como seis commits sequenciais em `main` (mais um audit sem commit). Cada commit mantém `pnpm typecheck`, `pnpm lint`, e os testes verdes.

| # | Tipo | Item | Custo |
|---|------|------|-------|
| 1 | feat | Live broadcast do tier change | ~1h |
| 2 | feat | `blockedReason` tooltip no `TrustTierBadge` | ~45min |
| 3 | feat | Live refresh da Vitrine via `INBOX_UPDATE` | ~30min |
| 4 | polish | UI da Vitrine via `frontend-design` (cap 200 LOC) | ~2-3h |
| 5 | doc | `SECURITY.md` — Trust ladder + nota Vitrine | ~30min |
| 6 | doc | `roadmap.html` — refresh M14 + fix "agente→funcionário" | ~2h |
| 7 | audit | Não-regressão final do M14 | ~30min |

Estimativa total: **~7-8h**.

## 3. Detalhes por item

### 3.1 Live broadcast do tier change (commit 1)

**Arquivos:**
- `apps/main/src/agents/repository.ts` — `setTrustTier(id, tier)` dispara broadcast.
- `packages/shared/src/types/agent.ts` — estender `AgentEvent` union com `{ kind: "trust-tier-changed"; agentId: string; tier: TrustTier }`.
- `apps/renderer/src/stores/agents.ts` — handler que atualiza `agent.trustTier` no array em memória.

**Mecanismo:** reusa o canal `IPC.AGENT_EVENT` (M5). O método `setTrustTier` chama `broadcastAgentEvent({ kind: "trust-tier-changed", agentId, tier })`. Confirmar nome do helper via grep — o repo já usa um para `status` / `current-action` deltas (M7.5 PR-C).

**Teste:** estender `apps/main/src/agents/repository.test.ts` — mock recorder ou broadcaster, assert call. Estender `apps/renderer/src/stores/agents.delta-handlers.test.ts` — evento `trust-tier-changed` muta `agents` slice.

**Auditoria de exhaustive switches:** ao adicionar variant à union, grep `switch (event.kind)` ou `switch (ev.kind)` nos consumers — qualquer `default: never` quebra (lição [[project-m11-pr-c-ui-lessons]]).

### 3.2 `blockedReason` tooltip (commit 2)

**Decisão arquitetural:** não materializar `blockedReason` no banco. Em vez disso, criar um IPC read-only `trust:get-evaluation(agentId) → TierEvaluation` que computa sob demanda via `evaluateTier(collectTrackRecord(...), agent.trustTier)`. Mantém o invariante "score não é estado armazenado".

**Arquivos:**
- `packages/shared/src/ipc-channels.ts` — `TRUST_GET_EVALUATION: "trust:get-evaluation"`.
- `apps/main/src/ipc/trust-handlers.ts` — novo método `getEvaluation({ agentId })`.
- `apps/main/src/ipc/preload.ts` + `apps/renderer/src/env.d.ts` — expor `trust.getEvaluation`.
- `apps/renderer/src/components/trust/TrustTierBadge.tsx` — estado local `blockedReason`, fetch em `onMouseEnter` (lazy). Fallback `title` = `t("trust.badge.title.<tier>")` quando ainda não fetched.
- `apps/renderer/src/i18n/{en-US,pt-BR}.json` — keys `trust.badge.blockedPrefix` (ex.: "Por que não sobe: {{reason}}").

**Teste:** `apps/main/tests/trust-handlers.test.ts` extender — `getEvaluation` retorna `TierEvaluation` correto (current + eligible + blockedReason). Renderer fica sem teste novo (lazy fetch + tooltip render).

### 3.3 Live refresh da Vitrine via `INBOX_UPDATE` (commit 3)

**Arquivos:**
- `apps/renderer/src/stores/briefing.ts` — nova action `subscribeInbox(companyId): () => void` que registra um listener `window.prospero.inbox.onUpdate(() => load(companyId))` e retorna o unsubscribe.
- `apps/renderer/src/routes/Briefing.tsx` — `useEffect(() => subscribeInbox(activeCompanyId), [activeCompanyId])`.

**Mecânica:** o handler de inbox já existe no preload (`window.prospero.inbox.onUpdate`) e já é consumido pelo `useInboxStore`. Reusa o mesmo canal.

**Sem debounce:** `INBOX_UPDATE` é fire-and-forget de baixa frequência; reload por evento é aceitável. Cache da manchete protege custo (mesmo hash = mesma resposta).

**Sem teste novo:** subscribe/cleanup é mecânico; verificação fica no smoke manual.

### 3.4 Polish UI da Vitrine (commit 4)

**Arquivo:** `apps/renderer/src/routes/Briefing.tsx`.

**Restrições:**
- **Cap explícito: 200 LOC novos.**
- Tailwind tokens reais (confirmar em `apps/renderer/tailwind.config.ts`); sem emojis.
- **Não tocar** store, route flip, IPC.

**Diretrizes pra `frontend-design`:**
- Contraste forte do bucket "Precisa de você" vs. os outros.
- Ritmo vertical consistente.
- Talvez SVG dots por bucket (mesmo padrão do `TrustTierBadge`).
- Loading / empty / error states explícitos (já existem; só polish).

**Sem teste novo** (visual, validar pelo smoke manual).

### 3.5 `SECURITY.md` (commit 5)

Adicionar duas seções:

**§ "Trust ladder — earned autonomy (M14 PR-A/B)"** (espelhando o template das seções existentes):
- Mecanismo: 3 degraus; gate auto-aprova só read-only; `mode=auto` só com aprovação explícita do usuário via inbox card.
- Mitigações: rebaixamento imediato em falha de verificação; track record vem **só** do verification engine do M13 (agente não pode auto-certificar); auditoria completa em `trust_events` + `activity_events`.
- Known gap: manual override de `mode` pelo usuário não é revertido pela escada (escolha consciente — usuário mantém controle).

**§ "Morning briefing — read-only triage surface (M14 PR-C)"** (curta):
- A Vitrine é read-only; cursor `briefing_reviewed_at` é write-only.
- Manchete via `claude -p` é o único caminho per-user-action; cacheada por hash dos contadores; fallback determinístico em falha.
- Contadores não incluem dados sensíveis dos agentes (só 6 inteiros agregados).

### 3.6 `roadmap.html` refresh (commit 6)

**Arquivos:**
- `docs/roadmap.html` — seções `/00` e `/03` ganham menção a M14 (Escada de Confiança + Vitrine Matinal) em tom leigo.
- **Fix `agente→funcionário`** no calculator + simulator (inconsistência pré-existente do M13 PR-F Task 7 — bullets novos usam "funcionário" mas calculator/simulator ainda usam "agente").

**Tom:** layperson, sem jargão técnico. Mirror o `ROADMAP.md` "Em linguagem simples". Ler os dois lado a lado antes de editar.

**QA:** abrir no navegador, conferir animações + responsivo (também era pendência do handoff anterior).

### 3.7 Audit final do M14 (commit 7 — opcional)

Sem código novo. Checklist:

- [ ] `pnpm typecheck` clean nos 4 pacotes
- [ ] `pnpm lint` clean
- [ ] `pnpm test` — espera **~1644** + 2 todo (1641 baseline + ~3 novos)
- [ ] `pnpm --filter @prospero/shared test ipc-channels` — verde
- [ ] `pnpm --filter @prospero/main test security` — verde
- [ ] grep `apps/main/src/orchestrator` por `trust_tier|briefing_reviewed_at|trust:get-evaluation` → confirmar zero growth no system prompt do agente
- [ ] Smoke manual da Vitrine atualizando ao vivo (criar inbox item, ver refresh) — opcional, fica no relatório

**Sem commit** a menos que algo precise fix.

## 4. Riscos & mitigações

| Risco | Mitigação |
|-------|-----------|
| Estender `AgentEvent` quebra `switch (ev.kind)` em consumers | Auditar todos os switches; `default: never` exhaustive precisa update |
| `frontend-design` propõe redesign grande | Cap 200 LOC explícito; trim antes de commitar |
| `roadmap.html` fica inconsistente com `ROADMAP.md` | Ler os dois lado a lado |
| `INBOX_UPDATE` listener vaza | `useEffect` retorna unsubscribe; React cleanup no unmount |
| `trust:get-evaluation` chamado pra cada agente da lista | Fetch só on mouseenter; badge renderiza com `title` fallback |

## 5. Fora de escopo

- Smoke manual do M14 — pendência separada (precisa do app rodando).
- Smoke do `claude -p` headless — pendência desde M11, mitigada pelo fallback.
- OS notifications / push da Vitrine — spec §14 deferred.
- Fusão Dashboard ↔ Vitrine — spec §14 deferred.
- Hardening do `criterion_judge` (forçar agente ≠ executor) — gap V2 do M13.
- Materializar `blockedReason` no banco — preferimos compute-on-demand.

## 6. Critério de pronto

- 6 commits em `main` (1-6) + audit (7) sem commit a menos que precise fix.
- Push pra `origin/main`.
- `ROADMAP.md` atualizado refletindo **M14 fechado (4/4 PRs)**.
- Memória: `project_m14_pr_d_lessons.md` + handoff.
- M14 inteiro encerrado como **fechado** — abre caminho pra M15 (Routines) ou próxima peça V2.

## 7. Ordem dos commits

1. `feat(trust): broadcast agent change on tier mutation`
2. `feat(trust): show blockedReason tooltip on the tier badge`
3. `feat(briefing): live-refresh when inbox changes`
4. `feat(briefing): polish UI`
5. `docs(security): document trust ladder and morning briefing`
6. `docs(roadmap): refresh public roadmap.html for m14`
7. `test(m14): non-regression audit` (opcional)

Cada commit é independente; reverter um não afeta os outros.
