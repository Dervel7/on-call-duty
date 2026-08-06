# Phase 1 — Foundation Design

**Project:** Doctor On-Call Duty Scheduling System
**Phase:** 1 of 8 (Foundation)
**Status:** Approved (2026-08-06)
**Scope owner:** backend `apps/api`, frontend `apps/web`, shared `packages/*`, `database/`

---

## 1. Purpose

Establish a clean, consistent, production-leaning foundation for a pnpm-workspaces monorepo. Phase 1 delivers the scaffold, tooling, local database setup, a minimal Express API with one health endpoint, and a minimal Vue 3 application rendered with the medical theme tokens. No business features are implemented in this phase.

The full system is decomposed into eight phases. Each phase gets its own spec, plan, and implementation cycle:

1. **Foundation** (this document)
2. Auth & Authorization
3. Doctor Management
4. Availability Management
5. Scheduling Engine (core)
6. Schedule Management UI
7. Statistics & Dashboard
8. Reporting

**Multi-hospital is excluded entirely.** The system targets a single hospital; no `hospital_id` scoping is introduced. Items such as public-holiday configuration, ICS export, and email notifications remain optional future work, unrelated to multi-tenancy.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Workspaces | pnpm workspaces; packages publish **TypeScript source** (no build step); consumed via workspace symlinks |
| Backend runtime | Node.js 24 LTS, TypeScript strict, `tsx watch` for dev, `tsc` for prod build |
| Frontend stack | Vue 3 (`<script setup>`), Vite, TypeScript strict, Vue Router, Pinia, VueUse, shadcn-vue, Tailwind CSS |
| Database | PostgreSQL 17, `pg`, hand-written SQL only (no ORM) |
| DB setup | Single runner script `database/scripts/setup-db.ts` executes `schema.sql` then `seed.sql`; both idempotent |
| Testing | Vitest (monorepo-wide) |
| Logging | Pino + `pino-http` |
| Lint/format | ESLint flat config (root); **no Prettier**; format via Volar format-on-save; lint rules never modified |
| Local runtime | PostgreSQL on host (no Docker Compose for dev) |
| Production Docker | Deferred to a later phase |
| Ports | API → `3000`, UI → `5174` |

## 3. Repository Structure

```
on-call-duty/
├── apps/
│   ├── api/                      # Node + Express + TS
│   └── web/                      # Vue 3 + Vite + TS
├── packages/
│   ├── shared/                   # @oncall/shared — shared TS types & zod schemas
│   └── utils/                    # @oncall/utils — pure helpers (dates, ids, etc.)
├── database/
│   ├── schema.sql                # DDL, idempotent (CREATE TABLE IF NOT EXISTS)
│   ├── seed.sql                  # sample/demo data
│   └── scripts/
│       └── setup-db.ts           # single runner: schema.sql → seed.sql
├── docs/
│   └── superpowers/specs/        # design docs land here
├── .vscode/
│   └── settings.json             # Volar format-on-save, ESLint
├── package.json                  # root: workspace scripts, dev tooling
├── pnpm-workspace.yaml
├── tsconfig.base.json            # shared TS compiler options
├── eslint.config.mjs             # root flat config (TS + Vue rules)
├── vitest.config.shared.ts       # base Vitest config extended by packages
├── .env.example
├── .gitignore
├── AGENTS.md
└── README.md
```

### 3.1 Package boundaries

- `@oncall/shared` — type aliases and zod schemas shared across api and web. No business logic, no Node- or Vue-specific imports. Source-only.
- `@oncall/utils` — framework-agnostic pure functions (date math, weekend/holiday detection, ID formatting). Source-only.
- `apps/api` depends on `@oncall/shared`, `@oncall/utils`.
- `apps/web` depends on `@oncall/shared`, `@oncall/utils`.

### 3.2 Conventions

- Package names scoped `@oncall/*`.
- TypeScript `strict: true` everywhere.
- Resolution via pnpm workspace symlinks; no custom `tsconfig` path aliases.

## 4. Backend Foundation (`apps/api`)

### 4.1 Layout

```
apps/api/src/
├── config/
│   └── env.ts              # zod-validated process.env
├── db/
│   └── client.ts           # pg Pool singleton + query() helper
├── middleware/
│   ├── error-handler.ts    # central error handler → { success:false, error }
│   ├── request-logger.ts   # pino-http request logging
│   └── not-found.ts        # 404 → standard envelope
├── routes/
│   └── health.routes.ts    # GET /health
├── app.ts                  # Express app wiring (helmet, cors, json, routes)
├── server.ts               # createServer + listen (entry point)
└── logger.ts               # pino instance (shared)
```

### 4.2 Configuration

