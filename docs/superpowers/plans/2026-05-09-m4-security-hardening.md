# M4 — Security Hardening (TODO stub)

> **Status:** TODO — pendências detectadas durante varredura de segurança em 2026-05-09. Este arquivo é stub: o plano completo do M4 deve ser escrito quando M3 estiver concluído.

## Pendências de segurança herdadas de M2/M3

### SEC-01 (ALTO): `AUTH_TOKEN_DETECT` retorna token bruto pro renderer — ✅ CORRIGIDO (2026-05-10)

**Onde:** `apps/main/src/ipc/auth-handlers.ts:31-33`, `apps/main/src/ipc/preload.ts:16`, `apps/renderer/src/routes/SetupWizard.tsx` (fluxo `goAuto` → `importAuto`).

**Problema:** o handler IPC `auth:token-detect` chama `detectClaudeCliToken()` e retorna o token OAuth completo pro processo renderer. O renderer guarda em estado React (`autoToken`) e devolve via `auth:token-set` na confirmação. Isso viola o invariante explícito do plano M2 (`docs/superpowers/plans/2026-05-09-m2-auth-and-settings.md:2150`):

> Don't expose `loadDecryptedToken` over IPC — that's the most important security invariant. The token never crosses the process boundary toward the renderer.

**Risco real:** tokens em memória do renderer ficam expostos a (a) DevTools/React DevTools em modo dev, (b) supply-chain attacks em deps do renderer (React, react-i18next, react-router-dom, zustand), (c) qualquer XSS-like se no futuro o renderer carregar markdown/conteúdo arbitrário.

**Correção proposta:**

1. Adicionar tipo `DetectResult` em `packages/shared/src/types/auth.ts`:
   ```ts
   export type DetectResult = { found: false } | { found: true; maskedPrefix: string };
   ```
   (já feito no working tree em 2026-05-09)

2. Adicionar canal IPC `AUTH_TOKEN_IMPORT_DETECTED: "auth:token-import-detected"` em `packages/shared/src/ipc-channels.ts`.

3. Refatorar `apps/main/src/ipc/auth-handlers.ts`:
   - `AUTH_TOKEN_DETECT` retorna `DetectResult` (apenas `maskedPrefix`, nunca o raw)
   - Novo handler `AUTH_TOKEN_IMPORT_DETECTED` re-detecta + chama `saveToken(...)` no main, retorna `TokenStatus`

4. Atualizar `apps/main/src/ipc/preload.ts`:
   ```ts
   detect: (): Promise<DetectResult> => ipcRenderer.invoke(IPC.AUTH_TOKEN_DETECT),
   importDetected: (): Promise<TokenStatus> => ipcRenderer.invoke(IPC.AUTH_TOKEN_IMPORT_DETECTED),
   ```

5. Atualizar `apps/renderer/src/stores/auth.ts` adicionando `importDetected()`.

6. Atualizar `apps/renderer/src/routes/SetupWizard.tsx` para usar `auth.detect()` (recebe só prefix mascarado) → mostrar preview → `auth.importDetected()` no confirmar (sem nunca tocar no raw).

7. Atualizar testes:
   - `apps/main/tests/ipc.auth-handlers.test.ts`: ajustar `auth:token-detect` para esperar `DetectResult`, adicionar testes pro novo handler.
   - `packages/shared/tests/settings.test.ts` e `packages/shared/tests/ipc-channels.test.ts`: adicionar `AUTH_TOKEN_IMPORT_DETECTED`.

**Tentativa anterior:** tentei aplicar em 2026-05-09 mas as edições nos 3 arquivos do main/IPC foram revertidas (provavelmente por conflito com sessão paralela do M3). Re-tentar quando M3 estiver mergeado e estável.

**Resolução (2026-05-10):** aplicado conforme plano. `AUTH_TOKEN_DETECT` agora retorna `DetectResult` (apenas `maskedPrefix`); novo `AUTH_TOKEN_IMPORT_DETECTED` re-detecta e salva no main; renderer atualizado pra nunca segurar o raw em estado React; regression-guard test garante que o raw token nunca aparece na resposta do IPC. Commit fecha o invariante do M2 ("token nunca cruza pro renderer").

### SEC-02 (MÉDIO): `verifyMcpToken` é no-op em `mcp/server.ts:38`

