# Phase 2 — Auth & Authorization Design

**Project:** Doctor On-Call Duty Scheduling System
**Phase:** 2 of 8 (Auth & Authorization)
**Status:** Approved (2026-08-06)
**Scope owner:** backend `apps/api`, frontend `apps/web`, shared `packages/shared`, `database/`
**Builds on:** Phase 1 — Foundation (complete)

---

## 1. Purpose

Deliver healthcare-grade authentication and role-based authorization for a single-hospital system. Phase 2 introduces: password-based login with bcrypt, short-lived access tokens kept in memory, DB-backed httpOnly-cookie refresh tokens with rotation, RBAC middleware, an admin-only user-management surface, a Vue auth store with route guards, and a login UI. Doctor *profile* data (specialty, contact, duty limits) is explicitly deferred to Phase 3 — Phase 2 manages only the authentication account.

The full system is decomposed into eight phases. This phase delivers items 2 of 8.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Scope | Auth core + admin-only user management. First admin seeded. Doctor profile → Phase 3 |
| Access token | JWT, short-lived (default 15m), returned in JSON body, kept **in memory only** (Pinia) — never persisted to storage |
| Refresh token | Opaque random token (not a JWT); sha256-hashed in DB; delivered as `httpOnly + Secure + SameSite=Lax` cookie; **rotated** on every refresh; revocable |
| Account creation | Admin-only via protected API; first administrator seeded in `seed.sql` with a documented default password to change on first login |
| Password policy | Minimum 6 characters, no complexity rules, bcrypt cost factor 12. Min length lives in the shared zod schema (one place) so it can be tightened later |
| Password change | Authenticated `POST /auth/change-password`; on success revokes **all** of the user's refresh tokens |
| Layering | Introduces the mandated **Controllers → Services → Database** layering for all business routes (Phase 1's inline health route remains) |
| Naming | DB columns snake_case; API/TS contract camelCase; service layer maps between them |
| CSRF | SameSite=Lax on the refresh cookie blocks cross-site forged POSTs; only `/auth/refresh` and `/auth/logout` accept the cookie. No extra CSRF-token layer |

## 3. Architecture & Layering

Phase 2 establishes the backend layering every later phase copies.

```
apps/api/src/
├── config/env.ts              # +JWT_* and COOKIE_* vars
├── db/client.ts               # exists (pool + query)
├── lib/
│   ├── envelope.ts            # exists (ok/fail)
│   ├── http-error.ts          # NEW: typed HttpError with .status
│   ├── jwt.ts                 # NEW: sign/verify access JWT
│   └── token.ts               # NEW: opaque refresh token gen + sha256 hash
├── middleware/
│   ├── error-handler.ts       # extend: map ZodError -> 400, respect HttpError.status
│   ├── not-found.ts           # exists
│   ├── request-logger.ts      # exists
│   ├── authenticate.ts        # NEW: verify access JWT, attach req.user
│   ├── authorize.ts           # NEW: RBAC gate authorize(...roles)
│   └── validate.ts            # NEW: zod schema -> body/params validator
├── controllers/
│   ├── auth.controller.ts     # login, refresh, logout, me, change-password
│   └── user.controller.ts     # admin user CRUD
├── services/
│   ├── auth.service.ts        # login/refresh/logout/rotate, bcrypt compare
│   ├── user.service.ts        # create/list/get/update/delete + disable
│   └── token.service.ts       # refresh-token DB ops (issue/rotate/revoke/revokeAll)
├── routes/
│   ├── health.routes.ts       # exists
│   ├── auth.routes.ts         # NEW: /auth/*
│   └── user.routes.ts         # NEW: /users/* (admin)
├── validators/                # NEW: re-export @oncall/shared schemas, map to requests
├── app.ts                     # wire cookie-parser + auth/user routers
└── server.ts                  # exists
```

### 3.1 `app.ts` middleware order (updated)

`helmet` → `cors({ origin: env.CORS_ORIGIN, credentials: true })` → `cookie-parser` → `express.json({ limit: '1mb' })` → `requestLogger` → `/health`, `/auth`, (`/users` behind `authenticate` + `authorize('administrator')`) → `notFound` → `errorHandler`.

### 3.2 End-to-end auth flow

1. **Login** `POST /auth/login {email,password}` → service verifies bcrypt, issues access JWT (JSON body) + refresh token (hashed) written to DB and set as httpOnly cookie. Body: `{ user, accessToken }`.
2. **SPA** stores `accessToken` + `user` in Pinia (memory only), never localStorage.
3. **App reload** → access token is gone → `http.ts` interceptor, on 401, calls `POST /auth/refresh` (cookie sent automatically) → new access token in body, refresh token rotated (old row revoked, new cookie set). Retries the original request once.
4. **Authenticated requests** carry `Authorization: Bearer <accessToken>` (injected by `http.ts`).
5. **Logout** `POST /auth/logout` → revokes the refresh-token row, clears the cookie.
6. **Change password** `POST /auth/change-password` → re-hash, revoke all the user's refresh tokens.

## 4. Database Schema

Appended to `database/schema.sql` (idempotent, `CREATE TABLE IF NOT EXISTS`). No triggers/functions are used — this keeps the `;`-splitting DB runner safe.

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

Design points:
- `password_hash` is bcrypt; never selected into API responses.
- `is_active = FALSE` = disabled; login refuses inactive users.
- Refresh tokens stored as **sha256 hashes** (a DB leak yields no usable tokens). Rotation = revoke old row (`revoked_at` set), insert new, link via `replaced_by`. `ON DELETE CASCADE` on `user_id` cleans up on user delete.
- `updated_at` maintained by the service layer (no trigger), preserving runner compatibility.

### 4.1 Seed (`database/seed.sql`)

One administrator with a documented default password. `seed.sql` cannot run bcrypt, so the hash is generated offline (node REPL / one-off script) and embedded literally. The README documents the plaintext default and "change immediately on first login."

## 5. Shared Types & Schemas (`@oncall/shared`)

`@oncall/shared` becomes the single source of truth for the auth contract — **types AND zod schemas**. This adds `zod` as a dependency of `@oncall/shared`, and `apps/web` gains `zod` (for form validation that mirrors the API).

```
packages/shared/src/
├── types/
│   ├── envelope.ts        # exists
│   ├── auth.ts            # expanded
│   └── index.ts
├── schemas/
│   ├── auth.ts            # NEW — zod schemas
│   └── index.ts
└── index.ts
```

**`types/auth.ts`** (camelCase API contract):
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

export interface LoginRequest { email: string; password: string }
export interface LoginResponse { user: AuthUser; accessToken: string }
export interface RefreshResponse { user: AuthUser; accessToken: string }
export interface ChangePasswordRequest { currentPassword: string; newPassword: string }
export interface CreateUserRequest { email: string; password: string; role: Role; firstName: string; lastName: string }
export interface UpdateUserRequest { email?: string; role?: Role; firstName?: string; lastName?: string; isActive?: boolean }
```

**`schemas/auth.ts`** (reused by API `validate` middleware AND web forms):
```ts
export const roleSchema           = z.enum(['administrator', 'doctor'])
export const loginSchema          = z.object({ email: z.string().email(), password: z.string().min(6) })
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword:     z.string().min(6),
}).refine(d => d.newPassword !== d.currentPassword, { message: 'New password must differ' })
export const createUserSchema     = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: roleSchema,
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
})
export const updateUserSchema     = z.object({
  email:     z.string().email().optional(),
  role:      roleSchema.optional(),
  firstName: z.string().min(1).optional(),
  lastName:  z.string().min(1).optional(),
  isActive:  z.boolean().optional(),
})
```

The 6-char minimum lives in one place; tightening the policy later is a single change in shared, propagated to both ends.

## 6. Backend API Surface (`apps/api`)

### 6.1 New dependencies

- `bcrypt` + `@types/bcrypt` — password hashing.
- `jsonwebtoken` + `@types/jsonwebtoken` — access JWT.
- `cookie-parser` + `@types/cookie-parser` — read the refresh cookie.
- `@oncall/shared` gains `zod` as a dependency.

### 6.2 New environment variables (`config/env.ts`, `apps/api/.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `JWT_ACCESS_SECRET` | (required) | Access JWT signing secret; fail-fast if missing in production |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token lifetime |
| `COOKIE_SECURE` | `true` in production, `false` in development | Cookie `Secure` flag |
| `COOKIE_SAMESITE` | `lax` | Cookie `SameSite` attribute |
| `COOKIE_DOMAIN` | (optional) | Cookie domain; unset for localhost |

