# M16 — Redesign da Interface · Fácil para Qualquer Pessoa

> **Status:** documento de design (2026-05-18). Base para o milestone **M16**.
>
> **Fontes:** brainstorm 2026-05-18 com companion visual (mockups em alta fidelidade salvos em `.superpowers/brainstorm/1071-1779151093/content/`) · código atual do renderer (`apps/renderer/src/App.tsx`, rotas, `theme/tokens.css`, `tailwind.config.ts`).
>
> **Pergunta original:** "o layout do app ainda é muito truncado e técnico — quero que qualquer pessoa, mesmo que nunca tenha pegado em um computador, consiga usar."

---

## TL;DR

O Prospero, em 15+ milestones, ficou poderoso — mas a interface fala **dialeto de engenharia**: a barra lateral tem **11 itens** (Issues, Agents, Goals, Org Chart, Roles, Costs, Activity, Inbox, Projects, Dashboard, Settings) e o vocabulário técnico aparece em todo lugar. Para a persona V2 ("qualquer pessoa criando um 1-person business"), isso é uma barreira.

O **M16 reconstrói a camada de apresentação** — não o backend. Princípios: **linguagem comum** no lugar de jargão · **revelação progressiva** (o iniciante vê o simples; a profundidade fica a um clique) · **nada é deletado** (todo recurso atual ganha uma casa). Identidade visual mantida (Poppins, azul `#1d5dd7`, cantos arredondados); **sem emojis** — ícones SVG.

A barra cai de **11 para 5 itens**: **Início · Pedir algo · Projetos · Minha equipe · Ajustes**. Oito telas foram redesenhadas e validadas visualmente neste brainstorm.

**Custo estimado:** ~20-28 dias (~7 PRs). **Natureza:** milestone de front-end (renderer); backend praticamente intacto.

---

## 1. O problema

`apps/renderer/src/App.tsx` hoje: uma barra lateral de **11 links** — `Dashboard · Inbox · Projects · Issues · Agents · Goals · Org Chart · Roles · Costs · Activity · Settings` — mais a lista de agentes. Todos os rótulos são vocabulário de desenvolvedor. O "Agent Studio" (`/agents/:id`) tem 5 abas técnicas. O texto é denso (`text-sm`, rótulos `text-[10px]`).

Isso é uma IA de **ferramenta de programador**. A tese V2 mira "qualquer pessoa que queira criar um 1-person business" — inclusive quem nunca usou um computador. Uma pessoa assim abre o app atual e não sabe o que é um "issue", um "goal", um "org chart". O poder está lá; o **acesso** a ele, não.

O M16 não corta poder — ele reembala. O backend (M1–M15) continua; muda **como a coisa é mostrada**.

---

## 2. Princípios do redesign

1. **Linguagem comum, não jargão.** "Funcionário" não "agente"; "Tarefa" não "issue"; "Gastos" não "Costs". Glossário completo na §14.
2. **Revelação progressiva.** O iniciante vê 5 portas simples. A profundidade técnica (charter, skills, política de execução, Kanban detalhado) fica alcançável drilando pra dentro — nunca na cara de quem está começando.
3. **Nada é deletado.** Todo recurso de M1–M15 ganha uma casa nova (mapeamento na §13). Simplificar é reorganizar, não remover.
4. **Sem emojis.** Ícones SVG (line icons). Decisão de identidade — ver [feedback_no_emojis](../../../README.md).
5. **Identidade visual preservada.** Fonte Poppins, paleta atual (`theme/tokens.css` — azul `#1d5dd7`, fundo `#f5f5fa`, texto `#070c27`, cores semânticas), cantos arredondados, janela frameless. O M16 muda estrutura e linguagem, não a "marca".
6. **A contagem de telas/abas pode crescer durante o desenvolvimento** — o objetivo é a estrutura certa, não um mínimo artificial (decisão do usuário).

---

## 3. A nova arquitetura de informação

A barra lateral passa de 11 para **5 itens**, em linguagem comum:

```
Início        — o resumo: o que rodou, o que precisa de você
Pedir algo    — conversar com o CEO para iniciar um trabalho
Projetos      — os projetos e o Kanban de tarefas de cada um
Minha equipe  — o organograma; abre a página de cada funcionário
Ajustes       — conta, gastos, preferências
```

