# Phase 1 — Foundation Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-06-phase1-foundation-design.md`
**Approach:** Subagent-driven. Each task is delegated to a subagent with exact file specs; the orchestrator verifies between tasks.

Host prerequisites (already satisfied): Node 24.15.0, pnpm 10.26.0, PostgreSQL 17 (service running). `psql` is not on PATH but is not required.

---

## Task ordering & dependencies

```
T1 (root scaffold) ─┬─> T2 (shared packages) ─┐
                    └─> T3 (root tooling) ──────┤
                                               ├──> T4 (database)  ┐
                                               ├──> T5 (backend)   ├──> T7 (verify)
                                               └──> T6 (frontend)  ┘
```

- **Step 1:** T1 + T2 + T3 (one subagent) — foundational, must be internally consistent.
- **Step 2:** verify foundation; run `pnpm install` once, centrally.
- **Step 3:** T4, T5, T6 in parallel (three subagents; they write disjoint directories).
- **Step 4:** T7 — README + full verification gate.

Subagents **must not** run `pnpm install` or edit `package.json` at workspace root beyond their assigned files (avoids install races). The orchestrator runs install/verification centrally.

---

## T1 — Root monorepo scaffold

**Files to create:**

### `pnpm-workspace.yaml`
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `package.json` (root)
- `private: true`
- `name: "on-call-duty"`
- `type: "module"`
- `packageManager: "pnpm@10.26.0"`
- `scripts`: `dev` → `pnpm --parallel --filter "@oncall/api" --filter "@oncall/web" dev`; `build` → `pnpm -r build`; `typecheck` → `pnpm -r typecheck`; `lint` → `pnpm -r lint`; `test` → `pnpm -r test`; `db:setup` → `tsx database/scripts/setup-db.ts`; `db:seed` → `tsx database/scripts/seed-only.ts`.
- `devDependencies`: `typescript`, `tsx`, `eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint-plugin-vue`, `vue-eslint-parser`, `jsonc-eslint-parser`, `vitest`, `@types/node`, `pino`.
  - (ESLint plugin versions resolved by pnpm at install; pin majors if needed.)
- `engines`: `node: ">=20"`, `pnpm: ">=10"`.

### `tsconfig.base.json`
Shared compiler options:
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true
  }
}
```

### `.gitignore`
`node_modules`, `dist`, `coverage`, `.env`, `.env.*` (keep `.env.example`), `*.log`, `.pnpm-debug.log*`, `.DS_Store`, `.vscode/*` (keep `!.vscode/settings.json`), IDE caches.

### `.env.example` (per-app, not root)
Implementation refinement: env files live per app and are loaded via `dotenv` (the api reads `apps/api/.env`; Vite reads `apps/web/.env` natively; the DB scripts load `apps/api/.env`). Examples:
- `apps/api/.env.example`: `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `LOG_LEVEL`, `DATABASE_URL`
- `apps/web/.env.example`: `VITE_API_URL`

### `.vscode/settings.json`
Volar default formatter, format-on-save, ESLint fix-on-save, Tailwind IntelliSense disabled unless installed.

---

## T2 — Shared packages

### `packages/shared`
- `package.json`: `name: "@oncall/shared"`, `version: "0.0.0"`, `private: true`, `type: "module"`, `"main": "./src/index.ts"`, `"types": "./src/index.ts"`, `sideEffects: false`.
- `tsconfig.json`: extends `../../tsconfig.base.json`, `include: ["src"]`.
- `src/types/envelope.ts`:
  ```ts
  export type ApiSuccess<T> = { success: true; data: T }
  export type ApiError = { success: false; error: string }
  export type ApiResponse<T> = ApiSuccess<T> | ApiError
  ```
- `src/types/auth.ts`:
  ```ts
  export type Role = 'administrator' | 'doctor'
  ```
- `src/types/index.ts`: re-export both.
- `src/index.ts`: barrel `export * from './types'`.
- A minimal Vitest smoke test (`src/__tests__/smoke.test.ts`) asserting `ApiResponse`/`Role` types compile.

### `packages/utils`
- `package.json`: `name: "@oncall/utils"`, same shape as shared (`private`, source-only).
- `tsconfig.json`: extends base.
- `src/date.ts`: `isWeekend(date: Date): boolean`, `daysInMonth(year: number, month0: number): number`.
- `src/env.ts`: `required(name: string, value: string | undefined): string`.
- `src/index.ts`: barrel.
- One Vitest test covering `isWeekend` / `daysInMonth`.

---

## T3 — Root tooling

### `eslint.config.mjs` (root flat config)
- `ignores`: `**/dist`, `**/node_modules`, `**/coverage`.
- `jsonc` parser for json/jsonc.
- `@typescript-eslint` recommended (type-aware off for speed in Phase 1).
- `eslint-plugin-vue` (`vue3-recommended`) with `vue-eslint-parser`.
- **No Prettier config, no formatting rules.** Rules left at defaults (never modified per AGENTS.md).

### `vitest.config.shared.ts`
Base config object exported for extension:
```ts
import { defineProject } from 'vitest/config' // or defineConfig
export const sharedVitest = {
  test: { globals: true, environment: 'node', coverage: { provider: 'v8' } }
}
```
(Each package/app has its own `vitest.config.ts` that imports/extends this.)

### Root `package.json` dev tooling deps and scripts already listed in T1.

---

## T4 — Database (`database/`)

- `database/schema.sql` — header comment; **idempotent**; Phase 1 smoke-test table only:
  ```sql
  CREATE TABLE IF NOT EXISTS app_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
  Establishes conventions: snake_case, `created_at`/`updated_at` timestamptz defaults (here `updated_at`).
