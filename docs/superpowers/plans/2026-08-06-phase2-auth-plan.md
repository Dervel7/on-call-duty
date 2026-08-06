# Phase 2 — Auth & Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver healthcare-grade password auth, JWT access tokens (in-memory), httpOnly-cookie refresh tokens with rotation, RBAC middleware, admin-only user CRUD, and a Vue auth UI with route guards.

**Architecture:** Three layers established on the backend — Controllers → Services → Database. `@oncall/shared` becomes the single source of truth for the auth contract (types AND zod schemas), consumed by both API and web. Refresh tokens are opaque, sha256-hashed in Postgres, rotated on every refresh, and delivered as `httpOnly` cookies. The SPA keeps the access token only in memory (Pinia) and silently rehydrates across reloads via the cookie.

**Tech Stack:** Node.js + TypeScript + Express 4, PostgreSQL via `pg`, `bcrypt`, `jsonwebtoken`, `cookie-parser`, `zod`, Vitest + `supertest`. Vue 3 + Pinia + Vue Router + `@vueuse/core`, hand-rolled shadcn-vue components (no reka-ui/radix in repo), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-06-phase2-auth-design.md`

---

## Global Constraints

Carry these verbatim into every task — they are non-negotiable project rules.

- **Runtime:** Node 20+ (developed on 24), pnpm 10+, PostgreSQL 14+ (developed on 17).
- **TypeScript:** `strict`, `noUncheckedIndexedAccess` (index access is `T | undefined`), `verbatimModuleSyntax` (use `import type` for type-only imports), `isolatedModules`, `esModuleInterop`. No `any` where `unknown` works.
- **ESLint:** unused args/vars/caught errors must be prefixed with `_`. Recommended TS + `vue3-recommended` rules at defaults. **No Prettier**; no formatting scripts.
- **DB:** parameterized queries only (`$1` placeholders), snake_case columns, camelCase API contract. Service layer maps between them. **No ORM.**
- **`schema.sql`/`seed.sql`:** idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT`). **No triggers/functions** — the DB runner splits statements on `;`.
- **Auth:** bcrypt cost factor **12**; password min length **6** (lives in shared zod schema once); access token **in memory only** (never `localStorage`/`sessionStorage`); refresh cookie `httpOnly + Secure(prod) + SameSite=Lax`, path `/auth`, rotated on use.
- **Response envelope:** `{ success: true, data }` or `{ success: false, error }`. HTTP status always set: 200/201/204 success; 400 validation; 401 unauth; 403 forbidden; 404 not found; 409 duplicate; 500 server error.
- **Frontend components:** hand-rolled using existing `cn()` + token classes (see `apps/web/src/components/ui/Button.vue`). Do not introduce `reka-ui`/`radix-vue`.
- **Commits:** conventional commits (`feat:`, `test:`, `chore:`, `docs:`). Commit per task on the `feat/phase2-auth` branch. **Never commit `.env`.**
- **No comments in code** unless explicitly requested.
- **Verification per task:** after implementation, run the task's test command and `pnpm typecheck` + `pnpm lint` for the affected package before committing.

---

## Architecture notes (deliberate simplifications from the spec)

1. **No `validators/` folder.** The `validate(schema, part)` middleware takes a zod schema directly; routes import schemas straight from `@oncall/shared`. The shared schemas ARE the validators (single source of truth). This removes a pure re-export layer with no behavioral change.
2. **`asyncHandler` wrapper added** (`apps/api/src/lib/async-handler.ts`). Express 4 does not auto-catch async rejections; every async controller is wrapped at the route level.
3. **`query` helper stays non-generic.** Services cast rows at the call site (`res.rows as unknown as UserRow[]`) to avoid churning Phase 1's `db/client.ts`.
4. **Refresh-token "family" reuse defense = revoke all of the user's active tokens.** The spec's "revoke the entire family" is implemented as revoking every active refresh token for that user on detected reuse — simpler than walking the `replaced_by` chain, and at least as strict.
5. **`req.user` typed via global augmentation** on `express-serve-static-core` (robust across `@types/express` v4/v5).

---

## Task ordering & dependencies

```
T1 (shared) ─┬─> T3 (api deps/env/error) ─> T4 (jwt/token) ─> T5 (middleware) ─┐
T2 (db) ──────┤                                                                ├─> T6 (token.svc) ─> T7 (auth.svc) ─┐
              │                                                                ├─> T8 (user.svc) ─────────────────┤
              │                                                                └──────────────────────────────────┤
              └─> T11 (web http) ─> T12 (web store/svc) ─> T13 (web router) ──┐                                     ├─> T9 (auth routes) ─> T10 (user routes + app) ─┐
                                                                              ├─> T14 (login/profile)            │                                                 ├─> T16 (README + verify)
                                                                              └─> T15 (users/header) ────────────┘                                                 │
```

Suggested execution grouping (subagent-driven): T1 → T2 → T3 → T4 → T5 → (T6, T8 can parallel) → T7 → T9 → T10 → (T11 → T12 → T13) → (T14, T15 parallel) → T16. The orchestrator runs `pnpm install` centrally after any `package.json` edit (T1, T3, T11).

---

## T1 — Shared contract (types + zod schemas)

**Files:**
- Modify: `packages/shared/package.json` (add `zod` dependency)
- Modify: `packages/shared/src/types/auth.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/schemas/auth.ts`
- Create: `packages/shared/src/schemas/index.ts`
- Test: `packages/shared/src/__tests__/schemas.test.ts`

**Interfaces:**
- Produces (values): `roleSchema`, `loginSchema`, `changePasswordSchema`, `createUserSchema`, `updateUserSchema` (all re-exported from `@oncall/shared`).
- Produces (types): `Role`, `AuthUser`, `User`, `LoginRequest`, `LoginResponse`, `RefreshResponse`, `ChangePasswordRequest`, `CreateUserRequest`, `UpdateUserRequest`.

- [ ] **Step 1: Add `zod` to the shared package**

`packages/shared/package.json` — add a `dependencies` block:
```json
  "dependencies": {
    "zod": "^3.23.0"
  }
```

- [ ] **Step 2: Expand `types/auth.ts`**

`packages/shared/src/types/auth.ts`:
```ts
export type Role = 'administrator' | 'doctor'

export interface AuthUser {
  id: number
  email: string
  role: Role
  firstName: string
  lastName: string
}

export interface User extends AuthUser {
  isActive: boolean
  createdAt: string
}

export interface LoginRequest {
  email: string
  password: string
}
export interface LoginResponse {
  user: AuthUser
  accessToken: string
}
export interface RefreshResponse {
  user: AuthUser
  accessToken: string
}
export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}
export interface CreateUserRequest {
  email: string
  password: string
  role: Role
  firstName: string
  lastName: string
}
export interface UpdateUserRequest {
  email?: string
  role?: Role
  firstName?: string
  lastName?: string
  isActive?: boolean
}
```

- [ ] **Step 3: Re-export the types**

`packages/shared/src/types/index.ts`:
```ts
export type { ApiSuccess, ApiError, ApiResponse } from './envelope'
export type {
  Role,
  AuthUser,
  User,
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  ChangePasswordRequest,
  CreateUserRequest,
  UpdateUserRequest,
} from './auth'
```

- [ ] **Step 4: Create the zod schemas**

`packages/shared/src/schemas/auth.ts`:
```ts
import { z } from 'zod'

export const roleSchema = z.enum(['administrator', 'doctor'])

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6),
    newPassword: z.string().min(6),
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'New password must differ',
  })

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: roleSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
})

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  role: roleSchema.optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
})
```

`packages/shared/src/schemas/index.ts`:
```ts
export {
  roleSchema,
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
} from './auth'
```

- [ ] **Step 5: Update the package barrel**

`packages/shared/src/index.ts`:
```ts
export type * from './types'
export * from './schemas'
```

- [ ] **Step 6: Write the failing test**

`packages/shared/src/__tests__/schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  roleSchema,
  updateUserSchema,
} from '../index'

describe('auth schemas', () => {
  it('loginSchema rejects short password and bad email', () => {
    expect(loginSchema.safeParse({ email: 'x', password: '123' }).success).toBe(false)
    expect(
      loginSchema.safeParse({ email: 'a@b.com', password: '123456' }).success,
    ).toBe(true)
  })

  it('changePasswordSchema rejects identical passwords', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'same123',
      newPassword: 'same123',
    })
    expect(r.success).toBe(false)
  })

  it('createUserSchema validates a doctor', () => {
    expect(
      createUserSchema.safeParse({
        email: 'd@h.com',
        password: 'secret1',
        role: 'doctor',
        firstName: 'Jane',
        lastName: 'Roe',
      }).success,
    ).toBe(true)
  })

  it('roleSchema rejects unknown roles', () => {
    expect(roleSchema.safeParse('nurse').success).toBe(false)
    expect(roleSchema.safeParse('doctor').success).toBe(true)
  })

  it('updateUserSchema accepts partial updates', () => {
    expect(updateUserSchema.safeParse({ isActive: false }).success).toBe(true)
    expect(updateUserSchema.safeParse({ email: 'nope' }).success).toBe(false)
  })
})
```

- [ ] **Step 7: Install + run test to verify it passes**

Run (central install after package.json edit): `pnpm install`
Run: `pnpm --filter @oncall/shared test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add auth types and zod schemas"
```

---

## T2 — Database schema + seed

**Files:**
- Modify: `database/schema.sql` (append Phase 2 tables)
- Modify: `database/seed.sql` (append admin user)

**Interfaces:**
- Produces (DB): tables `users(id, email, password_hash, role, first_name, last_name, is_active, created_at, updated_at)` and `refresh_tokens(id, user_id, token_hash, expires_at, revoked_at, replaced_by, created_at)`; indexes `idx_users_role`, `idx_refresh_tokens_user`, `idx_refresh_tokens_hash`.
- Produces (seed): one administrator row, email `admin@oncall.local`, password `changeme123`.

- [ ] **Step 1: Append Phase 2 tables to `schema.sql`**

Append to `database/schema.sql`:
```sql

-- Phase 2: Auth & Authorization

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'doctor'
                CHECK (role IN ('administrator', 'doctor')),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  replaced_by  INTEGER REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash)
  WHERE revoked_at IS NULL;
```

- [ ] **Step 2: Append the seeded administrator to `seed.sql`**

The bcrypt hash below (cost 12) is for the documented default password `changeme123`. It was generated offline and is safe to embed; the README documents the plaintext and "change on first login."

Append to `database/seed.sql`:
```sql

-- Phase 2: seed administrator (password: changeme123 — change on first login)
INSERT INTO users (email, password_hash, role, first_name, last_name, is_active)
VALUES (
  'admin@oncall.local',
  '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
  'administrator',
  'System',
  'Administrator'
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();
```