Mais um **fluxo de primeira vez** (Boas-vindas / Criar empresa) que roda antes do app, e uma **sub-página** (Página do funcionário → tela Ajustar). Total: o esqueleto (§4) + **8 telas** redesenhadas (§5–§12).

---

## 4. O esqueleto (shell)

**Escolhido: barra lateral enxuta** (vs. hub de cartões, vs. conversa-primeiro).

- Barra lateral com os 5 itens, cada um **ícone SVG + rótulo**, alvo generoso, item ativo com fundo `#eaf2fe` + texto `#1d5dd7`.
- Mantém a janela frameless (`TitleBar` atual) e o `CompanySwitcher`.
- A lista de agentes que hoje fica na barra **sai** — agentes vivem em "Minha equipe".
- `apps/renderer/src/App.tsx` é reescrito: `Sidebar` com 5 links; rotas remapeadas (§13).

---

## 5. Tela: Início

A primeira coisa ao abrir o app. **Layout aprovado:**

- **Saudação** — "Bom dia, Heverson" + uma linha de contexto.
- **Precisa de você** — um cartão com as decisões pendentes (aprovações, itens em Revisão, verificações), cada linha com ícone + texto + botão "Ver".
- **O que aconteceu** — 3 números: tarefas concluídas · em andamento · gastos do dia.
- **Sua equipe agora** — quem está trabalhando, com bolinha de status.

**Absorve:** Dashboard · Inbox · Activity.

> **Reconciliação com o M14:** o "Início" do M16 e a "Vitrine Matinal" do M14 são **a mesma tela**. Ver §17.

---

## 6. Tela: Pedir algo

Onde o usuário inicia um trabalho. **Layout aprovado: tela dividida** (vs. plano dentro da conversa, vs. plano em página separada).

- **Esquerda — conversa com o CEO.** Rótulo explícito "Conversa com o CEO" no topo. O usuário descreve, em português comum, o que quer. O CEO faz 1-2 perguntas de esclarecimento e então propõe um plano.
- **Direita — painel do plano.** Quando o CEO termina de entender, o plano aparece aqui: *O que vai ser feito · Quem vai fazer · Tempo e custo*, com botões **Aprovar e começar** e **Quero ajustar**.
- O usuário lê o plano e conversa ao mesmo tempo, sem trocar de tela.

**Por baixo:** "pedir algo" é a conversa com o agente CEO. O CEO classifica e traduz — a maioria dos pedidos vira um **Goal + GoalPlan** (M8.5); pedidos que exigem gente nova viram um **Org Plan** (M12). O usuário **nunca vê** as palavras "Goal" ou "Org Plan" — só "pedido → plano → tarefas".

**Absorve:** criação/plano/revisão de Goals · Org Plan.

---

## 7. Tela: Projetos

**Layout aprovado: lista-mestre + Kanban** (vs. lista→drill, vs. Kanban com abas).

- **Esquerda — lista de projetos**, sempre visível: nome, "X de Y tarefas", barra de progresso. "+ Novo projeto" embaixo.
- **Direita — o Kanban** do projeto selecionado, com um cabeçalho mostrando o nome **e a pasta do projeto**.
- **4 colunas:** **A fazer · Fazendo · Revisão · Concluído** (os 6 status do M6 — `backlog/todo/doing/review/done/cancelled` — agrupados: backlog+todo→A fazer, doing→Fazendo, review→Revisão, done→Concluído, cancelled oculto).
- **Kanban editável** — botão "+ Adicionar tarefa" na coluna "A fazer". Tarefas criadas pelo usuário ficam sem dono ("aguardando um agente pegar") até um agente assumir.
- **Coluna Revisão** (amarelo) — o agente terminou e precisa do OK humano. O mesmo trabalho que aparece em "Precisa de você" no Início.
- **Projeto = uma pasta no computador.** Criar um projeto é escolher/criar uma pasta; os agentes daquele projeto trabalham dentro dela. Ver §15.

**Absorve:** Projects · Issues/Kanban.

---

## 8. Tela: Minha equipe

