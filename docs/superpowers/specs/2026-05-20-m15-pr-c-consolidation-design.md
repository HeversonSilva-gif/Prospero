# M15 PR-C — Routines Consolidação

> **Status:** spec do PR-C (2026-05-20). Pré-req: M15 PR-A (`07aeff7`) + PR-B (`724d02f`) mergeados em `main`.
>
> **Fontes:** spec base [docs/superpowers/specs/2026-05-18-m15-routines-design.md](2026-05-18-m15-routines-design.md) §16 ("Próximo passo"); brainstorm 2026-05-20 (esta sessão, ASCII inline — 2 decisões: history como seção colapsável + linha rica com bolinha/chip); follow-ups documentados em [[project-m15-pr-b-lessons]].
>
> **Sucessor:** M16 redesign da interface OU próxima milestone V2 (Workflow Plays / Async governance — decisão do usuário em sessão futura).

---

## 1. Objetivo

Fechar o M15. Entregar 6 itens:

1. **Painel de Histórico** em `/routines/:id` (seção colapsável; reusa `activity:query` do M7.7 sem IPC novo).
2. **`SECURITY.md` seção Routines** — threat model curto + gap V2 conhecido (instruções autoradas por agente).
3. **`roadmap.html` atualização** cosmética — Routines de "em construção" pra ✅.
4. **`ROADMAP.md` fechar M15** (3/3 PRs).
5. **Polish UI** (cap +200 LOC):
   - Limpar dead i18n keys `routines.empty.cta` + `routines.empty.title` (pt + en).
   - `setTimeout` cleanup em `RoutineRow.tsx` + `RoutineForm.tsx` (Rodar agora).
   - Widen `TFunction` em `format-summary.ts` (elimina `as unknown as TFunction` em RoutineRow).
   - Mover `formatRelative` de RoutineRow.tsx pra `format-summary.ts` (compartilhar com RoutineHistoryRow).
6. **Não-regressão completa** — full suite verde, smoke manual se Electron estiver disponível.

**Custo estimado:** 1-2 dias · ~8 tasks.

---

## 2. Decisões travadas (do brainstorm)

| Decisão | Escolha | Motivo |
|---|---|---|
| **Onde vive o histórico em `/routines/:id`?** | Seção colapsável abaixo do form | Form é o foco principal (criar/editar). Routines disparam 1-2×/dia tipicamente — history raramente é o ponto central. Já temos `<Section>` primitive para o padrão de header colapsável. |
| **Como apresentar cada linha do histórico?** | Linha rica com bolinha (verde/cinza) + status em PT + reason em chip | Consistência visual com `RoutineRow` da lista. Bolinha dá scan rápido (✓ vs ✗) sem palavra. Chip separa "what" do "why". |

---

## 3. Arquitetura — file map

### Criados (renderer, 2)

| Arquivo | Responsabilidade |
|---|---|
| `apps/renderer/src/components/routines/RoutineHistory.tsx` | Seção colapsável. Subscreve estado interno `expanded` + `events` + `loading` + `error`. Ao expandir pela primeira vez, dispara `window.prospero.activity.query` com filtros. Header colapsável com contador e botão refresh. |
| `apps/renderer/src/components/routines/RoutineHistoryRow.tsx` | Linha individual. Props: `{ event: ActivityEventRow }`. Bolinha + status PT + chip de reason + timestamp formatado via `formatRelative`. |

### Modificados (renderer, 4)

