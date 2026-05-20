# M15 PR-B — Routines UI

> **Status:** spec do PR-B (2026-05-20). Pré-req: M15 PR-A mergeado em `main` (HEAD `07aeff7`) — engine backend + 5 IPCs `routines:*` + preload `window.api.routines` prontos.
>
> **Fontes:** spec base [docs/superpowers/specs/2026-05-18-m15-routines-design.md](2026-05-18-m15-routines-design.md) §9 · brainstorm 2026-05-20 (esta sessão, ASCII inline, 3 decisões: form em rota dedicada · picker em tabs · lista em linha rica).
>
> **Sucessor:** PR-C consolidação (polish · `SECURITY.md` · `roadmap.html` · não-regressão).

---

## 1. Objetivo

Entregar a interface humana das Routines. O usuário consegue, a partir do app:

1. Listar todas as routines da empresa ativa.
2. Ligar/desligar uma routine inline (toggle na lista).
3. Disparar manualmente uma routine ("Rodar agora").
4. Criar uma routine nova preenchendo um form estruturado (sem cron string crua).
5. Editar ou excluir uma routine existente.

O engine roda há um PR; o usuário ainda não tem como criar nenhuma sem ir no SQLite. Este PR fecha o caminho.

**Renderer-only.** O único toque em `apps/main/` é um bug-fix de 3-5 linhas no handler `routines:update` para re-semear `nextFireAt` quando `scheduleSpec` muda (follow-up do PR-A, ver §11).

---

## 2. Decisões travadas (do brainstorm)

| Decisão | Escolha | Motivo |
|---|---|---|
| **Onde vive o form?** | Rota dedicada `/routines/new` + `/routines/:id` | Form tem 5+ campos + picker dinâmico de 4 modos. Modal aperta; side panel deixa o picker estreito. Espelha `GoalPlanReview` e o editor de charter do M12. |
| **Picker de recorrência** | 4 tabs (diário/semanal/mensal/intervalo) | Modos têm campos muito diferentes (intervalo não tem hora; mensal tem dia 1-28). Tabs deixam a diferença óbvia. Compacto vertical. |
| **Layout da lista** | Linha rica (toggle + nome + sub-line com metadata + Rodar) | Toggle inline (ação mais comum). Schedule vs Event têm metadata muito diferentes — sub-line absorve melhor que colunas de tabela. Click na linha → `/routines/:id`. Espelha o tom M16 (revelação progressiva). |

---

## 3. Arquitetura — file map

### Criados (renderer, 9)

| Arquivo | Responsabilidade |
|---|---|
| `apps/renderer/src/routes/RoutinesListPage.tsx` | Rota `/routines`. Subscreve `useRoutinesStore.load(activeCompanyId)` no mount. Renderiza `<RoutineRow>` para cada routine. Empty state quando `routines.length === 0`. |
| `apps/renderer/src/routes/RoutineFormPage.tsx` | Rotas `/routines/new` e `/routines/:id`. `useParams()` discrimina; modo edit pré-carrega via `getById`. Submit aciona `create` ou `update`; "Rodar agora" e "Excluir" só visíveis em edit. |
| `apps/renderer/src/components/routines/RoutineRow.tsx` | Linha rica: toggle • nome • [Rodar] • ⋮ na primeira linha; sub-line com gatilho resumido + agente + próximo/último. Click na linha (não nos controles) navega. |
| `apps/renderer/src/components/routines/RecurrencePicker.tsx` | 4 tabs. Estado interno: `freq` ativa. Mudar de tab emite um novo `ScheduleSpec` com defaults sensatos (daily→{atMinute:540}; weekly→{weekday:1,atMinute:540}; monthly→{day:1,atMinute:540}; interval→{everyMinutes:30}). |
| `apps/renderer/src/components/routines/EventPicker.tsx` | Dropdown dos 4 `RoutineEventType` com labels i18n. Emite `EventSpec`. |
| `apps/renderer/src/components/routines/TargetAgentPicker.tsx` | Dropdown de agentes da empresa ativa (não-terminated). Mostra `{name} ({role})`. |
| `apps/renderer/src/lib/routines/format-summary.ts` | `formatScheduleSummary(spec, t)` e `formatEventSummary(spec, t)` puros, i18n-aware via função `t` injetada. |
| `apps/renderer/src/lib/routines/format-summary.test.ts` | Tests dos formatters (~10 casos). |
| `apps/renderer/src/state/useRoutinesStore.ts` | Zustand store: `routines` (lista) + `loading` + 6 ações que delegam ao `window.api.routines.*`. `toggleEnabled` é optimistic; demais são pessimistic. |

