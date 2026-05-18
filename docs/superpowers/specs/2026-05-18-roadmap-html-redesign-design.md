# roadmap.html — Redesenho como página de pitch — Design

> **Status:** design aprovado (2026-05-18) na sessão de brainstorming. Base para o plano de execução.
>
> **Origem:** pedido do usuário — transformar `docs/roadmap.html` (hoje um devlog técnico) numa página de venda visual, bonita e explicativa para leigos, que comunique o poder do projeto, onde ele está e para onde vai.

---

## 1. Objetivo

Substituir `docs/roadmap.html` por uma **página única de pitch**, 100% em linguagem de leigo, que venda o Prospero para qualquer pessoa não-técnica — investidor, cliente em potencial ou leigo geral. A página precisa, com detalhe e de forma visual: explicar o poder do produto, mostrar onde o projeto está hoje e para onde vai.

### 1.1 Decisões travadas no brainstorming

- **Público:** pitch universal — funciona para investidor, cliente e leigo geral ao mesmo tempo.
- **Escopo:** substituição total. `docs/roadmap.html` deixa de ser um devlog técnico (milestones M1–M11, PRs, SHAs, módulos, wishlist) e vira 100% página de venda. O rastreio técnico passa a viver **apenas** no `ROADMAP.md`.
- **Gancho (a ideia única da página):** "Delegue o resultado, não a tarefa."
- **Estética:** clara e amigável.
- **Paleta:** creme & coral (tokens em §3).
- **Interatividade:** três momentos interativos completos, distribuídos pela narrativa — organograma vivo, simulador de delegação, slider de escala e custo — mais toques leves (revelação no scroll, contadores animados, linha do tempo interativa).

### 1.2 Consequência para a regra de sincronização do roadmap

Hoje a regra `feedback_roadmap_3_lugares` manda atualizar `roadmap.html` a cada feature mergeada. Como o `roadmap.html` deixa de espelhar milestones, **essa parte da regra é aposentada**: a partir deste redesenho, só o `ROADMAP.md` é atualizado por feature. O comentário de manutenção no topo do novo `roadmap.html` deve declarar isso explicitamente. O plano de execução deve registrar essa mudança de regra no fechamento (atualizar a memória/feedback correspondente fica a cargo do usuário/sessão).

## 2. O produto (base factual para a copy)

Para a copy ser precisa sem inventar:

- Prospero é um **app de desktop** onde **uma pessoa comanda uma empresa de funcionários de IA** (construídos sobre o Claude).
- O usuário **contrata agentes**, dá a cada um um **papel** (engenheiro, designer, CEO, etc.) e os arranja num **organograma** com hierarquia e equipes.
- O usuário **delega**: cria **tarefas** e **metas (objetivos)**; um agente-CEO planeja, o time executa; um **quadro kanban** acompanha; o usuário **revisa e aprova**.
- **Custo:** cada agente tem orçamento; gasto visível ao vivo.
- **Memória e aprendizado (entregue no M11):** os agentes têm memória persistente, derivam "habilidades" reutilizáveis do trabalho concluído, e o conhecimento é herdado entre funcionários do mesmo papel.
- Os agentes rodam **na máquina do usuário ou num servidor (VPS)**. Suporta **múltiplas empresas**.
- **Segurança:** agentes rodam em ambiente isolado (sandbox); ações sensíveis exigem aprovação do usuário.
- **Estado real:** v1 completo; M11 (memória e aprendizado) entregue.
- **Visão V2:** a "empresa de uma pessoa só" — resultados garantidos (enforced outcomes), rotinas automáticas, manuais reutilizáveis (plays).

A copy **nunca** usa jargão técnico: nada de "M11", "PR", "commit", "milestone", "IPC". Tudo em português, linguagem comum.

## 3. Sistema visual

### 3.1 Arquivo e restrições

- Arquivo único: `docs/roadmap.html`. CSS em `<style>` inline no `<head>`; JS em um único `<script>` no fim do `<body>`.
- **Offline-first:** sem CDN, sem dependências externas, sem requisições de rede, sem fontes web. Fontes do sistema. Todos os ícones e gráficos são SVG inline. (Mantém o valor de projeto já existente do arquivo atual.)
- Tema **claro único** (sem alternância dark/light — a direção escolhida é inerentemente clara).
- Idioma: **português (pt-BR)**, sem jargão.