- `database/seed.sql` — idempotent; upserts the smoke-test row:
  ```sql
  INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  ```
- `database/scripts/setup-db.ts`:
  - Reads `DATABASE_URL` (via `@oncall/utils` `required`).
  - Connects with `pg.Client`.
  - Reads + executes `schema.sql` (split statements on `;`, ignore empty), then `seed.sql`.
  - Logs steps via `pino`; exits non-zero with clear message on failure.
- `database/scripts/seed-only.ts`: same but executes only `seed.sql`.
- Both run via root `pnpm db:setup` / `pnpm db:seed` (tsx). Needs `pg` + `pino` resolvable — add `pg` to root devDependencies (T1) and `pino` already there; the script imports via `tsx` from root. (Confirm `pg` in root deps.)

> Note: The database itself must already exist on the host. The README documents creating it once (e.g., `CREATE DATABASE oncall;`). The runner only creates tables + seeds.

---

## T5 — Backend (`apps/api`)

**package.json:** `name: "@oncall/api"`, `private: true`, `type: "module"`. Dependencies: `express`, `pg`, `pino`, `pino-http`, `helmet`, `cors`, `zod`. DevDeps: `tsx`, `typescript`, `vitest`, `@types/express`, `@types/cors`, `@types/node`. Workspace deps: `"@oncall/shared": "workspace:*"`, `"@oncall/utils": "workspace:*"`.

Scripts: `dev` → `tsx watch src/server.ts`; `build` → `tsc -p tsconfig.json`; `start` → `node dist/server.js`; `lint` → `eslint .`; `typecheck` → `tsc --noEmit -p tsconfig.json`; `test` → `vitest run`.

**tsconfig.json:** extends `../../tsconfig.base.json`; `outDir: "dist"`, `rootDir: "src"`, `include: ["src"]`. Note: `verbatimModuleSyntax` requires `import type` for type-only imports.

**vitest.config.ts:** extends shared base.

**Source files (`apps/api/src/`):**
- `logger.ts`: exports `logger = pino({ level: env.LOG_LEVEL, transport: dev ? { target: 'pino-pretty' } : undefined })`. Add `pino-pretty` to devDeps.
- `config/env.ts`: zod schema validating `process.env` → typed `env` object (`NODE_ENV`, `PORT=3000`, `DATABASE_URL`, `CORS_ORIGIN`, `LOG_LEVEL`). Fail fast on invalid.
- `db/client.ts`: `export const pool = new Pool({ connectionString: env.DATABASE_URL })`; thin `query` helper.
- `middleware/request-logger.ts`: `pino-http` wired to `logger`.
- `middleware/not-found.ts`: returns 404 `{ success:false, error:'Not found' }`.
- `middleware/error-handler.ts`: central; maps errors to status (default 500); body `{ success:false, error }`; logs error. (Reserves 400/401/403/404/409/422/429 mapping for later phases; Phase 1 covers 404 + 500 + generic.)
- `routes/health.routes.ts`: `GET /health` → 200 `{ success:true, data:{ status:'ok' } }`.
- `app.ts`: create express app; `helmet()`; `cors({ origin: env.CORS_ORIGIN })`; `express.json({ limit: '1mb' })`; request-logger; mount `/health`; not-found; error-handler. Export `app`.
- `server.ts`: `app.listen(env.PORT)`; log startup. Entry point.
- `lib/envelope.ts` (or in a small helper): `ok(data)` / `fail(msg)` builders used by controllers (thin).

**Tests:** `src/__tests__/health.test.ts` using Vitest + `supertest` (add `supertest` + `@types/supertest` devDeps) asserting `/health` returns 200 success envelope.

---

## T6 — Frontend (`apps/web`)