### Modificados (renderer, 3)

| Arquivo | Mudança |
|---|---|
| `apps/renderer/src/App.tsx` | 3 rotas novas registradas: `/routines`, `/routines/new`, `/routines/:id`. |
| `apps/renderer/src/components/layout/Sidebar.tsx` | Entrada "Routines" entre "Início" e "Inbox". Ícone SVG (Lucide `Clock` ou similar — sem emoji). |
| `apps/renderer/src/i18n/pt.ts` + `apps/renderer/src/i18n/en.ts` | ~46 chaves novas em `routines.*` + 1 `nav.routines` (lista completa em §8). |

### Modificados (main, 3 — bug-fix do PR-A)

| Arquivo | Mudança |
|---|---|
| `apps/main/src/schemas/routine.ts` | `ROUTINE_UPDATE_INPUT_SCHEMA` ganha `nextFireAt: z.number().int().nullable().optional()`. Necessário porque hoje o schema não expõe esse campo e o handler precisa setá-lo internamente após re-cálculo. |
| `apps/main/src/ipc/routines-handlers.ts` | `update()` re-semeia `nextFireAt` quando `parsed.scheduleSpec !== undefined` na routine de tipo schedule. Mirror do `seedNextFire` que já existe no `create`. |
| `apps/main/tests/routines-handlers.test.ts` | +1 teste: "update — re-seeds nextFireAt when scheduleSpec changes". |

**Total:** 11 criados + 6 modificados = 17 arquivos. Estimativa: 10 tasks.

---

## 4. Componentes — assinaturas

### 4.1 `useRoutinesStore`

```typescript
import type { Routine } from "@prospero/shared";
import type { RoutineCreateInput, RoutineUpdateInput } from "../main/schemas/routine"; // não, types vêm via preload

interface RoutinesStore {
  routines: Routine[] | null;     // null = not yet loaded (renderiza skeleton)
  loading: boolean;
  load(companyId: string): Promise<void>;
  getById(id: string): Routine | null;
  create(input: unknown): Promise<Routine>;
  update(input: unknown): Promise<Routine>;
  delete(id: string): Promise<void>;
  runNow(id: string): Promise<void>;
  toggleEnabled(id: string): Promise<void>;
}
```

- `load` chamada no mount do `RoutinesListPage`; idempotente.
- `getById` lê do array em memória; não fala com main.
- `create`/`update`/`delete` mutam o array após resposta IPC (pessimistic).
- `toggleEnabled` é OPTIMISTIC: vira `enabled` no array antes do IPC; se IPC falha, reverte + mostra error.
- Tipo `unknown` para `input` no `create`/`update` espelha o preload — renderer não importa o Zod schema do main; main re-valida.

### 4.2 `RoutineRow`

Props: `{ routine: Routine; onToggle: () => void; onRun: () => void; onClick: () => void }`.

Layout (linha rica):

```
●  {routine.name}                                  [▶ Rodar]  ⋮
   {summary} · {agentName} · próx {nextWhen} · últ {lastWhen}
```

- Toggle (bolinha): `routine.enabled ? "filled" : "outline"`. `onMouseDown={stopPropagation}` + `onClick={(e) => { e.stopPropagation(); onToggle(); }}`.
- Rodar: idem stopPropagation.
- ⋮ menu (futuramente: Duplicar, Histórico). v1: só "Excluir" inline.
- Click na linha (qualquer área fora dos controles): `onClick()` → navigate.
- Disabled state quando `routine.enabled === false`: row com 60% opacity.