### 3.2 Tokens de cor (CSS custom properties em `:root`)

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#fbf6ec` | fundo creme da página |
| `--surface` | `#ffffff` | cartões, painéis |
| `--surface-2` | `#fffaf2` | cartão/seção alternada (creme claro) |
| `--ink` | `#2a2521` | texto principal |
| `--ink-soft` | `#7a7066` | texto secundário |
| `--ink-faint` | `#a89e90` | texto terciário, estados "futuro" |
| `--accent` | `#ff5e3a` | coral — destaque, botões, nós ativos |
| `--accent-dark` | `#d2401d` | coral escuro — coral como **texto** sobre fundo claro |
| `--accent-soft` | `#ffe7df` | lavagem coral — fundos de pílula/tag |
| `--line` | `#f0e4d6` | bordas hairline |
| `--shadow-sm` | `0 6px 18px rgba(42,37,33,.07)` | elevação de cartão |
| `--shadow-lg` | `0 18px 44px rgba(42,37,33,.12)` | elevação de elemento em foco |

Paleta **monocromática coral + tinta** — sem verde. Estados de "concluído/passado" usam coral preenchido; "agora" usa anel coral pulsante; "futuro" usa contorno em `--ink-faint`.

### 3.3 Tipografia, forma, espaçamento

- Fonte única: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Sem serif, sem fonte web.
- `html { font-size: 16px }`. Títulos de herói/seção em `clamp()` fluido (ex.: herói `clamp(2.4rem, 6vw, 4rem)`; título de seção `clamp(1.6rem, 3.5vw, 2.4rem)`). Peso 800 em títulos, 400 no corpo.
- Cantos arredondados (amigável): cartões 14–18px, pílulas/botões 22px.
- Espaçamento generoso. Largura máxima do conteúdo ~1120px, centrado; seções com fundo de borda a borda.
- Sombras suaves, bordas hairline, sem traços duros.

### 3.4 Animação e acessibilidade

- **Revelação no scroll:** `IntersectionObserver` adiciona classe `.in` → fade + sobe ~16px. Aplicado a blocos de seção.
- **Contadores animados:** números sobem do 0 ao valor ao entrar na viewport.
- **Os três interativos** (§4) + micro-interações de hover.
- **`prefers-reduced-motion: reduce`** — guarda global: revelações aparecem sem transição, contadores mostram o valor final direto, os interativos pulam direto para o estado final (sem o movimento encenado). Nenhuma animação ambiente roda.
- HTML semântico (`<section>`, `<h1>`–`<h3>`, `<button>`), `aria-label` onde necessário, interativos operáveis por teclado, contraste suficiente (coral como texto usa `--accent-dark`).
- Responsivo: breakpoints ~720px e ~1024px. Os interativos degradam com elegância em telas pequenas (toque, colunas que empilham/rolam).

## 4. Estrutura da página — seção a seção

Página única, rolável, **8 blocos** (0–7). A copy abaixo é o ponto de partida; o plano de execução pode polir o texto mas não regredir a clareza ou inserir jargão.

### S0 — Herói

- Altura ~88vh, fundo `--bg`.
- Barra de topo minimalista: wordmark "PROSPERO" (letterspaced, `--accent-dark`). Sem menu.
- Centro: kicker ("SEU TIME DE IA"); título **"Delegue o resultado, não a tarefa."** (gigante, peso 800; "o resultado" em coral); subtítulo: *"Você monta uma empresa de funcionários de IA, pede um objetivo, e recebe o trabalho pronto para revisar."*; botão CTA primário ("Ver como funciona ↓" — rola para S1) + link de texto secundário ("ou pule para a jornada" — rola para S6).
- **Animação ambiente:** SVG pequeno do organograma de 3 nós onde um pulso suave viaja do nó-pai aos filhos, em loop ~6s. Pausado em reduced-motion.
- Indicador de scroll no rodapé da seção.

### S1 — A virada de chave