| Arquivo | Mudança |
|---|---|
| `apps/renderer/src/routes/RoutineForm.tsx` | Adiciona `<RoutineHistory routineId={id} companyId={activeCompanyId} />` abaixo do form, SÓ em edit mode (não em `/routines/new`). `setTimeout` do "Rodar agora" passa a usar `useRef` + `useEffect` cleanup. |
| `apps/renderer/src/components/routines/RoutineRow.tsx` | Remove `as unknown as TFunction` cast (pós-widen). Mesma transformação do `setTimeout` via `useRef` + cleanup. Importa `formatRelative` de `lib/routines/format-summary.ts`. |
| `apps/renderer/src/lib/routines/format-summary.ts` | Widen `TFunction` pra `(key: string, params?: Record<string, unknown>) => string`. Exporta `formatRelative(ts, neverLabel)` (movido de RoutineRow.tsx). |
| `apps/renderer/src/lib/routines/format-summary.test.ts` | +3 testes pra `formatRelative` (hoje, ontem, antigo). |
| `apps/renderer/src/i18n/en-US.json` + `pt-BR.json` | Remove `routines.empty.cta` + `.empty.title`. Adiciona ~14 chaves de `routines.history.*`. |

### Modificados (docs, 3)

| Arquivo | Mudança |
|---|---|
| `SECURITY.md` | Nova seção "Routines (M15)" — ~25 linhas após a seção do trust ladder. |
| `docs/roadmap.html` | Bullet de Routines passa de "🚧 em construção" pra ✅ com copy leigo. |
| `ROADMAP.md` | "▸ Agora" + "Status atual" fecham M15 (3/3 PRs); "▸ Próximo" passa pra próxima V2 milestone. |

**Total:** 2 criados + 9 modificados = 11 arquivos (renderer: RoutineForm + RoutineRow + format-summary.ts + format-summary.test.ts + en-US.json + pt-BR.json; docs: SECURITY.md + roadmap.html + ROADMAP.md). ~8 tasks.

---

## 4. Componentes — assinaturas

### 4.1 `RoutineHistory`

```typescript
type Props = {
  routineId: string;
  companyId: string;
};
```

Comportamento:

- Estado interno: `expanded: boolean` (default `false`), `events: ActivityEventRow[] | null` (null = not yet loaded), `loading: boolean`, `error: string | null`.
- Header sempre visível: `Histórico de disparos{events !== null ? ` (${events.length})` : ""}` + chevron + botão "Atualizar" (SVG refresh icon) visível quando `expanded && events !== null`.
- Click no header alterna `expanded`. Primeira expansão dispara `load()`.
- `load()` chama:
  ```typescript
  const rows = await window.prospero.activity.query({
    companyId,
    filters: { entityKind: "routine", entityId: routineId },
    limit: 20,
  });
  ```
  (IPC `ACTIVITY_QUERY` do M7.7 já existe e aceita `entityKind`/`entityId` filters via `ActivityQueryFilters`.)
- Loading: `loading: true` → mostra `<LoadingState>` primitive (ou skeleton inline).
- Empty: `events !== null && events.length === 0` → renderiza `<EmptyState message={t("routines.history.empty")} />`.
- Erro: banner inline dismissable no topo da seção.
- "Atualizar" botão re-executa `load()`.

### 4.2 `RoutineHistoryRow`

```typescript
type Props = {
  event: ActivityEventRow; // action: "routine.fired" | "routine.skipped"
};
```

Layout:

```
●  15:32 · Disparada                            scheduled
○  ontem 18:00 · Pulada                         orçamento pausado
```

Implementação:
- `const isFired = event.action === "routine.fired";`
- Bolinha: `bg-semantic-success` quando fired, `bg-ink-soft` quando skipped.
- Status PT: `t("routines.history.status.fired")` / `t("routines.history.status.skipped")`.
- Reason: `(event.payload as { reason: string }).reason`. Chip à direita com label traduzido via `t(\`routines.history.reason.${reason}\`)`.
- Timestamp: `formatRelative(event.createdAt, t("routines.row.neverFired"))` (importado de format-summary.ts).

### 4.3 Reuse de IPC

PR-A já registra `routine.fired`/`routine.skipped` com `entityKind: "routine"` + `entityId: routine.id`. PR-C **não cria IPC novo** — usa o `activity:query` do M7.7.

