# M1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the DashboardAgent monorepo: empty Electron app with SQLite, IPC bridge, tray icon, lint/test/CI pipeline, and seed/commit hygiene — so subsequent milestones can build on a solid base.

**Architecture:** pnpm monorepo with `apps/main` (Electron + Node + better-sqlite3), `apps/renderer` (React + Vite + Tailwind), and `packages/shared` (cross-process TypeScript types and IPC channel constants). All TypeScript strict. Tooling: ESLint + Prettier + Vitest + Playwright + husky + gitleaks + GitHub Actions.

**Tech Stack:** Node 20+, pnpm 9+, Electron 33, TypeScript 5.5+, React 18, Vite 5, Tailwind 3, better-sqlite3 11, Vitest 2, Playwright 1.47, husky 9, lint-staged 15, gitleaks (binary), commitlint.

**Spec reference:** `docs/superpowers/specs/2026-05-09-dashboard-agent-design.md`

---

## Pre-flight

- This is a fresh empty directory at `D:\Projetos pessoais\DashboardAgent` (only `docs/` and `.superpowers/` exist).
- Verify Node and pnpm are installed:
  ```
  node --version    # expect ≥ 20.0.0
  pnpm --version    # expect ≥ 9.0.0
  ```
  If pnpm is missing: `npm install -g pnpm@latest`.
- Verify gitleaks is installed (Windows): `gitleaks version`. If missing: `winget install gitleaks` or `scoop install gitleaks`.

---

## File Structure (this milestone)

```
DashboardAgent/
├── package.json                      # root workspace root
├── pnpm-workspace.yaml               # workspace declaration
├── tsconfig.base.json                # shared compiler options
├── .editorconfig
├── .gitignore                        # comprehensive (per spec §14.1)
├── .gitleaks.toml                    # custom rules
├── .prettierrc.json
├── .prettierignore
├── eslint.config.mjs                 # flat config
├── commitlint.config.cjs
├── .husky/
│   ├── pre-commit                    # gitleaks + lint-staged
│   └── commit-msg                    # commitlint
├── .github/
│   └── workflows/
│       ├── ci.yml                    # lint + typecheck + test + build
│       └── secrets.yml               # gitleaks on PR
├── README.md
├── LICENSE                           # MIT
├── SECURITY.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── apps/
│   ├── main/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts            # bundler for main process
│   │   ├── electron-builder.yml      # placeholder; M9 finalizes
│   │   ├── src/
│   │   │   ├── index.ts              # entry: app.whenReady, window, tray
│   │   │   ├── window/main-window.ts
│   │   │   ├── tray/index.ts
│   │   │   ├── ipc/
│   │   │   │   ├── handlers.ts
│   │   │   │   └── preload.ts
│   │   │   └── db/
│   │   │       ├── client.ts         # opens DB, runs migrations
│   │   │       ├── migrations.ts     # migrator using PRAGMA user_version
│   │   │       └── migrations/
│   │   │           └── 0001_initial.sql
│   │   └── tests/
│   │       ├── db.client.test.ts
│   │       └── db.migrations.test.ts
│   └── renderer/
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.node.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── postcss.config.js
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── styles/index.css
│           └── env.d.ts
└── packages/
    └── shared/
        ├── package.json
        ├── tsconfig.json
        ├── src/
        │   ├── index.ts
        │   ├── ipc-channels.ts        # canonical channel names
        │   └── types/
        │       ├── index.ts
        │       └── ids.ts             # branded ID types
        └── tests/
            └── ipc-channels.test.ts
```

Each file has a single responsibility:
- `apps/main/src/index.ts` — process entry; only orchestrates submodules
- `apps/main/src/window/main-window.ts` — window lifecycle
- `apps/main/src/tray/index.ts` — tray icon + menu
- `apps/main/src/ipc/handlers.ts` — registers channel handlers (one place)
- `apps/main/src/ipc/preload.ts` — contextBridge whitelist (preload script)
- `apps/main/src/db/client.ts` — opens/migrates DB; exposes `getDb()`
- `apps/main/src/db/migrations.ts` — migration runner
- `packages/shared/src/ipc-channels.ts` — single source of truth for channel names

---

## Task 1: Initialize git + monorepo skeleton

**Files:**
- Create: `D:\Projetos pessoais\DashboardAgent\package.json`
- Create: `D:\Projetos pessoais\DashboardAgent\pnpm-workspace.yaml`
- Create: `D:\Projetos pessoais\DashboardAgent\.gitignore`
- Create: `D:\Projetos pessoais\DashboardAgent\.editorconfig`

- [ ] **Step 1: Initialize git repository**

```powershell
git init
git config core.autocrlf true
```

Expected: `Initialized empty Git repository in D:/Projetos pessoais/DashboardAgent/.git/`

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "dashboard-agent",
  "version": "0.0.0",
  "private": true,
  "description": "Local orchestrator for Claude Code agents using Claude Max OAuth (no API key).",
  "license": "MIT",
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "lint": "pnpm -r --parallel run lint",
    "typecheck": "pnpm -r --parallel run typecheck",
    "test": "pnpm -r --parallel run test",
    "build": "pnpm -r run build",
    "dev": "pnpm --filter @dashboard-agent/main dev & pnpm --filter @dashboard-agent/renderer dev",
    "prepare": "husky"
  },
  "devDependencies": {}
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 4: Create comprehensive `.gitignore` (mirrors spec §14.1)**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build artifacts
dist/
out/
release/
build/
.vite/
.turbo/
*.tsbuildinfo