- Fundo `--surface-2`.
- Título: **"Você não precisa fazer. Você precisa decidir."**
- Corpo curto (2–3 frases): a mudança de mentalidade — de quem executa cada tarefa para quem só define o rumo e revisa.
- Visual: dois cartões lado a lado — "Você hoje: executando" (lista cansada de tarefas) vs. "Você com o Prospero: decidindo" (resultados prontos chegando para revisão). Leve, sem gráfico pesado.
- Revelação no scroll.

### S2 — Monte seu time · INTERATIVO: organograma vivo

- Fundo `--bg`.
- Título: **"Monte seu time"** / subtítulo "Sozinho, você comanda uma empresa inteira."
- Copy de apoio: você contrata agentes de IA, dá a cada um um papel, e os organiza num organograma com hierarquia e equipes.
- **Interativo "Organograma vivo":**
  - Área com um nó **CEO** já presente. Abaixo, uma fileira de pílulas de contratação: "+ Engenheiro", "+ Designer", "+ Redator", "+ Analista".
  - Clicar numa pílula adiciona um nó-agente ao organograma sob o CEO, com animação (o nó surge com um "pop", um conector é traçado do CEO até ele). A árvore (2 níveis) re-distribui suavemente.
  - Um contador atualiza ("4 funcionários"). Cada nó é um cartão arredondado com ícone SVG do papel + nome do papel + um nome curto gerado.
  - Limite ~9 contratações; ao atingir, as pílulas desabilitam com uma nota amigável. Link "recomeçar".
  - Abaixo do interativo, uma frase: *"Demitiu alguém? Contrate outro para o mesmo papel — ele herda tudo que o time já aprendeu."* (amarra a memória/herança do M11.)
  - **Reduced-motion:** nós aparecem sem o "pop", conectores sem traçado animado.
  - **Mobile:** funciona por toque; o organograma rola horizontalmente se ficar largo.

### S3 — Delegue uma meta · INTERATIVO: simulador de delegação

- Fundo `--surface-2`.
- Título: **"Delegue uma meta"** / subtítulo "Peça o resultado. O time faz o resto."
- Copy de apoio: explica o ciclo — você escreve uma meta; o agente-CEO a divide em tarefas; o time executa; um quadro acompanha; você revisa e aprova.
- **Interativo "Simulador de delegação":**
  - Três pílulas de meta pré-definidas: "Quero um site para minha loja", "Quero um relatório de vendas do mês", "Quero um app de lista de tarefas".
  - Ao clicar uma, roda uma sequência animada **determinística** (roteiro fixo por meta):
    1. A meta aparece como um cartão ("Meta: …").
    2. Ela se "divide" em 3–5 cartões de tarefa que se espalham e caem num mini-kanban (colunas: "A fazer / Fazendo / Revisão / Pronto").
    3. Os cartões de tarefa atravessam as colunas ao longo de alguns segundos (escalonados), cada um "pego" por um avatar de agente.
    4. Terminam em "Pronto"; estado final "✓ Entregue para sua revisão".
  - Tarefas autoradas por meta:
    - **Site para a loja:** Estrutura das páginas · Design visual · Catálogo de produtos · Carrinho e checkout · Publicação.
    - **Relatório de vendas:** Coletar os dados · Analisar tendências · Gerar os gráficos · Escrever o resumo · Revisão final.
    - **App de lista de tarefas:** Definir as telas · Programar a lógica · Testar · Empacotar o app.
  - Controle "ver de novo" / escolher outra meta.
  - **Reduced-motion:** mostra direto o estado final (meta → lista de tarefas → tudo em "Pronto"), sem o movimento.
  - **Mobile:** colunas do kanban empilham ou rolam; animação simplificada.

### S4 — O poder

- Fundo `--bg`.
- Título: **"O que seu time consegue fazer."**
- Grade de **6 cartões de capacidade** (ícone SVG inline + título + explicação de 1–2 linhas em linguagem comum):
  1. **Constrói de verdade** — escreve software, cria documentos, faz análises. Trabalho real, não rascunho.
  2. **Trabalha 24/7** — o time não dorme; você acorda com coisas prontas.
  3. **Controla o próprio custo** — cada funcionário tem um orçamento; você vê o gasto ao vivo e nada foge do controle.
  4. **Tem memória e aprende** — cada trabalho vira conhecimento; o time fica melhor sozinho, e o que um aprende os outros herdam.
  5. **Local ou na nuvem** — roda na sua máquina ou num servidor. Você escolhe.
  6. **Seguro por princípio** — os agentes trabalham numa caixa fechada e pedem sua permissão para ações sensíveis.