In development, sensible dev secrets are allowed (documented). In production, missing secrets fail fast on boot.

### 6.3 `lib/`

- **`jwt.ts`** — `signAccessToken(payload: { sub: number; role: Role }): string` and `verifyAccessToken(token: string): JwtAccessPayload`. Uses `JWT_ACCESS_SECRET` + `JWT_ACCESS_EXPIRES_IN`.
- **`token.ts`** — `generateRefreshToken(): string` (`crypto.randomBytes(48).toString('base64url')`) and `hashToken(token: string): string` (`crypto.createHash('sha256').update(token).digest('hex')`).
- **`http-error.ts`** — `class HttpError extends Error { constructor(public status: number, message: string) }`. Aligns with the existing error-handler which reads `err.status`.

### 6.4 Services

- **`token.service.ts`** — `issueRefreshToken(userId, tx?)`, `rotateRefreshToken(oldToken, userId)`, `revokeRefreshToken(token)`, `revokeAllForUser(userId)`, `findActiveToken(token)`. All DB ops hash the token before lookup/write.
- **`auth.service.ts`** — `login(email, password)` (load user, compare bcrypt, check `is_active`, issue access + refresh, return `{ user, accessToken }` + the raw refresh token to cookie), `refresh(oldToken)` (find active non-expired row, rotate, return new access + new refresh), `logout(token)` (revoke), `changePassword(userId, currentPassword, newPassword)` (verify current, re-hash, update, revoke all refresh tokens). Maps DB rows → camelCase `AuthUser`/`User`.
- **`user.service.ts`** — `list()`, `getById(id)`, `create(input)` (hash password, insert, duplicate email → 409), `update(id, input)` (partial update of non-password fields only — `updateUserSchema` has no password field; password changes are the user's own `/auth/change-password`, admin password reset is out of scope), `remove(id)` (hard delete; cascades refresh tokens). Maps rows → camelCase.

### 6.5 Middleware

- **`validate(schema, part)`** — parses `req[part]` with a zod schema; on success attaches parsed value back; on failure throws `HttpError(400, firstIssueMessage)`.
- **`authenticate`** — reads `Authorization: Bearer`, verifies access JWT, sets `req.user = { id, role }`; throws `HttpError(401, 'Unauthorized')` if missing/invalid.
- **`authorize(...roles: Role[])`** — returns a middleware that throws `HttpError(403, 'Forbidden')` unless `req.user.role` is permitted. `req.user` typed via a merged `Request` declaration.

### 6.6 Error handler extension (`middleware/error-handler.ts`)

- If `err instanceof ZodError` → status 400, message = first issue message.
- If `err instanceof HttpError` → use `err.status` (already covered by existing `.status` read).
- Otherwise unchanged (default 500).

### 6.7 Routes

| Method | Path | Auth | Body / Source | Response |
|---|---|---|---|---|
| POST | `/auth/login` | public | `loginSchema` body | 200 `{ user, accessToken }` + Set-Cookie |
| POST | `/auth/refresh` | cookie | cookie `refresh_token` | 200 `{ user, accessToken }` + rotated Set-Cookie |
| POST | `/auth/logout` | cookie | cookie `refresh_token` | 204 + clear cookie |
| GET  | `/auth/me` | bearer | — | 200 `{ user }` |
| POST | `/auth/change-password` | bearer | `changePasswordSchema` body | 200 `{ user }` |
| GET  | `/users` | admin | — | 200 `{ users: User[] }` |
| GET  | `/users/:id` | admin | params | 200 `{ user }` |
| POST | `/users` | admin | `createUserSchema` body | 201 `{ user }` |
| PATCH | `/users/:id` | admin | `updateUserSchema` body + params | 200 `{ user }` |
| DELETE | `/users/:id` | admin | params | 204 |

Status mapping: 200/201/204 success; 400 validation; 401 unauthenticated/invalid token; 403 forbidden/inactive; 404 not found; 409 duplicate email; 500 server error. All responses use the standard envelope.

## 7. Frontend (`apps/web`)

### 7.1 HTTP client (`lib/http.ts`)

- Add `apiPost`, `apiPatch`, `apiDelete` (mirror `apiGet`).
- Add `credentials: 'include'` on every request (refresh cookie).
- Add a module-private `accessToken` variable + `setAccessToken(t)` setter (the auth store calls it on login/refresh/logout).
- Inject `Authorization: Bearer <accessToken>` when a token is set.
- 401 interceptor: on a 401 from a non-refresh request, call the auth store's `refresh()` once; on success retry the original request once; on failure clear auth and redirect to `/login`. Avoid infinite loops by tracking a retry flag and skipping `/auth/refresh` itself.

### 7.2 Pinia auth store (`stores/auth.ts`)

State: `user: AuthUser | null`, `accessToken: string | null`.
Getters: `isAuthenticated`, `isAdmin`.
Actions: `login(email, password)`, `refresh()`, `logout()`, `fetchMe()`, `changePassword(current, next)`. Persists nothing; on app boot `main.ts`/router calls `refresh()` to rehydrate silently (failures are silent → stays logged out).

### 7.3 Services

- `services/auth.ts` — `login`, `refresh`, `logout`, `me`, `changePassword` (typed via `@oncall/shared`).
- `services/user.ts` — `list`, `get`, `create`, `update`, `remove` (admin).

### 7.4 Router & guards (`router/index.ts`)

Route meta: `{ requiresAuth?: boolean; roles?: Role[] }`.
`beforeEach`: if `requiresAuth && !isAuthenticated` → redirect `/login` with redirect query; if `roles && !roles.includes(user.role)` → redirect `/` (home) with a brief notice. The login route is public; successful login returns to the `redirect` query.

Routes:
- `/login` → `LoginPage` (public)
- `/` → `HomePage` (`requiresAuth`)
- `/profile` → `ProfilePage` (`requiresAuth`)
- `/users` → `UsersPage` (`requiresAuth`, `roles: ['administrator']`)

### 7.5 Pages & UI

- **`pages/LoginPage.vue`** — email/password form using shared `loginSchema` for client validation; `Input`, `Button`, `Label`, `Card`. Submits via the store; shows field/server errors; redirects home on success.
- **`pages/ProfilePage.vue`** — change-password form using `changePasswordSchema`.
- **`pages/UsersPage.vue`** (admin) — table of users, create + edit via a `Dialog`, disable/enable + delete actions. Uses `Table`, `Dialog`, `Label`, `Input`, `Button`.
- **`components/layout/AppHeader.vue`** (extended) — brand + nav links (Home, Users for admins, Profile), plus user name/role and a Logout action.

New shadcn-vue ui components: `Label`, `Table` (+ sub-parts), `Dialog` (+ sub-parts). Added via the existing `components.json` CLI conventions.

### 7.6 Boot rehydration

`main.ts` awaits a silent `auth.refresh()` before mounting (best-effort; failure leaves the user logged out). This restores the in-memory access token from the httpOnly cookie across reloads.

## 8. Security & Testing

### 8.1 Security

- Access token never persisted; refresh token not readable by JS (httpOnly).
- Refresh token rotation; stolen-but-reused tokens can be detected (revoked-on-reuse) — on detecting a reused (already-revoked) token, the service revokes the entire family (defensive).
- bcrypt cost 12; passwords never logged; `password_hash` never serialized.
- Inactive users cannot log in or refresh.
- CORS `credentials: true`; `CORS_ORIGIN` honored.

### 8.2 Testing strategy

- **Unit (services)** — mock `db/client` `query` with `vi.mock`; test `auth.service`, `token.service`, `user.service` happy paths + error cases (invalid credentials → 401, inactive → 403, duplicate email → 409, rotation revokes old, change-password revokes all).
- **Unit (lib)** — test `jwt.ts` round-trip, `token.ts` hash determinism.
- **Integration (routes, supertest)** — exercise the request envelope + status codes with `query` mocked at the module level, so tests never touch the real DB. Login/refresh/logout/me + admin RBAC (doctor hitting `/users` → 403).
- **Web** — mount `LoginPage` with Pinia + Router; assert error rendering and successful-redirect behavior with a mocked `services/auth`. Mount `UsersPage` behind a mocked admin store.

### 8.3 Definition of Done (Phase 2)

- `pnpm install`, `pnpm db:setup`, `pnpm dev` all succeed from a clean clone.
- Seeded admin can log in; access token in body, refresh cookie set httpOnly.
- Refresh rotates the token and restores the session across reload.
- Logout clears cookie and revokes the token.
- Authenticated `GET /auth/me` returns the user; `change-password` works and revokes sessions.
- Admin can list/create/update/disable/delete users; doctors get 403 on `/users`.
- Unauthenticated SPA visits redirect to `/login`; RBAC-protected routes redirect non-admins.
- Access token never written to `localStorage`/`sessionStorage`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass across the monorepo.

## 9. Out of Scope (Phase 2)

Doctor profile data (specialty, contact, duty limits), availability, scheduling engine, schedule UI, statistics, reporting, audit logging, rate limiting, production Docker, email/password reset, MFA. Each is handled in its own phase or future work.