# Runtime data (Spec §14.1)
*.db
*.db-journal
*.db-wal
*.sqlite
*.sqlite3
data/
app-data/
user-data/
logs/
*.log

# Env / secrets (Spec §14.1)
.env
.env.*
!.env.example
*.pem
*.key
.credentials/

# Brainstorm/design artifacts (local-only)
.superpowers/

# Editors
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea/

# OS
Thumbs.db
.DS_Store

# Test artifacts
coverage/
playwright-report/
test-results/
```

- [ ] **Step 5: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 6: Verify file states**

```powershell
git status
```

Expected: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.editorconfig` listed as untracked.

- [ ] **Step 7: Commit**

```powershell
git add package.json pnpm-workspace.yaml .gitignore .editorconfig
git commit -m "chore: initialize monorepo skeleton"
```

Expected: 1 commit. NOT yet running pre-commit hooks (added in Task 9).

---

## Task 2: TypeScript shared config

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create `tsconfig.base.json` with strict options**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "useUnknownInCatchVariables": true,
    "declaration": true,
    "sourceMap": true,
    "incremental": true
  },
  "exclude": ["node_modules", "dist", "out", "build"]
}
```

- [ ] **Step 2: Commit**

```powershell
git add tsconfig.base.json
git commit -m "chore: add base tsconfig with strict options"
```

---

## Task 3: `packages/shared` — types and IPC channels

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/types/ids.ts`
- Create: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/ipc-channels.ts`
- Create: `packages/shared/tests/ipc-channels.test.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@dashboard-agent/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Write the failing test for IPC channel constants**

