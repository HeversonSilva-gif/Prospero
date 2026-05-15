# M9 PR-F.2.3 — Issue Review UX (implementation plan)

**Spec:** [`2026-05-14-m9-design.md`](../specs/2026-05-14-m9-design.md) §9.3
**Status:** in progress
**Estimativa:** ~1-2d
**Encerra M9 (6/6 PRs).**

## Reality check vs spec

Spec §9.3 menciona "approval_comments (M7.5)". Essa tabela nunca foi criada — só `approvals` (0007) e `issue_artifacts` (0008) existem do M7.5.

**Decisão:** não criamos `approval_comments`. O fluxo real do review fica:
- **Approve & merge** → `issues:update` status `'review' → 'done'` (+ opcional `issues:add-comment` com nota do revisor)
- **Request changes** → `issues:update` status `'review' → 'doing'` (+ comment obrigatório)
- **Reject** → `issues:update` status `'review' → 'cancelled'` (+ comment obrigatório)

Activity events já são gravados via `recorder.recordActivity` no `issues.update` handler. Sem migração nova. Sem IPC novo.

## Arquivos

### Novos

1. `apps/renderer/src/lib/issue-review/decision.ts` — helpers puros (`statusForDecision`, `validateDecision`).
2. `apps/renderer/src/lib/issue-review/artifact.ts` — `pickDiffArtifact(artifacts)` (latest `output_text` ou `snapshot` com `contentPreview`).
3. `apps/renderer/src/lib/issue-review/decision.test.ts` + `artifact.test.ts`.
4. `apps/renderer/src/components/issues/IssueReviewBlock.tsx` — diff viewer + comment box + 3 buttons.

### Modificados

5. `apps/renderer/package.json` — add `react-diff-viewer-continued`.
6. `apps/renderer/src/components/issues/IssueDetailModal.tsx` — render `IssueReviewBlock` no topo quando `issue.status === 'review'`.
7. `apps/renderer/src/i18n/{pt,en}.json` — chaves `issues.review.*`.
8. `ROADMAP.md` (2 seções) + `apps/renderer/public/docs/roadmap.html` (3 seções).

## Tasks (TDD por etapa)

### 1. Plan + dep
- [x] Criar este arquivo de plano.
- [ ] `pnpm -F @dashboard-agent/renderer add react-diff-viewer-continued` (last release 2024, peer-dep React 18 ok).

### 2. Helpers puros + tests

**`decision.ts`:**
```typescript
export type ReviewDecision = 'approve' | 'request_changes' | 'reject';
export const statusForDecision = (d: ReviewDecision): IssueStatus => ...;
export const requiresComment = (d: ReviewDecision): boolean => d !== 'approve';
export const validateDecision = (
  d: ReviewDecision,
  comment: string,
): { ok: true } | { ok: false; reason: 'comment_required' };
```

**`artifact.ts`:**
```typescript
export const pickDiffArtifact = (artifacts: IssueArtifact[]): IssueArtifact | null;
// Filtra kind in ('output_text','snapshot') com contentPreview !== null, retorna o mais recente.
```

**Tests:**
- `statusForDecision('approve') === 'done'`, etc.
- `validateDecision('approve', '')` → ok; `validateDecision('reject', '')` → not ok.
- `pickDiffArtifact([])` → null; ignora kinds `file_path|commit_sha|pr_url`; pega mais recente entre múltiplos.

### 3. IssueReviewBlock + integração

**Props:**
```typescript
type Props = {
  issueId: string;
  status: IssueStatus;
  artifacts: IssueArtifact[];
};
```

Renderiza `null` quando `status !== 'review'`. Caso contrário:
- Banner header com label "Em revisão"
- Se `pickDiffArtifact()` retorna artifact: `<ReactDiffViewer oldValue='' newValue={artifact.contentPreview} splitView={true} useDarkTheme={...} />`
- Se não retorna: empty state ("sem artefatos para revisar — feedback livre")
- `<textarea>` comment box (placeholder: "Opcional para aprovar; obrigatório para mudanças/rejeição")
- 3 buttons (Approve / Request changes / Reject)
- Click: `validateDecision`; se ok → `update({status})` + (se comment) `addComment`; se não ok, mostra hint inline.
- Dark theme: detectar `document.documentElement.classList.contains('dark')` (mesmo padrão já usado no resto do app? — verificar; se não, passar via prop a partir do `IssueDetailModal` ou via hook `useThemeStore`).

**Integração em `IssueDetailModal`:** render bloco logo após o header e antes da seção Comments quando `issue.status === 'review'`.

### 4. i18n

Chaves novas (ambos PT-BR e EN-US):
- `issues.review.heading` ("Em revisão" / "In review")
- `issues.review.empty` (...)
- `issues.review.commentPlaceholder`
- `issues.review.commentRequired`
- `issues.review.approve` / `requestChanges` / `reject`
- `issues.review.diffOld` / `issues.review.diffNew`

`parity.test.ts` é auto-validado.

### 5. Roadmap + non-regression

- `ROADMAP.md` §M9: checar PR-F.2.3 + status `6/6`.
- `ROADMAP.md` §Em linguagem simples: adicionar nota sobre o review embutido.
- `roadmap.html` /00 + /01 + /03: marcar M9 fechado.

### 6. Verificação final

- `pnpm -r typecheck`
- `pnpm -r lint`
- `pnpm -r test` — esperar **>=820 testes passing** (+ ~5 dos helpers).
- Commit chain: dep → helpers → component → i18n → roadmap.
- Memory: `project_m9_pr_f2_3_lessons.md` + handoff "M9 fechado".

## Riscos / gotchas

- **`react-diff-viewer-continued` SSR/Vite quirks** — biblioteca usa `react` peer-dep, react 18 ok. Se Vite reclamar de CJS interop, importar via `import DiffViewer from 'react-diff-viewer-continued'` (default export). Fallback: `import { DiffMethod } from 'react-diff-viewer-continued'` se precisar.
- **Theme detection:** se a app tem hook centralizado de tema, usar. Senão `document.documentElement.classList.contains('dark')` no mount é suficiente — esse componente vive dentro de um modal sempre acessado pelo user, não em prerender.
- **Optimistic updates:** `issues.update` no store já refaz a list e o detail; após `addComment` o store dispara `loadDetail`. Sem race conditions esperadas.
- **Commitlint:** subject minúsculo, sem `+/%/uppercase`. Subjects planejados:
  - `chore(deps): add react-diff-viewer-continued`
  - `feat(m9): issue review helpers — decision + diff artifact picker`
  - `feat(m9): issuereviewblock + integration in detail modal`
  - `feat(m9): i18n keys for issue review`
  - `docs(m9): close pr-f.2.3 issue review ux in roadmap`
