# Contributing

Thanks for your interest! This project is in active early development.

## Development setup

Prerequisites: Node 20+, pnpm 9+, gitleaks, Windows 11 (primary platform).

```powershell
git clone <url>
cd Prospero
pnpm install
pnpm dev
```

## Branch and commit conventions

- Branches: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) — enforced by commitlint
- All commits go through pre-commit hooks (gitleaks, lint, format)

## Tests

- Unit + integration: `pnpm test`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`

CI gates: lint, typecheck, test, build, gitleaks. Security tests (Spec §10.2) and token efficiency (§10.3) are non-regression gates from M7/M8 onward.

## Issue templates

When reporting issues, please **redact paths, project names, and conversations** before submitting.