### 4.3 `RecurrencePicker`

Props: `{ value: ScheduleSpec | null; onChange: (s: ScheduleSpec) => void }`.

```
Recorrência
┌────────┬─────────┬────────┬───────────┐
│ Diário │•Semanal•│ Mensal │ Intervalo │
└────────┴─────────┴────────┴───────────┘

Dia da semana    Horário
[ Segunda ▼ ]    [ 09:00 ]
```

- 4 tabs com state interno `activeFreq`.
- Inicialização: se `value !== null`, usa `value.freq`; senão `"daily"`.
- Switch de tab: emite `onChange` com default da nova freq:
  - daily → `{freq:"daily", atMinute:540}` (09:00)
  - weekly → `{freq:"weekly", weekday:1, atMinute:540}` (Mon 09:00)
  - monthly → `{freq:"monthly", day:1, atMinute:540}` (dia 1 09:00)
  - interval → `{freq:"interval", everyMinutes:30}`
- Campos por aba (controlled inputs):
  - **Diário:** input time → emite `{freq:"daily", atMinute}`.
  - **Semanal:** select weekday (0-6 com labels i18n) + input time.
  - **Mensal:** input number (1-28) + input time.
  - **Intervalo:** input number (≥1) "minutos".
- Inputs `time` são HTML5 `<input type="time">`; conversão `"HH:MM"` ↔ `atMinute` via helper `parseAtMinute`/`formatAtMinute`.

### 4.4 `EventPicker`

Props: `{ value: EventSpec | null; onChange: (s: EventSpec) => void }`.

```
Tipo de evento
[ ▼ Objetivo alcançado                                       ]
```

- 4 opções (`goal_achieved`/`verification_failed`/`issue_done`/`agent_recovered`).
- Labels via i18n `routines.form.event.<key>`.
- Default no mount se `value === null`: emite `{eventType:"goal_achieved"}`.

### 4.5 `TargetAgentPicker`

Props: `{ value: string | null; onChange: (id: string) => void; companyId: string }`.

- Lê `useAgentsStore.byCompany(companyId)` filtrando `status !== "terminated"`.
- Dropdown com `{name} ({role})`.
- Se vazio (só CEO ou nenhum agente além de CEO): empty state inline "Nenhum agente disponível. Contrate um primeiro."

### 4.6 `formatScheduleSummary` & `formatEventSummary`

```typescript
type TFunction = (key: string, params?: Record<string, string | number>) => string;

export function formatScheduleSummary(spec: ScheduleSpec, t: TFunction): string;
export function formatEventSummary(spec: EventSpec, t: TFunction): string;
```

Casos:
- `{daily, 540}` → `t("routines.summary.daily", { time: "09:00" })` → "Toda dia 09:00"
- `{weekly, 1, 540}` → `t("routines.summary.weekly", { weekday: "segunda", time: "09:00" })` → "Toda segunda 09:00"
- `{monthly, 15, 540}` → "Todo dia 15 às 09:00"
- `{interval, 30}` → "A cada 30 min"
- `{goal_achieved}` → "Quando: objetivo alcançado"

Helper interno `weekdayName(n, t)` resolve 0-6.

---

## 5. UX do form — fluxos

### 5.1 Create flow (`/routines/new`)

**Estado inicial:**
- `name = ""`
- `triggerType = "schedule"`
- `scheduleSpec = {freq:"daily", atMinute:540}`
- `eventSpec = null`
- `targetAgentId = null`
- `instruction = ""`
- `enabled = true`

**UI:**
```
← Routines / Nova routine

Nome
[_______________________________________________]

Gatilho
(•) Schedule     ( ) Event

[RecurrencePicker visible — schedule mode]

Agente alvo
[ ▼ — Selecione — ]

Instrução
[                                              ]
[                                              ]

[Cancelar]                                [Criar]
```