- `config/env.ts` validates `process.env` with zod on boot. Missing or invalid values fail fast with a clear message.
- Variables: `NODE_ENV`, `PORT` (default 3000), `DATABASE_URL`, `CORS_ORIGIN`, `LOG_LEVEL`.

### 4.3 Middleware (Phase 1 set)

- `helmet` security headers.
- `cors` with origin from `CORS_ORIGIN`.
- JSON body parser with a size limit.
- `request-logger` via `pino-http` with request-id.
- `not-found` → 404 envelope.
- `error-handler` → central mapping to status + envelope.

> Rate limiting, auth, and RBAC middleware are added in Phase 2.

### 4.4 Response contract

Every response carries the JSON envelope **and** the correct HTTP status code.

- Success body: `{ "success": true, "data": {} }`
- Error body: `{ "success": false, "error": "message" }`

Status mapping:

| Outcome | Status |
|---|---|
| GET / PUT success | 200 |
| POST create | 201 |
| DELETE | 204 |
| Validation error | 400 |
| Unauthenticated | 401 |
| Forbidden | 403 |
| Not found | 404 |
| Conflict | 409 |
| Unprocessable | 422 |
| Rate limited | 429 |
| Server error | 500 |

### 4.5 Database client

- `db/client.ts` exports a single `pg.Pool` constructed from `DATABASE_URL`.
- A thin `query()` helper wraps parameterized queries. No connection logic in route handlers.

### 4.6 Logging

- `logger.ts` exports one pino instance.
- Pretty transport in dev; JSON in prod.
- Level controlled by `LOG_LEVEL` (default `info`).

### 4.7 Scripts (`apps/api/package.json`)

| Script | Action |
|---|---|
| `dev` | `tsx watch src/server.ts` |
| `build` | `tsc -p tsconfig.json` → `dist/` |
| `start` | `node dist/server.js` |
| `lint` | `eslint .` |
| `typecheck` | `tsc --noEmit -p tsconfig.json` |
| `test` | `vitest run` |

## 5. Frontend Foundation (`apps/web`)

### 5.1 Layout

```
apps/web/src/
├── assets/                 # logo, favicon
├── components/
│   ├── ui/                 # shadcn-vue generated components (Button, Card, Input, ...)
│   └── layout/             # AppHeader, AppSidebar, AppLayout
├── layouts/
│   └── DefaultLayout.vue
├── composables/            # e.g., useApi() later
├── lib/
│   ├── http.ts             # fetch wrapper for { success, data } envelopes
│   └── utils.ts            # cn() class merge helper (shadcn requirement)
├── pages/
│   └── HomePage.vue        # minimal landing/dashboard placeholder
├── router/
│   └── index.ts            # routes + placeholder guard (auth guards arrive Phase 2)
├── services/               # API service modules per resource — empty in Phase 1
├── stores/                 # Pinia stores — auth store arrives Phase 2
├── types/                  # re-export @oncall/shared + web-only types
├── App.vue
├── main.ts                 # createApp, pinia, router, css
└── style.css               # tailwind directives + theme tokens
```

### 5.2 Token-based theming

All color is expressed as **CSS-variable design tokens**, centralized in `src/style.css`. No component hardcodes a color; components reference only token-derived utility classes.

- Token group: `--background`, `--foreground`, `--card`, `--primary` / `--primary-foreground`, `--accent` / `--accent-foreground`, `--muted`, `--border`, `--ring`, `--success`, plus radius `--radius`.
- Palette: white / light-gray backgrounds, soft medical blue primary, medical green accent/success, neutral borders, subtle shadows, no heavy gradients.
- Typography: system UI stack; no flashy display fonts.
- Re-theming (e.g., adjust the medical blue) = editing the token block in `style.css` only.

### 5.3 HTTP wrapper

- `lib/http.ts` is a typed fetch client pointing at `VITE_API_URL`.
- Parses the envelope; surfaces `success:false` as errors.
- Auth header injection is wired in Phase 2.

### 5.4 Router

- One public route `/` in Phase 1.
- Route meta and a `beforeEach` guard are stubbed for Phase 2 RBAC.

### 5.5 Accessibility & responsiveness

- Semantic HTML, labeled inputs, keyboard-focusable controls, mobile-first layout grid — baseline set in Phase 1 and maintained in every phase.

### 5.6 Scripts (`apps/web/package.json`)

| Script | Action |
|---|---|
| `dev` | `vite --port 5174` |
| `build` | `vue-tsc --noEmit && vite build` |
| `preview` | `vite preview` |
| `lint` | `eslint .` |
| `typecheck` | `vue-tsc --noEmit` |
| `test` | `vitest run` |

## 6. Shared Packages

### 6.1 `@oncall/shared`

```
packages/shared/src/
├── index.ts            # barrel
├── types/
│   ├── envelope.ts     # ApiResponse<T> = { success, data } / { success, error }
│   ├── auth.ts         # Role = 'administrator' | 'doctor' (types only in Phase 1)
│   └── index.ts
└── package.json        # "main": "./src/index.ts", sideEffects: false
```