`packages/shared/tests/ipc-channels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IPC } from "../src/ipc-channels.js";

describe("IPC channels", () => {
  it("exposes a 'ping' channel", () => {
    expect(IPC.PING).toBe("ping");
  });

  it("channel names are unique", () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
  });

  it("channel names use lowercase-kebab-case namespacing", () => {
    for (const v of Object.values(IPC)) {
      expect(v).toMatch(/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*$/);
    }
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```powershell
pnpm --filter @dashboard-agent/shared test
```

Expected: FAIL — module not found (`ipc-channels.js` does not exist yet).

- [ ] **Step 5: Implement `packages/shared/src/ipc-channels.ts`**

```ts
export const IPC = {
  PING: "ping",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
```

- [ ] **Step 6: Implement `packages/shared/src/types/ids.ts`** (branded ID types — used in M3+)

```ts
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type CompanyId = Brand<string, "CompanyId">;
export type ProjectId = Brand<string, "ProjectId">;
export type AgentId = Brand<string, "AgentId">;
export type IssueId = Brand<string, "IssueId">;
export type ThreadId = Brand<string, "ThreadId">;
export type MessageId = Brand<string, "MessageId">;
export type InboxItemId = Brand<string, "InboxItemId">;

export const newId = <T extends string>(): T => crypto.randomUUID() as unknown as T;
```

- [ ] **Step 7: Implement `packages/shared/src/types/index.ts`**

```ts
export * from "./ids.js";
```

- [ ] **Step 8: Implement `packages/shared/src/index.ts`**

```ts
export * from "./ipc-channels.js";
export * from "./types/index.js";
```

- [ ] **Step 9: Run test to verify it passes**

```powershell
pnpm --filter @dashboard-agent/shared install
pnpm --filter @dashboard-agent/shared test
```

Expected: PASS — 3 tests green.

- [ ] **Step 10: Run typecheck**

```powershell
pnpm --filter @dashboard-agent/shared typecheck
```

Expected: no errors.

- [ ] **Step 11: Commit**

```powershell
git add packages/shared
git commit -m "feat(shared): add ipc-channels and branded id types"
```

---

## Task 4: ESLint + Prettier flat config (root)

**Files:**
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `eslint.config.mjs`
- Modify: `package.json` (add devDependencies)

- [ ] **Step 1: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "bracketSpacing": true,
  "endOfLine": "lf"
}
```

- [ ] **Step 2: Create `.prettierignore`**

```
node_modules
dist
out
release
build
.turbo
.vite
coverage
*.md
pnpm-lock.yaml
```

- [ ] **Step 3: Create `eslint.config.mjs` (flat config)**

```js
// @ts-check
import js from "@eslint/js";
import ts from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
    },
  },
  {
    files: ["apps/renderer/**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
    settings: { react: { version: "detect" } },
  },
  {
    ignores: ["**/dist/**", "**/out/**", "**/.vite/**", "**/coverage/**"],
  },
  prettier,
);
```

- [ ] **Step 4: Add devDependencies to root `package.json`** (use `pnpm add -Dw`)

```powershell
pnpm add -Dw typescript@^5.5.4 prettier@^3.3.3 eslint@^9.10.0 typescript-eslint@^8.5.0 @eslint/js@^9.10.0 eslint-config-prettier@^9.1.0 eslint-plugin-react@^7.36.1 eslint-plugin-react-hooks@^4.6.2
```

- [ ] **Step 5: Verify lint runs**

```powershell
pnpm lint
```

Expected: passes with no errors (or zero output for shared package).

- [ ] **Step 6: Commit**

```powershell
git add .prettierrc.json .prettierignore eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "chore: add eslint flat config and prettier"
```

---

## Task 5: `apps/main` — Electron main bootstrap (no DB yet)

**Files:**
- Create: `apps/main/package.json`
- Create: `apps/main/tsconfig.json`
- Create: `apps/main/tsup.config.ts`
- Create: `apps/main/src/index.ts`
- Create: `apps/main/src/window/main-window.ts`

- [ ] **Step 1: Create `apps/main/package.json`**

```json
{
  "name": "@dashboard-agent/main",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "dev": "tsup --watch --onSuccess \"electron .\"",
    "build": "tsup",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@dashboard-agent/shared": "workspace:*",
    "electron": "33.0.2"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create `apps/main/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "moduleResolution": "Node",
    "module": "ESNext",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `apps/main/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/ipc/preload.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["electron", "better-sqlite3"],
});
```

- [ ] **Step 4: Implement `apps/main/src/window/main-window.ts`**

```ts
import { BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const createMainWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#F5F5FA",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: resolve(__dirname, "ipc/preload.js"),
    },
  });

  const devUrl = process.env.RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(resolve(__dirname, "../../renderer/dist/index.html"));
  }

  win.once("ready-to-show", () => win.show());
  return win;
};
```

- [ ] **Step 5: Implement minimal `apps/main/src/index.ts`** (full version added in Task 8 once tray exists)

```ts
import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window/main-window.js";

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  mainWindow = createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
});
```

- [ ] **Step 6: Stub preload to be filled in Task 7**

`apps/main/src/ipc/preload.ts`:

```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("dashboardAgent", {
  ping: () => "pong",
});
```

- [ ] **Step 7: Install dependencies + build**

```powershell
pnpm install
pnpm --filter @dashboard-agent/main build
```

Expected: `apps/main/dist/index.js` and `apps/main/dist/ipc/preload.js` exist; no TS errors.

- [ ] **Step 8: Verify Electron launches**

```powershell
pnpm --filter @dashboard-agent/main exec electron .
```

Expected: a 1280×800 window with `#F5F5FA` background appears (blank — no renderer yet). Close it.

- [ ] **Step 9: Commit**

```powershell
git add apps/main package.json pnpm-lock.yaml
git commit -m "feat(main): electron bootstrap with window and preload stub"
```

---

## Task 6: `apps/renderer` — React + Vite + Tailwind

**Files:**
- Create: `apps/renderer/package.json`
- Create: `apps/renderer/tsconfig.json`
- Create: `apps/renderer/tsconfig.node.json`
- Create: `apps/renderer/vite.config.ts`
- Create: `apps/renderer/tailwind.config.ts`
- Create: `apps/renderer/postcss.config.js`
- Create: `apps/renderer/index.html`
- Create: `apps/renderer/src/main.tsx`
- Create: `apps/renderer/src/App.tsx`
- Create: `apps/renderer/src/styles/index.css`
- Create: `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Create `apps/renderer/package.json`**

```json
{
  "name": "@dashboard-agent/renderer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc -b && vite build",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "dependencies": {
    "@dashboard-agent/shared": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.45",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.6",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create `apps/renderer/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src/**/*"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create `apps/renderer/tsconfig.node.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "noEmit": true
  },
  "include": ["vite.config.ts", "tailwind.config.ts", "postcss.config.js"]
}
```

- [ ] **Step 4: Create `apps/renderer/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", sourcemap: true },
});
```

- [ ] **Step 5: Create `apps/renderer/tailwind.config.ts`** (paleta Subido PRO)

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          DEFAULT: "#1D5DD7",
          dark: "#001D5A",
          soft: "#BEE0FE",
          bg: "#EAF2FE",
          accent: "#5bc4e7",
        },
        ink: {
          DEFAULT: "#070C27",
          muted: "#48484A",
          soft: "#969696",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          soft: "#F5F5FA",
          border: "#E8E8E8",
          "border-strong": "#D4D4DA",
        },
        semantic: {
          success: "#16a34a",
          "success-bg": "#dcfce7",
          warning: "#FFC520",
          "warning-bg": "#fef9c3",
          danger: "#E83838",
          "danger-bg": "#fee2e2",
          purple: "#7c3aed",
          "purple-bg": "#ede9fe",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 6: Create `apps/renderer/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 7: Create `apps/renderer/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dashboard Agent</title>
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"
    />
  </head>
  <body class="font-sans bg-surface-soft text-ink antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create `apps/renderer/src/styles/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 9: Create `apps/renderer/src/env.d.ts`**

```ts
/// <reference types="vite/client" />

declare global {
  interface Window {
    dashboardAgent: {
      ping: () => string;
    };
  }
}
export {};
```