- O cartão "Tem memória e aprende" inclui um **mini-gráfico de linha ascendente** animado (SVG simples) ilustrando "fica melhor com o tempo".
- **Faixa de fatos** com contadores/revelações animados — **apenas fatos honestos**, nada de métrica inventada de usuários/receita. Ex.: "24/7 trabalhando", "1 pessoa no comando", "100% offline — sem nuvem obrigatória". Onde não houver número honesto e impressionante, usar revelação qualitativa em vez de contador numérico.

### S5 — A conta fecha · INTERATIVO: slider de escala e custo

- Fundo `--surface-2`.
- Título: **"A conta fecha."** / subtítulo "Faça as contas você mesmo."
- Copy de apoio: um time de IA custa uma fração de contratações humanas e escala na hora.
- **Interativo "Slider de escala e custo":**
  - Um `<input type="range">`: **"Tamanho do time"**, 1 a 8 agentes.
  - Ao arrastar, atualiza ao vivo dois valores e duas barras horizontais que crescem:
    - "Com Prospero (estimativa): ~R$ X/mês"
    - "Equipe humana equivalente: ~R$ Y/mês"
  - Um indicador de "trabalho entregue" escala junto.
  - **Honestidade — obrigatório:** a seção exibe, de forma visível, um aviso *"valores ilustrativos"* e as **premissas** (ex.: "estimativa de ~R$ A por agente/mês de uso · salário médio de referência ~R$ B/mês"). É uma ferramenta de "sentir a ordem de grandeza", não uma promessa de preço. Os números-base ficam em constantes JS no topo do script, claramente comentadas como ilustrativas e editáveis. Valores-base ilustrativos de partida: `R$ 150` por agente/mês e `R$ 6.000`/mês por trabalhador humano de referência (o plano pode ajustar; o que não pode é apresentar como precisão real).
  - **Reduced-motion:** barras atualizam sem transição.

### S6 — A jornada (onde estamos, para onde vamos)

- Fundo `--bg`. **A seção que carrega o "onde estamos / para onde vamos" com detalhe.**
- Título: **"A jornada"** / subtítulo "Onde estamos. Para onde vamos."
- **Linha do tempo horizontal interativa** com 4 fases (nós clicáveis):
  1. **O começo** — a ideia: um time de IA gerenciado por conversa.
  2. **HOJE — você está aqui** — empresa completa funcionando + memória e aprendizado. Nó destacado, marcador "você está aqui" com anel coral pulsante.
  3. **Próximo** — definir empresas e agentes de forma mais rica e reaproveitável.
  4. **A visão** — a empresa de uma pessoa só que quase se gerencia sozinha.
  - Interação: clicar num nó atualiza o painel de detalhe abaixo. Padrão = "Hoje". A espinha da linha do tempo se desenha na revelação.
- Abaixo da linha do tempo, **dois blocos honestos e detalhados** (o detalhe que o usuário pediu), em linguagem de leigo:
  - **"O que já funciona hoje":**
    - Você monta sua empresa: contrata agentes, define papéis, desenha o organograma, agrupa em equipes e projetos.
    - Você delega: cria tarefas e metas; um agente-CEO planeja, o time executa.
    - Um quadro acompanha tudo; você revisa e aprova.
    - Controle de custo: orçamento por agente, gasto ao vivo.
    - Memória e aprendizado: os agentes lembram, transformam o trabalho em habilidades reutilizáveis, e o conhecimento passa de um funcionário para outro.
    - Roda na sua máquina ou num servidor; suporta várias empresas.
    - Segurança: caixa fechada, aprovação para ações sensíveis.
  - **"Para onde vamos":**
    - Definir empresas e agentes de forma mais rica e reaproveitável.
    - Resultados garantidos: você define um padrão e a empresa garante que ele seja cumprido.
    - Rotinas: trabalhos que se repetem passam a rodar sozinhos, no horário certo, sem você pedir.
    - Manuais prontos: formas comprovadas de obter um resultado, prontas para reusar.
    - O rumo: a empresa cada vez mais se conduz sozinha — você só dá direção e revisa.