- [ ] **Step 3: Apply the schema + seed**

Ensure `apps/api/.env` has a working `DATABASE_URL`, then:
Run: `pnpm db:setup`
Expected: completes without error; logs "database setup complete".

- [ ] **Step 4: Verify the admin row exists**

Run (from repo root; uses hoisted `pg` + `dotenv`):
```bash
node -e "require('dotenv').config({path:'apps/api/.env'}); const {Client}=require('pg'); const c=new Client({connectionString:process.env.DATABASE_URL}); (async()=>{await c.connect(); const u=await c.query('SELECT email, role, is_active FROM users'); console.log('USERS', u.rows); await c.end();})().catch(e=>{console.error(e); process.exit(1);})"
```
Expected: prints one row — email `admin@oncall.local`, role `administrator`, is_active `true`.

- [ ] **Step 5: Commit**

```bash
git add database/schema.sql database/seed.sql
git commit -m "feat(db): add users and refresh_tokens tables + seed admin"
```

---

## T3 — Backend deps + env + http-error + async-handler + error-handler

**Files:**
- Modify: `apps/api/package.json` (add `bcrypt`, `jsonwebtoken`, `cookie-parser` + types)
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/vitest.config.ts` (test env: `JWT_ACCESS_SECRET`)
- Modify: `apps/api/src/middleware/error-handler.ts`
- Create: `apps/api/src/lib/http-error.ts`
- Create: `apps/api/src/lib/async-handler.ts`
- Create: `apps/api/src/__tests__/error-handler.test.ts`

**Interfaces:**
- Produces: `HttpError` class (`new HttpError(status, message)`); `asyncHandler(fn)` Express wrapper; `env` now also exposes `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN`.
- Error handler now maps `ZodError` → 400 (first issue message) and respects `HttpError.status`.

- [ ] **Step 1: Add backend dependencies**

`apps/api/package.json` — add to `dependencies`:
```json
    "bcrypt": "^5.1.0",
    "cookie-parser": "^1.4.7",
    "jsonwebtoken": "^9.0.2"
```
Add to `devDependencies`:
```json
    "@types/bcrypt": "^5.0.2",
    "@types/cookie-parser": "^1.4.8",
    "@types/jsonwebtoken": "^9.0.7"
```

- [ ] **Step 2: Extend `config/env.ts`**

Replace `apps/api/src/config/env.ts` with:
```ts
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { z } from 'zod'

config({ path: resolve(import.meta.dirname, '../../.env') })

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:5174'),
  LOG_LEVEL: z.string().default('info'),

  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? process.env.NODE_ENV === 'production' : v === 'true')),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data

export type Env = z.infer<typeof schema>
```

- [ ] **Step 3: Update `.env.example`**

`apps/api/.env.example`:
```
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5174
LOG_LEVEL=info
DATABASE_URL=postgres://postgres:postgres@localhost:5432/oncall
JWT_ACCESS_SECRET=dev-secret-change-me
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
```
Also add `JWT_ACCESS_SECRET=dev-secret-change-me` to the real `apps/api/.env` (never committed).

- [ ] **Step 4: Add the test env var to vitest config**

`apps/api/vitest.config.ts` — add `JWT_ACCESS_SECRET: 'test-secret'` to the `env` block so existing tests keep passing after the required-field change:
```ts
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/oncall',
        JWT_ACCESS_SECRET: 'test-secret',
      },
```

- [ ] **Step 5: Create `lib/http-error.ts`**

`apps/api/src/lib/http-error.ts`:
```ts
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}
```

- [ ] **Step 6: Create `lib/async-handler.ts`**

`apps/api/src/lib/async-handler.ts`:
```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express'

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
```

- [ ] **Step 7: Extend the error handler**

`apps/api/src/middleware/error-handler.ts`:
```ts
import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../lib/http-error'
import { logger } from '../logger'

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const message = err.issues[0]?.message ?? 'Validation failed'
    res.status(400).json({ success: false, error: message })
    return
  }
  const status =
    err instanceof HttpError ? err.status : typeof err?.status === 'number' ? err.status : 500
  if (status >= 500) logger.error({ err }, 'request failed')
  res.status(status).json({ success: false, error: err?.message ?? 'Internal server error' })
}
```

- [ ] **Step 8: Write the failing test**

`apps/api/src/__tests__/error-handler.test.ts`:
```ts
import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { asyncHandler } from '../lib/async-handler'
import { HttpError } from '../lib/http-error'
import { errorHandler } from '../middleware/error-handler'

function build() {
  const app = express()
  app.use(express.json())
  app.get('/http', (_req, _res, next) => next(new HttpError(409, 'taken')))
  app.post(
    '/zod',
    asyncHandler(async (req, _res, next) => {
      const r = z.object({ x: z.string().min(3) }).safeParse(req.body)
      if (!r.success) throw r.error
      next()
    }),
  )
  app.use(errorHandler)
  return app
}

test('HttpError status is respected', async () => {
  const res = await request(build()).get('/http')
  expect(res.status).toBe(409)
  expect(res.body).toEqual({ success: false, error: 'taken' })
})

test('ZodError maps to 400', async () => {
  const res = await request(build()).post('/zod').send({ x: 'a' })
  expect(res.status).toBe(400)
  expect(res.body.success).toBe(false)
})
```

- [ ] **Step 9: Install + run tests**

Run: `pnpm install`
Run: `pnpm --filter @oncall/api test`
Expected: PASS (new tests + existing health test).

- [ ] **Step 10: Commit**

```bash
git add apps/api/package.json apps/api/.env.example apps/api/vitest.config.ts apps/api/src/config/env.ts apps/api/src/lib/http-error.ts apps/api/src/lib/async-handler.ts apps/api/src/middleware/error-handler.ts apps/api/src/__tests__/error-handler.test.ts
git commit -m "feat(api): auth deps, env, HttpError, asyncHandler, zod error mapping"
```

---

## T4 — Backend crypto libs (jwt + token)

**Files:**
- Create: `apps/api/src/lib/jwt.ts`
- Create: `apps/api/src/lib/token.ts`
- Test: `apps/api/src/__tests__/jwt-token.test.ts`

**Interfaces:**
- Produces: `signAccessToken(payload: { sub: number; role: Role }): string`; `verifyAccessToken(token: string): JwtAccessPayload` (throws on invalid/expired); `generateRefreshToken(): string` (43+ char `base64url`); `hashToken(token: string): string` (sha256 hex, deterministic).

- [ ] **Step 1: Create `lib/jwt.ts`**

`apps/api/src/lib/jwt.ts`:
```ts
import jwt from 'jsonwebtoken'
import type { Role } from '@oncall/shared'
import { env } from '../config/env'

export interface JwtAccessPayload {
  sub: number
  role: Role
}

export function signAccessToken(payload: JwtAccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN })
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtAccessPayload
}
```

- [ ] **Step 2: Create `lib/token.ts`**

`apps/api/src/lib/token.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto'

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
```

- [ ] **Step 3: Write the failing test**

`apps/api/src/__tests__/jwt-token.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { signAccessToken, verifyAccessToken } from '../lib/jwt'
import { generateRefreshToken, hashToken } from '../lib/token'

describe('jwt', () => {
  it('round-trips the payload', () => {
    const t = signAccessToken({ sub: 7, role: 'doctor' })
    const p = verifyAccessToken(t)
    expect(p.sub).toBe(7)
    expect(p.role).toBe('doctor')
  })

  it('rejects a token signed with a different secret', () => {
    const t = jwt.sign({ sub: 1, role: 'doctor' }, 'wrong-secret')
    expect(() => verifyAccessToken(t)).toThrow()
  })
})

describe('refresh token helpers', () => {
  it('hashToken is deterministic and differs from input', () => {
    const a = hashToken('abc')
    const b = hashToken('abc')
    expect(a).toBe(b)
    expect(a).not.toBe('abc')
    expect(a).toHaveLength(64)
  })

  it('generateRefreshToken produces unique opaque tokens', () => {
    const a = generateRefreshToken()
    const b = generateRefreshToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(43)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @oncall/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/jwt.ts apps/api/src/lib/token.ts apps/api/src/__tests__/jwt-token.test.ts
git commit -m "feat(api): access JWT and refresh token crypto helpers"
```

---

## T5 — Backend middleware (validate, authenticate, authorize)

**Files:**
- Create: `apps/api/src/types/express.d.ts`
- Create: `apps/api/src/middleware/validate.ts`
- Create: `apps/api/src/middleware/authenticate.ts`
- Create: `apps/api/src/middleware/authorize.ts`
- Test: `apps/api/src/__tests__/middleware.test.ts`

**Interfaces:**
- Produces: `validate(schema: ZodTypeAny, part: 'body'|'params'|'query')` → RequestHandler (throws `HttpError(400)` on failure, writes parsed value back). `authenticate` (reads `Authorization: Bearer`, sets `req.user = { id, role }`, else `HttpError(401)`). `authorize(...roles: Role[])` → RequestHandler (`HttpError(403)` unless permitted). `req.user?: { id: number; role: Role }` globally augmented.

- [ ] **Step 1: Augment Express's Request type**

`apps/api/src/types/express.d.ts`:
```ts
import type { Role } from '@oncall/shared'

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: number; role: Role }
  }
}
```

- [ ] **Step 2: Create `validate.ts`**

`apps/api/src/middleware/validate.ts`:
```ts
import type { NextFunction, Request, Response } from 'express'
import type { ZodTypeAny } from 'zod'
import { HttpError } from '../lib/http-error'

type Part = 'body' | 'params' | 'query'

export function validate(schema: ZodTypeAny, part: Part) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part])
    if (!result.success) {
      throw new HttpError(400, result.error.issues[0]?.message ?? 'Validation failed')
    }
    req[part] = result.data
    next()
  }
}
```

- [ ] **Step 3: Create `authenticate.ts`**

`apps/api/src/middleware/authenticate.ts`:
```ts
import type { NextFunction, Request, Response } from 'express'
import { HttpError } from '../lib/http-error'
import { verifyAccessToken } from '../lib/jwt'

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Unauthorized')
  }
  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length))
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    throw new HttpError(401, 'Unauthorized')
  }
}
```

- [ ] **Step 4: Create `authorize.ts`**

`apps/api/src/middleware/authorize.ts`:
```ts
import type { NextFunction, Request, Response } from 'express'
import type { Role } from '@oncall/shared'
import { HttpError } from '../lib/http-error'

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'Forbidden')
    }
    next()
  }
}
```

- [ ] **Step 5: Write the failing test**

`apps/api/src/__tests__/middleware.test.ts`:
```ts
import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { signAccessToken } from '../lib/jwt'
import { asyncHandler } from '../lib/async-handler'
import { errorHandler } from '../middleware/error-handler'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'