- [ ] **Step 10: Create `apps/renderer/src/App.tsx`**

```tsx
export const App = (): JSX.Element => {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-brand-dark">Dashboard Agent</h1>
        <p className="text-ink-muted">Foundation milestone — bootstrap complete.</p>
      </div>
    </div>
  );
};
```

- [ ] **Step 11: Create `apps/renderer/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 12: Install + dev start**

```powershell
pnpm install
pnpm --filter @dashboard-agent/renderer dev
```

Open `http://localhost:5173`. Expected: white page with "Dashboard Agent" heading in dark blue. Stop with Ctrl+C.

- [ ] **Step 13: Commit**

```powershell
git add apps/renderer pnpm-lock.yaml
git commit -m "feat(renderer): vite+react+tailwind bootstrap with subido palette"
```

---

## Task 7: IPC bridge — `ping` handler end-to-end

**Files:**
- Modify: `apps/main/src/ipc/preload.ts`
- Create: `apps/main/src/ipc/handlers.ts`
- Modify: `apps/main/src/index.ts`
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `apps/renderer/src/App.tsx`
- Create: `apps/main/tests/ipc.handlers.test.ts`

- [ ] **Step 1: Write failing test for ping handler**

`apps/main/tests/ipc.handlers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/ipc/handlers.js";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

describe("registerIpcHandlers", () => {
  it("registers ping handler that returns 'pong'", async () => {
    handlers.clear();
    registerIpcHandlers();
    const ping = handlers.get("ping");
    expect(ping).toBeDefined();
    const result = await Promise.resolve(ping!({}));
    expect(result).toBe("pong");
  });
});
```

- [ ] **Step 2: Run test — should fail (handlers.ts missing)**

```powershell
pnpm --filter @dashboard-agent/main test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/main/src/ipc/handlers.ts`**

```ts
import { ipcMain } from "electron";
import { IPC } from "@dashboard-agent/shared";

export const registerIpcHandlers = (): void => {
  ipcMain.handle(IPC.PING, () => "pong");
};
```

- [ ] **Step 4: Run test — should pass**

```powershell
pnpm --filter @dashboard-agent/main test
```

Expected: PASS.

- [ ] **Step 5: Update `apps/main/src/ipc/preload.ts` to use ipcRenderer.invoke**

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@dashboard-agent/shared";

contextBridge.exposeInMainWorld("dashboardAgent", {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.PING),
});
```

- [ ] **Step 6: Update `apps/main/src/index.ts` to register handlers**

```ts
import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window/main-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
});
```

- [ ] **Step 7: Update `apps/renderer/src/env.d.ts` to use Promise<string>**

```ts
/// <reference types="vite/client" />

declare global {
  interface Window {
    dashboardAgent: {
      ping: () => Promise<string>;
    };
  }
}
export {};
```

- [ ] **Step 8: Update `apps/renderer/src/App.tsx` to call ping**

```tsx
import { useEffect, useState } from "react";

