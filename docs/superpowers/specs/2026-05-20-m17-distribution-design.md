# M17 — Distribution & Auto-update Design

**Date:** 2026-05-20. **Status:** Approved (architecture); awaiting plan.

## 1. Goal

Levar Prospero da "roda na máquina do desenvolvedor" pra "instalável + auto-atualizável". Usuários instalam um `.exe`; quando uma nova versão é tageada e empurrada, o app baixa a atualização em background e oferece "Reiniciar pra aplicar".

## 2. Stack acordada (per user 2026-05-20)

| Camada | Escolha | Por quê |
|---|---|---|
| **Packager** | `electron-builder` | Mais usado no ecossistema Electron; integrado com `electron-updater`; targets NSIS/MSI/DMG/AppImage prontos. |
| **Distribution channel** | GitHub Releases | Grátis; integrado com `electron-builder` via `publish.provider = "github"`; permissões de release controladas via tokens do repo. |
| **Updater** | `electron-updater` | Polls `latest.yml` no GitHub Releases; baixa delta NSIS; valida SHA512. |
| **Trigger de release** | Git tag (`v0.1.0`) | CI roda só em push de tag. Versionamento explícito; releases conscientes. |
| **Plataforma v1** | Windows-only (x64) | CI já é `windows-latest`; `better-sqlite3` já buildando lá; outras plataformas ficam pra M18. |
| **Code signing** | **Sem signing v1** | Usuário verá warning SmartScreen na 1ª instalação ("Mais informações" → "Executar mesmo assim"). Aceitável pra early adopters; cert paid (~$300/ano) entra em M18 se distribuição ampliar. |
| **Update check** | Auto-check no launch + botão manual | Default: check em silêncio quando app abre; baixa em background se houver update; mostra banner "Reiniciar pra aplicar". Botão em **Ajustes → Avançado** pra check manual + toggle "Atualizar automaticamente". |

## 3. Fluxo end-to-end

```
Developer:
  pnpm version 0.1.0        (bumps package.json version)
  git tag v0.1.0
  git push --tags

GitHub Actions (.github/workflows/release.yml — NOVO):
  1. Triggered on tag push v*.
  2. pnpm install --frozen-lockfile
  3. pnpm build (tsup main + renderer bundle)
  4. electron-builder --win nsis --publish always
       → Empacota dist + renderer + native deps
       → Gera Prospero-Setup-0.1.0.exe (NSIS)
       → Gera latest.yml com SHA512 do .exe
       → Upload pra GitHub Release (auto-cria release no tag)
  5. Done.

User instala v0.1.0 .exe (NSIS instala em %LOCALAPPDATA%\Programs\Prospero).
  App roda. electron-updater no main process:
    autoUpdater.checkForUpdatesAndNotify() no app.whenReady()
    → GET https://github.com/.../releases/latest/download/latest.yml
    → Compara com package.json version
    → Se newer: autoDownload (default true) → baixa delta em background
    → Emite "update-downloaded" → main envia IPC pro renderer
    → Renderer mostra banner "Atualização v0.1.1 baixada — Reiniciar agora?"
    → User clica → autoUpdater.quitAndInstall() → app reinicia em v0.1.1
```

## 4. Estrutura do M17 em PRs

Proposta: 5 PRs sequenciais.

### PR-A — electron-builder config + first local installer

**Goal:** Conseguir gerar `Prospero-Setup-0.1.0.exe` localmente via `pnpm dist:win`.

**Arquivos:**
- `package.json` (root): bumpar version pra `0.1.0`, adicionar `electron-builder` devDep, novo script `dist:win`.
- `electron-builder.yml` (root): config com appId, productName, target NSIS, files glob (apps/main/dist + apps/renderer/dist + native deps), `asarUnpack` pra better-sqlite3.
- `.gitignore`: ignorar `release/` (output do electron-builder).

**Saída:** rodar `pnpm dist:win` produz `release/Prospero-Setup-0.1.0.exe`. Manual smoke test: instala, abre, app roda. Esse PR não publica nada — só prova que packaging funciona.

