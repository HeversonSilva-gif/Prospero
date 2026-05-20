# M13 PR-F — Consolidation Design (2026-05-20)

> Último PR do M13. Costura final do milestone: fecha follow-ups acumulados de PR-A a PR-E, atualiza docs públicos e auditoria de não-regressão. Não introduz peças novas — só amarra o que ficou aberto.

## 1. Contexto

M13 entregou cinco peças até aqui:

- PR-A — ISA (Ideal State Artifact)
- PR-B (B1+B2) — Motor de verificação + tools de agente
- PR-C — TELOS
- PR-D — The Algorithm
- PR-E — Containment Zones

Cada PR mergeado deixou follow-ups conscientes (decisões "fica pra PR-F" ou
"se ficar barulhento na prática"). PR-F coleta esses follow-ups num único PR
bundled em `main`, mais o que a spec §15 row F pede explicitamente: polish
da UI, atualização de `SECURITY.md`, refresh do `roadmap.html` público, e
auditoria de não-regressão.

## 2. Escopo

Oito itens, ordenados como 8 commits sequenciais em `main`. Cada commit
mantém `pnpm typecheck` e os testes verdes.

| # | Tipo | Item | Custo |
|---|------|------|-------|
| 1 | bug | `validateTelos` na síntese | ~30min |
| 2 | bug | `company:export` + `:import` carregam `isa.md` + `telos.md` | ~1h |
| 3 | bug | Broadcast de UI no `criterion_judge` | ~30min |
| 4 | feat | Inbox card pra `security.zone_blocked` | ~45min |
| 5 | polish | UI da Vitrine de Verificação (`frontend-design`) | ~2-3h |
| 6 | doc | `SECURITY.md` — zones + verificação como vetores | ~30min |
| 7 | doc | `roadmap.html` refresh M11/M12/M13 | ~2h |
| 8 | audit | Não-regressão final do M13 | ~30min |

Estimativa total: **~8-10h de trabalho contínuo**.

## 3. Mudanças detalhadas

### 3.1 `validateTelos` na síntese

**Arquivo:** `apps/main/src/companies/telos-synthesis.ts`.

Depois do `sanitizeMemoryBody`, chamar `validateTelos(body)` (já exportado
de `@prospero/shared/telos`). Se retornar erros, propagar como
`{ error: string[] }` opcional no `TelosDraft` retornado.

**UI:** rota `/telos` (componente que consome a síntese — confirmar
caminho exato no implementador). Quando `draft.error` chega, renderizar
inline acima do editor com lista de problemas. **Não bloquear o save** —
usuário decide editar ou ignorar.

**Teste:** estender `telos-synthesis.test.ts` com caso de síntese
malformada (string sem `## Mission`).

### 3.2 `company:export` + `:import` carregam ISA + TELOS

**Arquivo:** `apps/main/src/ipc/companies-handlers.ts` (handlers `:export`
e `:import`).

**Export:** `apps/main/src/companies/export.ts` (`CompanyExportV1`).

- Adicionar campo top-level `artifacts?: { companyTelos?: string; goalIsas?: Record<string, string> }`.
- Ler `<userData>/memory/companies/<cid>/telos.md` se existir → grava em
  `artifacts.companyTelos`.
- Para cada goal exportado, ler `<userData>/companies/<cid>/goals/<gid>/isa.md` se
  existir → `artifacts.goalIsas[<gid>]`.

**Import:** `apps/main/src/companies/import.ts`. Depois do two-pass de
linhas, se `artifacts.companyTelos` presente, escrever em
`<userData>/memory/companies/<newCid>/telos.md` e setar
`companies.telos_path` no destino. Se `artifacts.goalIsas` presente,
para cada `gid` mapear pra o `goalId` novo via `idMap` e escrever
`<userData>/companies/<newCid>/goals/<newGid>/isa.md` + setar
`goals.isa_path`.

**Schema:** estender `CompanyImportSchemaV1` em
`apps/main/src/companies/import-schema.ts` com:

```typescript
artifacts: z
  .object({
    companyTelos: z.string().optional(),
    goalIsas: z.record(z.string()).optional(),
  })
  .optional(),
```

Mantém `schemaVersion: 1` — campos opcionais preservam backwards-compat
com exports antigos do M9 PR-F.2.1 sem bumpar a versão.

**Teste:** round-trip — exportar empresa com TELOS + 1 goal com ISA,
importar como empresa nova, ler de volta os bodies do disco, comparar.

### 3.3 Broadcast no `criterion_judge`

**Arquivo:** `apps/main/src/mcp/tools-isa.ts` + módulo que expõe
`reevaluateGoalFromState` (verificar com grep no implementador).

O B1 broadcasta via `broadcastGoalChanged` quando a checagem automática
fecha um goal; o B2 (`criterion_judge`) não passa o callback. Threadar
`notify` opcional pelo `ToolContext` ou via
`BrowserWindow.getAllWindows()` (mesmo pattern do B1 — copy/paste o
broadcast, não inventar novo channel).

**Teste:** estender `tools-isa.test.ts` — assert que
`broadcastGoalChanged` foi chamado quando o judge fecha um goal.

### 3.4 Inbox card pra `security.zone_blocked`

**Arquivo:** `apps/main/src/security/gate.ts` `auditZoneBlocked` —
depois do `recordActivity`, também cria inbox item via
`tryGetInboxRepository()` ou pattern similar (auditar como outros
gates/eventos criam inbox sem acoplamento).

