# M12 PR-F — Redesign do Agent Studio

> **Status:** spec de design (2026-05-18). Implementa o **PR-F** do M12 — a
> última PR (`docs/m12-agent-org-definition-layer.md` §11, §13, §16).
>
> **Brainstorm:** 2026-05-18 · contexto explorado: as 6 abas em
> `apps/renderer/src/components/agent-panel/`, a rota `/agents/:id`
> (`Agent.tsx`), o `AgentConfigPanel` (sidebar 320px), a `LearningPanel`
> (painel fullscreen do M11), os tokens Tailwind, a ausência de
> `components/ui/`.

---

## TL;DR

O Agent Studio cresceu por acreção: cada PR (M7.6, M11, M12 PR-C/E1/E2) somou
uma aba com seu próprio padding, heading e estados, e as superfícies acabaram
**espalhadas por duas barras de abas** — abas de conteúdo principal
(Chat · Delegations · Learning) e uma sidebar de 320px (Config · Instructions ·
Issues · Runs · Stats). O §11 do design doc do M12 sempre quis **6 abas
unificadas**; nunca aconteceu.

O PR-F reformula a tela `/agents/:id` em **dois modos** — **Conversa** e
**Estúdio** — sob um `AgentHeader` persistente. Estúdio reúne as 6 abas
(Config · Instructions · Learning · Issues · Runs · Stats) numa barra única,
cada aba em **largura cheia**. A sidebar de 320px é removida; a barra de abas
dupla some.

**É renderer-puro:** zero migração, zero IPC, zero mudança em `@prospero/shared`,
zero toque no processo main — **token-neutro por construção**.

A conversa (balões, composer, Delegations) **não é restilizada** — apenas
re-aninhada no modo Conversa. O PR cria um conjunto mínimo de primitivos de UI
(`components/ui/`) e fixa um contrato de consistência para as 6 abas.

---

## 1. O problema

| Sintoma | Detalhe |
|---|---|
| Duas barras de abas | Conteúdo principal: Chat/Delegations/Learning. Sidebar 320px: Config/Instructions/Issues/Runs/Stats. 8 superfícies, IA fragmentada. |
| Learning espremida | `LearningPanel` (487 linhas, 4 sub-abas) é "gestão" mas vive como aba do conteúdo principal, fora do grupo de gestão. |
| Sidebar estreita demais | 320px não comporta o editor de charter da aba Instructions nem as sub-abas da Learning — por isso a Learning virou fullscreen à parte. |
| Deriva visual | Padding `p-3` vs `p-4`; espaçamento `space-y-2`..`space-y-5`; `IssuesTab` sem headings; loading `…` cru; empty states italic ad-hoc. |
| Sem design system | Não existe `components/ui/`. Cada aba faz hand-roll de `Section`, `EmptyState`, loading, `TabBar`. |
| Bug | `IssuesTab` usa `bg-semantic-info`, token **inexistente** no `tailwind.config.ts`. |

O §11 do design doc do M12 já desenhou a saída (6 abas) e o §16 deixou a "IA
final das 6 abas" explicitamente para o PR-F, a confirmar com a skill
`frontend-design`.

---

## 2. Arquitetura — dois modos

A rota `/agents/:id` (`Agent.tsx`) passa a ter um `AgentHeader` persistente com
um **switch de modo** (segmented control): **Conversa** | **Estúdio**.

```
AgentHeader (fixo) — nome · status · papel · 🎓 badge · ação atual · pause · assign · ⋯
                     ┌─ switch de modo (segmented) ─┐
                     │  [ Conversa ]   Estúdio       │
─────────────────────┴───────────────────────────────┴──────────────
MODO CONVERSA                         MODO ESTÚDIO
  sub-switch  Chat | Delegations        barra única de 6 abas (underline):
  MessageList / DelegationsPanel        Config·Instructions·Learning·
  ApprovalCards (overlay)               Issues·Runs·Stats
  Composer (sticky)                     conteúdo da aba em LARGURA CHEIA
```

- **Modo Conversa** — reúne o que hoje são as abas `Chat`/`Delegations` num
  sub-switch (`TabBar variant="segmented"`). `MessageList`, `DelegationsPanel`,
  `ApprovalCard` e `Composer` são os **mesmos componentes**, apenas
  re-aninhados — visual intocado. O `Composer` (sticky) aparece **só** no modo
  Conversa.
- **Modo Estúdio** — uma barra única (`TabBar variant="underline"`) com as 6
  abas; o conteúdo de cada aba ocupa **largura cheia** numa área rolável. Sem
  `Composer`.
