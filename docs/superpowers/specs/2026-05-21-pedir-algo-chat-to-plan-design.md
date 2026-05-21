# "Pedir algo" — fluxo conversa → plano (M16 gap #3)

Data: 2026-05-21
Status: aprovado (design); pendente escrita do plano de implementação.

## Problema

"Pedir algo" (`nav.pedirAlgo` → `/goals/new` → `GoalNew.tsx`) ainda é o **formulário técnico de Goals** (título, nível, owner, parent, budget em tokens, critérios). O M16 §6 e o mockup `docs/m16-mockups/flow-pedir-plano.html` especificam outra coisa: o dono **descreve em linguagem comum**, o **CEO conversa** pra esclarecer, e depois apresenta um **plano** ("o que vai ser feito / quem vai fazer / tempo e custo") com **"Aprovar e começar / Quero ajustar"**. É o último gap pro app ser usável ponta-a-ponta por um usuário novo (ver auditoria M16: #1 onboarding, #2 Kanban, #4 emoji já resolvidos).

## Decisões (confirmadas com o usuário)

1. **Conversa real com o CEO** (não um wizard leve). O "Pedir algo" é uma conversa de verdade: o usuário descreve, o CEO (agente real) pode fazer perguntas, e depois propõe o plano.
2. **Página de revisão dedicada** (Opção 2 do mockup): a conversa termina com "montei seu plano — ver" e o usuário vai a uma página própria pra revisar/desmarcar itens e aprovar.
3. **Objetivo primeiro (abordagem A1):** a 1ª mensagem já cria o objetivo; conversa e plano ficam atrelados a ele desde o início. (Alternativa A2 "conversa primeiro, objetivo criado no fim" descartada — emergente demais, rastreamento difícil.)

## O backend já existe (reuso, não reconstrução)

O pipeline de Goal plan (M8.5) **já roteia pelo CEO real** e faz exatamente o que o mockup mostra:

- `goals.create(CreateGoalInput)` → cria o objetivo.
- `goals.requestPlan({ goalId })` → acha o CEO (`findCeo(companyId)`) e faz `orchestrator.deliverSystemMessage(ceo.id, formatGoalPlanRequest(goal))`. O CEO (runtime `claude-oauth-local`, que lê a credencial viva e auto-renova o token) produz um plano `proposed` via suas MCP tools de goal.
- `goals.get({ id })` → `GoalWithPlan` com `currentPlan` (propostas de agentes + de issues) e `history`.
- `goals.approvePlan({ planId, includeAgentIndexes?, includeIssueIndexes?, mode? })` → `executePlan` contrata os agentes marcados + cria as issues marcadas. = **"Aprovar e começar"** (com desmarcação seletiva).
- `goals.requestChanges({ planId, feedback })` → supersede o plano, re-entrega ao CEO com o feedback. = **"Quero ajustar"**.

Mapeamento mockup → dados do plano: "O que vai ser feito" = issues propostas; "Quem vai fazer" = agentes propostos; "Tempo e custo" = estimativa.

A conversa com o CEO reusa o runtime de agente: `agents.sendMessage(agentId, content)`, `messages.listByAgent(agentId)`, `agents.onEvent` (`message-append`), `permissions.onRequest`. Os componentes `MessageList` e `Composer` já renderizam isso (ver `AgentConversation.tsx`).

## Fluxo

### Tela 1 — "Pedir algo" (conversa) — substitui o `GoalNew`

- **Estado vazio:** "O que você precisa?" + caixa de descrição (1 campo, linguagem comum). Sem nível/owner/parent/budget/critérios à mostra.
- **Ao enviar o 1º pedido:**
  1. `goals.create` com defaults sensatos (título derivado do pedido — primeira linha/resumo; `description` = pedido completo; `level` default top-level — `"company"` ou `"task"`, a decidir no plano; sem owner/parent; budget/critérios nulos).
  2. Dispara o pedido ao CEO de forma **conversacional** (ver "Backend novo" abaixo) e abre a conversa.
- **Conversa:** reusa `MessageList` + `Composer`. O CEO faz perguntas de esclarecimento; o usuário responde via `agents.sendMessage`. Atualização ao vivo por `agents.onEvent`.
- **Plano pronto:** quando o objetivo passa a ter `currentPlan` status `proposed` (detectado via `goals:changed` / re-`get`), aparece um cartão/aviso no chat: **"Seu plano está pronto → Ver plano"** que navega pra Tela 2.

### Tela 2 — Página de revisão (dedicada, linguagem comum)

Reskin/wrapper de `/goals/:id` (Opção 2), reusando os dados de `GoalPlanReview`:

- Cabeçalho: "Seu plano · Para: \<pedido\>".
- **O que vai ser feito** — issues propostas, cada uma desmarcável (alimenta `includeIssueIndexes`).
- **Quem vai fazer** — agentes a contratar, desmarcáveis (alimenta `includeAgentIndexes`).
- **Tempo e custo** — estimativa.
- **Aprovar e começar** → `approvePlan` com os índices marcados → `ExecutePlanResult`; em sucesso, navega pro Início/Projetos.
- **Quero ajustar** → volta pra conversa (Tela 1) com a opção de mandar feedback ao CEO (`requestChanges`), que gera um novo plano.

## Componentes

**Reuso:** `MessageList`, `Composer`, `GoalPlanReview` (dados/lógica de inclusão), `GoalDetailHeader` (parcial); stores `useGoalsStore`, `useAgentsStore`; APIs `goals.*`, `agents.*`, `messages.*`.

**Novo (renderer):**
- `PedirAlgo.tsx` — a view conversacional (estado vazio + chat + detecção de plano), substituindo `GoalNew.tsx` na rota `/goals/new`.
- Página/painel de revisão em linguagem comum (novo componente reusando os dados do plano; o `GoalDetail` técnico de 5 abas permanece acessível para usuários avançados pela área de Projetos/objetivos, não é deletado — princípio M16 "nada deletado").

**Novo (backend, mínimo):**
- Entrega **conversacional** do pedido ao CEO: uma variante de `formatGoalPlanRequest` (ou flag) que instrui o CEO a *conversar com o dono pra esclarecer o que precisar e só então submeter o plano*, em vez de ir direto ao plano. Não hard-required (ver Risco).
- **Escopo da conversa:** como a view sabe quais mensagens são deste pedido. Recomendação: cada "Pedir algo" = um objetivo; a view mostra a conversa do CEO a partir do início deste pedido (filtrar por timestamp do `createdAt` do objetivo, ou tag de goal nas mensagens se já existir). "Novo pedido" começa outro do zero. Mecanismo exato = detalhe do plano de implementação.

## Tratamento de erro

- `goals.create` falha → mostra erro inline, não abre a conversa.
- CEO indisponível (`findCeo` null) → mensagem clara ("nenhum CEO na empresa"); não deveria ocorrer pós-onboarding (onboarding cria o CEO).
- O CEO demora/não responde → estado "o CEO está pensando…"; a conversa nunca trava a UI.
- `approvePlan` retorna `ok:false` → mostra o motivo, mantém o plano revisável.

## Risco principal (sinalizado e aceito)

Todo o fluxo repousa sobre o CEO (via `claude`) **realmente** produzir um plano válido pelas MCP tools de goal — esse E2E **nunca foi smoke-testado ao vivo** (pendência desde M11/M12). Mitigações embutidas no design:

1. **Perguntas de esclarecimento não são obrigatórias** — se o CEO já manda o plano direto, o fluxo funciona; se pergunta, o usuário responde.
2. **"Quero ajustar" sempre devolve à conversa** — recuperação natural se o plano vier ruim.
3. **Recomendação:** verificar cedo, no smoke do usuário, que "o CEO monta um plano" a partir de um pedido. Se não for confiável, reavaliar a abordagem antes de investir na UI inteira.

## Fora de escopo (YAGNI)

- Layout inline-no-chat (Opção 1) e split lado-a-lado (Opção 3) do mockup — usuário escolheu a página dedicada (Opção 2).
- Múltiplos pedidos simultâneos / histórico rico de pedidos — um pedido em andamento por vez; "Novo pedido" recomeça.
- Geração de plano por caminho headless dedicado — reusa o CEO real (decisão "conversa real").
- Deletar o `GoalDetail` técnico — permanece para uso avançado.

## Testes

- Renderer não tem react-testing-library: cobertura por typecheck/lint + i18n parity + smoke manual no app empacotado (fluxo de validação do usuário).
- Backend: testes unitários da variante conversacional de `formatGoalPlanRequest` (formato da system message) seguindo `format-request.test.ts`.
- Smoke (usuário): pedido em linguagem comum → CEO conversa/monta plano → página de revisão → Aprovar e começar contrata agentes + cria issues (visíveis no Kanban de Projetos do gap #2).