**Layout aprovado: organograma** (vs. grade de cartões, vs. lista por seções).

- O **CEO** no topo (nó destacado), os **funcionários** abaixo, conectados por linhas — mostra a estrutura da empresa.
- Cada nó: avatar (iniciais), nome, papel, status.
- **Tocar em qualquer nó — CEO ou funcionário — abre a Página do funcionário** daquela pessoa. (Corrige a premissa de "só conversar com o CEO": todo agente é conversável.)
- "+ Contratar alguém".

**Absorve:** lista de Agentes · Org Chart.

---

## 9. Sub-página: Página do funcionário

Abre ao tocar num nó do organograma. **Layout aprovado: conversa em tela cheia + botão "Ajustar"** (vs. abas Conversa/Ajustar, vs. conversa + perfil lateral).

- A página **é a conversa** com aquele agente, em tela cheia.
- Cabeçalho: link "‹ Minha equipe", avatar + nome + papel + status, e um botão **"Ajustar"** discreto.
- "Ajustar" abre a tela de configuração profunda (§10).
- Vale para todo agente, inclusive o CEO.

---

## 10. Tela: Ajustar (configuração do funcionário)

Abre pelo botão "Ajustar". **Layout aprovado: sub-abas** (vs. página rolável, vs. menu lateral).

Cinco abas:

| Aba | Conteúdo | Origem |
|---|---|---|
| **Identidade** | Nome, papel, foto/iniciais | `agents` |
| **Instruções** | O charter em linguagem comum (Missão · Como ela faz · Padrão de qualidade), com **"Gerar com IA"** | charter M12 + geração M12 PR-D1 |
| **Habilidades** | As skills/capabilities do agente; adicionar/remover | M11 skills + M7 capabilities |
| **Comportamento** | Modelo de IA, política de execução (precisa de aprovação?), limite de gasto | Run Policy M12 PR-E2 |
| **Histórico** | Tarefas, métricas, o que aprendeu, execuções | abas Issues/Stats/Learning/Runs |

**Absorve:** o "Agent Studio" inteiro (Config/Instructions/Issues/Stats/Learning/Runs) + a biblioteca de papéis/charters (`/roles`).

---

## 11. Fluxo: Boas-vindas / Criar empresa

Roda **uma vez**, antes do app (sem barra lateral). **Layout aprovado: passo a passo** (vs. conversa de boas-vindas, vs. tela única).

- Wizard com barra de progresso, **uma pergunta por tela**:
  1. Boas-vindas + **conectar a conta** (a autenticação OAuth/Claude).
  2. **Conte sobre o seu negócio** — descrição em linguagem natural.
  3. **Criando** — a empresa **e o CEO** são criados automaticamente; cai no app (Início).
- O usuário **não "contrata um CEO"** como passo técnico — a empresa nasce com um gerente. Personalizá-lo depois: Minha equipe → CEO → Ajustar.

**Absorve:** `SetupWizard` (`/setup`).

---

## 12. Tela: Ajustes

**Layout aprovado: grade de categorias** (estilo "Ajustes" de celular — vs. menu lateral, vs. página rolável).

- Quatro cartões grandes: **Conta · Gastos · Preferências · Avançado**. Tocar abre a área.
  - **Conta** — conexão e plano (autenticação).
  - **Gastos** — gasto do mês + limite mensal + avisos. (Absorve o Costs.)
  - **Preferências** — tema (claro/escuro), idioma.
  - **Avançado** — onde os agentes rodam (local/VPS — M10), salvar/carregar empresa (import/export `companies.sh` e `AGENTS.md`).

**Absorve:** Settings · Costs.

---

## 13. Mapeamento — o que existe hoje → onde vai

Nenhum recurso é perdido.

