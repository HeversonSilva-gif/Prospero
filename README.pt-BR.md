# Prospero

> **[🇺🇸 Read in English](README.md)**

[![Versão](https://img.shields.io/badge/versão-0.1.18-blue)](https://github.com/HeversonSilva-gif/Prospero/releases/latest)
[![Licença: MIT](https://img.shields.io/badge/licença-MIT-green)](LICENSE)
[![Plataforma: Windows](https://img.shields.io/badge/plataforma-Windows%20x64-lightgrey)](https://github.com/HeversonSilva-gif/Prospero/releases/latest)
[![Testes](https://img.shields.io/badge/testes-1757_passando-brightgreen)](#status)

---

**Monte um negócio de uma pessoa com o suporte de uma empresa inteira de IA.**

O Prospero roda uma hierarquia de agentes Claude Code no seu desktop Windows — CEO, engenheiros, QA, PM — se coordenando automaticamente, usando a **assinatura Claude Max que você já paga**. Você descreve o que quer; o CEO propõe um plano e quem contratar; os agentes fazem o trabalho; você revisa o que importa.

Sem API key separada. Sem cloud. Seus dados ficam em SQLite no seu computador.

> ⚠️ **Isto é vibecoded.** O Prospero foi construído quase inteiramente pelo Claude Code, guiado conversacionalmente com um humano definindo a direção e testando cada etapa. É um projeto pessoal e experimental — não um produto comercial endurecido. Leia o [Disclaimer](#disclaimer) antes de usar.

---

<!-- DEMO PLACEHOLDER — screenshot / GIF em breve com o Brand Kit -->
> 🎬 *Screenshot e demo GIF chegando em breve.*

---

## O que é

- **Um orquestrador local de agentes** — app Electron desktop (Windows x64). Todos os dados em SQLite. Nada na nuvem.
- **Uma hierarquia de agentes Claude** — CEO planeja e delega, especialistas executam. Até 4 agentes rodando em paralelo (limite seguro do plano Claude Max).
- **Memória e skills que crescem** — agentes acumulam memória persistente entre sessões e skills reutilizáveis. O que um agente aprende, a empresa inteira guarda.
- **Trabalho orientado a resultados** — objetivos têm critérios de sucesso explícitos; o trabalho é verificado antes de ser marcado como concluído.
- **Escada de confiança** — agentes que constroem um histórico verificado ganham mais autonomia com o tempo. Você está sempre no controle.

## Por que Claude Max e não uma API key

Se você já paga o Claude Max, não precisa de uma API key Anthropic separada só para rodar agentes. O Prospero usa `CLAUDE_CODE_OAUTH_TOKEN` (do `claude setup-token`) para que toda a atividade dos agentes conte contra sua assinatura existente — sem cobranças extras.

Três modos de autenticação suportados, escolhíveis por agente:

| Modo | Quando usar |
|---|---|
| **Claude Max OAuth** (padrão) | Você tem um plano Claude Max — custo extra zero |
| **Anthropic API key** | Pague por token, sem assinatura |
| **Docker remoto (VPS)** | Agentes rodam em contêineres isolados num servidor seu |

## Instalação

**Baixe o instalador (mais fácil)**

Acesse a [página de Releases](https://github.com/HeversonSilva-gif/Prospero/releases/latest) e baixe `Prospero-Setup-x.y.z.exe` (Windows x64).

O instalador é atualmente **sem assinatura** — o Windows SmartScreen vai avisar na primeira vez. Escolha **Mais informações → Executar assim mesmo**. Depois disso, o app se atualiza automaticamente.

**Pré-requisitos:** [Claude Code CLI](https://docs.anthropic.com/claude-code) instalado, mais um token do `claude setup-token`.

**Rodar a partir do código-fonte**

```bash
git clone https://github.com/HeversonSilva-gif/Prospero.git
cd Prospero
pnpm install
pnpm dev        # inicia o app em modo watch
```

Outros scripts:

```bash
pnpm test       # testes unitários (vitest) — 1 757 passando
pnpm typecheck  # tsc em todos os pacotes
pnpm lint       # eslint
pnpm dist:win   # gera o instalador Windows em ./release
```

O repositório é um monorepo pnpm: `apps/main` (Electron main + orquestrador), `apps/renderer` (UI React), `apps/agent-runner` e `packages/shared`. Requer Node 20+ e pnpm 9+.

**Rodar numa VPS (avançado)**

O Prospero pode rodar numa VPS Linux e ser acessado de qualquer
navegador via noVNC, atrás de Traefik + Authelia (2FA TOTP obrigatório).
Veja [`infra/docker/vps/README.md`](infra/docker/vps/README.md) para o
passo a passo. Leia antes a [`SECURITY.md`](SECURITY.md) → "VPS
Deployment Threat Model" — este modo expõe um shell de desktop à
internet pública, e o sandbox do Electron fica atenuado (`--no-sandbox`
dentro do container).

## Status

**v0.1.15 — todos os milestones v1 concluídos (M1–M18), features V2 sendo entregues.**

| O que funciona hoje |
|---|
| Contratar um time de agentes Claude com papéis, personas e habilidades |
| CEO planeja o trabalho: descreva um objetivo → CEO propõe agentes + tarefas → você aprova |
| Kanban board (5 colunas, drag-and-drop) com colaboração em tempo real |
| Memória e skills dos agentes — conhecimento persiste entre sessões e transfere entre agentes |
| Verificação de resultados — critérios explícitos precisam ser cumpridos antes de marcar uma tarefa como concluída |
| Escada de confiança — agentes ganham autonomia por resultados verificados |
| Vitrine Matinal — o que precisa da sua atenção, de um só olhar |
| Rastreamento de custos com soft-stop de budget (por agente, por tarefa, por dia) |
| Adapter Docker remoto — rode agentes em contêineres isolados numa VPS |
| 1 757 testes passando · 0 erros de lint/typecheck |

Veja [`ROADMAP.md`](ROADMAP.md) para o histórico completo de milestones e o que vem a seguir.

## Disclaimer

O Prospero spawn agentes Claude Code na sua máquina usando **seu** token OAuth do Claude Max. Agentes podem acessar seu sistema de arquivos, rodar comandos shell e usar a rede dentro dos limites que você configurar.

**Você é responsável por revisar as permissões dos agentes e supervisionar os modos autônomos.** Os autores não assumem responsabilidade por ações tomadas pelos agentes em seu nome. Por ser experimental e vibecoded, rode-o em projetos que você possa se dar ao luxo de ter um agente tocando — e mantenha backups.

Veja [`SECURITY.md`](SECURITY.md) para o modelo de ameaças completo, instruções de rotação de token e detalhes de mitigações.

## Contribuindo

Pré-requisitos: Node 20+, pnpm 9+, gitleaks, Windows 11 (plataforma principal).

Veja [`CONTRIBUTING.md`](CONTRIBUTING.md) para convenções de branch, estilo de commits (Conventional Commits) e o checklist do CI (lint · typecheck · test · build · gitleaks).

Ao reportar issues, **remova caminhos, nomes de projetos e conversas** antes de enviar.

## Licença

MIT — veja [LICENSE](LICENSE).