Confirmação no preload (`apps/main/src/ipc/preload.ts`): a chave `activity.query` já está exposta. Caso a tipagem em `apps/renderer/src/env.d.ts` esteja incompleta para essa surface, estender no escopo desta task.

---

## 5. Polish fixes — escopo detalhado

### 5.1 `setTimeout` cleanup em RoutineRow + RoutineForm

**Problema:** o handler "Rodar agora" usa `setTimeout(setRunStatus, 2000)`. Se o usuário navegar (ou desmontar o componente) antes dos 2s, `setRunStatus` dispara num componente desmontado → warning React (silenciado em React 18, mas é code-smell).

**Fix** — padrão `useRef` + `useEffect` cleanup. Aplica em:
- `apps/renderer/src/components/routines/RoutineRow.tsx`
- `apps/renderer/src/routes/RoutineForm.tsx`

Template:

```typescript
const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
  return () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
  };
}, []);

const handleRun = (e: MouseEvent): void => {
  e.stopPropagation();
  void (async () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    try {
      await onRun();
      setRunStatus("fired");
    } catch {
      setRunStatus("error");
    }
    timerRef.current = setTimeout(() => setRunStatus("idle"), 2000);
  })();
};
```

### 5.2 Widen `TFunction`

Hoje (`apps/renderer/src/lib/routines/format-summary.ts`):

```typescript
export type TFunction = (key: string, params?: Record<string, string | number>) => string;
```

i18next `t` é mais permissivo. Widen pra aceitar i18next:

```typescript
export type TFunction = (key: string, params?: Record<string, unknown>) => string;
```

Resultado: `RoutineRow.tsx` pode usar `const { t } = useTranslation();` direto sem o cast `as unknown as TFunction`. Confirmar via typecheck.

### 5.3 Mover `formatRelative` pra `format-summary.ts`

Hoje vive privado em `RoutineRow.tsx`. Vai ser usado por `RoutineHistoryRow` também. Mover + exportar:

```typescript
// apps/renderer/src/lib/routines/format-summary.ts
export const formatRelative = (ts: number | null, neverLabel: string): string => {
  if (ts === null) return neverLabel;
  const d = new Date(ts);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return formatAtMinute(d.getHours() * 60 + d.getMinutes());
  }
  return d.toLocaleDateString();
};
```

`RoutineRow.tsx` importa ao invés de redefinir.

### 5.4 Dead i18n keys

Remover de ambos os locales:
- `routines.empty.cta`
- `routines.empty.title`

Ambos foram adicionados no PR-B mas nunca consumidos (o `EmptyState` primitivo só aceita `message` + `icon`).

---

## 6. i18n — chaves novas

### Removidas (pt + en)

- `routines.empty.cta`
- `routines.empty.title`

### Adicionadas (pt-BR / en-US)

```
routines.history.title                        "Histórico de disparos" / "Fire history"
routines.history.empty                        "Esta routine nunca disparou" / "This routine has never fired"
routines.history.refresh                      "Atualizar" / "Refresh"
routines.history.expand                       "Expandir" / "Expand"
routines.history.collapse                     "Colapsar" / "Collapse"
routines.history.status.fired                 "Disparada" / "Fired"
routines.history.status.skipped               "Pulada" / "Skipped"
routines.history.reason.scheduled             "agendada" / "scheduled"
routines.history.reason.catchup               "atrasada (catch-up)" / "catch-up"
routines.history.reason.event                 "por evento" / "event-triggered"
routines.history.reason.manual                "manual" / "manual"
routines.history.reason.agent_unavailable     "agente indisponível" / "agent unavailable"
routines.history.reason.budget_paused         "orçamento pausado" / "budget paused"
```

13 chaves novas, 2 removidas → net +11. Parity test deve passar.

---

## 7. SECURITY.md — nova seção

Inserir após a seção do trust ladder (M14 PR-A), preservando ordem cronológica das milestones. Conteúdo (~25 linhas):

