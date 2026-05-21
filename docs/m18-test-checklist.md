# M18 — Checklist de testes (smoke do app empacotado)

Roteiro pra você testar o app de verdade e anotar tudo que estiver errado. M18 = corrigir o que aparecer aqui.

**Como usar:** marque `[x]` o que passou; em cada item que falhar, escreva o que aconteceu na linha **▸ Problema:** abaixo dele (qual passo, mensagem de erro, o que esperava vs. o que viu). Sem pressa — quanto mais detalhe, mais fácil corrigir.

**Build sob teste:** `release/Prospero-Setup-0.1.0.exe` (rebuild de 2026-05-21, inclui M16 completo + M17 PR-A→D + fixes token/scroll).

**Preparação (importante):**

- [ ] Desinstalar o Prospero (se instalado) e **apagar `%APPDATA%\Prospero`** (remove token + empresas antigas sem CEO). Sem isso, o app pula o onboarding.
- [ ] Rodar o `Prospero-Setup-0.1.0.exe` → SmartScreen → "Mais informações" → "Executar mesmo assim" (sem code signing ainda — esperado).

---

## 1. Onboarding (primeiro uso) — M16 PR-F

- [ ] Abre na tela **Boas-vindas** (sem sidebar, card centralizado).
- [ ] Conectar conta: OAuth Max (auto-detect do `~/.claude/.credentials.json`) funciona.
  - ▸ Problema:
- [ ] Aparece o passo **"Conte sobre o seu negócio"** (nome da empresa + descrição).
  - ▸ Problema:
- [ ] **Criar minha empresa** → cai no **Início**.
  - ▸ Problema:
- [ ] O **CEO já aparece em "Minha equipe"** logo após criar.
  - ▸ Problema:

## 2. Início (Vitrine) — M14 + M16

- [ ] Saudação no topo + cards de status (concluídas / em andamento / gastos).
- [ ] Seção "Precisa de você" e "Sua equipe agora" (agentes com inicial + status).
  - ▸ Problema:
- [ ] A manchete/resumo do dia carrega (ou um fallback sensato, sem travar).
  - ▸ Problema:

## 3. Sidebar (5 itens) — M16

- [ ] Exatamente 5 itens: Início · Pedir algo · Projetos · Minha equipe · Ajustes (ícones SVG, sem emoji).
- [ ] Cada um navega corretamente; nada quebra (sem tela branca).
  - ▸ Problema:

## 4. ⭐ Pedir algo — #3 (NOVO) — **DE-RISK CRÍTICO**

Este é o fluxo mais novo e o de maior risco (o CEO produzir um plano nunca foi testado ao vivo). Teste com calma.

- [ ] "Pedir algo" abre no estado vazio: "O que você precisa?" + caixa de texto.
- [ ] Digitar um pedido em linguagem comum (ex.: "quero abrir uma loja online de velas") → **Pedir**.
- [ ] O **CEO responde no chat** (a conversa funciona).
  - ▸ Problema:
- [ ] Clicar **Montar o plano** → em ~30-60s aparece **"Seu plano está pronto → Ver plano"**. ← *o risco principal*
  - ▸ Problema:
- [ ] **Ver plano** abre a página de revisão: "O que vai ser feito" (tarefas) / "Quem vai fazer" (funcionários) / "Tempo e custo".
  - ▸ Problema:
- [ ] Desmarcar uma tarefa e/ou um funcionário funciona (some/risca).
- [ ] **Aprovar e começar** → contrata os funcionários marcados + cria as tarefas; cai em Projetos.
  - ▸ Problema:
- [ ] **Quero ajustar** volta pra conversa; **Refazer o plano** gera um plano novo.
  - ▸ Problema:

## 5. Projetos (Kanban) — #2

- [ ] Criar um projeto (escolher pasta) funciona.
- [ ] Abrir o projeto mostra um **Kanban de 4 colunas** (A fazer / Fazendo / Revisão / Concluído).
  - ▸ Problema:
- [ ] **Adicionar tarefa** (na coluna A fazer) abre o formulário já com o projeto preenchido.
- [ ] **Arrastar** uma tarefa entre colunas funciona e persiste.
  - ▸ Problema:
- [ ] No topo aparece a **pasta do projeto** como pill com ícone SVG (sem emoji 📁).
- [ ] A lista lateral mostra progresso ("X de Y tarefas" + barra).
  - ▸ Problema:
- [ ] As tarefas criadas via "Pedir algo" (item 4) aparecem aqui no projeto certo.
  - ▸ Problema:

## 6. Minha equipe (organograma)

- [ ] Mostra o CEO (e quaisquer funcionários) em organograma.
- [ ] Clicar num funcionário navega pra conversa dele.
- [ ] Arrastar pra mudar chefia (drag-to-reparent) funciona; "+ Contratar" no header.
  - ▸ Problema:

## 7. Conversa com funcionário — fix do scroll

- [ ] Abrir a conversa de um agente: o **campo de escrever mensagem aparece sem precisar rolar** (mesmo numa conversa vazia, mesmo com o banner no topo). ← *o bug que você reportou*
  - ▸ Problema:
- [ ] Mandar mensagem; o agente responde; histórico rola dentro da área certa.
- [ ] Botão **Ajustar** → 5 abas (Identidade / Instruções / Habilidades / Comportamento / Histórico).
  - ▸ Problema:

## 8. Ajustes (grade + sub-páginas) — M16 PR-B2

- [ ] Grade de tiles: Conta · Preferências · Avançado · Gastos.
- [ ] **Conta**, **Preferências** (idioma/tema), **Avançado** abrem.
  - ▸ Problema:
- [ ] Trocar tema claro/escuro e idioma reflete na hora.
  - ▸ Problema:

## 9. Token OAuth — fix

- [ ] **Não aparece** mais o banner amarelo "Token OAuth expira em 1 dias" o tempo todo. ← *o que você reportou*
  - ▸ Problema:
- [ ] (Após ~1 dia de uso) os recursos de IA em segundo plano continuam funcionando (manchete do Início, etc.) — i.e., o token headless se renova sozinho.
  - ▸ Problema:

## 10. Atualizações (UI) — M17 PR-D

- [ ] Ajustes › Avançado tem a seção **Atualizações** com status + botão "Verificar atualizações".
- [ ] "Verificar atualizações" não quebra (em build instalado pode dizer "Em dia" ou baixar; em dev é no-op).
  - ▸ Problema:

## 11. M17 release ao vivo — **só depois do push** (gated)

Só dá pra testar depois que os commits forem pushados e uma tag for cortada (a Action roda em push de tag). Sequência:

- [ ] Push dos commits → `git tag v0.1.0` → `git push origin v0.1.0`.
- [ ] A **GitHub Action** roda e publica `Prospero-Setup-0.1.0.exe` + `latest.yml` no Release.
  - ▸ Problema:
- [ ] Instalar pelo `.exe` do Release; publicar um **v0.1.1** trivial → o app **se auto-atualiza** (banner "Reiniciar para atualizar").
  - ▸ Problema:

## 12. Transversal (M16 §2 e geral)

- [ ] **Sem emojis** na interface (só ícones SVG) — anote qualquer emoji que sobrou.
  - ▸ Onde achou emoji:
- [ ] Linguagem comum (sem jargão técnico) nas telas principais.
  - ▸ Onde achou jargão:
- [ ] Nenhuma **tela branca** / crash em nenhum fluxo.
  - ▸ Onde:
- [ ] Qualquer outra coisa estranha (layout quebrado, texto cortado, lentidão):
  - ▸

---

## Anotações livres (jogue aqui qualquer problema que não coube acima)

-
-
-