**Custo:** ~4-6 tasks. Native deps são o risco principal (better-sqlite3 precisa estar nos lugares certos do .asar).

### PR-B — GitHub Actions release workflow

**Goal:** `git push --tags` dispara CI que publica installer pro GitHub Releases.

**Arquivos:**
- `.github/workflows/release.yml` (NOVO): trigger on `push: tags: [v*]`, runs-on windows-latest, builds + publishes.
- `package.json`: campo `repository` (electron-builder usa pra inferir GitHub publish target).
- `electron-builder.yml`: adicionar `publish:` block apontando pra GitHub provider.

**Saída:** primeiro `git push origin v0.1.0` cria automaticamente uma Release no GitHub com o `.exe` e `latest.yml` anexados.

**Custo:** ~3-4 tasks.

### PR-C — electron-updater no app

**Goal:** App checa por updates no launch.

**Arquivos:**
- `apps/main/package.json`: adicionar `electron-updater` dep.
- `apps/main/src/updater/` (NOVO): wrapper sobre electron-updater com event handlers + IPC bridge.
- `apps/main/src/index.ts`: chamar `checkForUpdates()` em `app.whenReady()`.
- `apps/main/src/preload.ts`: expor `window.prospero.updater.*` IPCs.
- `apps/renderer/src/env.d.ts`: type defs do bridge.

**IPCs novos:**
- `updater:check-now` (renderer → main): força check manual.
- `updater:status` (renderer → main): retorna `{ state: "idle"|"checking"|"available"|"downloading"|"downloaded"|"error", version?, error? }`.
- `updater:install-now` (renderer → main): chama `autoUpdater.quitAndInstall()`.
- Broadcast `updater:event` (main → renderer): notifica mudanças de estado.

**Saída:** app verifica updates ao abrir; baixa em background; emite eventos. Sem UI visível ainda — PR-D adiciona.

**Custo:** ~5-7 tasks.

### PR-D — UI de update (banner + botão Ajustes)

**Goal:** Usuário vê banner quando update tá pronto + tem controle manual em Ajustes.

**Arquivos:**
- `apps/renderer/src/components/UpdateBanner.tsx` (NOVO): banner fixed-bottom-right "Atualização vX.Y.Z baixada · Reiniciar agora" + close button (snooze).
- `apps/renderer/src/stores/updater.ts` (NOVO): zustand store assinada ao IPC `updater:event`.
- `apps/renderer/src/routes/AjustesAvancado.tsx`: adicionar seção "Atualizações" com versão atual + botão "Verificar atualizações" + toggle "Auto-download" + estado do updater.
- `apps/renderer/src/i18n/{en-US,pt-BR}.json`: bloco `updater.*`.
- `apps/renderer/src/App.tsx`: render `<UpdateBanner />` global.

**Custo:** ~5-6 tasks.

### PR-E — First real release v0.1.0 + docs

**Goal:** Cortar primeiro release público + documentar processo.

**Tasks:**
1. Smoke test ponta-a-ponta: build local, instala, abre, configura, tag, CI publica, instalar via released `.exe`, conferir auto-update mock (publish v0.1.1 com mudança trivial, verificar app atualiza).
2. `docs/release.md` (NOVO): runbook "Como cortar uma release" (versionar, tag, push, monitorar CI, comunicar).
3. `docs/auto-update.md` (NOVO): docs pro usuário sobre como auto-update funciona.
4. `SECURITY.md`: seção "Distribution & Auto-update" — threat model (sem code signing v1, GitHub repo trust, SHA512 verification, mitigation pra repo-takeover scenario).
5. Tag `v0.1.0` + push.
6. Update ROADMAP.md.

**Custo:** ~5-7 tasks.

**Total estimado:** 22-30 tasks distribuídas em 5 PRs.

## 5. Decisões pendentes (anotadas pra implementação)