```markdown
### Routines (M15)

A *routine* wakes a target agent on a schedule (cron-like, structured)
or on a fixed activity event. The routine itself is data — the user
authors the instruction string via the `/routines` UI; no agent
generates routines.

**Threat model:**
- *Prompt injection via routine instruction* — N/A. Instructions are
  user-authored.
- *Agent escapes via routine* — N/A. The agent woken by a routine
  passes through the gate (`request_permission`) and the trust ladder
  (M14) exactly as if the user had sent the turn manually. A `novato`
  agent will still block at the first sensitive tool call.
- *Routines firing across companies* — Blocked by FK cascade. A
  routine and its target agent share a `company_id` (PR-A migration
  `0035`); `ON DELETE CASCADE` on both companies and agents wipes
  routines automatically.
- *Routine firing on budget-paused agent* — Blocked by `fireRoutine`
  skip rule (`budget_paused`). The routine logs a `routine.skipped`
  activity event and does NOT despause.
- *Stale schedule* — Mitigated by PR-B fix: `routines:update` re-seeds
  `nextFireAt` via `computeNextFire` when `scheduleSpec` changes. Without
  this, an edit "09:00 → 14:00" would still fire at 09:00 once before
  self-correcting.

**Known V2 hardening gap:** routines authored by agents (via a future
MCP tool) would re-open the prompt-injection vector. Out of scope for
v1; see `docs/superpowers/specs/2026-05-18-m15-routines-design.md` §14.
```

---

## 8. roadmap.html

Atualização cosmética. Encontrar o bullet de Routines (atualmente em "🚧 em construção" ou similar) e atualizar para:

> ✅ **Routines (Funcionários acordam sozinhos)** — você configura uma rotina ("todo dia 9h" ou "quando um objetivo é alcançado") e ela dispara um funcionário automaticamente. Sem você precisar empurrar.

Sem novas animações. Cap +30 LOC. O copy exato fica para a implementação (skill `frontend-design` inline se polish adicional for necessário).

---

## 9. ROADMAP.md

### "▸ Agora" (em torno da linha 142)

Adicionar logo após a linha do M15 PR-B:

```markdown
- **M15 PR-C ✅ MERGEADO** (2026-05-20) — consolidação que fecha o M15. Painel de Histórico colapsável em `/routines/:id` (lê `activity_events` via `activity:query`; sem IPC novo). `SECURITY.md` seção Routines (threat model + gap V2). `roadmap.html` em tom leigo. Polish: dead i18n keys removidas, `setTimeout` cleanup em RoutineRow/RoutineForm, widen `TFunction` (elimina `as unknown as TFunction`), `formatRelative` extraído pra `lib/routines/`. +3 testes. **M15 3/3 PRs ✅ FECHADO.**
- **1741 testes passing + 2 todo** · 0 lint/typecheck errors
- HEAD `main`: M15 PR-C (consolidação) mergeado (2026-05-20)
```

E atualizar a métrica de testes / HEAD em "Status atual".

### "▸ Próximo"

Substituir o card único de M15 PR-C por:

```markdown
| Candidato | Escopo | Por quê |
|---|---|---|
| 🥇 **M16 Redesign da Interface** | Reembala a camada de apresentação pra "qualquer pessoa": barra 11→5 itens, linguagem comum, revelação progressiva. Spec em `docs/superpowers/specs/2026-05-18-m16-design.md`. | M15 fechado; o motor (M11-M15) está pronto. M16 reembala a interface antes de seguir pra V2 Tier 1 final. |
| 🥈 **Workflow Plays** | Playbooks pré-prontos que já configuram org + goals + ISAs. Mata o cold-start. Tier 1 V2. | Próxima peça V2 depois do motor (M11-M15). |
| 🥉 **Async governance** | Como uma escalada noturna se resolve sem o usuário (timeout + escalação inteligente). Tier 2. | Outra metade do loop assíncrono que o M14 começou. |
```