| Rota / superfície atual | Vai para |
|---|---|
| `/dashboard` | **Início** |
| `/inbox` | **Início** → "Precisa de você" |
| `/activity` | **Início** (resumo) + Histórico do funcionário |
| `/goals`, `/goals/new`, `/goals/:id` | **Pedir algo** (conversa → plano) |
| `/org-plan` | **Pedir algo** (plano de organização) |
| `/projects` | **Projetos** (lista) |
| `/issues` (Kanban) | **Projetos** → Kanban do projeto |
| `/agents` | **Minha equipe** |
| `/org` | **Minha equipe** (organograma) |
| `/agents/:id` (Agent Studio) | **Página do funcionário** + **Ajustar** |
| `/roles` (biblioteca de charters) | **Ajustar** → aba Instruções |
| `/costs` | **Ajustes** → Gastos |
| `/settings` | **Ajustes** |
| `/setup` (SetupWizard) | **Boas-vindas / Criar empresa** |

---

## 14. Vocabulário — jargão → linguagem comum

| Hoje (técnico) | No M16 |
|---|---|
| Agent | Funcionário / membro da equipe |
| CEO | Gerente (e nome próprio) |
| Issue / task | Tarefa |
| Goal / Org Plan | Não exposto — vira "pedido" → "plano" → "tarefas" |
| Org Chart | O organograma em "Minha equipe" |
| Role / Charter | Instruções (do funcionário) |
| Skills / Capabilities | Habilidades |
| Run Policy | Comportamento |
| Costs | Gastos |
| Inbox | "Precisa de você" / coluna Revisão |
| Settings | Ajustes |
| Setup Wizard | Boas-vindas |

A passada de vocabulário é majoritariamente nas chaves de i18n (`t()`). Auditar com cuidado — lição do M11 PR-A (um `sed` de rename sobre-captura chaves de i18n).

---

## 15. Conceitos confirmados no brainstorm

- **Pedir algo = conversa com o CEO.** O CEO esclarece e propõe; o usuário aprova o plano. Tudo numa tela dividida (§6).
- **Conversar com todos os agentes.** Não só o CEO — qualquer nó do organograma abre a conversa daquela pessoa (§8, §9).
- **Kanban editável.** O usuário cria tarefas em "A fazer"; agentes pegam (§7).
- **Coluna "Revisão".** 4ª coluna — trabalho que terminou e precisa do OK humano (§7).
- **Projeto = pasta.** Um projeto corresponde a uma pasta no computador do usuário, que os agentes do projeto acessam. Criar projeto = escolher/criar a pasta. Isto casa com o conceito de **zonas de contenção** do M13 (cada pasta uma zona) — alinhar na implementação.
- **CEO automático.** A empresa nasce com o CEO no onboarding; não é um passo técnico do usuário (§11).

---

## 16. Não-regressão — o que NÃO se perde

Tudo continua acessível, só reembalado:

- **Kanban** — preservado, dentro de cada projeto, com 4 colunas (o usuário pediu explicitamente para mantê-lo).
- **Múltiplos projetos** — primeira classe (a lista-mestre em Projetos).
- **Profundidade do Agent Studio** — toda em "Ajustar" (charter, skills, modelo, política, histórico).
- **Costs, Activity, Org Chart, Roles** — todos têm casa (§13).
- **Multi-empresa** — o `CompanySwitcher` permanece no topo da barra.
- Backend M1–M15 intacto — o M16 é camada de apresentação.

---

## 17. Reconciliação com o M14

O **M14 — Vitrine Matinal** desenhou a tela inicial como um resumo de triagem do "que rodou enquanto você dormia". O **Início** do M16 (§5) é **a mesma superfície**. As duas specs descrevem a home do app.

**Resolução:** o Início do M16 **é** a Vitrine Matinal, em linguagem comum. Na implementação, quem rodar primeiro define a base; o outro se ajusta. Concretamente: o layout de triagem ("Precisa de você" no topo), o cursor "desde a última revisão" e a manchete gerada (M14) são as mecânicas; o M16 dá a elas a roupagem de linguagem comum. **Recomendação:** se o M16 vier antes do M14, o M14 deixa de ter "PR da Vitrine" e vira só "Escada de Confiança" + os ganchos de dados do Início.

---

## 18. Faseamento (PRs)