**package.json:** `name: "@oncall/web"`, `private: true`, `type: "module"`. Dependencies: `vue`, `vue-router`, `pinia`, `@vueuse/core`, plus shadcn-vue peer deps: `radix-vue` (or `reka-ui` per current shadcn-vue), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-vue-next`, `tailwindcss`, `@tailwindcss/vite` (Tailwind v4) or PostCSS plugin per chosen Tailwind version. DevDeps: `vite`, `@vitejs/plugin-vue`, `vue-tsc`, `typescript`, `vitest`, `@vue/test-utils`, `jsdom`. Workspace deps: `"@oncall/shared": "workspace:*"`, `"@oncall/utils": "workspace:*"`.

> Tailwind version: use **Tailwind CSS v4** with the Vite plugin (`@tailwindcss/vite`) and CSS-based config (matches shadcn-vue current setup and the token model).

Scripts: `dev` → `vite --port 5174 --strictPort`; `build` → `vue-tsc --noEmit && vite build`; `preview` → `vite preview`; `lint` → `eslint .`; `typecheck` → `vue-tsc --noEmit`; `test` → `vitest run`.

**vite.config.ts:** `@vitejs/plugin-vue`, `@tailwindcss/vite`, `resolve` for `@` → `src` (and workspace deps resolve via pnpm). Vitest config merged (environment `jsdom`).

**tsconfig.json** (+ `tsconfig.node.json` for vite config): extends base; `jsx: preserve`, `types: ["vite/client"]`.

**`src/style.css`** — Tailwind v4 import + token block (HSL channel tokens) for: `--background`, `--foreground`, `--card`, `--primary`/`--primary-foreground`, `--accent`/`--accent-foreground` (medical green), `--muted`/`--muted-foreground`, `--border`, `--input`, `--ring`, `--success`, `--radius`. Mapped into Tailwind theme via `@theme`. Palette: white/light-gray backgrounds, soft medical blue primary, medical green accent. **No hardcoded colors anywhere else.**

**Files (`apps/web/src/`):**
- `lib/utils.ts`: `cn(...)` via `clsx` + `tailwind-merge`.
- `lib/http.ts`: typed fetch wrapper using `import.meta.env.VITE_API_URL`; returns `data` on success, throws on `success:false`. No auth header yet (Phase 2).
- `components/ui/`: minimal shadcn-vue components for Phase 1 — `Button`, `Card` (+`CardHeader/Title/Content`), `Input`. Generated following shadcn-vue conventions, using token classes.
- `components/layout/`: `AppHeader.vue`, `AppLayout.vue` (simple, responsive, accessible).
- `layouts/DefaultLayout.vue`: composes `AppLayout` + `<RouterView>`.
- `pages/HomePage.vue`: renders inside a `Card`, uses `Button`, shows title + a short description. Demonstrates tokens.
- `router/index.ts`: one route `/` → `HomePage` in `DefaultLayout`; `beforeEach` stub for Phase 2.
- `types/index.ts`: re-export `@oncall/shared`.
- `App.vue`: `<RouterView />`.
- `main.ts`: `createApp(App).use(pinia).use(router).mount('#app')`; import `./style.css`.
- `index.html` (root of `apps/web`): mounts `#app`.
- `components.json` (shadcn-vue config) so future components can be added via CLI.

**Tests:** one smoke test mounting `HomePage` with `@vue/test-utils` (assert it renders).

---

## T7 — README + full verification

### `README.md`
Sections: project overview, stack, phase roadmap (8 phases), prerequisites (Node 24 / pnpm 10 / Postgres 17), quickstart (install → create db → `.env` → `pnpm db:setup` → `pnpm dev`), script reference, env var reference, definition of done for Phase 1.

Document the one-time DB creation step: connect to local Postgres and run `CREATE DATABASE oncall;` (since the runner assumes the DB exists). Optionally note adding `C:\Program Files\PostgreSQL\17\bin` to PATH.

### Verification gate (run centrally by orchestrator)
1. `pnpm install` — succeeds, workspace links resolve.
2. Create `oncall` DB on local Postgres; `pnpm db:setup` — applies schema + seed; `app_meta` row exists.
3. `pnpm typecheck` — all packages pass.
4. `pnpm lint` — passes (default rules, unmodified).
5. `pnpm test` — Vitest suites pass (shared, utils, api health, web smoke).
6. `pnpm dev` — api on `:3000`, web on `:5174`; `GET /health` → `{ success:true, data:{ status:'ok' } }` (HTTP 200); web renders home with medical tokens.

---

## Acceptance criteria (= spec Definition of Done)
All six verification items green. No hardcoded colors in web. Shared types imported in both apps. HTTP status codes set on every API response path.