**Submit** (`Criar` habilitado quando: `name.trim() !== ""` AND `targetAgentId !== null` AND `instruction.trim() !== ""`):
1. Monta `RoutineCreateInput` válido (discriminated union do PR-A Zod).
2. `await store.create(input)`.
3. Em sucesso: navigate `/routines`.
4. Em erro: banner vermelho no topo com a mensagem do erro (Zod, geralmente).

**Cancelar:** navigate `/routines` (sem confirm — sem dados perdidos relevantes).

### 5.2 Edit flow (`/routines/:id`)

**On mount:**
- Se `store.routines === null`, awaitar `store.load(companyId)`.
- Após load: `routine = store.getById(id)`. Se `null` → mostra banner "Routine não encontrada" + botão "Voltar".
- Pre-fill todos os campos do form.

**UI** (mesma estrutura do create, com diferenças no rodapé):
```
← Routines / {routine.name}

[ ...mesmos campos pre-filled... ]

[Excluir]   [Rodar agora]              [Cancelar]  [Salvar]
```

- **Excluir:** `window.confirm(t("routines.form.deleteConfirm", {name})) → store.delete(id) → navigate("/routines")`.
- **Rodar agora:** `store.runNow(id)`. Status inline ao lado do botão por 2s: "✓ Disparada" / "✗ Erro".
- **Salvar:** mesmo flow do Criar, mas chama `store.update`.

### 5.3 Trigger type switch

Mudar radio schedule↔event:
- `schedule → event`: state limpa `scheduleSpec = null`; `eventSpec` default `{eventType:"goal_achieved"}`.
- `event → schedule`: inverso. `scheduleSpec` default `{freq:"daily", atMinute:540}`.
- Só um picker visível por vez.

### 5.4 Validação

**Client-side (gate o botão Submit):**
- name non-empty, ≤120 chars.
- triggerType selecionado.
- scheduleSpec OR eventSpec preenchido conforme triggerType.
- targetAgentId non-null.
- instruction non-empty, ≤4000 chars.

Outros limites (atMinute ≤1439, day 1-28, etc.) são forçados pelos inputs HTML5 (`max`/`min`) → impossível submeter inválido.

**Server-side:** o Zod do `ROUTINE_CREATE_INPUT_SCHEMA` re-valida no main. Em caso de throw, mostra a mensagem do erro no banner do form. Não há tradução; mostra a string crua do Zod (aceitável v1).

### 5.5 Estados de loading/erro

- **Loading** (busca inicial em edit): skeleton ocupando o lugar do form.
- **Salvando** (após click Salvar/Criar): botão vira "Salvando..." disabled.
- **Erro IPC:** banner vermelho no topo do form, dismissable.

---

## 6. Lista — UX completa

### 6.1 Layout da página

```
Routines                                              [+ Nova routine]
Agentes que acordam sozinhos

●  Standup diário                                     [▶ Rodar]  ⋮
   Toda dia 09:00 · Bob (Engenheiro) · próx 09:00 · últ 15:32

●  Watch goals                                        [▶ Rodar]  ⋮
   Quando: objetivo alcançado · QA

○  Cleanup semanal                                    [▶ Rodar]  ⋮
   Toda segunda 07:00 · DevOps · pausada
```

- Título + subtítulo no topo.
- Botão `+ Nova routine` no canto direito do header.
- Cada routine = um `RoutineRow`.
- Empty state quando `routines.length === 0`: usa o primitivo `<EmptyState>` (existente do M12 PR-F) com CTA "Criar primeira routine" → `/routines/new`.

### 6.2 Comportamento

- **Click na linha:** navigate `/routines/{id}`.
- **Click no toggle:** `store.toggleEnabled(id)`. Optimistic; reverte em erro.
- **Click no Rodar:** `store.runNow(id)`. Status inline por 2s ao lado do botão. Não rola na lista, não navega.
- **⋮ menu:** v1 só tem "Excluir" (`window.confirm` → `store.delete`). Reserva pra Histórico / Duplicar em PR-C.

### 6.3 Empty state