- A **sidebar de 320px (`AgentConfigPanel`) é removida**. A `LearningPanel`
  deixa de ser aba do conteúdo principal e vira a aba "Learning" do Estúdio. O
  🎓 badge do `AgentHeader` passa a abrir Estúdio → aba Learning (hoje muda a
  aba principal para "learning").

**Estado:** modo e aba ativos são estado local de `Agent.tsx`, default
**Conversa** (a ação primária). Sem persistência cross-navegação (YAGNI).

### 2.1 Estrutura de arquivos (renderer apenas)

- `apps/renderer/src/routes/Agent.tsx` — rota: monta `AgentHeader` + switch de
  modo + renderiza `<AgentConversation>` ou `<AgentStudio>`.
- `apps/renderer/src/components/agent-panel/AgentConversation.tsx` — **novo**,
  extraído do `Agent.tsx` atual: sub-switch Chat/Delegations + a conversa +
  `ApprovalCard`s + `Composer`.
- `apps/renderer/src/components/agent-panel/AgentStudio.tsx` — **novo**,
  substitui `AgentConfigPanel.tsx` (que é **deletado**): a barra de 6 abas + o
  conteúdo da aba ativa.
- Os 6 componentes de aba (`ConfigTab`, `InstructionsTab`, `LearningPanel`,
  `IssuesTab`, `RunsTab`, `StatsTab`) **permanecem**, redesenhados por dentro;
  a fronteira de props de cada um é preservada.

---

## 3. Primitivos de UI & contrato de consistência

### 3.1 Novo `apps/renderer/src/components/ui/`

| Primitivo | Substitui | Interface |
|---|---|---|
| `Section` | o par `<section>` + `<h3 className="text-[10px] uppercase…">` repetido em 5 abas (ausente na Issues) | `{ title: string; hint?: string; children }` |
| `EmptyState` | textos italic ad-hoc de "nada aqui" | `{ message: string; icon?: ReactNode }` |
| `LoadingState` | o `…` cru de `IssuesTab`/`StatsTab` | indicador único, sem props obrigatórias |
| `TabBar` | a barra de abas hand-rolled | `{ tabs; active; onSelect; variant: "segmented" \| "underline" }` |

`TabBar` serve o switch de modo + o sub-switch Chat/Delegations (`segmented`),
a barra de 6 abas do Estúdio e as 4 sub-abas da Learning (`underline`).

`Field` (label + controle) **não** vira primitivo — o contrato de formulário
fica no estilo de Config/Stats (YAGNI).

### 3.2 Contrato — toda aba do Estúdio

- Padding externo único **`p-6`** com `space-y-6` entre `Section`s.
- Um único estilo de heading (via `Section`).
- Um único `EmptyState`, um único `LoadingState`.
- Vocabulário de tokens existente (`ink`/`ink-soft`/`surface`/`brand`/
  `semantic-*`).

### 3.3 Correção de bug — `semantic-info`

`IssuesTab` referencia `bg-semantic-info`, inexistente. O PR-F adiciona os
tokens `semantic-info` / `semantic-info-bg` (azul) ao `tailwind.config.ts` e ao
`tokens.css` (light + dark), seguindo o padrão dos outros `semantic-*`.

### 3.4 Limite de escopo dos primitivos

Os primitivos novos são consumidos **só pelo Agent Studio** neste PR. O resto
do app (Dashboard, Costs, Org, etc.) **não** é refatorado — adota os primitivos
organicamente depois. Isso mantém o PR-F focado e o risco de regressão baixo.

---

## 4. As 6 abas do Estúdio — redesenho estrutural

O spec fixa o *layout estrutural* de cada aba. A IA fina (disposição exata dos
campos, microcopy, espaçamentos internos) é decisão da skill `frontend-design`
na implementação, conforme §11/§16 do design doc do M12 — o spec **não congela
pixels**. Nenhum comportamento, prop ou IPC de aba muda.

| Aba | Hoje | Redesenho estrutural |
|---|---|---|
| **Config** | 8 seções numa coluna de 320px (347 linhas) | Grid de **2 colunas** de `Section`s: Identidade (papel, modelo, reports-to, location) \| Run Policy + Schedule + Capabilities + Projects. Controles e IPCs inalterados. |
| **Instructions** | file-list + textarea **empilhados** num painel estreito (143 linhas) | **Tree de arquivos à esquerda + editor à direita**, lado a lado. IPCs `instructions:*` inalterados. |
| **Learning** | painel fullscreen separado, 4 sub-abas (487 linhas) | Vira a aba "Learning" do Estúdio; as 4 sub-abas usam `TabBar variant="underline"`; adota padding/heading do contrato. Comportamento intacto — sem refactor. |
| **Issues** | lista sem headings (63 linhas) | `Section` com heading + `EmptyState`/`LoadingState`; corrige `semantic-info`. |
| **Runs** | sessões com runs expansíveis (142 linhas) | Mantém agrupamento por sessão; aplica `Section`/`EmptyState`; o drill-in expandido usa a largura (tokens/custo/atividade lado a lado, não empilhados). |
| **Stats** | métricas + `BudgetSection` (120 linhas) | Métricas e a seção Budget num grid de 2 colunas; barras de utilização e o form de limites ganham largura. |