export const App = (): JSX.Element => {
  const [pong, setPong] = useState<string>("(waiting)");

  useEffect(() => {
    void window.dashboardAgent.ping().then(setPong);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-brand-dark">Dashboard Agent</h1>
        <p className="text-ink-muted">IPC ping → {pong}</p>
      </div>
    </div>
  );
};
```

- [ ] **Step 9: Manual verify end-to-end**

In one terminal:
```powershell
pnpm --filter @dashboard-agent/renderer dev
```

In another:
```powershell
$env:RENDERER_URL = "http://localhost:5173"
pnpm --filter @dashboard-agent/main build
pnpm --filter @dashboard-agent/main exec electron .
```

Expected: window opens; UI shows "IPC ping → pong".

- [ ] **Step 10: Commit**

```powershell
git add apps packages
git commit -m "feat(ipc): add ping handler with end-to-end bridge"
```

---

## Task 8: Tray icon + window restoration

**Files:**
- Create: `apps/main/src/tray/index.ts`
- Create: `apps/main/resources/tray-icon.png` (16×16 placeholder; final asset in M2)
- Modify: `apps/main/src/index.ts`

- [ ] **Step 1: Add a placeholder tray icon**

Create a 16×16 PNG at `apps/main/resources/tray-icon.png`. For now, generate a solid-color placeholder so Electron loads something:

```powershell
# Use any 16x16 PNG — placeholder. Real icon deferred to M2.
# If you have ImageMagick:
magick -size 16x16 xc:#1D5DD7 apps/main/resources/tray-icon.png
# Otherwise create manually; verify file exists:
Test-Path apps/main/resources/tray-icon.png
```

Expected: returns `True`.

- [ ] **Step 2: Implement `apps/main/src/tray/index.ts`**

```ts
import { Tray, Menu, BrowserWindow, app } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const createTray = (getWindow: () => BrowserWindow | null): Tray => {
  const iconPath = resolve(__dirname, "../resources/tray-icon.png");
  const tray = new Tray(iconPath);
  tray.setToolTip("Dashboard Agent");

  const menu = Menu.buildFromTemplate([
    {
      label: "Open",
      click: () => {
        const win = getWindow();
        if (win === null || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);

  tray.on("click", () => {
    const win = getWindow();
    if (win === null || win.isDestroyed()) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });

  return tray;
};
```

- [ ] **Step 3: Update `tsup.config.ts` to copy resources and (anticipating Task 9) migrations**

`apps/main/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const copyTreeIfExists = (srcDir: string, destDir: string): void => {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      copyFileSync(join(srcDir, entry.name), join(destDir, entry.name));
    }
  }
};

export default defineConfig({
  entry: ["src/index.ts", "src/ipc/preload.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["electron", "better-sqlite3"],
  onSuccess: async () => {
    // Copy tray asset (this milestone)
    mkdirSync(resolve("dist/resources"), { recursive: true });
    copyFileSync(
      resolve("resources/tray-icon.png"),
      resolve("dist/resources/tray-icon.png"),
    );
    // Copy SQL migrations (used by Task 9; safe no-op until migrations dir exists)
    copyTreeIfExists(
      resolve("src/db/migrations"),
      resolve("dist/db/migrations"),
    );
  },
});
```

- [ ] **Step 4: Update `apps/main/src/index.ts` to wire tray and prevent app quit on window close**

```ts
import { app, BrowserWindow, Tray } from "electron";
import { createMainWindow } from "./window/main-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/index.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const getWindow = (): BrowserWindow | null => mainWindow;

app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createMainWindow();
  tray = createTray(getWindow);
});

// On Windows, closing the window should hide it (tray keeps app alive).
app.on("window-all-closed", (event: Event) => {
  // Do not quit; tray keeps process alive.
  event.preventDefault();
});

app.on("activate", () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
});

// Suppress unused-tray warning by referencing tray on quit
app.on("before-quit", () => {
  tray?.destroy();
  tray = null;
});
```

- [ ] **Step 5: Manually verify tray**

```powershell
pnpm --filter @dashboard-agent/main build
pnpm --filter @dashboard-agent/main exec electron .
```

Expected: window opens; close window → window hides; tray icon visible in system tray (near clock); right-click tray shows menu (Open / Quit); click "Open" → window reappears; click "Quit" → process exits.

- [ ] **Step 6: Commit**

```powershell
git add apps/main
git commit -m "feat(main): add tray icon with hide-on-close"
```

---

## Task 9: SQLite + migration runner

**Files:**
- Modify: `apps/main/package.json` (add `better-sqlite3`)
- Create: `apps/main/src/db/client.ts`
- Create: `apps/main/src/db/migrations.ts`
- Create: `apps/main/src/db/migrations/0001_initial.sql`
- Create: `apps/main/tests/db.client.test.ts`
- Create: `apps/main/tests/db.migrations.test.ts`

- [ ] **Step 1: Add `better-sqlite3` to `apps/main/package.json` dependencies**

```powershell
pnpm --filter @dashboard-agent/main add better-sqlite3@^11.3.0
pnpm --filter @dashboard-agent/main add -D @types/better-sqlite3@^7.6.11
```

Expected: `pnpm-lock.yaml` updated; package compiles native module.

- [ ] **Step 2: Write failing test for migration runner**

`apps/main/tests/db.migrations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, getCurrentVersion } from "../src/db/migrations.js";

describe("applyMigrations", () => {
  it("starts at version 0 on a fresh database", () => {
    const db = new Database(":memory:");
    expect(getCurrentVersion(db)).toBe(0);
  });

  it("applies all migrations and bumps user_version", () => {
    const db = new Database(":memory:");
    const applied = applyMigrations(db);
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(getCurrentVersion(db)).toBe(applied.length);
  });

  it("is idempotent: running twice does not re-apply", () => {
    const db = new Database(":memory:");
    const first = applyMigrations(db);
    const second = applyMigrations(db);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(second.length).toBe(0);
  });

  it("creates the companies table after migration 0001", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'")
      .get();
    expect(row).toBeDefined();
  });
});
```

- [ ] **Step 3: Write failing test for client**

`apps/main/tests/db.client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { openDatabase } from "../src/db/client.js";