### S7 — Fechamento

- Fundo em **faixa coral (`--accent`)** com texto claro — fechamento quente, confiante, ainda dentro da estética clara/amigável.
- Recapitula a ideia única: **"Pare de executar. Comece a comandar."**
- Parágrafo de fechamento confiante.
- CTA final: botão proeminente. Como a página é um artefato autônomo sem funil, o CTA padrão é **"Voltar ao início"** (rola ao herói). Um bloco de constantes `LINKS` no topo do script permite ao usuário, depois, apontar o CTA para uma URL externa (site/contato) — se `LINKS.cta` estiver definido, o botão vira link externo. Não inventar destino.
- Rodapé minimalista: *"Prospero · construído localmente · funciona offline."*

## 5. Arquitetura técnica

- **Um arquivo:** `docs/roadmap.html`. `<head>` com `<style>` inline (todo o CSS, custom properties da paleta). `<body>` com as 8 `<section>` semânticas. Um único `<script>` no fim.
- **Sem build, sem dependências, sem CDN.** Todos os ícones/gráficos são SVG inline.
- **Módulos JS** (funções/IIFEs dentro do único script):
  - `reducedMotion` — guarda global via `matchMedia('(prefers-reduced-motion: reduce)')`; cada módulo a consulta.
  - `scrollReveal()` — `IntersectionObserver`, adiciona `.in`.
  - `counters()` — anima contagem ao revelar.
  - `orgChart()` — interativo da S2.
  - `delegationSim()` — interativo da S3.
  - `costSlider()` — interativo da S5.
  - `timeline()` — interativo da S6.
  - Bloco de constantes no topo: `LINKS` (CTA), `COST` (premissas ilustrativas do slider).
- **Comentário de manutenção** no topo do arquivo: declara que `roadmap.html` é a página de pitch para leigos (não mais um devlog), que o rastreio técnico vive no `ROADMAP.md`, e que este arquivo **não** é mais sincronizado por feature.
- Cada interativo é um módulo isolado: pode ser entendido e testado por conta própria; uma falha num interativo não derruba os outros nem o resto da página (cada `init` em `try/catch` defensivo, registrando no console e seguindo).

## 6. Testes e verificação

Arquivo HTML estático standalone — o vitest do repositório não cobre `docs/`. Verificação é **QA visual manual** por checklist (o plano detalha):

- Cada uma das 8 seções renderiza corretamente.
- Os 3 interativos funcionam: organograma adiciona/reseta nós; simulador roda as 3 metas até o estado final; slider atualiza valores e barras; linha do tempo troca o detalhe ao clicar.
- Animações de revelação disparam ao rolar; contadores sobem.
- `prefers-reduced-motion` respeitado (testar com a preferência ligada — sem movimento, estados finais diretos).
- Responsivo: conferir em larguras de celular (~375px), tablet (~768px) e desktop (~1280px).
- **Offline:** abrir o arquivo sem rede / a aba de rede do navegador não mostra nenhuma requisição externa.
- Sem erros no console; HTML válido.

## 7. Fora de escopo (não-objetivos)

- Sem backend, sem API de custo real, sem cadastro/funil de conversão.
- Sem tema escuro, sem alternância de tema.
- Sem outro idioma além de pt-BR.
- Os números do slider de custo são **ilustrativos** — não é uma calculadora de preço real.
- Não preservar o conteúdo técnico do `roadmap.html` atual (milestones, PRs, wishlist) — ele é descartado de propósito; o `ROADMAP.md` continua sendo o doc técnico.

## 8. Riscos e mitigações

- **Credibilidade do slider de custo** — mitigado por rótulo "ilustrativo" visível + premissas à mostra + constantes editáveis. Apresentar como ordem de grandeza, nunca como preço.
- **Tamanho do arquivo** — arquivo único com 3 interativos + SVG inline; manter SVGs enxutos; alvo abaixo de ~150 KB.
- **Esforço de build concentrado nos 3 interativos** — são a maior parte do trabalho; o plano deve tratá-los como tarefas próprias, cada uma testável isolada.
- **Honestidade da copy** — nenhuma métrica de tração inventada (usuários, receita, etc.); apenas fatos verificáveis sobre o que o produto faz e o estado real (v1 completo, memória entregue).