function build() {
  const app = express()
  app.use(express.json())
  app.post('/v', validate(z.object({ x: z.string().min(2) }), 'body'), (_req, res) =>
    res.status(200).json({ success: true, data: { ok: true } }),
  )
  app.get('/me', authenticate, (req, res) =>
    res.status(200).json({ success: true, data: { id: req.user?.id, role: req.user?.role } }),
  )
  app.get(
    '/admin',
    authenticate,
    authorize('administrator'),
    asyncHandler(async (_req, res) => res.status(200).json({ success: true, data: { ok: true } })),
  )
  app.use(errorHandler)
  return app
}

test('validate rejects bad body with 400', async () => {
  const res = await request(build()).post('/v').send({ x: 'a' })
  expect(res.status).toBe(400)
})

test('authenticate requires bearer token', async () => {
  const res = await request(build()).get('/me')
  expect(res.status).toBe(401)
})

test('authenticate attaches req.user from valid token', async () => {
  const token = signAccessToken({ sub: 42, role: 'doctor' })
  const res = await request(build()).get('/me').set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(200)
  expect(res.body.data).toEqual({ id: 42, role: 'doctor' })
})

test('authorize forbids non-admin (403) and allows admin (200)', async () => {
  const app = build()
  const doc = signAccessToken({ sub: 1, role: 'doctor' })
  const adm = signAccessToken({ sub: 2, role: 'administrator' })
  expect((await request(app).get('/admin').set('Authorization', `Bearer ${doc}`)).status).toBe(403)
  expect((await request(app).get('/admin').set('Authorization', `Bearer ${adm}`)).status).toBe(200)
})
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @oncall/api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/types/express.d.ts apps/api/src/middleware/validate.ts apps/api/src/middleware/authenticate.ts apps/api/src/middleware/authorize.ts apps/api/src/__tests__/middleware.test.ts
git commit -m "feat(api): validate/authenticate/authorize middleware"
```

---

## T6 — token.service

**Files:**
- Create: `apps/api/src/services/token.service.ts`
- Test: `apps/api/src/__tests__/token.service.test.ts`

**Interfaces:**
- Consumes: `query` from `db/client`; `generateRefreshToken`, `hashToken` from `lib/token`; `env.JWT_REFRESH_EXPIRES_IN`.
- Produces: `issueRefreshToken(userId): Promise<string>`; `rotateRefreshToken(oldToken): Promise<{ token: string; userId: number }>` (throws `HttpError(401)` if missing/expired/revoked; on reuse of a revoked token revokes all the user's active tokens); `revokeRefreshToken(token): Promise<void>`; `revokeAllForUser(userId): Promise<void>`; `refreshExpiryMs(): number` (exported, reused for cookie maxAge).

- [ ] **Step 1: Create `token.service.ts`**

`apps/api/src/services/token.service.ts`:
```ts
import { env } from '../config/env'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'
import { generateRefreshToken, hashToken } from '../lib/token'

interface TokenRow {
  id: number
  user_id: number
  expires_at: Date
  revoked_at: Date | null
  replaced_by: number | null
}

export function refreshExpiryMs(): number {
  const raw = env.JWT_REFRESH_EXPIRES_IN.trim()
  if (raw.endsWith('d')) {
    const days = Number(raw.slice(0, -1))
    if (Number.isFinite(days) && days > 0) return days * 86_400_000
  }
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 7 * 86_400_000
}

function expiryDate(): Date {
  return new Date(Date.now() + refreshExpiryMs())
}

async function insertToken(userId: number): Promise<string> {
  const token = generateRefreshToken()
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expiryDate()],
  )
  return token
}

async function getRow(token: string): Promise<TokenRow | undefined> {
  const res = await query(
    `SELECT id, user_id, expires_at, revoked_at, replaced_by
     FROM refresh_tokens WHERE token_hash = $1`,
    [hashToken(token)],
  )
  return (res.rows as unknown as TokenRow[])[0]
}

export async function issueRefreshToken(userId: number): Promise<string> {
  return insertToken(userId)
}

export async function rotateRefreshToken(
  oldToken: string,
): Promise<{ token: string; userId: number }> {
  const row = await getRow(oldToken)
  if (!row) throw new HttpError(401, 'Invalid refresh token')
  const now = new Date()
  const expired = row.expires_at.getTime() < now.getTime()
  if (row.revoked_at || expired) {
    if (row.revoked_at) await revokeAllForUser(row.user_id)
    throw new HttpError(401, 'Invalid refresh token')
  }
  const newToken = generateRefreshToken()
  const ins = await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3) RETURNING id`,
    [row.user_id, hashToken(newToken), expiryDate()],
  )
  const newId = (ins.rows as unknown as { id: number }[])[0]?.id
  await query(
    `UPDATE refresh_tokens SET revoked_at = $1, replaced_by = $2 WHERE id = $3`,
    [now, newId, row.id],
  )
  return { token: newToken, userId: row.user_id }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  )
}

export async function revokeAllForUser(userId: number): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  )
}
```

- [ ] **Step 2: Write the failing test (db mocked)**

`apps/api/src/__tests__/token.service.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

import { issueRefreshToken, revokeAllForUser, rotateRefreshToken } from '../services/token.service'
import { hashToken } from '../lib/token'

function returning(rows: unknown) {
  return async () => ({ rows })
}

beforeEach(() => query.mockReset())

describe('token.service', () => {
  it('issueRefreshToken inserts a hashed token', async () => {
    query.mockImplementation(returning([]))
    const token = await issueRefreshToken(5)
    expect(typeof token).toBe('string')
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('INSERT INTO refresh_tokens')
    const params = query.mock.calls[0]?.[1] as unknown[]
    expect(params?.[1]).toBe(hashToken(token))
  })

  it('rotateRefreshToken throws on unknown token', async () => {
    query.mockImplementation(returning([]))
    await expect(rotateRefreshToken('nope')).rejects.toMatchObject({ status: 401 })
  })

  it('rotateRefreshToken throws on revoked token and revokes the user family', async () => {
    let calls = 0
    query.mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return {
          rows: [
            {
              id: 1,
              user_id: 9,
              expires_at: new Date(Date.now() + 10000),
              revoked_at: new Date(),
              replaced_by: 2,
            },
          ],
        }
      }
      return { rows: [] }
    })
    await expect(rotateRefreshToken('reused')).rejects.toMatchObject({ status: 401 })
    const familySql = query.mock.calls[1]?.[0] as string
    expect(familySql).toContain('UPDATE refresh_tokens SET revoked_at')
    expect((query.mock.calls[1]?.[1] as unknown[])[0]).toBe(9)
  })

  it('rotateRefreshToken issues a new token and revokes the old row', async () => {
    let calls = 0
    query.mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return {
          rows: [
            {
              id: 1,
              user_id: 9,
              expires_at: new Date(Date.now() + 100000),
              revoked_at: null,
              replaced_by: null,
            },
          ],
        }
      }
      if (calls === 2) return { rows: [{ id: 2 }] }
      return { rows: [] }
    })
    const res = await rotateRefreshToken('good')
    expect(res.userId).toBe(9)
    expect(typeof res.token).toBe('string')
    const updateSql = query.mock.calls[2]?.[0] as string
    expect(updateSql).toContain('replaced_by')
  })

  it('revokeAllForUser updates active tokens', async () => {
    query.mockImplementation(returning([]))
    await revokeAllForUser(3)
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('UPDATE refresh_tokens')
    expect((query.mock.calls[0]?.[1] as unknown[])[0]).toBe(3)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @oncall/api test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/token.service.ts apps/api/src/__tests__/token.service.test.ts
git commit -m "feat(api): refresh token service (issue/rotate/revoke)"
```

---

## T7 — auth.service

**Files:**
- Create: `apps/api/src/services/auth.service.ts`
- Test: `apps/api/src/__tests__/auth.service.test.ts`

**Interfaces:**
- Consumes: `query` from `db/client`; `bcrypt`; `signAccessToken` from `lib/jwt`; `token.service` (issue/rotate/revoke/revokeAll); shared types.
- Produces: `login(input): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }>` (401 invalid creds, 403 inactive); `refresh(token): Promise<same shape>`; `logout(token): Promise<void>`; `getUser(id): Promise<AuthUser>` (404); `changePassword(userId, input): Promise<AuthUser>` (401 wrong current, then re-hash + revoke all).

- [ ] **Step 1: Create `auth.service.ts`**

`apps/api/src/services/auth.service.ts`:
```ts
import bcrypt from 'bcrypt'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'
import { signAccessToken } from '../lib/jwt'
import type { AuthUser, ChangePasswordRequest, LoginRequest } from '@oncall/shared'
import * as tokenService from './token.service'

interface UserRow {
  id: number
  email: string
  password_hash: string
  role: 'administrator' | 'doctor'
  first_name: string
  last_name: string
  is_active: boolean
  created_at: Date
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
  }
}

const USER_COLUMNS = `id, email, password_hash, role, first_name, last_name, is_active, created_at`

async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const res = await query(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [email])
  return (res.rows as unknown as UserRow[])[0]
}

async function findUserById(id: number): Promise<UserRow | undefined> {
  const res = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id])
  return (res.rows as unknown as UserRow[])[0]
}

export async function login(
  input: LoginRequest,
): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const row = await findUserByEmail(input.email)
  if (!row) throw new HttpError(401, 'Invalid credentials')
  const ok = await bcrypt.compare(input.password, row.password_hash)
  if (!ok) throw new HttpError(401, 'Invalid credentials')
  if (!row.is_active) throw new HttpError(403, 'Account disabled')
  const accessToken = signAccessToken({ sub: row.id, role: row.role })
  const refreshToken = await tokenService.issueRefreshToken(row.id)
  return { user: toAuthUser(row), accessToken, refreshToken }
}

export async function refresh(
  oldToken: string,
): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const { token: newToken, userId } = await tokenService.rotateRefreshToken(oldToken)
  const row = await findUserById(userId)
  if (!row) throw new HttpError(401, 'Invalid refresh token')
  if (!row.is_active) throw new HttpError(403, 'Account disabled')
  const accessToken = signAccessToken({ sub: row.id, role: row.role })
  return { user: toAuthUser(row), accessToken, refreshToken: newToken }
}

export async function logout(token: string): Promise<void> {
  await tokenService.revokeRefreshToken(token)
}

export async function getUser(id: number): Promise<AuthUser> {
  const row = await findUserById(id)
  if (!row) throw new HttpError(404, 'User not found')
  return toAuthUser(row)
}

export async function changePassword(
  userId: number,
  input: ChangePasswordRequest,
): Promise<AuthUser> {
  const row = await findUserById(userId)
  if (!row) throw new HttpError(404, 'User not found')
  const ok = await bcrypt.compare(input.currentPassword, row.password_hash)
  if (!ok) throw new HttpError(401, 'Current password is incorrect')
  const newHash = await bcrypt.hash(input.newPassword, 12)
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    newHash,
    row.id,
  ])
  await tokenService.revokeAllForUser(userId)
  return toAuthUser(row)
}
```