- **Kind:** `security_zone_blocked` (string livre, sem migration — padrão
  M11/M13).
- **Payload:** `{ attemptedPath, zoneKind, reason }` (mesma shape do
  activity event).
- **De-dup:** se já existir card unread do mesmo
  `(companyId, agentId, kind)` nos últimos 5 minutos, **não cria outro**.
  Evita barulho se o agente retentar.
- **CTA:** nenhum — só informativo. Sem botões de aprovar/rejeitar.

**UI:** `apps/renderer/src/components/InboxItem.tsx` (ou switch de kind
equivalente). Render preview com path tentado + reason. Sem botões de
ação.

**Teste:** `gate-zones.test.ts` — assert que inbox row foi criada no
deny; +1 teste pra de-dup em <5min.

### 3.5 Polish da UI da Vitrine de Verificação

**Arquivo:** componente que renderiza a checklist ISC em `/goals/:id` —
provavelmente `apps/renderer/src/components/goals/VerificationPanel.tsx`
(confirmar com grep no implementador).

Usar **skill `frontend-design`** pra propor um polish. Diretrizes:

- Estados loading/empty/error explícitos.
- Contraste entre critérios pendentes vs. verificados vs. falhados.
- Ritmo vertical consistente.
- **Sem emojis** (regra do projeto — ver feedback memory).
- Apenas tokens reais de Tailwind (confirmar em `tailwind.config.ts`).
- **Cap: 200 LOC novos** — é polish, não redesign.

Sem teste novo (visual, validar pelo smoke manual).

### 3.6 `SECURITY.md` — zones + verificação

**Arquivo:** `SECURITY.md` (raiz do repo). Adicionar duas seções:

**§ "Containment zones (M13 PR-E)"** — declara o classifier `zoneOf` +
`canAccess` + audit `security.zone_blocked`. Deixa claro que é
defense-in-depth sobre o sandbox CWD do M6.1, não substituto.

**§ "Verification as an attack surface"** — agente malicioso pode tentar
marcar critério como passed sem rodar o check. Mitigação atual:
`criterion_judge` registra o `verified_by` (audit). Aberto:
`criterion_check` é self-reported pelo agente que fez o trabalho —
hardening (forçar agente diferente) fica pra V2.

### 3.7 `roadmap.html` refresh

**Arquivo:** `docs/roadmap.html` (página pública pra leigos, não devlog).

Atualizar seções `/00` (visão geral) e `/03` (status) refletindo
M11 + M12 + M13 inteiros. Tom: o que dá pra fazer **hoje**, sem jargão
técnico. Ler `ROADMAP.md` lado a lado pra preservar consistência de
narrativa.

QA manual: abrir no navegador local, conferir animações + responsivo
(já era pendência do handoff).

### 3.8 Não-regressão final do M13

Sem código novo. Checklist:

- [ ] `pnpm typecheck` clean nos 4 pacotes
- [ ] `pnpm lint` clean
- [ ] `pnpm test` — espera ≥ 1555 (1550 atual + ~5 dos PR-F)
- [ ] `packages/shared/tests/ipc-channels.test.ts` verde
- [ ] `pnpm --filter @prospero/main test security` — todos verdes
- [ ] grep `apps/main/src/orchestrator` por imports do PR-F → confirmar
      zero crescimento de system prompt
- [ ] (manual) abrir o app, smoke: rota `/telos` mostrando erro de
      validação; `/goals/:id` com UI polida; inbox recebendo card de
      zone_blocked após simular cross-zone

## 4. Riscos & mitigações

| Risco | Mitigação |
|-------|-----------|
| Export schema quebra backwards-compat com M9 PR-F.1 | Campos `.optional()` no Zod; import lida com `undefined` |
| `frontend-design` propõe redesign grande | Cap explícito de 200 LOC; instrução "polish, não redesign" |
| `roadmap.html` fica inconsistente com `ROADMAP.md` | Ler os dois lado a lado antes de editar |
| Inbox enchendo com `zone_blocked` se agente loopa | De-dup de 5min; aceitar barulho residual |

## 5. Fora do escopo

- **Smoke manual do M13** — pendência separada (precisa do app rodando).
- **Smoke do `claude -p` headless** — pendência desde M11, não resolvida aqui.
- **Inbox card pra outros `security.*` events** — só `zone_blocked` por enquanto.
- **Hardening do `criterion_judge`** (forçar agente ≠ executor) —
  `SECURITY.md` documenta como aberto; fix fica pra V2.
- **Tradução do `SECURITY.md`** — fica em inglês.

## 6. Critério de pronto

- 8 commits em `main` com convenção `feat(...) / docs(...) / test(...)`.
- Push pra `origin/main`.
- `ROADMAP.md` atualizado refletindo M13 fechado (6/6 PRs).
- Memória atualizada: `project_m13_pr_f_lessons.md` + handoff.
- M13 inteiro encerrado como **fechado** — abre caminho pra M14 (Vitrine
  Matinal & Escada de Confiança).

## 7. Ordem dos commits

1. `feat(telos): validate synthesized telos before saving`
2. `feat(company): include isa.md and telos.md in company export`
3. `feat(verification): broadcast goal update when criterion_judge completes`
4. `feat(security): add zone_blocked inbox card`
5. `feat(verification): polish goal verification panel`
6. `docs(security): document zones and verification as attack vectors`
7. `docs(roadmap): refresh public roadmap.html for m11-m13`
8. `test: m13 non-regression audit`

Cada commit é independente — pode reverter um sem afetar os outros.