- **NSIS one-click vs. assisted**: one-click instala sem perguntar nada (melhor UX, padrão `electron-builder`). Vai com one-click v1.
- **Install location**: per-user (`%LOCALAPPDATA%`, não exige admin) vs. per-machine (`Program Files`, exige admin). Vai com **per-user** v1 (NSIS `oneClick: true` + `perMachine: false`).
- **Update cadence**: silenciosa em background (`autoDownload: true`); banner mostra só quando download completo. Sem prompt durante download.
- **Beta channel**: por enquanto só `latest`. Beta/canary podem entrar depois via `electron-updater` channel switching.
- **Rollback**: NSIS guarda installer anterior em `nsis-update`; rollback manual via desinstalar + instalar versão antiga do GitHub Releases. Sem UI de rollback em v1.
- **Delta updates**: electron-builder gera deltas NSIS por default; primeira release sempre é full. Economiza bandwidth a partir do v0.1.1.

## 6. Versioning policy

- **Pre-1.0 (now)**: `0.x.y` — features ainda evoluem. Patch (`0.0.x`) pra bug fix; minor (`0.x.0`) pra features novas; major bump quando v1 público + estável.
- **v1.0.0**: marco de "estável pra uso geral" — depois que feedback do early access valida fluxo.
- **Tags só de release**: `v0.1.0`, `v0.1.1`. Nunca commits intermediários sem tag.

## 7. Security threat model

| Ameaça | Mitigação v1 | Mitigação futura |
|---|---|---|
| Update tampering (download interceptado) | electron-updater valida SHA512 do .exe contra `latest.yml`. `latest.yml` baixado via HTTPS do GitHub. | Code signing certs (M18) — assina .exe + latest.yml fica imutável após signing. |
| Repo takeover (atacante publica release maliciosa) | GitHub Actions usa `GITHUB_TOKEN` automático com permissão de repo. Compromisso requer write access ao repo. | 2FA obrigatório (já ativo), commits assinados, branch protection em `main` (depois que repo virar público). |
| SmartScreen bypass via fake signing | N/A — não temos cert v1, então SmartScreen warning é esperado. | Cert OV (~$300/ano) ou EV (~$400/ano) suprime warning. |
| Sideloaded `.exe` antigo continuando rodar | electron-updater não força — usuário pode escolher não reiniciar. Mas próxima abertura vai checar de novo. | "Force update" flag em releases críticos (futuro). |
| Native deps (better-sqlite3) divergem entre dev e release | electron-builder rebuilds nativos pra target Electron version no CI. Local dev usa `electron-rebuild` no `predev`. | Validação automática no CI (build + smoke test). |

## 8. O que NÃO está no escopo v1

- Mac (.dmg) e Linux (.AppImage) — pra M18.
- Auto-update silenciosa sem prompt — sempre pergunta "Reiniciar agora?".
- Rollback UI — manual via download de versão antiga do GitHub Releases.
- Beta/canary channels — só `latest`.
- Code signing — adicionar em M18 quando audiência ampliar.
- Pre-flight checks (e.g., "está em modo offline?") — assume rede disponível.
- Update mid-task — se houver agentes rodando, espera o usuário decidir.

## 9. Open issues (resolver na implementação)

- **better-sqlite3 + asarUnpack**: confirmar caminho exato e que `app.asar.unpacked` é carregado corretamente no production build.
- **`__dirname` em main process empacotado**: alguns paths (e.g., migrations, charters de role) usam `path.join(__dirname, ...)`. Confirmar que esses paths resolvem corretamente no app empacotado (geralmente sim, mas precisa smoke).
- **userData path**: SQLite + memories + companies/ ficam em `app.getPath('userData')` que muda entre dev e prod. Confirmar migração — usuário que rodava dev e instala depois NÃO vai ver seus dados de dev (caminhos diferentes). Aceitável v1 (early adopters); documentar.
- **First-launch UX**: app instalado roda Setup wizard (PR-F M16). OK.
- **electron-updater + windows dev mode**: updater não funciona em dev (electron path local). Documentar.