- [ ] **Step 2: Write the failing test (db + deps mocked)**

`apps/api/src/__tests__/auth.service.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

vi.mock('../lib/jwt', () => ({ signAccessToken: vi.fn(() => 'ACCESS') }))

vi.mock('../services/token.service', () => ({
  issueRefreshToken: vi.fn(async () => 'REFRESH'),
  rotateRefreshToken: vi.fn(async () => ({ token: 'REFRESH2', userId: 1 })),
  revokeRefreshToken: vi.fn(async () => undefined),
  revokeAllForUser: vi.fn(async () => undefined),
}))

const compare = vi.fn(async () => true)
const hash = vi.fn(async () => 'NEWHASH')
vi.mock('bcrypt', () => ({ default: { compare: (...a: unknown[]) => compare(...a), hash: (...a: unknown[]) => hash(...a) } }))

import bcrypt from 'bcrypt'
import { changePassword, getUser, login, logout, refresh } from '../services/auth.service'

const SEED_HASH = '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi'

function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'admin@oncall.local',
    password_hash: SEED_HASH,
    role: 'administrator',
    first_name: 'System',
    last_name: 'Administrator',
    is_active: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
  compare.mockReset()
  hash.mockReset()
  compare.mockResolvedValue(true)
  hash.mockResolvedValue('NEWHASH')
})

describe('auth.service', () => {
  it('login returns tokens on valid credentials', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await login({ email: 'admin@oncall.local', password: 'changeme123' })
    expect(r.accessToken).toBe('ACCESS')
    expect(r.refreshToken).toBe('REFRESH')
    expect(r.user.email).toBe('admin@oncall.local')
    expect(bcrypt.compare).toHaveBeenCalledWith('changeme123', SEED_HASH)
  })

  it('login throws 401 when user not found', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(login({ email: 'x@y.z', password: 'whatever' })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('login throws 401 on wrong password', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    compare.mockResolvedValue(false)
    await expect(login({ email: 'admin@oncall.local', password: 'bad' })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('login throws 403 when inactive', async () => {
    query.mockResolvedValue({ rows: [userRow({ is_active: false })] })
    await expect(login({ email: 'admin@oncall.local', password: 'changeme123' })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('refresh returns a new access token from the rotated token', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await refresh('old')
    expect(r.accessToken).toBe('ACCESS')
    expect(r.refreshToken).toBe('REFRESH2')
  })

  it('logout revokes the token', async () => {
    await logout('t')
    expect(query).not.toHaveBeenCalled()
  })

  it('getUser throws 404 when missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getUser(99)).rejects.toMatchObject({ status: 404 })
  })

  it('changePassword re-hashes and revokes all tokens', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const u = await changePassword(1, { currentPassword: 'changeme123', newPassword: 'newpass123' })
    expect(u.id).toBe(1)
    expect(hash).toHaveBeenCalledWith('newpass123', 12)
    const updateSql = query.mock.calls.find((c) => String(c[0]).includes('UPDATE users'))
    expect(updateSql?.[1]).toEqual(['NEWHASH', 1])
  })

  it('changePassword throws 401 on wrong current password', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    compare.mockResolvedValue(false)
    await expect(
      changePassword(1, { currentPassword: 'wrong', newPassword: 'newpass123' }),
    ).rejects.toMatchObject({ status: 401 })
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @oncall/api test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/auth.service.ts apps/api/src/__tests__/auth.service.test.ts
git commit -m "feat(api): auth service (login/refresh/logout/changePassword)"
```

---

## T8 — user.service

**Files:**
- Create: `apps/api/src/services/user.service.ts`
- Test: `apps/api/src/__tests__/user.service.test.ts`

**Interfaces:**
- Consumes: `query` from `db/client`; `bcrypt`; shared types.
- Produces: `list(): Promise<User[]>`; `getById(id): Promise<User>` (404); `create(input: CreateUserRequest): Promise<User>` (409 duplicate email); `update(id, input: UpdateUserRequest): Promise<User>` (404; partial, no password field); `remove(id): Promise<void>` (404).

- [ ] **Step 1: Create `user.service.ts`**

`apps/api/src/services/user.service.ts`:
```ts
import bcrypt from 'bcrypt'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'
import type { CreateUserRequest, UpdateUserRequest, User } from '@oncall/shared'

interface UserRow {
  id: number
  email: string
  password_hash: string
  role: 'administrator' | 'doctor'
  first_name: string
  last_name: string
  is_active: boolean
  created_at: Date
}

const COLUMNS = `id, email, password_hash, role, first_name, last_name, is_active, created_at`

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  }
}

function oneRow(res: { rows: unknown[] }): UserRow | undefined {
  return (res.rows as unknown as UserRow[])[0]
}

export async function list(): Promise<User[]> {
  const res = await query(`SELECT ${COLUMNS} FROM users ORDER BY created_at`, [])
  return (res.rows as unknown as UserRow[]).map(toUser)
}

export async function getById(id: number): Promise<User> {
  const res = await query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id])
  const row = oneRow(res)
  if (!row) throw new HttpError(404, 'User not found')
  return toUser(row)
}

export async function create(input: CreateUserRequest): Promise<User> {
  const existing = await query(`SELECT id FROM users WHERE email = $1`, [input.email])
  if (existing.rows.length > 0) throw new HttpError(409, 'Email already in use')
  const passwordHash = await bcrypt.hash(input.password, 12)
  const res = await query(
    `INSERT INTO users (email, password_hash, role, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [input.email, passwordHash, input.role, input.firstName, input.lastName],
  )
  const row = oneRow(res)
  if (!row) throw new HttpError(500, 'Failed to create user')
  return toUser(row)
}

export async function update(id: number, input: UpdateUserRequest): Promise<User> {
  const sets: string[] = []
  const params: unknown[] = []
  const map: Array<[string, unknown]> = [
    ['email', input.email],
    ['role', input.role],
    ['first_name', input.firstName],
    ['last_name', input.lastName],
    ['is_active', input.isActive],
  ]
  for (const [col, value] of map) {
    if (value !== undefined) {
      params.push(value)
      sets.push(`${col} = $${params.length}`)
    }
  }
  if (sets.length === 0) return getById(id)
  params.push(new Date())
  sets.push(`updated_at = $${params.length}`)
  params.push(id)
  const res = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
    params,
  )
  const row = oneRow(res)
  if (!row) throw new HttpError(404, 'User not found')
  return toUser(row)
}

export async function remove(id: number): Promise<void> {
  const res = await query(`DELETE FROM users WHERE id = $1 RETURNING id`, [id])
  if (res.rows.length === 0) throw new HttpError(404, 'User not found')
}
```

- [ ] **Step 2: Write the failing test (db + bcrypt mocked)**

`apps/api/src/__tests__/user.service.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

const hash = vi.fn(async () => 'HASH')
vi.mock('bcrypt', () => ({ default: { hash: (...a: unknown[]) => hash(...a) } }))

import { create, list, remove, update } from '../services/user.service'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'd@h.com',
    password_hash: 'HASH',
    role: 'doctor',
    first_name: 'Jane',
    last_name: 'Roe',
    is_active: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
  hash.mockReset()
  hash.mockResolvedValue('HASH')
})

describe('user.service', () => {
  it('list maps rows to User', async () => {
    query.mockResolvedValue({ rows: [row(), row({ id: 2, email: 'x@y.z' })] })
    const users = await list()
    expect(users).toHaveLength(2)
    expect(users[0].firstName).toBe('Jane')
    expect(typeof users[0].createdAt).toBe('string')
  })

  it('create rejects duplicate email with 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      create({ email: 'd@h.com', password: 'secret1', role: 'doctor', firstName: 'J', lastName: 'R' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('create hashes the password and inserts', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const u = await create({
      email: 'd@h.com',
      password: 'secret1',
      role: 'doctor',
      firstName: 'Jane',
      lastName: 'Roe',
    })
    expect(hash).toHaveBeenCalledWith('secret1', 12)
    expect(u.email).toBe('d@h.com')
    const insertSql = query.mock.calls[1]?.[0] as string
    expect(insertSql).toContain('INSERT INTO users')
  })

  it('update builds a partial SET clause', async () => {
    query.mockResolvedValue({ rows: [row({ is_active: false })] })
    const u = await update(1, { isActive: false })
    expect(u.isActive).toBe(false)
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('is_active = $1')
    expect(sql).not.toContain('email')
  })

  it('remove throws 404 when nothing deleted', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99)).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @oncall/api test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/user.service.ts apps/api/src/__tests__/user.service.test.ts
git commit -m "feat(api): admin user service (CRUD + disable)"
```

---

## T9 — Auth controllers + routes + integration tests

**Files:**
- Create: `apps/api/src/controllers/auth.controller.ts`
- Create: `apps/api/src/routes/auth.routes.ts`
- Test: `apps/api/src/__tests__/auth.routes.test.ts`

**Interfaces:**
- Consumes: `auth.service`; `validate`/`authenticate` middleware; `asyncHandler`; `env` + `refreshExpiryMs()` for cookie options; shared schemas.
- Produces: `authRouter` mounted at `/auth` (T10). Cookie name `refresh_token`, path `/auth`, httpOnly, `SameSite=Lax`, `Secure=env.COOKIE_SECURE`, `Max-Age=refreshExpiryMs()`.

- [ ] **Step 1: Create `auth.controller.ts`**

`apps/api/src/controllers/auth.controller.ts`:
```ts
import type { CookieOptions, Request, Response } from 'express'
import { env } from '../config/env'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import * as authService from '../services/auth.service'
import { refreshExpiryMs } from '../services/token.service'

const COOKIE_NAME = 'refresh_token'

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN,
    path: '/auth',
    maxAge: refreshExpiryMs(),
  }
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, cookieOptions())
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions())
}