```
   ┌──────────────────────────────────┐
   │       (ícone Clock 48×48)         │
   │                                   │
   │     Nenhuma routine ainda        │
   │   Crie a primeira para que um    │
   │  agente acorde sozinho em horário │
   │       ou por evento.              │
   │                                   │
   │      [+ Criar primeira routine]   │
   └──────────────────────────────────┘
```

Reusa `<EmptyState title={...} description={...} cta={{label, onClick}} />`.

---

## 7. Sidebar nav

`apps/renderer/src/components/layout/Sidebar.tsx` — inserir entrada entre "Início" (Vitrine M14) e "Inbox":

```
Início       (BookOpen)
Routines     (Clock)         ← novo
Inbox        (Inbox)
Agentes      (Users)
Issues       (ClipboardList)
Activity     (Activity)
Settings     (Settings)
```

- Label vem de `t("nav.routines")`.
- Ícone Lucide `Clock` (ou `Repeat` se ficar mais legível depois — decidir na implementação).
- Click → `/routines`.
- Active state quando a rota começa com `/routines` (cobre `/routines/new` e `/routines/:id`).

---

## 8. i18n — chaves

~29 chaves novas em `routines.*` + `nav.routines`:

| Chave | pt-BR | en-US |
|---|---|---|
| `nav.routines` | Routines | Routines |
| `routines.title` | Routines | Routines |
| `routines.subtitle` | Agentes que acordam sozinhos | Agents that wake on their own |
| `routines.new` | Nova routine | New routine |
| `routines.empty.title` | Nenhuma routine ainda | No routines yet |
| `routines.empty.description` | Crie a primeira para que um agente acorde sozinho em horário ou por evento. | Create the first one so an agent wakes on its own — on a schedule or in response to an event. |
| `routines.empty.cta` | Criar primeira routine | Create first routine |
| `routines.form.name` | Nome | Name |
| `routines.form.trigger` | Gatilho | Trigger |
| `routines.form.trigger.schedule` | Schedule | Schedule |
| `routines.form.trigger.event` | Evento | Event |
| `routines.form.recurrence` | Recorrência | Recurrence |
| `routines.form.freq.daily` | Diário | Daily |
| `routines.form.freq.weekly` | Semanal | Weekly |
| `routines.form.freq.monthly` | Mensal | Monthly |
| `routines.form.freq.interval` | Intervalo | Interval |
| `routines.form.atMinute` | Horário | Time of day |
| `routines.form.weekday` | Dia da semana | Weekday |
| `routines.form.monthDay` | Dia do mês | Day of month |
| `routines.form.everyMinutes` | A cada (minutos) | Every (minutes) |
| `routines.form.event` | Tipo de evento | Event type |
| `routines.form.event.goal_achieved` | Objetivo alcançado | Goal achieved |
| `routines.form.event.verification_failed` | Verificação falhou | Verification failed |
| `routines.form.event.issue_done` | Issue concluída | Issue done |
| `routines.form.event.agent_recovered` | Agente recuperou | Agent recovered |
| `routines.form.targetAgent` | Agente alvo | Target agent |
| `routines.form.targetAgent.placeholder` | — Selecione um agente — | — Select an agent — |
| `routines.form.targetAgent.empty` | Nenhum agente disponível. Contrate um primeiro. | No agents available. Hire one first. |
| `routines.form.instruction` | Instrução | Instruction |
| `routines.form.create` | Criar | Create |
| `routines.form.save` | Salvar | Save |
| `routines.form.saving` | Salvando... | Saving... |
| `routines.form.cancel` | Cancelar | Cancel |
| `routines.form.runNow` | Rodar agora | Run now |
| `routines.form.runNow.fired` | Disparada | Fired |
| `routines.form.delete` | Excluir | Delete |
| `routines.form.deleteConfirm` | Excluir routine '{name}'? | Delete routine '{name}'? |
| `routines.form.notFound` | Routine não encontrada | Routine not found |
| `routines.row.lastFired` | Último: {when} | Last: {when} |
| `routines.row.nextFire` | Próximo: {when} | Next: {when} |
| `routines.row.paused` | pausada | paused |
| `routines.summary.daily` | Toda dia {time} | Every day at {time} |
| `routines.summary.weekly` | Toda {weekday} {time} | Every {weekday} at {time} |
| `routines.summary.monthly` | Todo dia {day} às {time} | Every {day} at {time} |
| `routines.summary.interval` | A cada {minutes} min | Every {minutes} min |
| `routines.summary.event` | Quando: {event} | When: {event} |
| `routines.weekday.0` | domingo | Sunday |
| `routines.weekday.1` | segunda | Monday |
| `routines.weekday.2` | terça | Tuesday |
| `routines.weekday.3` | quarta | Wednesday |
| `routines.weekday.4` | quinta | Thursday |
| `routines.weekday.5` | sexta | Friday |
| `routines.weekday.6` | sábado | Saturday |