Phase 1 is intentionally thin (response envelope + `Role`) so api and web share one contract from day one. The package grows per phase.

### 6.2 `@oncall/utils`

```
packages/utils/src/
├── index.ts
├── date.ts             # isWeekend, daysInMonth, date range helpers
├── env.ts              # small runtime helpers (e.g., required())
└── package.json
```

## 7. Tooling (root-level)

- **`tsconfig.base.json`** — `strict:true`, `target ES2022`, `moduleResolution Bundler`, `verbatimModuleSyntax`, shared `lib`. Each app/package `extends` it.
- **`eslint.config.mjs`** — `@typescript-eslint` + `eslint-plugin-vue` + `jsonc`. **No Prettier.** Lint rules are never modified.
- **`vitest.config.shared.ts`** — base config (globals, environment); each package/app extends it.
- **`.vscode/settings.json`** — Volar as default formatter, format-on-save, ESLint auto-fix on save, Tailwind IntelliSense.
- **Root `package.json`** — workspaces; aggregate scripts using `pnpm -r` and `pnpm --filter`.
- **`.gitignore`** — `node_modules`, `dist`, `.env`, coverage, editor caches.
- **`.env.example`** — documents `DATABASE_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `LOG_LEVEL`, and the web copy with `VITE_API_URL`.

### 7.1 Root scripts

| Script | Action |
|---|---|
| `dev` | start api + web in parallel (watch) |
| `build` | `pnpm -r build` |
| `typecheck` | `pnpm -r typecheck` |
| `lint` | `pnpm -r lint` |
| `test` | `pnpm -r test` |
| `db:setup` | run `database/scripts/setup-db.ts` via tsx |
| `db:seed` | re-run `seed.sql` only |

## 8. Database Setup (`database/`)

### 8.1 Layout

```
database/
├── schema.sql          # DDL only, idempotent
├── seed.sql            # sample data only
└── scripts/
    └── setup-db.ts     # single runner: connect → schema.sql → seed.sql
```

### 8.2 Runner (`scripts/setup-db.ts`)

- Reads `DATABASE_URL` from env.
- Connects with a temporary `pg.Client`.
- Executes `schema.sql` (statement by statement). Idempotent via `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
- Then executes `seed.sql`, kept safe to re-run.
- Logs each step with pino; exits with clear errors on failure.
- Invoked via root `pnpm db:setup`.

### 8.3 Phase 1 schema

`schema.sql` is intentionally minimal. It establishes the file, conventions, and header, and contains only a smoke-test table (e.g., `app_meta` with a `schema_version` row) to prove the pipeline end-to-end. Real tables (users, doctors, …) are appended in their phases.

`seed.sql` seeds only the smoke-test row in Phase 1.

### 8.4 Conventions (established now, used by all phases)

- snake_case tables/columns.
- Primary keys: `id INTEGER GENERATED ALWAYS AS IDENTITY` unless a table needs UUID.
- `created_at` / `updated_at` `timestamptz` defaults on every table.
- Indexes added as queries demand (per AGENTS.md).

## 9. Developer Workflow

End-to-end onboarding (documented in the README):

1. Install Node LTS + pnpm + local PostgreSQL (already satisfied on the author's host: Node 24.15.0, pnpm 10.26.0, PostgreSQL 17 running).
2. `pnpm install`.
3. Create the local database; copy `.env.example` → `.env` for api and web.
4. `pnpm db:setup` applies schema + seed.
5. `pnpm dev` runs api on `:3000` and web on `:5174`.
6. `curl http://localhost:3000/health` → `{ "success": true, "data": { "status": "ok" } }`.

> `psql` is not required to be on PATH; the runner uses the `pg` library over `DATABASE_URL`. The README notes adding `C:\Program Files\PostgreSQL\17\bin` to PATH as optional.

## 10. Definition of Done (Phase 1)

- `pnpm install`, `pnpm db:setup`, `pnpm dev` all succeed from a clean clone.
- `GET /health` returns the standard success envelope with HTTP 200.
- Web renders the home page with the medical theme tokens (no hardcoded colors).
- `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass.
- `@oncall/shared` `ApiResponse`/`Role` types import successfully in both api and web (proves workspace wiring).

## 11. Documentation Deliverables (Phase 1)

- `README.md` — project overview, stack, quickstart, script reference, env vars.
- This design document (committed).
- Installation / Development / Production deployment guides are expanded in later phases.

## 12. Out of Scope (Phase 1)

Auth/JWT, doctors CRUD, availability, scheduling engine, schedule UI, statistics, reporting, audit logging, rate limiting, production Docker. Each is handled in its own phase.