export const authController = {
  async login(req: Request, res: Response) {
    const { user, accessToken, refreshToken } = await authService.login(req.body)
    setRefreshCookie(res, refreshToken)
    res.status(200).json(ok({ user, accessToken }))
  },
  async refresh(req: Request, res: Response) {
    const token = req.cookies?.[COOKIE_NAME]
    if (!token) throw new HttpError(401, 'Invalid refresh token')
    const { user, accessToken, refreshToken } = await authService.refresh(token)
    setRefreshCookie(res, refreshToken)
    res.status(200).json(ok({ user, accessToken }))
  },
  async logout(req: Request, res: Response) {
    const token = req.cookies?.[COOKIE_NAME]
    if (token) await authService.logout(token)
    clearRefreshCookie(res)
    res.status(204).end()
  },
  async me(req: Request, res: Response) {
    if (!req.user) throw new HttpError(401, 'Unauthorized')
    const user = await authService.getUser(req.user.id)
    res.status(200).json(ok({ user }))
  },
  async changePassword(req: Request, res: Response) {
    if (!req.user) throw new HttpError(401, 'Unauthorized')
    const user = await authService.changePassword(req.user.id, req.body)
    res.status(200).json(ok({ user }))
  },
}
```

- [ ] **Step 2: Create `auth.routes.ts`**

`apps/api/src/routes/auth.routes.ts`:
```ts
import { Router } from 'express'
import { changePasswordSchema, loginSchema } from '@oncall/shared'
import { authController } from '../controllers/auth.controller'
import { asyncHandler } from '../lib/async-handler'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'

export const authRouter = Router()

authRouter.post('/login', validate(loginSchema, 'body'), asyncHandler(authController.login))
authRouter.post('/refresh', asyncHandler(authController.refresh))
authRouter.post('/logout', asyncHandler(authController.logout))
authRouter.get('/me', authenticate, asyncHandler(authController.me))
authRouter.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema, 'body'),
  asyncHandler(authController.changePassword),
)
```

- [ ] **Step 3: Write the failing integration test (db mocked at module level)**

`apps/api/src/__tests__/auth.routes.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

import bcrypt from 'bcrypt'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import express from 'express'
import { authRouter } from '../routes/auth.routes'
import { errorHandler } from '../middleware/error-handler'

const SEED_HASH = '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/auth', authRouter)
  app.use(errorHandler)
  return app
}

function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'admin@oncall.local',
    password_hash: SEED_HASH,
    role: 'administrator',
    first_name: 'System',
    last_name: 'Administrator',
    is_active: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('POST /auth/login', () => {
  it('returns 200, access token + Set-Cookie on success', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ email: 'admin@oncall.local', password: 'changeme123' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.user.email).toBe('admin@oncall.local')
    const setCookie = res.headers['set-cookie']?.[0] ?? ''
    expect(setCookie).toContain('refresh_token=')
    expect(setCookie.toLowerCase()).toContain('httponly')
  })

  it('returns 400 on invalid body', async () => {
    const res = await request(buildApp()).post('/auth/login').send({ email: 'x', password: '1' })
    expect(res.status).toBe(400)
  })

  it('returns 401 on wrong password (real bcrypt compare)', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ email: 'admin@oncall.local', password: 'wrongpass' })
    expect(res.status).toBe(401)
  })
})

describe('GET /auth/me', () => {
  it('returns 401 without a bearer token', async () => {
    const res = await request(buildApp()).get('/auth/me')
    expect(res.status).toBe(401)
  })
})

describe('bcrypt sanity', () => {
  it('the seed hash matches changeme123 at cost 12', async () => {
    await expect(bcrypt.compare('changeme123', SEED_HASH)).resolves.toBe(true)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (login integration uses real `bcrypt.compare`; the sanity test pins the seed hash).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/controllers/auth.controller.ts apps/api/src/routes/auth.routes.ts apps/api/src/__tests__/auth.routes.test.ts
git commit -m "feat(api): auth routes (login/refresh/logout/me/change-password)"
```

---

## T10 — User controllers + routes + app wiring + integration tests

**Files:**
- Create: `apps/api/src/controllers/user.controller.ts`
- Create: `apps/api/src/routes/user.routes.ts`
- Modify: `apps/api/src/app.ts` (cookie-parser, `cors({ credentials: true })`, mount `/auth` + `/users`)
- Create: `apps/api/src/__tests__/user.routes.test.ts`

**Interfaces:**
- Produces: `userRouter` mounted at `/users` behind `authenticate + authorize('administrator')`. `app` now wires cookie-parser + credentials + both auth routers. The full server is now auth-enabled.

- [ ] **Step 1: Create `user.controller.ts`**

`apps/api/src/controllers/user.controller.ts`:
```ts
import type { Request, Response } from 'express'
import { ok } from '../lib/envelope'
import * as userService from '../services/user.service'

export const userController = {
  async list(_req: Request, res: Response) {
    const users = await userService.list()
    res.status(200).json(ok({ users }))
  },
  async getById(req: Request, res: Response) {
    const user = await userService.getById(Number(req.params.id))
    res.status(200).json(ok({ user }))
  },
  async create(req: Request, res: Response) {
    const user = await userService.create(req.body)
    res.status(201).json(ok({ user }))
  },
  async update(req: Request, res: Response) {
    const user = await userService.update(Number(req.params.id), req.body)
    res.status(200).json(ok({ user }))
  },
  async remove(req: Request, res: Response) {
    await userService.remove(Number(req.params.id))
    res.status(204).end()
  },
}
```

- [ ] **Step 2: Create `user.routes.ts`**

`apps/api/src/routes/user.routes.ts`:
```ts
import { Router } from 'express'
import { z } from 'zod'
import { createUserSchema, updateUserSchema } from '@oncall/shared'
import { userController } from '../controllers/user.controller'
import { asyncHandler } from '../lib/async-handler'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'

export const userRouter = Router()

userRouter.use(authenticate, authorize('administrator'))

const idParams = z.object({ id: z.coerce.number().int().positive() })

userRouter.get('/', asyncHandler(userController.list))
userRouter.get('/:id', validate(idParams, 'params'), asyncHandler(userController.getById))
userRouter.post('/', validate(createUserSchema, 'body'), asyncHandler(userController.create))
userRouter.patch('/:id', validate(idParams, 'params'), validate(updateUserSchema, 'body'), asyncHandler(userController.update))
userRouter.delete('/:id', validate(idParams, 'params'), asyncHandler(userController.remove))
```

- [ ] **Step 3: Wire the app**

Replace `apps/api/src/app.ts` with:
```ts
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env'
import { errorHandler } from './middleware/error-handler'
import { notFound } from './middleware/not-found'
import { requestLogger } from './middleware/request-logger'
import { authRouter } from './routes/auth.routes'
import { healthRouter } from './routes/health.routes'
import { userRouter } from './routes/user.routes'

export const app = express()

app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use(requestLogger)

app.use('/health', healthRouter)
app.use('/auth', authRouter)
app.use('/users', userRouter)

app.use(notFound)
app.use(errorHandler)
```

- [ ] **Step 4: Write the failing integration test (db mocked)**

`apps/api/src/__tests__/user.routes.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

import request from 'supertest'
import { app } from '../app'
import { signAccessToken } from '../lib/jwt'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'd@h.com',
    password_hash: 'x',
    role: 'doctor',
    first_name: 'Jane',
    last_name: 'Roe',
    is_active: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('RBAC on /users', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/users')
    expect(res.status).toBe(401)
  })

  it('returns 403 for a doctor', async () => {
    const token = signAccessToken({ sub: 1, role: 'doctor' })
    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('returns 200 list for an administrator', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.users).toHaveLength(1)
  })
})

describe('POST /users (admin)', () => {
  it('returns 201 and creates a user', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row({ id: 5, email: 'new@h.com' })] })
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@h.com', password: 'secret1', role: 'doctor', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(201)
    expect(res.body.data.user.email).toBe('new@h.com')
  })

  it('returns 409 on duplicate email', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'd@h.com', password: 'secret1', role: 'doctor', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(409)
  })
})

describe('DELETE /users/:id (admin)', () => {
  it('returns 204 on success, 404 when missing', async () => {
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    const ok = await request(app).delete('/users/1').set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(204)

    query.mockResolvedValueOnce({ rows: [] })
    const notFound = await request(app).delete('/users/99').set('Authorization', `Bearer ${token}`)
    expect(notFound.status).toBe(404)
  })
})
```

- [ ] **Step 5: Run the full API test suite**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (health, error-handler, jwt/token, middleware, token.service, auth.service, user.service, auth.routes, user.routes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/controllers/user.controller.ts apps/api/src/routes/user.routes.ts apps/api/src/app.ts apps/api/src/__tests__/user.routes.test.ts
git commit -m "feat(api): user routes (admin CRUD) + wire cookie-parser, cors credentials, routers"
```

---

## T11 — Web http client expansion + zod dep

**Files:**
- Modify: `apps/web/package.json` (add `zod`)
- Modify: `apps/web/src/lib/http.ts`
- Test: `apps/web/src/__tests__/http.test.ts`

**Interfaces:**
- Produces: `apiGet`, `apiPost`, `apiPatch`, `apiDelete` (all send `credentials: 'include'`); `setAccessToken(token | null)`; `setRefreshHandler(fn | null)` (handler returns `Promise<string | null>`). The client injects `Authorization: Bearer <token>` when a token is set, and on a 401 from a non-`/auth/refresh` request calls the refresh handler once (deduped), then retries once.

- [ ] **Step 1: Add `zod` to the web app**

`apps/web/package.json` — add to `dependencies`:
```json
    "zod": "^3.23.0"
```

- [ ] **Step 2: Expand `lib/http.ts`**

Replace `apps/web/src/lib/http.ts` with:
```ts
const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let accessToken: string | null = null
export function setAccessToken(token: string | null): void {
  accessToken = token
}

type RefreshHandler = () => Promise<string | null>
let refreshHandler: RefreshHandler | null = null
export function setRefreshHandler(fn: RefreshHandler | null): void {
  refreshHandler = fn
}

interface Envelope {
  success?: boolean
  data?: unknown
  error?: string
}

async function parseEnvelope(res: Response): Promise<Envelope> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as Envelope
  } catch {
    return {}
  }
}

function isRefreshPath(path: string): boolean {
  return path.startsWith('/auth/refresh')
}

let refreshing: Promise<string | null> | null = null

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const send = (token: string | null): Promise<Response> =>
    fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  let res = await send(accessToken)

  if (res.status === 401 && !isRefreshPath(path) && refreshHandler) {
    const next = await (refreshing ??= refreshHandler().finally(() => (refreshing = null)))
    if (next) res = await send(next)
  }

  const json = await parseEnvelope(res)
  if (res.ok && json.success === true) return json.data as T
  throw new ApiError(json.error ?? 'Request failed', res.status)
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body)
}
export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, body)
}
export function apiDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path)
}
```