Total real: ~46 chaves (subestimei "~28" no brainstorm; o leque de variações dos formatters + dias da semana inflou).

---

## 9. Token efficiency

Regra dura: o uso normal **não pode inflar**.

- PR-B é **renderer-only** (mais o bug-fix de 5 linhas no main). Zero impacto no system prompt do agente.
- Zustand store é local; subscriptions são in-process — sem chamadas extras de IA.
- Toggle/Rodar/Excluir disparam IPCs mínimos no `routines:*` que já existem.
- Compatível com [[feedback-token-efficiency]].

---

## 10. Segurança

- Validação client-side gateia formato; main re-valida com Zod (defense-in-depth).
- `targetAgentId` é validado contra a lista de agentes da empresa ativa (renderer); FK do `routines.target_agent_id` no schema do PR-A (cascade) é a segunda barreira.
- Excluir rotina não dispara nada perigoso (DELETE simples).
- "Rodar agora" não burla o gate — o agente que acorda passa pelo `request_permission` normalmente.
- Sem mudança no `SECURITY.md` neste PR (vem no PR-C).

---

## 11. Bug-fix do PR-A absorvido aqui

O final reviewer do PR-A flagou: `routines:update` não re-semeia `nextFireAt` quando `scheduleSpec` muda. UX rough edge — depois de editar a hora de "09:00" para "14:00", o primeiro fire roda ainda no horário antigo (depois o scheduler self-corrige). Como o PR-B expõe a edição na UI, faz sentido fechar o ciclo agora.

**Fix** (`apps/main/src/ipc/routines-handlers.ts`):

```typescript
update({ input }) {
  const parsed = ROUTINE_UPDATE_INPUT_SCHEMA.parse(input);

  // M15 PR-B: re-seed nextFireAt quando scheduleSpec muda em routine schedule.
  // Mirror do seedNextFire usado em create. Se o caller já passou nextFireAt
  // explícito (cenário raro — runtime advance), respeitamos.
  let next = parsed;
  if (parsed.scheduleSpec !== undefined && parsed.nextFireAt === undefined) {
    const existing = repo.getById(parsed.id);
    if (existing !== null && existing.triggerType === "schedule") {
      next = {
        ...parsed,
        nextFireAt: computeNextFire(parsed.scheduleSpec, new Date(Date.now())).getTime(),
      };
    }
  }

  return repo.update(next);
}
```

(O snippet acima é a forma. Implementação final pode ajustar pra `next` aproveitando o pattern spread-only-defined que o handler já usa para `exactOptionalPropertyTypes`. Detalhe no plano.)

**Teste novo** (`apps/main/tests/routines-handlers.test.ts`):

```typescript
it("update — re-seeds nextFireAt when scheduleSpec changes", () => {
  const h = routinesHandlers({ db });
  const created = h.create({ input: { ..., scheduleSpec: { freq: "daily", atMinute: 540 } } });
  const initialNextFire = created.nextFireAt!;

  const updated = h.update({
    input: { id: created.id, scheduleSpec: { freq: "daily", atMinute: 600 } /* 10:00 */ },
  });

  expect(updated.nextFireAt).not.toBe(initialNextFire);
  expect(updated.nextFireAt).not.toBeNull();
});
```