**Onde:** `apps/main/src/mcp/server.ts:38`

**Problema:** chamada atual `verifyMcpToken(expectedToken, expectedToken)` passa o mesmo valor pros dois argumentos da função. A comparação `provided !== expected` sempre é falsa, então a verificação sempre passa. O comentário no código admite a limitação ("stdio MCP can't carry custom auth headers, so we validate the env presence as a soft guard").

**Risco real:** baixo no modelo atual (stdio MCP é privado pro par parent-child, sem outros processos no canal). Mas a função dá falsa sensação de proteção e acumula dívida pra quando o transport mudar (HTTP/WS).

**Correção proposta:** uma das duas opções:
- (a) Remover `verifyMcpToken` e o env `MCP_TOKEN`. Se stdio não suporta auth real, não fingir que tem.
- (b) Implementar challenge real: primeiro tool call do client precisa ser um `authenticate` que envia o token via input, e o server mantém estado de `authenticated: bool` por sessão. Outras tools rejeitam até autenticar.

Recomendação: (a) por enquanto, (b) quando/se mudarmos transport.

### SEC-03 (BAIXO): Email pessoal em git history

**Onde:** commit `419239276ab71d293673207c61b1430a562da15b` ("chore(gitleaks): allow placeholder tokens in design docs")

**Problema:** introduziu o email pessoal do autor em `docs/superpowers/specs/2026-05-09-dashboard-agent-design.md:4`. Working tree atual já tem a remoção (uncommitted em 2026-05-09); HEAD ainda contém.

**Risco real:** zero enquanto o repo for local (sem `git remote`). Vira problema se/quando for pushado. Repo público + email indexado pelo GitHub = phishing/spam.

**Correção proposta:** decidir antes do primeiro push:
- Se nunca for público: deixar como está, commitar a remoção do working tree.
- Se for público: rewrite de história com `git filter-repo --replace-text replacements.txt` onde `replacements.txt` contém uma linha mapeando o email pessoal para `REDACTED`. Único commit afetado = `4192392`. Rewrite é seguro porque não há remote ainda. **NÃO USAR `--no-verify`** ao recommitar.

### SEC-04 (BAIXO/INFO): Author email pessoal em todos os commits

**Onde:** metadata de autor/committer de todos os commits do branch.

**Problema:** identidade Git pública. Padrão do GitHub. Não é vulnerabilidade — é uma escolha de privacidade.

**Correção proposta** (se quiser ocultar antes de push):
1. `git config user.email "<github-user-id>+<github-username>@users.noreply.github.com"` (achar o numeric user id em `https://api.github.com/users/<github-username>`).
2. Reescrever histórico via `git filter-repo --email-callback` substituindo o email antigo pelo noreply.
3. Repetir antes do primeiro push.

### SEC-05 (BAIXO): Google Fonts externo no renderer

**Onde:** `apps/renderer/index.html:11-14`

**Problema:** app desktop "offline-first" carrega Poppins via `https://fonts.googleapis.com`. Vaza User-Agent + IP pro Google em cada launch. CSP atual permite a origem (`style-src ... https://fonts.googleapis.com`).

**Correção proposta:** bundle Poppins via `@fontsource/poppins` ou similar, importar no CSS principal, remover `<link>` externo do `index.html`, apertar CSP removendo `fonts.googleapis.com` e `fonts.gstatic.com`.

## Mitigações já aplicadas em 2026-05-09

- Inputs de token em `Settings.tsx` e `SetupWizard.tsx` agora `type="password"` + `autoComplete="off"` + `spellCheck={false}`.
- CSP restritivo adicionado em `apps/renderer/index.html`.
- Email pessoal removido do spec doc (working tree, ainda não commitado).
- Tipo `DetectResult` adicionado em shared (preparação pro SEC-01).

## Critério de pronto pro M4

- [x] SEC-01 corrigido com testes verdes em `ipc.auth-handlers.test.ts` (regression-guard valida que raw token nunca está na resposta).
- [ ] SEC-02 resolvido (remover ou implementar de verdade).
- [ ] SEC-03 e SEC-04 decididos antes do primeiro push (se for público, rewrite executado).
- [ ] SEC-05 fechado se decidirmos virar offline-first puro.
- [ ] Suite gitleaks roda local + CI sem novos achados.