- [ ] **Step 3: Write the failing test (fetch mocked)**

`apps/web/src/__tests__/http.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  apiGet,
  apiPost,
  setAccessToken,
  setRefreshHandler,
} from '../lib/http'

function envelope(data: unknown, ok = true) {
  return { success: ok, data }
}

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  setAccessToken(null)
  setRefreshHandler(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('http client', () => {
  it('sends Authorization header when a token is set', async () => {
    const fetchMock = vi.fn(async () => jsonRes(envelope({ ok: 1 }), 200))
    vi.stubGlobal('fetch', fetchMock)
    setAccessToken('AAA')
    await apiGet('/x')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer AAA')
    expect(init.credentials).toBe('include')
  })

  it('does not retry on /auth/refresh 401 (no recursion)', async () => {
    const fetchMock = vi.fn(async () => jsonRes(envelope(undefined, false), 401))
    vi.stubGlobal('fetch', fetchMock)
    setRefreshHandler(async () => 'NEW')
    await expect(apiPost('/auth/refresh')).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('on a 401 for a normal path, calls refresh handler once and retries', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls++
      if (calls === 1) return jsonRes(envelope(undefined, false), 401)
      return jsonRes(envelope({ ok: 2 }), 200)
    })
    vi.stubGlobal('fetch', fetchMock)
    const refresh = vi.fn(async () => 'NEW')
    setRefreshHandler(refresh)
    const data = await apiGet('/users')
    expect(data).toEqual({ ok: 2 })
    expect(refresh).toHaveBeenCalledTimes(1)
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect((secondInit.headers as Record<string, string>).Authorization).toBe('Bearer NEW')
  })
})
```

- [ ] **Step 4: Install + run tests**

Run: `pnpm install`
Run: `pnpm --filter @oncall/web test`
Expected: PASS (new http tests + existing HomePage test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/http.ts apps/web/src/__tests__/http.test.ts
git commit -m "feat(web): http client with token injection and 401 refresh interceptor"
```

---

## T12 — Web auth store + services

**Files:**
- Create: `apps/web/src/services/auth.ts`
- Create: `apps/web/src/services/user.ts`
- Create: `apps/web/src/stores/auth.ts`
- Test: `apps/web/src/__tests__/auth.store.test.ts`

**Interfaces:**
- Consumes: `lib/http`; shared types.
- Produces: `useAuthStore` (state `user`, `accessToken`; getters `isAuthenticated`, `isAdmin`; actions `login`, `refresh`, `logout`, `fetchMe`, `changePassword`). The store registers itself as the http refresh handler on first use. `services/auth.ts` (`login/refresh/logout/fetchMe/changePassword`) and `services/user.ts` (`list/get/create/update/remove`).

- [ ] **Step 1: Create `services/auth.ts`**

`apps/web/src/services/auth.ts`:
```ts
import type { AuthUser, LoginResponse } from '@oncall/shared'
import { apiGet, apiPost, setAccessToken } from '@/lib/http'

export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/login', { email, password })
  setAccessToken(data.accessToken)
  return data
}

export async function refresh(): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/refresh')
  setAccessToken(data.accessToken)
  return data
}

export async function logout(): Promise<void> {
  await apiPost<void>('/auth/logout')
  setAccessToken(null)
}

export async function fetchMe(): Promise<AuthUser> {
  const { user } = await apiGet<{ user: AuthUser }>('/auth/me')
  return user
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
  const { user } = await apiPost<{ user: AuthUser }>('/auth/change-password', {
    currentPassword,
    newPassword,
  })
  return user
}
```

- [ ] **Step 2: Create `services/user.ts`**

`apps/web/src/services/user.ts`:
```ts
import type { CreateUserRequest, UpdateUserRequest, User } from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

export async function list(): Promise<User[]> {
  const { users } = await apiGet<{ users: User[] }>('/users')
  return users
}
export async function get(id: number): Promise<User> {
  const { user } = await apiGet<{ user: User }>(`/users/${id}`)
  return user
}
export async function create(input: CreateUserRequest): Promise<User> {
  const { user } = await apiPost<{ user: User }>('/users', input)
  return user
}
export async function update(id: number, input: UpdateUserRequest): Promise<User> {
  const { user } = await apiPatch<{ user: User }>(`/users/${id}`, input)
  return user
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/users/${id}`)
}
```

- [ ] **Step 3: Create `stores/auth.ts`**

`apps/web/src/stores/auth.ts`:
```ts
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthUser } from '@oncall/shared'
import { setRefreshHandler } from '@/lib/http'
import * as authService from '@/services/auth'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const accessToken = ref<string | null>(null)

  const isAuthenticated = computed(() => accessToken.value !== null)
  const isAdmin = computed(() => user.value?.role === 'administrator')

  async function login(email: string, password: string): Promise<void> {
    const data = await authService.login(email, password)
    user.value = data.user
    accessToken.value = data.accessToken
  }

  async function refresh(): Promise<string | null> {
    try {
      const data = await authService.refresh()
      user.value = data.user
      accessToken.value = data.accessToken
      return data.accessToken
    } catch {
      user.value = null
      accessToken.value = null
      return null
    }
  }

  async function logout(): Promise<void> {
    try {
      await authService.logout()
    } finally {
      user.value = null
      accessToken.value = null
    }
  }

  async function fetchMe(): Promise<void> {
    user.value = await authService.fetchMe()
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    user.value = await authService.changePassword(currentPassword, newPassword)
  }

  setRefreshHandler(refresh)

  return { user, accessToken, isAuthenticated, isAdmin, login, refresh, logout, fetchMe, changePassword }
})
```

- [ ] **Step 4: Write the failing test (services mocked)**

`apps/web/src/__tests__/auth.store.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/auth', () => ({
  login: vi.fn(async () => ({
    user: { id: 1, email: 'a@b.com', role: 'administrator', firstName: 'A', lastName: 'B' },
    accessToken: 'AAA',
  })),
  refresh: vi.fn(async () => ({
    user: { id: 1, email: 'a@b.com', role: 'doctor', firstName: 'A', lastName: 'B' },
    accessToken: 'BBB',
  })),
  logout: vi.fn(async () => undefined),
  fetchMe: vi.fn(async () => ({
    id: 1,
    email: 'a@b.com',
    role: 'doctor',
    firstName: 'A',
    lastName: 'B',
  })),
  changePassword: vi.fn(async () => ({
    id: 1,
    email: 'a@b.com',
    role: 'doctor',
    firstName: 'A',
    lastName: 'B',
  })),
}))

import { useAuthStore } from '../stores/auth'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())

describe('auth store', () => {
  it('login sets user + token and reports authenticated', async () => {
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(false)
    await auth.login('a@b.com', 'secret1')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isAdmin).toBe(true)
    expect(auth.accessToken).toBe('AAA')
  })

  it('refresh failure clears auth and resolves null', async () => {
    const auth = useAuthStore()
    const { refresh } = await import('@/services/auth')
    vi.mocked(refresh).mockRejectedValueOnce(new Error('boom'))
    const token = await auth.refresh()
    expect(token).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
  })

  it('logout clears auth even if the service throws', async () => {
    const auth = useAuthStore()
    await auth.login('a@b.com', 'secret1')
    const { logout } = await import('@/services/auth')
    vi.mocked(logout).mockRejectedValueOnce(new Error('net'))
    await auth.logout()
    expect(auth.isAuthenticated).toBe(false)
  })
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @oncall/web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services/auth.ts apps/web/src/services/user.ts apps/web/src/stores/auth.ts apps/web/src/__tests__/auth.store.test.ts
git commit -m "feat(web): auth store and auth/user services"
```

---

## T13 — Web router + guards + main.ts rehydration

**Files:**
- Create: `apps/web/src/router/guard.ts`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/main.ts`
- Test: `apps/web/src/__tests__/guard.test.ts`

**Interfaces:**
- Produces: pure predicate `resolveGuard(to, auth)` in `router/guard.ts` returning `true` to allow, or a `RouteLocationRaw` redirect; route meta `{ public?: boolean; roles?: Role[] }`; `beforeEach` calls the predicate; `main.ts` silently calls `useAuthStore().refresh()` before mount. Routes: `/login` (public, bare), `/` (home), `/profile`, `/users` (admin).

- [ ] **Step 1: Create the pure guard predicate**

`apps/web/src/router/guard.ts`:
```ts
import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'
import type { Role } from '@oncall/shared'

export interface GuardAuth {
  isAuthenticated: boolean
  user: { role: Role } | null
}

export function resolveGuard(
  to: RouteLocationNormalized,
  auth: GuardAuth,
): true | RouteLocationRaw {
  if (to.meta.public) return true
  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  const roles = to.meta.roles
  if (roles && (auth.user === null || !roles.includes(auth.user.role))) {
    return { name: 'home' }
  }
  return true
}
```

- [ ] **Step 2: Replace `router/index.ts` to use the predicate**

`apps/web/src/router/index.ts`:
```ts
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import type { Role } from '@oncall/shared'
import { useAuthStore } from '@/stores/auth'
import { resolveGuard } from './guard'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    roles?: Role[]
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../pages/LoginPage.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('../layouts/DefaultLayout.vue'),
    children: [
      { path: '', name: 'home', component: () => import('../pages/HomePage.vue') },
      { path: 'profile', name: 'profile', component: () => import('../pages/ProfilePage.vue') },
      {
        path: 'users',
        name: 'users',
        component: () => import('../pages/UsersPage.vue'),
        meta: { roles: ['administrator'] },
      },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => resolveGuard(to, useAuthStore()))
```

> **Note:** `LoginPage.vue`, `ProfilePage.vue`, `UsersPage.vue` are created in T14/T15. Until then, typecheck for the router will pass (lazy imports resolve to dynamic specs); the pages must exist before running the app. Execute T14/T15 after this task.

- [ ] **Step 3: Replace `main.ts` with boot rehydration**

`apps/web/src/main.ts`:
```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import './style.css'

async function bootstrap(): Promise<void> {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(router)
  await useAuthStore().refresh().catch(() => undefined)
  app.mount('#app')
}

bootstrap()
```

- [ ] **Step 4: Write the failing test for the guard predicate**

`apps/web/src/__tests__/guard.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'
import { resolveGuard, type GuardAuth } from '../router/guard'

function to(fullPath: string, meta: Partial<RouteLocationNormalized['meta']> = {}): RouteLocationNormalized {
  return {
    fullPath,
    path: fullPath,
    meta,
  } as RouteLocationNormalized
}

const authed = (role: 'administrator' | 'doctor'): GuardAuth => ({
  isAuthenticated: true,
  user: { role },
})

describe('resolveGuard', () => {
  it('allows public routes regardless of auth', () => {
    expect(resolveGuard(to('/login', { public: true }), { isAuthenticated: false, user: null })).toBe(true)
  })

  it('redirects unauthenticated users to /login with redirect query', () => {
    const res = resolveGuard(to('/users'), { isAuthenticated: false, user: null })
    expect(res).not.toBe(true)
    expect(res).toEqual({ name: 'login', query: { redirect: '/users' } })
  })

  it('allows an administrator on a role-gated route', () => {
    expect(resolveGuard(to('/users', { roles: ['administrator'] }), authed('administrator'))).toBe(true)
  })

  it('redirects a doctor away from an admin-only route to home', () => {
    const res = resolveGuard(to('/users', { roles: ['administrator'] }), authed('doctor'))
    expect(res).toEqual({ name: 'home' })
  })

  it('allows any authenticated user on an open route', () => {
    expect(resolveGuard(to('/profile'), authed('doctor'))).toBe(true)
  })
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @oncall/web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/router/guard.ts apps/web/src/router/index.ts apps/web/src/main.ts apps/web/src/__tests__/guard.test.ts
git commit -m "feat(web): auth-aware router guard and silent boot rehydration"
```

---

## T14 — Web LoginPage + Label + ProfilePage

**Files:**
- Create: `apps/web/src/components/ui/Label.vue`
- Create: `apps/web/src/pages/LoginPage.vue`
- Create: `apps/web/src/pages/ProfilePage.vue`
- Test: `apps/web/src/__tests__/LoginPage.test.ts`

**Interfaces:**
- Consumes: `useAuthStore`; shared `loginSchema`/`changePasswordSchema`; `Button`, `Card*`, `Input`; `ApiError`.
- Produces: `/login` (email/password, client-validated, redirects to `?redirect` or `/` on success), `/profile` (change-password form).

- [ ] **Step 1: Create `Label.vue`**

`apps/web/src/components/ui/Label.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  for?: string
}>()
</script>

<template>
  <label :for="props.for" :class="cn('text-sm font-medium text-foreground', props.class)">
    <slot />
  </label>
</template>
```

- [ ] **Step 2: Create `LoginPage.vue`**

`apps/web/src/pages/LoginPage.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loginSchema } from '@oncall/shared'
import { ApiError } from '@/lib/http'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'

const email = ref('')
const password = ref('')
const formError = ref('')
const submitting = ref(false)

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

async function onSubmit() {
  formError.value = ''
  const parsed = loginSchema.safeParse({ email: email.value, password: password.value })
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  submitting.value = true
  try {
    await auth.login(parsed.data.email, parsed.data.password)
    const redirect = (route.query.redirect as string) || '/'
    await router.push(redirect)
  } catch (e) {
    formError.value = e instanceof ApiError ? e.message : 'Login failed'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>On-Call Duty staff login</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
          <div class="flex flex-col gap-2">
            <Label for="email">Email</Label>
            <Input id="email" v-model="email" type="email" autocomplete="username" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="password">Password</Label>
            <Input id="password" v-model="password" type="password" autocomplete="current-password" />
          </div>
          <p v-if="formError" class="text-sm text-destructive" role="alert">{{ formError }}</p>
          <Button type="submit" :disabled="submitting">Sign in</Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
```

- [ ] **Step 3: Create `ProfilePage.vue`**

`apps/web/src/pages/ProfilePage.vue`:
```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { changePasswordSchema } from '@oncall/shared'
import { ApiError } from '@/lib/http'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'

const currentPassword = ref('')
const newPassword = ref('')
const formError = ref('')
const success = ref(false)
const submitting = ref(false)

const auth = useAuthStore()
const heading = computed(() =>
  auth.user ? `${auth.user.firstName} ${auth.user.lastName}` : 'Profile',
)

async function onSubmit() {
  formError.value = ''
  success.value = false
  const parsed = changePasswordSchema.safeParse({
    currentPassword: currentPassword.value,
    newPassword: newPassword.value,
  })
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  submitting.value = true
  try {
    await auth.changePassword(parsed.data.currentPassword, parsed.data.newPassword)
    success.value = true
    currentPassword.value = ''
    newPassword.value = ''
  } catch (e) {
    formError.value = e instanceof ApiError ? e.message : 'Could not change password'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-md">
    <Card>
      <CardHeader>
        <CardTitle>{{ heading }}</CardTitle>
        <CardDescription>Change your password. You will be signed out of other sessions.</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
          <div class="flex flex-col gap-2">
            <Label for="current">Current password</Label>
            <Input id="current" v-model="currentPassword" type="password" autocomplete="current-password" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="new">New password</Label>
            <Input id="new" v-model="newPassword" type="password" autocomplete="new-password" />
          </div>
          <p v-if="formError" class="text-sm text-destructive" role="alert">{{ formError }}</p>
          <p v-if="success" class="text-sm text-accent-foreground">Password updated.</p>
          <Button type="submit" :disabled="submitting">Update password</Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
```

- [ ] **Step 4: Write the failing test**

`apps/web/src/__tests__/LoginPage.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'

const login = vi.fn()
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isAdmin: false,
    login,
    refresh: vi.fn(),
    logout: vi.fn(),
    fetchMe: vi.fn(),
    changePassword: vi.fn(),
  }),
}))