`nextFireAt` em `ROUTINE_UPDATE_INPUT_SCHEMA` precisa virar opcional. Hoje não está exposta — só `name`, `enabled`, `scheduleSpec`, `eventSpec`, `targetAgentId`, `instruction`. Adicionar `nextFireAt: z.number().int().nullable().optional()` ao schema do PR-A. É mudança de contrato no IPC `routines:update`, mas additive (campo opcional novo); o renderer ignora.

---

## 12. Testes

Renderer:
- `format-summary.test.ts` — ~10 casos cobrindo todos os ScheduleSpec/EventSpec.
- Demais componentes renderer-puros, sem testes (consistente com o resto do `apps/renderer/`: tests apenas pra lib funções puras e store; presença visual cobre via smoke manual).
- `useRoutinesStore` recebe ~6 testes unitários (optimistic toggle revert em erro, load idempotência, getById hit/miss). Espelha [[project-m11-pr-c-ui-lessons]] (renderer não tem react-testing-library).

Main:
- `routines-handlers.test.ts` — +1 teste pra re-seed do `nextFireAt`.

Não-regressão:
- `Sender.kind = "routine"` continua intacto.
- IPCs `routines:*` não mudam de assinatura (só o handler `update` ganha um cálculo interno).

---

## 13. Faseamento (tasks dentro do PR)

Estimativa: 10 tasks.

| # | Task | Files |
|---|---|---|
| 1 | i18n keys (pt + en) | `apps/renderer/src/i18n/*.ts` |
| 2 | `format-summary.ts` + tests | renderer/lib |
| 3 | `useRoutinesStore.ts` + tests | renderer/state |
| 4 | `RecurrencePicker.tsx` | renderer/components/routines |
| 5 | `EventPicker.tsx` + `TargetAgentPicker.tsx` | renderer/components/routines |
| 6 | `RoutineFormPage.tsx` (create + edit modes) | renderer/routes |
| 7 | `RoutineRow.tsx` | renderer/components/routines |
| 8 | `RoutinesListPage.tsx` + empty state | renderer/routes |
| 9 | `App.tsx` (3 rotas) + Sidebar (nav entry) | renderer/components/layout, App.tsx |
| 10 | Adicionar `nextFireAt` opcional em `ROUTINE_UPDATE_INPUT_SCHEMA` + bug-fix `routines:update` re-seed `nextFireAt` + 1 teste | main |

Ordem TDD: para tasks com testes (#2, #3, #10), test-first. Componentes renderer (#4-9) sem testes próprios.

---

## 14. Não-regressão

- M1–M14 + M15 PR-A intactos.
- Suíte main: 1392 → 1393 (+1 do bug-fix).
- Suíte renderer: 170 → 170 + N (N = testes do store + formatters; estimativa +16).
- Suíte shared: 100 → 100 (sem mudanças).
- Total estimado: ~1729 (era 1712).
- `pnpm typecheck` + `pnpm lint` continuam limpos.

---

## 15. Out-of-scope

- ❌ **Painel de histórico de disparos por routine** (lista de `activity_events` filtrada por `entity_id`). Útil mas opcional; vai pro PR-C.
- ❌ **Agrupamento na lista** (por agente, por gatilho). PR-C se a lista ficar longa.
- ❌ **Filtros / busca na lista** — v1 espera ~5-15 routines por empresa; lista direta é OK.
- ❌ **Duplicar routine** — menu ⋮ tem só Excluir em v1.
- ❌ **Validação fancy** com erros field-level — banner aggregate é suficiente.
- ❌ **MCP tool pra agente criar routine** — fica pro Workflow Plays.
- ❌ **Toast system** — app não tem; status inline na própria página resolve.
- ❌ **Permissão por papel** — qualquer usuário cria qualquer routine (single-user app).

---

## 16. Próximo passo

Quando aprovado: invocar `writing-plans` para destrinchar as 10 tasks acima em passos TDD com código exato (mesmo padrão do plano do PR-A).