describe("openDatabase", () => {
  it("creates a new file and returns an open Database", () => {
    const dir = mkdtempSync(join(tmpdir(), "da-test-"));
    try {
      const db = openDatabase(join(dir, "test.db"));
      expect(db.open).toBe(true);
      const ver = db.pragma("user_version", { simple: true });
      expect(typeof ver).toBe("number");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Run tests — they should fail (modules missing)**

```powershell
pnpm --filter @dashboard-agent/main test
```

Expected: 5 failures.

- [ ] **Step 5: Implement `apps/main/src/db/migrations/0001_initial.sql`**

This is the schema from the spec §5.3 — full SQL. Engineers must use this file verbatim:

```sql
-- 0001_initial.sql — initial schema (Spec §5.3)

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1D5DD7',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  template_id TEXT,
  system_prompt TEXT NOT NULL,
  skills_json TEXT NOT NULL DEFAULT '[]',
  allowed_projects_json TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'supervised'
    CHECK (mode IN ('supervised','auto')),
  always_on INTEGER NOT NULL DEFAULT 0
    CHECK (always_on IN (0,1)),
  reports_to TEXT REFERENCES agents(id) ON DELETE SET NULL,
  claude_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle','thinking','working','waiting','error')),
  current_action TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('backlog','todo','doing','review','done','cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','urgent')),
  created_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  participants_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL
    CHECK (sender_kind IN ('user','agent','system')),
  sender_id TEXT,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('approval','completed','suggestion','error','security_alert')),
  actor_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT,
  requires_action INTEGER NOT NULL DEFAULT 0
    CHECK (requires_action IN (0,1)),
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS costs_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  model TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  mcp_tools_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS role_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  default_system_prompt TEXT NOT NULL,
  default_skills_json TEXT NOT NULL DEFAULT '[]',
  icon TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_company_status
  ON issues(company_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created
  ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_company_unread
  ON inbox_items(company_id, read_at);
CREATE INDEX IF NOT EXISTS idx_costs_company_date
  ON costs_log(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agents_company
  ON agents(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_company
  ON projects(company_id);
```

- [ ] **Step 6: Implement `apps/main/src/db/migrations.ts`**

```ts
import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const getCurrentVersion = (db: Database.Database): number => {
  const result = db.pragma("user_version", { simple: true });
  return typeof result === "number" ? result : 0;
};

const setVersion = (db: Database.Database, version: number): void => {
  db.pragma(`user_version = ${version}`);
};

const loadMigrations = (): { id: number; sql: string }[] => {
  const dir = resolve(__dirname, "migrations");
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  return files.map((f) => {
    const id = Number.parseInt(f.slice(0, 4), 10);
    const sql = readFileSync(join(dir, f), "utf8");
    return { id, sql };
  });
};

export const applyMigrations = (db: Database.Database): number[] => {
  const current = getCurrentVersion(db);
  const all = loadMigrations();
  const pending = all.filter((m) => m.id > current);

  const tx = db.transaction((migrations: { id: number; sql: string }[]) => {
    for (const m of migrations) {
      db.exec(m.sql);
      setVersion(db, m.id);
    }
  });
  tx(pending);

  return pending.map((m) => m.id);
};
```

- [ ] **Step 7: Implement `apps/main/src/db/client.ts`**

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations } from "./migrations.js";

export const openDatabase = (filePath: string): Database.Database => {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  applyMigrations(db);
  return db;
};
```

- [ ] **Step 8: Run tests — should pass**

```powershell
pnpm --filter @dashboard-agent/main test
```

Expected: 5 PASS.

- [ ] **Step 9: Commit**

```powershell
git add apps/main pnpm-lock.yaml
git commit -m "feat(db): add sqlite client and migration runner with initial schema"
```

---

## Task 10: Wire DB into Electron startup

**Files:**
- Modify: `apps/main/src/index.ts`
- Create: `apps/main/src/db/path.ts`

- [ ] **Step 1: Implement `apps/main/src/db/path.ts`** (resolves user-data path)

```ts
import { app } from "electron";
import { join } from "node:path";

export const databasePath = (): string =>
  join(app.getPath("userData"), "dashboard-agent.db");
```

- [ ] **Step 2: Update `apps/main/src/index.ts` to open DB on ready**

```ts
import { app, BrowserWindow, Tray } from "electron";
import type Database from "better-sqlite3";
import { createMainWindow } from "./window/main-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/index.js";
import { openDatabase } from "./db/client.js";
import { databasePath } from "./db/path.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: Database.Database | null = null;

const getWindow = (): BrowserWindow | null => mainWindow;

app.whenReady().then(() => {
  db = openDatabase(databasePath());
  registerIpcHandlers();
  mainWindow = createMainWindow();
  tray = createTray(getWindow);
});

app.on("window-all-closed", (event: Event) => {
  event.preventDefault();
});

app.on("activate", () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
});

app.on("before-quit", () => {
  tray?.destroy();
  tray = null;
  db?.close();
  db = null;
});
```

- [ ] **Step 3: Manually verify**

```powershell
pnpm --filter @dashboard-agent/main build
pnpm --filter @dashboard-agent/main exec electron .
```

Expected: window opens. Check `%APPDATA%\dashboard-agent\dashboard-agent.db` exists. Quit via tray.

- [ ] **Step 4: Commit**

```powershell
git add apps/main
git commit -m "feat(main): open sqlite db on app ready, close on quit"
```

---

## Task 11: Pre-commit hooks (husky + gitleaks + lint-staged + commitlint)

**Files:**
- Create: `.husky/pre-commit`
- Create: `.husky/commit-msg`
- Create: `.gitleaks.toml`
- Create: `commitlint.config.cjs`
- Modify: root `package.json` (add husky/lint-staged/commitlint deps)

- [ ] **Step 1: Install hook deps**

```powershell
pnpm add -Dw husky@^9.1.5 lint-staged@^15.2.10 @commitlint/cli@^19.5.0 @commitlint/config-conventional@^19.5.0
```

- [ ] **Step 2: Initialize husky**

```powershell
pnpm exec husky init
```

This creates `.husky/pre-commit` with default content. Replace it.

- [ ] **Step 3: Replace `.husky/pre-commit`**

```sh
gitleaks detect --staged --redact --no-banner --exit-code 1
pnpm exec lint-staged
```

- [ ] **Step 4: Create `.husky/commit-msg`**

```sh
pnpm exec commitlint --edit "$1"
```

Make it executable on Linux/Mac (Windows ignores):
```powershell
git update-index --chmod=+x .husky/commit-msg
```

- [ ] **Step 5: Create `commitlint.config.cjs`**

```js
module.exports = {
  extends: ["@commitlint/config-conventional"],
};
```

- [ ] **Step 6: Add `lint-staged` config to root `package.json`**

Add this top-level field:
```json
"lint-staged": {
  "*.{ts,tsx,js,mjs,cjs}": ["prettier --write", "eslint --fix"],
  "*.{json,md,yml,yaml,css,html}": ["prettier --write"]
}
```

- [ ] **Step 7: Create `.gitleaks.toml` with custom rules**

```toml
title = "Dashboard Agent gitleaks rules"

[extend]
useDefault = true

[[rules]]
id = "claude-oauth-token"
description = "Claude Code OAuth token"
regex = '''sk-ant-oat[A-Za-z0-9_-]{20,}'''
tags = ["secret", "anthropic"]

[[rules]]
id = "claude-api-key"
description = "Anthropic API key"
regex = '''sk-ant-api03-[A-Za-z0-9_-]{50,}'''
tags = ["secret", "anthropic"]

[allowlist]
description = "Allow placeholder strings in tests and docs"
regexes = [
  '''sk-ant-(api|oat)0?3?-(EXAMPLE|FAKE|PLACEHOLDER)[A-Z_-]*''',
]
paths = [
  '''pnpm-lock\.yaml''',
]
```

- [ ] **Step 8: Test the gitleaks hook by attempting a commit with a fake token**

Create a temp file `temp-leak.txt` with content `sk-ant-oat-FAKEPRODUCTION_TOKEN_VALUE_FOR_TEST_xxxxxx`:

```powershell
"sk-ant-oat-FAKEPRODUCTION_TOKEN_VALUE_FOR_TEST_xxxxxx" | Out-File temp-leak.txt -Encoding utf8
git add temp-leak.txt
git commit -m "test: should fail"
```

Expected: pre-commit hook **rejects** the commit, citing the gitleaks finding.

```powershell
git restore --staged temp-leak.txt
Remove-Item temp-leak.txt
```

- [ ] **Step 9: Verify commitlint rejects bad messages**

```powershell
echo "" > temp.txt
git add temp.txt
git commit -m "bad message no type"
```

Expected: commitlint rejects ("subject may not be empty" / "type may not be empty").

```powershell
git restore --staged temp.txt
Remove-Item temp.txt
```

- [ ] **Step 10: Commit hook setup itself (use a conforming message)**

```powershell
git add .husky .gitleaks.toml commitlint.config.cjs package.json pnpm-lock.yaml
git commit -m "chore: add pre-commit hooks (gitleaks, lint-staged, commitlint)"
```

Expected: succeeds (no leaks; conforming message).

---

## Task 12: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/secrets.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint

      - run: pnpm typecheck

      - run: pnpm test

      - run: pnpm build

      - run: pnpm audit --prod --audit-level=high
        continue-on-error: false
```

- [ ] **Step 2: Create `.github/workflows/secrets.yml`**

```yaml
name: Gitleaks

on:
  pull_request:
  push:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITLEAKS_CONFIG: .gitleaks.toml
```

- [ ] **Step 3: Commit**

```powershell
git add .github
git commit -m "ci: add lint+test+build pipeline and gitleaks scan"
```

---

## Task 13: Open-source documentation seeds

**Files:**
- Create: `LICENSE`
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `CHANGELOG.md`

> Detailed content for these is finalized in M9 (open-source readiness). For M1, seed minimal placeholders so the repo has the boilerplate from day one.

- [ ] **Step 1: Create `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 Heverson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create `README.md`**

```markdown
# Dashboard Agent

Local orchestrator for Claude Code agents using the Claude Max OAuth login — no API key required.

> ⚠️ Status: in development. M1 (Foundation) is the current milestone.

## What it is

An Electron app that lets you run multiple Claude Code agents (CEO, engineers, QA, etc.) hierarchically on your machine. Inspired by [Paperclip](https://github.com/paperclipai/paperclip), but designed to use your existing Claude Max subscription via OAuth instead of an Anthropic API key.

## Why

If you already pay for Claude Max, you shouldn't need a separate API key just to orchestrate agents. This project uses `CLAUDE_CODE_OAUTH_TOKEN` (generated by `claude setup-token`) so all agent activity counts against your existing subscription.

## Status

- [x] M1 — Foundation (Electron + SQLite + tooling)
- [ ] M2 — Auth & Settings
- [ ] M3 — Orchestrator + MCP core
- [ ] M4 — Companies + Agents UI
- [ ] M5 — Issues + Inbox + Threads
- [ ] M6 — Projects + Costs + Org
- [ ] M7 — Security hardening
- [ ] M8 — Token efficiency
- [ ] M9 — Open-source readiness

See [`docs/superpowers/specs/2026-05-09-dashboard-agent-design.md`](docs/superpowers/specs/2026-05-09-dashboard-agent-design.md) for the full design.

## Disclaimer

This app spawns Claude Code agents on your machine using YOUR Claude Max OAuth token. Agents have access to your filesystem, shell commands, and network within the limits you configure. You are responsible for reviewing agent permissions and supervising autonomous modes. The authors assume no liability for actions taken by agents on your behalf.

## License

MIT — see [LICENSE](LICENSE).
```

- [ ] **Step 3: Create `SECURITY.md`**

```markdown
# Security

## Reporting

If you discover a security issue, please **do not open a public issue**. Email the maintainer directly or open a private security advisory on GitHub.

## Threat model

This app runs agents (Claude Code subprocesses) on your machine with access to:
- Filesystem (Read/Write/Edit) within `allowed_projects_json` of each agent
- Shell commands (Bash) with deny-list of destructive operations
- Network (within tools the agents call)

Threats covered (per Spec §8):
- OAuth token exfiltration → DPAPI encryption + filesystem allowlist + Bash deny-list
- Prompt injection → heuristic detector + auto-mode degradation
- MCP local exploit → ephemeral per-agent tokens
- Supply chain → lockfile + audit + Renovate

## Token rotation

Generate a new token with `claude setup-token`, then paste it in Settings.

## Incident runbook

See `docs/superpowers/specs/...` §8.9 (full runbook in M7+).
```

- [ ] **Step 4: Create `CONTRIBUTING.md`**

```markdown
# Contributing

Thanks for your interest! This project is in active early development.

## Development setup

Prerequisites: Node 20+, pnpm 9+, gitleaks, Windows 11 (primary platform).

```powershell
git clone <url>
cd DashboardAgent
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
```

- [ ] **Step 5: Create `CHANGELOG.md`**

```markdown
# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- M1 Foundation: Electron + SQLite + monorepo + lint/test/CI tooling
```

- [ ] **Step 6: Commit**

```powershell
git add LICENSE README.md SECURITY.md CONTRIBUTING.md CHANGELOG.md
git commit -m "docs: seed open-source boilerplate (license, readme, security, contributing, changelog)"
```

---

## Task 14: Final smoke test + lint sweep

- [ ] **Step 1: Run full pipeline locally**

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green. If any step fails, fix in-place and re-commit.

- [ ] **Step 2: Manual end-to-end check**

In one terminal:
```powershell
pnpm --filter @dashboard-agent/renderer dev
```

In another:
```powershell
$env:RENDERER_URL = "http://localhost:5173"
pnpm --filter @dashboard-agent/main build
pnpm --filter @dashboard-agent/main exec electron .
```

Verify all of the following:

- [ ] Window opens at 1280×800 with `#F5F5FA` background
- [ ] UI shows "Dashboard Agent" + "IPC ping → pong"
- [ ] Tray icon visible in system tray; right-click shows Open/Quit menu
- [ ] Closing the window hides it; tray icon stays
- [ ] Click tray "Open" → window reappears
- [ ] Click tray "Quit" → process exits cleanly
- [ ] `%APPDATA%\dashboard-agent\dashboard-agent.db` exists after first run

- [ ] **Step 3: Verify CI passes on GitHub** (after pushing — push step is optional in M1; can be deferred)

If pushing now:
```powershell
gh repo create dashboard-agent --private --source=. --remote=origin
git push -u origin main
```

Then check GitHub Actions tab for green checks on `CI` and `Gitleaks` workflows.

- [ ] **Step 4: Final commit if any drift was caught**

```powershell
git status
# If clean:
echo "M1 complete."
# If dirty:
git add -A && git commit -m "chore: M1 final sweep"
```

---

## M1 Definition of Done

- [ ] `pnpm install` from a clean clone produces a working repo
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass
- [ ] Electron app launches, shows the window, IPC ping returns pong
- [ ] Tray icon hides/shows window; quits cleanly
- [ ] SQLite DB is created at first run with all tables from `0001_initial.sql`
- [ ] `git commit` with a fake OAuth token is **rejected** by gitleaks
- [ ] `git commit` with a non-conventional message is **rejected** by commitlint
- [ ] CI workflow defined (`ci.yml` + `secrets.yml`)
- [ ] LICENSE, README, SECURITY, CONTRIBUTING, CHANGELOG present

If all 9 boxes check, M1 is done. Move to M2 — Auth & Settings.

---

## Notes for the implementing engineer

- **Windows-first**: this milestone is verified on Windows 11. Mac/Linux verification is a v2 concern — don't spend time fixing platform-specific issues outside Win11 unless they block.
- **Native modules**: `better-sqlite3` may rebuild on first install (takes 10–30s). If `electron-rebuild` becomes necessary in later milestones, defer until needed (M3 spawns Electron-bound code that hits this).
- **Don't expand scope**: M1 is plumbing. Resist the urge to add features (settings UI, sidebar, etc.) — those have dedicated milestones with proper tests.
- **Spec is the source of truth**: when in doubt, re-read the relevant section of `docs/superpowers/specs/2026-05-09-dashboard-agent-design.md`. The plan implements the spec, not the other way around.