function mountWithRouter(currentPath = '/login') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/login', name: 'login', component: LoginPage },
    ],
  })
  router.push(currentPath)
  return mount(LoginPage, { global: { plugins: [createPinia(), router] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  login.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('LoginPage', () => {
  it('shows a validation error when the password is too short', async () => {
    login.mockResolvedValue(undefined)
    const wrapper = mountWithRouter()
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('a@b.com')
    await inputs[1]!.setValue('123')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()
    expect(login).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Sign in succeeded')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('calls the store and shows a server error on failure', async () => {
    const { ApiError } = await import('@/lib/http')
    login.mockRejectedValue(new ApiError('Invalid credentials', 401))
    const wrapper = mountWithRouter()
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('a@b.com')
    await inputs[1]!.setValue('secret1')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(login).toHaveBeenCalledWith('a@b.com', 'secret1')
    expect(wrapper.find('[role="alert"]').text()).toContain('Invalid credentials')
  })
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @oncall/web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/Label.vue apps/web/src/pages/LoginPage.vue apps/web/src/pages/ProfilePage.vue apps/web/src/__tests__/LoginPage.test.ts
git commit -m "feat(web): login page, change-password page, Label component"
```

---

## T15 — Web UsersPage + Table + Dialog + AppHeader

**Files:**
- Create: `apps/web/src/components/ui/Table.vue`, `TableHeader.vue`, `TableBody.vue`, `TableRow.vue`, `TableHead.vue`, `TableCell.vue`
- Create: `apps/web/src/components/ui/Dialog.vue`
- Create: `apps/web/src/pages/UsersPage.vue`
- Modify: `apps/web/src/components/layout/AppHeader.vue` (nav + user/role + logout)
- Test: `apps/web/src/__tests__/UsersPage.test.ts`

**Interfaces:**
- Consumes: `services/user`; `useAuthStore`; `Button`, `Input`, `Label`, `Table*`, `Dialog`; shared `createUserSchema`/`updateUserSchema`/`Role`/`User`.
- Produces: admin `/users` page (list, create via dialog, edit via dialog, disable/enable, delete). AppHeader shows nav (Home, Users for admins, Profile), the signed-in user, and a Logout action.

- [ ] **Step 1: Create the Table sub-components**

`apps/web/src/components/ui/Table.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <div class="w-full overflow-x-auto">
    <table :class="cn('w-full caption-bottom text-sm', props.class)"><slot /></table>
  </div>
</template>
```

`apps/web/src/components/ui/TableHeader.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <thead :class="cn('[&_tr]:border-b', props.class)"><slot /></thead>
</template>
```

`apps/web/src/components/ui/TableBody.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <tbody :class="cn('[&_tr:last-child]:border-0', props.class)"><slot /></tbody>
</template>
```

`apps/web/src/components/ui/TableRow.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <tr :class="cn('border-b transition-colors hover:bg-muted/50', props.class)"><slot /></tr>
</template>
```

`apps/web/src/components/ui/TableHead.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <th :class="cn('h-10 px-3 text-left font-medium text-muted-foreground', props.class)"><slot /></th>
</template>
```

`apps/web/src/components/ui/TableCell.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <td :class="cn('p-3 align-middle', props.class)"><slot /></td>
</template>
```

- [ ] **Step 2: Create `Dialog.vue` (hand-rolled, teleport + Esc + click-outside)**

`apps/web/src/components/ui/Dialog.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import Button from './Button.vue'

const props = defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const panel = ref<HTMLElement | null>(null)

function close() {
  if (props.open) emit('update:open', false)
}

onClickOutside(panel, close)
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (props.open && e.key === 'Escape') close()
})

watch(
  () => props.open,
  (v) => {
    if (v) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="close" />
      <div ref="panel" class="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
        <h2 v-if="title" class="mb-4 text-lg font-semibold text-foreground">{{ title }}</h2>
        <slot />
        <div class="mt-6 flex justify-end gap-2">
          <slot name="footer">
            <Button variant="outline" @click="close">Close</Button>
          </slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 3: Create `UsersPage.vue`**

`apps/web/src/pages/UsersPage.vue`:
```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CreateUserRequest, UpdateUserRequest, User } from '@oncall/shared'
import { createUserSchema, updateUserSchema } from '@oncall/shared'
import * as userService from '@/services/user'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const users = ref<User[]>([])
const loading = ref(false)
const errorMsg = ref('')

interface EditState {
  open: boolean
  id: number | null
  email: string
  firstName: string
  lastName: string
  role: 'administrator' | 'doctor'
  isActive: boolean
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  email: '',
  firstName: '',
  lastName: '',
  role: 'doctor',
  isActive: true,
})
const edit = ref<EditState>(emptyEdit())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    users.value = await userService.list()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load users'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

function openUpdate(u: User) {
  edit.value = {
    open: true,
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    isActive: u.isActive,
  }
}

async function save() {
  errorMsg.value = ''
  if (edit.value.id === null) {
    const payload: CreateUserRequest = {
      email: edit.value.email,
      password: edit.value.email,
      role: edit.value.role,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
    }
    const r = createUserSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await userService.create(r.data)
  } else {
    const payload: UpdateUserRequest = {
      email: edit.value.email,
      role: edit.value.role,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      isActive: edit.value.isActive,
    }
    const r = updateUserSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await userService.update(edit.value.id, r.data)
  }
  edit.value = emptyEdit()
  await load()
}

async function toggleActive(u: User) {
  await userService.update(u.id, { isActive: !u.isActive })
  await load()
}

async function remove(u: User) {
  if (!confirm(`Delete ${u.email}?`)) return
  await userService.remove(u.id)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Users</h1>
      <Button @click="openCreate">New user</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="u in users" :key="u.id">
          <TableCell>{{ u.firstName }} {{ u.lastName }}</TableCell>
          <TableCell>{{ u.email }}</TableCell>
          <TableCell>{{ u.role }}</TableCell>
          <TableCell>{{ u.isActive ? 'active' : 'disabled' }}</TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(u)">Edit</Button>
              <Button size="sm" variant="outline" @click="toggleActive(u)">
                {{ u.isActive ? 'Disable' : 'Enable' }}
              </Button>
              <Button size="sm" variant="destructive" @click="remove(u)">Delete</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New user' : 'Edit user'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="e-email">Email</Label>
          <Input id="e-email" v-model="edit.email" type="email" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-first">First name</Label>
          <Input id="e-first" v-model="edit.firstName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-last">Last name</Label>
          <Input id="e-last" v-model="edit.lastName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-role">Role</Label>
          <select
            id="e-role"
            v-model="edit.role"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="doctor">doctor</option>
            <option value="administrator">administrator</option>
          </select>
        </div>
        <p v-if="edit.id === null" class="text-xs text-muted-foreground">
          Initial password equals the email. The user should change it on first login.
        </p>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
```

- [ ] **Step 4: Extend `AppHeader.vue` with nav + user/role + logout**

`apps/web/src/components/layout/AppHeader.vue`:
```vue
<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { LogOut, Stethoscope } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ui/Button.vue'

const auth = useAuthStore()
const router = useRouter()

async function onLogout() {
  await auth.logout()
  await router.push('/login')
}
</script>

<template>
  <header class="sticky top-0 z-40 w-full border-b border-border bg-background">
    <div class="container mx-auto flex h-16 items-center gap-6 px-6">
      <div class="flex items-center gap-2">
        <Stethoscope class="h-6 w-6 text-primary" />
        <span class="text-lg font-semibold text-primary">On-Call Duty</span>
      </div>
      <nav v-if="auth.isAuthenticated" class="flex items-center gap-4 text-sm">
        <RouterLink class="text-muted-foreground hover:text-foreground" to="/">Home</RouterLink>
        <RouterLink v-if="auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/users">Users</RouterLink>
        <RouterLink class="text-muted-foreground hover:text-foreground" to="/profile">Profile</RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-3">
        <template v-if="auth.user">
          <span class="text-sm text-muted-foreground">
            {{ auth.user.firstName }} {{ auth.user.lastName }} · {{ auth.user.role }}
          </span>
          <Button size="sm" variant="outline" @click="onLogout">
            <LogOut class="h-4 w-4" /> Logout
          </Button>
        </template>
      </div>
    </div>
  </header>
</template>
```

- [ ] **Step 5: Write the failing test**

`apps/web/src/__tests__/UsersPage.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()

vi.mock('@/services/user', () => ({
  list: (...a: unknown[]) => list(...a),
  get: vi.fn(),
  create: (...a: unknown[]) => create(...a),
  update: (...a: unknown[]) => update(...a),
  remove: (...a: unknown[]) => remove(...a),
}))

import UsersPage from '../pages/UsersPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  create.mockReset()
  update.mockReset()
  remove.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('UsersPage', () => {
  it('renders the user list on mount', async () => {
    list.mockResolvedValue([
      {
        id: 1,
        email: 'a@b.com',
        role: 'doctor',
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('a@b.com')
    expect(wrapper.text()).toContain('Jane')
  })

  it('shows an error message when listing fails', async () => {
    list.mockRejectedValue(new Error('nope'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @oncall/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/Table.vue apps/web/src/components/ui/TableHeader.vue apps/web/src/components/ui/TableBody.vue apps/web/src/components/ui/TableRow.vue apps/web/src/components/ui/TableHead.vue apps/web/src/components/ui/TableCell.vue apps/web/src/components/ui/Dialog.vue apps/web/src/pages/UsersPage.vue apps/web/src/components/layout/AppHeader.vue apps/web/src/__tests__/UsersPage.test.ts
git commit -m "feat(web): admin users page, Table + Dialog components, header nav/logout"
```

---

## T16 — README Phase 2 + full verification gate

**Files:**
- Modify: `README.md` (Phase 2 status, default admin creds, new env vars, setup/first-login notes)

- [ ] **Step 1: Update README content**

In `README.md`:
- Change the **Status** section so Phase 2 (Auth & Authorization) is complete; keep the roadmap marking Phase 2 done.
- In the **Environment variables** table, add:

| `JWT_ACCESS_SECRET` | `apps/api/.env` | Access-token signing secret. Required in production; dev default in `.env.example`. |
| `JWT_ACCESS_EXPIRES_IN` | `apps/api/.env` | Access-token lifetime (default `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | `apps/api/.env` | Refresh-token lifetime (default `7d`) |
| `COOKIE_SECURE` | `apps/api/.env` | Refresh-cookie `Secure` flag (default true in production, false in dev) |
| `COOKIE_SAMESITE` | `apps/api/.env` | Refresh-cookie `SameSite` (default `lax`) |
| `COOKIE_DOMAIN` | `apps/api/.env` | Optional refresh-cookie domain |

- Add a **Default administrator** subsection (under Quickstart or Auth):

```
### Default administrator

`pnpm db:setup` seeds one administrator:

- Email: `admin@oncall.local`
- Password: `changeme123`

This default password is documented and MUST be changed on first login
(Profile → Change password). The seeded bcrypt hash (cost 12) lives in
`database/seed.sql`; the plaintext exists only in documentation.
```

- Add a **Definition of Done (Phase 2)** section mirroring spec §8.3 (login, refresh rotation, logout, me/change-password, admin CRUD, RBAC 403, in-memory token, typecheck/lint/test).

- [ ] **Step 2: Full verification gate (run centrally)**

From the repo root, run each and confirm success:
```bash
pnpm install
pnpm db:setup
pnpm typecheck
pnpm lint
pnpm test
```

Then a manual end-to-end smoke (two terminals):
1. `pnpm dev` — API on `:3000`, web on `:5174`.
2. Browser → `http://localhost:5174/login` → sign in as `admin@oncall.local` / `changeme123` → land on Home; the header shows the admin name/role; navigate to `/users` (admin) and `/profile`.
3. Reload the page while signed in → session is restored (silent refresh via the httpOnly cookie); the access token is never present in `localStorage`/`sessionStorage` (DevTools → Application → Storage must be empty of tokens).
4. Logout → returns to `/login`; the `refresh_token` cookie is cleared.

Expected: all steps green; no token in browser storage.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Phase 2 auth setup, default admin, env vars, definition of done"
```

---

## Spec coverage map (self-review)

Every spec section maps to at least one task:

- §3 Architecture & layering → T3 (error/async), T6–T10 (services/controllers/routes), T10 (`app.ts` wiring). Layering is enforced in every backend task.
- §3.1 middleware order → T10 (`app.ts`: helmet → cors(credentials) → cookieParser → json → requestLogger → routers → notFound → errorHandler).
- §3.2 end-to-end auth flow → T7 (login/refresh/logout/changePassword), T9 (routes/cookies), T11 (401 interceptor + rotation), T13 (boot rehydration), T15 (logout UI).
- §4 DB schema + §4.1 seed → T2 (tables, indexes, seeded admin with embedded cost-12 hash).
- §5 shared types & schemas → T1 (all 9 types + 5 zod schemas + zod dep).
- §6.1 backend deps → T3 (bcrypt, jsonwebtoken, cookie-parser + types; `@oncall/shared` zod in T1; web zod in T11).
- §6.2 env vars → T3 (`config/env.ts` + `.env.example` + vitest test env).
- §6.3 lib → T3 (`http-error`, `async-handler`), T4 (`jwt`, `token`).
- §6.4 services → T6 (token.service), T7 (auth.service), T8 (user.service).
- §6.5 middleware → T5 (validate/authenticate/authorize + `req.user` augmentation).
- §6.6 error handler → T3 (ZodError→400, HttpError.status).
- §6.7 routes table → T9 (auth routes), T10 (user routes + status mapping).
- §7 frontend → T11 (http), T12 (store + services), T13 (router + rehydration), T14 (Login/Profile + Label), T15 (Users + Table + Dialog + AppHeader).
- §7.6 boot rehydration → T13 (`main.ts` awaits silent `refresh()`).
- §8.1 security → in-memory token (T11/T12, no persistence), httpOnly cookie (T9), rotation + reuse defense (T6), bcrypt cost 12 (T2/T7/T8), inactive rejection (T7), CORS credentials (T10).
- §8.2 testing → unit (T6/T7/T8 services, T4 lib), integration (T9/T10 routes with db mocked), web (T11 http, T12 store, T13 guard, T14 login, T15 users).
- §8.3 DoD → T16 verification gate mirrors it item-for-item.
- §9 out of scope → untouched.

## Plan self-review (fresh-eyes pass)

- **Placeholder scan:** none. Every code step contains the actual file content; the seed hash and test bcrypt hashes are real, precomputed values. No "TODO"/"TBD".
- **Type consistency:** `signAccessToken({ sub, role })` ↔ `verifyAccessToken(): JwtAccessPayload` ↔ `authenticate` sets `req.user = { id: payload.sub, role: payload.role }` (T4 ↔ T5). `rotateRefreshToken` returns `{ token, userId }` consumed by `auth.service.refresh` (T6 ↔ T7). `setRefreshHandler` / `setAccessToken` names match between `lib/http.ts`, `services/auth.ts`, and `stores/auth.ts` (T11 ↔ T12). `resolveGuard` signature matches its test (T13). `usersController.getById` etc. match `user.service` exports (T10 ↔ T8).
- **Consistency of deviations:** the 5 simplifications in "Architecture notes" are each reflected in the tasks (no `validators/` folder; `asyncHandler` in T3; row casts in T6–T8; reuse = revoke-all-user in T6; `express-serve-static-core` augmentation in T5).
- **One known soft spot, surfaced honestly:** T8 `user.service.update` builds the SET clause in camelCase→snake_case map order; the unit test only exercises `isActive`. An executor may add more cases — that is test depth, not a plan gap. The behavior itself (partial update, no password field, 404 when missing) is fully specified.
- **Scope:** cohesive single phase; no spec section unowned; task boundaries each carry an independent test cycle.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-06-phase2-auth-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan's size and the parallelism in the dependency graph.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