**Recomendação:** decisão fica para o usuário (em sessão futura). O default desta sessão é deixar o M15 fechado e listar as opções.

### "Status atual" → "Concluído recentemente"

Bumpa pra cobrir o PR-C com sumário curto (linha única).

---

## 10. Testes

- `format-summary.test.ts` — +3 testes para `formatRelative`:
  - `formatRelative(<today timestamp>, "—")` → returns "HH:MM" string.
  - `formatRelative(<yesterday>, "—")` → returns a date string (the local `toLocaleDateString` output).
  - `formatRelative(null, "never")` → returns `"never"`.
- Renderer components (RoutineHistory, RoutineHistoryRow) — sem testes (padrão renderer; visual via smoke manual).
- i18n parity test — passa automaticamente após adicionar/remover chaves simétricamente nos dois locales.

Total: +3 testes. Suite final estimada: 1738 + 3 = **1741 passing + 2 todo**.

---

## 11. Não-regressão

- Suíte full verde: typecheck, lint, main, shared, renderer, agent-runner.
- Nenhum IPC novo. Nenhum schema novo. Nenhuma migration. Zero impacto no system prompt do agente.
- Renderer-only + 3 docs. Mudanças no main = zero.
- Smoke manual (se Electron disponível na máquina): abrir `/routines`, criar uma routine schedule daily, clicar "Rodar agora" 2-3 vezes, voltar pra lista, abrir a routine de novo, expandir "Histórico de disparos", confirmar que os disparos aparecem com timestamps e reason chips. Re-clicar "Atualizar" e confirmar refresh.

---

## 12. Token efficiency

Renderer-only. Zero impacto no prompt do agente. `activity:query` é SQL query sem chamada de IA. Compatível com [[feedback-token-efficiency]].

---

## 13. Segurança

Coberto na §7 (SECURITY.md update). Sem novos surface areas.

---

## 14. Out-of-scope (V2 ou futuro)

- ❌ Filtros no histórico (por reason, por período).
- ❌ Paginação (limit 20 fixo).
- ❌ Click numa linha → navega pra activity timeline filtrada.
- ❌ Live update do histórico durante a vista.
- ❌ Export do histórico.
- ❌ MCP tool pra agente criar/editar routine (mantém o V2 hardening gap aberto).
- ❌ Routines com condições/filtros arbitrários no evento.

---

## 15. Faseamento (tasks dentro do PR)

Estimativa: ~8 tasks.

| # | Task | Files |
|---|---|---|
| 1 | i18n keys novas + remoção das dead keys | `apps/renderer/src/i18n/{en-US,pt-BR}.json` |
| 2 | Widen `TFunction` + mover `formatRelative` + tests | `lib/routines/format-summary.ts` + `.test.ts` |
| 3 | Cleanup do `as unknown as TFunction` em RoutineRow + import `formatRelative` + `setTimeout` cleanup via useRef | `components/routines/RoutineRow.tsx` |
| 4 | `setTimeout` cleanup via useRef em RoutineForm | `routes/RoutineForm.tsx` |
| 5 | `RoutineHistoryRow.tsx` (componente puro) | `components/routines/RoutineHistoryRow.tsx` |
| 6 | `RoutineHistory.tsx` (seção colapsável + IPC query) | `components/routines/RoutineHistory.tsx` |
| 7 | Integrar `<RoutineHistory>` em `/routines/:id` (RoutineForm) | `routes/RoutineForm.tsx` |
| 8 | Docs — `SECURITY.md` + `docs/roadmap.html` + `ROADMAP.md` (commit final do fechamento) | 3 arquivos |

Ordem TDD: Task 2 (formatters + tests) é TDD. Demais são renderer puros sem teste; commit após typecheck + lint.

---

## 16. Próximo passo

Quando aprovado: invocar `writing-plans` para detalhar as 8 tasks acima com código exato e comandos.