| PR | Escopo |
|---|---|
| **A** | **Esqueleto + vocabulário.** Reescrita do `App.tsx` (barra de 5 itens, ícones SVG, rotas remapeadas) · passada de i18n jargão→comum · conjunto de ícones SVG. |
| **B** | **Início + Ajustes.** A tela Início (saudação, Precisa de você, O que aconteceu, equipe agora) · a tela Ajustes (grade de categorias). |
| **C** | **Minha equipe + Página do funcionário + Ajustar.** Organograma · página de conversa do agente · tela Ajustar (5 sub-abas) absorvendo o Agent Studio. |
| **D** | **Pedir algo.** Tela dividida conversa-CEO + painel de plano. |
| **E** | **Projetos.** Lista-mestre + Kanban de 4 colunas · "+ Adicionar tarefa" · vínculo projeto↔pasta. |
| **F** | **Boas-vindas / Criar empresa.** Wizard passo a passo redesenhado. |
| **G** | **Consolidação.** Polish (`frontend-design`) · não-regressão · `roadmap.html`. |

**Custo estimado:** ~20-28 dias. É um milestone de front-end — o backend quase não muda.

---

## 19. Testes & não-regressão

- Cada rota antiga continua resolvendo (redirect/remap) — sem links quebrados.
- Os fluxos existentes (criar goal, revisar plano, kanban, configurar agente) continuam funcionais sob os nomes novos.
- Teste de paridade de i18n (PT/EN) após a passada de vocabulário.
- Tema claro/escuro em todas as 8 telas (lição M7.6 — form controls em `@layer base`).
- Suíte do renderer verde; backend M1–M15 intacto.
- Auditar `t()` após o rename de chaves (lição M11 PR-A).

---

## 20. Out-of-scope do M16

- ❌ Mudanças de backend além do mínimo para ligar a UI nova (ex.: vínculo projeto↔pasta, se ainda não existir, é o único candidato).
- ❌ Novos recursos de produto — o M16 reembala o que existe; features novas são M13/M14/M15 e adiante.
- ❌ App mobile / responsivo para telas pequenas — segue desktop (Electron).
- ❌ Onboarding tutorial interativo dentro do app (tooltips guiados) — fast-follow possível, não V1.

---

## 21. Decisões em aberto

- **Numeração do milestone** — "M16" é provisório; confirmar a posição no ROADMAP.
- **Mockups validados** — os 9 mockups em alta fidelidade estão versionados em `docs/m16-mockups/`, junto com este spec.
- **Vínculo projeto↔pasta** — confirmar se `projects` já guarda um caminho de pasta; se não, é a única adição de schema do M16.
- **IA fina de cada tela** — espaçamentos, ícones definitivos: decisão da skill `frontend-design` na implementação.
- **Posição vs. M14** — ver §17; resolver ao sequenciar.

---

## 22. Custo & posição no roadmap

**Custo estimado:** ~20-28 dias (~7 PRs). Milestone de front-end.

**Posição:** a interface técnica atual **contradiz a persona V2** ("qualquer pessoa, mesmo quem nunca usou um computador"). Shippar backends poderosos (M13/M14/M15) sobre uma UI "truncada e técnica" entrega valor que o público-alvo não consegue acessar. Por isso o M16 deve vir **cedo na V2** — recomendação: logo após fechar o M12 (PR-F) e o M13, e **antes ou junto** das demais. Decisão final de sequência é do usuário.

**Próximo passo quando o M16 começar:** invocar a skill `writing-plans` para gerar o plano de implementação detalhado, PR a PR.

---

## 23. Referências

- Mockups em alta fidelidade validados no brainstorm — `docs/m16-mockups/`: `shell-navigation-hifi.html` · `page-inicio.html` · `flow-pedir-plano.html` · `page-equipe.html` · `page-funcionario.html` · `screen-ajustar.html` · `screen-onboarding.html` · `screen-projetos-b2.html` · `screen-ajustes.html`.
- Código atual: `apps/renderer/src/App.tsx` (barra/rotas) · `apps/renderer/src/theme/tokens.css` + `tailwind.config.ts` (identidade visual) · `apps/renderer/src/routes/` (as 17 telas atuais).
- [docs/superpowers/specs/2026-05-18-m14-vitrine-confianca-design.md](2026-05-18-m14-vitrine-confianca-design.md) — a Vitrine Matinal, reconciliada com o Início (§17).
- [feedback_no_emojis](../../../README.md) · [feedback_three_layout_options](../../../README.md) — regras de UI deste brainstorm.