---

## 5. Fora de escopo

- ❌ Restilizar a conversa (balões de chat, `Composer`, `DelegationsPanel`) —
  só é re-aninhada no modo Conversa.
- ❌ Adotar os primitivos `components/ui/` no resto do app.
- ❌ Refactor de comportamento da `LearningPanel`.
- ❌ Qualquer mudança de backend / IPC / tipo / lógica de negócio das abas.
- ❌ `roadmap.html` — regra atual: é página de pitch standalone, não se mexe
  por feature; só o `ROADMAP.md` é atualizado.
- ❌ Persistência cross-navegação do modo/aba ativos.

---

## 6. Dados, tipos, migração

**Nenhum.** PR-F é renderer-puro: reorganiza componentes React e adiciona
primitivos de UI + 2 tokens Tailwind. Sem migração, sem IPC, sem mudança em
`@prospero/shared`, sem toque no processo main.

---

## 7. Testes & não-regressão

O repo não tem React Testing Library (padrão do projeto: helpers puros > RTL).
PR-F quase não tem lógica testável — o switch de modo é estado trivial.

**Verificação:**
- Os **168 testes de renderer atuais seguem verdes** — os 6 componentes de aba
  mantêm a fronteira de props, então seus testes (se houver) não quebram.
- **Parity test de i18n verde** — chaves novas (labels do switch de modo
  `Conversa`/`Estúdio` e o que o redesign exigir) presentes em `en-US.json`
  **e** `pt-BR.json`.
- `pnpm -r typecheck` + `pnpm -r lint` limpos.
- Se algum helper puro surgir, ganha teste unitário; não se inventa lógica só
  para ter teste.

**Não-regressão:**
- **Token-neutro por construção** — nada toca system prompt nem processo main.
- Toda funcionalidade das 6 abas preservada; a conversa preservada; as "6 abas"
  do §11 entregues numa superfície única e coerente.
- M1–M12 (PR-A..E2) intactos; suíte de segurança verde (PR-F não a encosta).

---

## 8. Segurança

PR-F não introduz vetores: é reorganização de UI no renderer. Não injeta nada
no system prompt, não executa saída de LLM, não muda gate, IPC nem permissões.
A superfície de ataque é idêntica à de antes.

---

## 9. Docs

- **Novo `docs/agent-studio.md`** — capstone do M12: os dois modos
  (Conversa/Estúdio), as 6 abas e o que cada uma faz, o conjunto de primitivos
  `components/ui/`. Espelha o padrão dos docs do M11
  (`memory-architecture.md` etc.).
- Atualiza `docs/m12-agent-org-definition-layer.md` — §11 reflete o layout
  final de dois modos; PR-F marcado como concluído na §13.
- Atualiza `ROADMAP.md` (2 seções, padrão dos outros PRs do M12).

---

## 10. Faseamento

Um PR, plano multi-task (~10 tasks):

| Fase | Entrega |
|---|---|
| 1 | Primitivos `components/ui/` (`Section`, `EmptyState`, `LoadingState`, `TabBar`) + tokens `semantic-info`. |
| 2 | Casca de dois modos — `Agent.tsx` reestruturado + `AgentConversation.tsx` (extração) + `AgentStudio.tsx` (substitui `AgentConfigPanel`). |
| 3-8 | As 6 abas redesenhadas — uma task por aba (Config, Instructions, Learning, Issues, Runs, Stats). |
| 9 | i18n (chaves novas em PT/EN). |
| 10 | `docs/agent-studio.md` + atualização dos docs do M12 + `ROADMAP.md` + varredura de não-regressão. |

Próximo passo após aprovação do spec: invocar `writing-plans` para gerar o
plano de implementação. A execução das tasks de UI usa a skill
`frontend-design` para a IA fina de cada aba.

**Fecha o M12.** Depois do M12, V2 Tier 1 — os specs de M13/M14/M15 já estão
escritos (`docs/superpowers/specs/2026-05-18-m13/m14/m15-*.md`).
