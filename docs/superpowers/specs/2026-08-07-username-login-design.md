# Username + Email Login Design

**Project:** Doctor On-Call Duty Scheduling System
**Status:** Approved (2026-08-07)
**Scope owner:** backend `apps/api`, frontend `apps/web`, shared `packages/shared`, `database/`
**Builds on:** Phase 2 — Auth & Authorization (complete)

---

## 1. Purpose

Extend the existing email/password login so staff can additionally authenticate with a **username/password** pair. Usernames become a required, unique identifier on every user account. The login form exposes a single combined field ("Email or username") that accepts either identifier; the backend resolves which one by shape (`@` present → email lookup, otherwise → username lookup).

This is an additive change to the Phase 2 auth contract. No new tokens, cookies, middleware, or routes are introduced.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Username presence | **Required for all users.** `username` is `NOT NULL UNIQUE`. Existing seed rows are backfilled. |
| Login payload | **Single `identifier` field** replaces `{ email, password }`. `loginSchema = { identifier, password }`. The combined UI field maps 1:1 to this payload. |
| Identifier resolution | `identifier.includes('@')` → email lookup; otherwise → username lookup. Exactly one DB query per login. |
| Username format | 3–32 chars; `[A-Za-z0-9._-]` only; must not contain `@` (implicit — not in the allowed set); **case-sensitive** comparison (stored and matched verbatim). |
| API contract change | `LoginRequest` becomes `{ identifier, password }`. Safe because the only client is this monorepo's frontend. |
| `AuthUser`/`User` | Both gain a required `username: string`. Surfaces in `/auth/me`, user management, and the login response. |
| Create/Update user | `createUserSchema` requires `username`; `updateUserSchema` allows optional `username`. |
| DB evolution | No migration runner exists. Idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + backfill + `SET NOT NULL` + `CREATE UNIQUE INDEX IF NOT EXISTS` handles pre-existing databases. |
| Doctor creation path | `doctor.service.ts` inserts into `users` directly (bypassing `createUserSchema`). Since `username` is `NOT NULL`, `createDoctorSchema`/`UpdateDoctorSchema`/`CreateDoctorRequest`/`UpdateDoctorRequest`/`Doctor` and the service's `create()`/`update()`/`SELECT`/`toDoctor()` MUST also carry username — otherwise doctor creation breaks. |

## 3. Identifier Resolution Logic

```
input.identifier
  ├── includes '@'  →  SELECT ... WHERE email = $1
  └── otherwise     →  SELECT ... WHERE username = $1
```

The `@`-check is a reliable discriminator because the username format regex forbids `@`, so a username can never look like an email and an email always contains `@`. No fallback/second-guessing needed.

## 4. Database Schema (`database/schema.sql`)

The `users` table gains a required `username` column with a format CHECK and a unique index.

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'doctor'
                CHECK (role IN ('administrator', 'doctor')),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (username ~ '^[A-Za-z0-9._-]{3,32}$')
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role) WHERE is_active = TRUE;

-- Idempotent evolution for pre-existing databases (no migration runner exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
UPDATE users SET username = split_part(email, '@', 1) WHERE username IS NULL;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);
```

Design points:
- `username` is `NOT NULL UNIQUE`; uniqueness is enforced via the idempotent `idx_users_username` index (not an inline `UNIQUE`) so both fresh and existing DBs end up with exactly one unique index, avoiding duplicates.
- The format `CHECK` is inline in `CREATE TABLE` — applied to fresh databases. Existing upgraded DBs enforce the same rule at the application layer (Zod), since every write funnels through the API. (PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`.)
- Backfill derives the username from the email local-part (`split_part(email, '@', 1)`). The only existing rows are the seed users (`admin`, `dr1`, `dr2`, `dr3`), all valid under the format rule.
- Lookup is served by the unique index; no extra read index needed (mirrors how `email`'s inline `UNIQUE` serves its lookups).

### 4.1 Seed (`database/seed.sql`)

The admin and doctor `INSERT`s gain a `username` column:

| email | username | role |
|---|---|---|
| `admin@oncall.local` | `admin` | administrator |
| `dr1@oncall.local` | `dr1` | doctor |
| `dr2@oncall.local` | `dr2` | doctor |
| `dr3@oncall.local` | `dr3` | doctor |

## 5. Shared Types & Schemas (`packages/shared`)

`@oncall/shared` remains the single source of truth. One reusable username schema is introduced and reused across create/update.

**`schemas/auth.ts`** (delta):
```ts
export const usernameSchema = z.string().regex(/^[A-Za-z0-9._-]{3,32}$/, 'Invalid username')

export const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(6),
})

export const createUserSchema = z.object({
  email: z.string().email(),
  username: usernameSchema,
  password: z.string().min(6),
  role: roleSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
})

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  username: usernameSchema.optional(),
  role: roleSchema.optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
})
```

`changePasswordSchema` is unchanged.

**`schemas/doctor.ts`** (delta — required because doctors are users and username is NOT NULL):
```ts
export const createDoctorSchema = z.object({
  email: z.string().email(),
  username: usernameSchema,          // NEW
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  maxMonthlyDuties: z.number().int().min(1).max(7).default(7),
})
export const updateDoctorSchema = z.object({
  email: z.string().email().optional(),
  username: usernameSchema.optional(),   // NEW
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  maxMonthlyDuties: z.number().int().min(1).max(7).optional(),
  isActive: z.boolean().optional(),
})
```

**`types/auth.ts`** (delta):
```ts
export interface AuthUser {
  id: number
  email: string
  username: string        // NEW
  role: Role
  firstName: string
  lastName: string
}

export interface LoginRequest { identifier: string; password: string }   // changed

export interface CreateUserRequest {
  email: string
  username: string        // NEW
  password: string
  role: Role
  firstName: string
  lastName: string
}

export interface UpdateUserRequest {
  email?: string
  username?: string       // NEW
  role?: Role
  firstName?: string
  lastName?: string
  isActive?: boolean
}
```

`User extends AuthUser` so it inherits `username` automatically. `LoginResponse`, `RefreshResponse`, `ChangePasswordRequest` are unchanged.

**`types/doctor.ts`** (delta):
```ts
export interface Doctor {
  // ...existing fields...
  username: string        // NEW
}
export interface CreateDoctorRequest {
  email: string
  username: string        // NEW
  password: string
  firstName: string
  lastName: string
  maxMonthlyDuties?: number
}
export interface UpdateDoctorRequest {
  email?: string
  username?: string       // NEW
  firstName?: string
  lastName?: string
  maxMonthlyDuties?: number
  isActive?: boolean
}
```

## 6. Backend (`apps/api`)

No changes to controllers, routes, middleware, JWT, token service, or HTTP error handling. Only the two services that own `UserRow` are touched — the codebase deliberately duplicates `UserRow`/column lists across `auth.service.ts` and `user.service.ts` (no shared repository), so both update consistently.

### 6.1 `services/auth.service.ts`

- `UserRow`: add `username: string`.
- `USER_COLUMNS`: add `username` to the projected column list.
- `toAuthUser()`: add `username: row.username`.
- Add `findUserByUsername(username): Promise<UserRow | undefined>` — `SELECT ${USER_COLUMNS} FROM users WHERE username = $1`.
- `login()`: replace `findUserByEmail(input.email)` with a branch:
  ```ts
  const row = input.identifier.includes('@')
    ? await findUserByEmail(input.identifier)
    : await findUserByUsername(input.identifier)
  ```
  The rest of `login()` (bcrypt compare, `is_active` check, token issuance) is unchanged.
- `findUserByEmail`, `findUserById`, `refresh()`, `logout()`, `getUser()`, `changePassword()` are unchanged.

### 6.2 `services/user.service.ts`

- `UserRow`: add `username: string`.
- `COLUMNS`: add `username`.
- `toUser()`: add `username: row.username`.
- `create()`: add a duplicate-username check mirroring the existing duplicate-email check (`SELECT id FROM users WHERE username = $1` → `HttpError(409, 'Username already in use')`), and include `username` in the `INSERT` columns/values.
- `update()`: add `['username', input.username]` to the field map so partial username edits work.

### 6.3 `services/doctor.service.ts` (required — doctors are users)

- `DoctorRow`: add `username: string`.
- `SELECT`: add `u.username` to the projected columns.
- `toDoctor()`: add `username: row.username`.
- `create()`: add a username duplicate check (`SELECT id FROM users WHERE username = $1` → `HttpError(409, 'Username already in use')`) alongside the existing email check, and include `username` in the `INSERT INTO users` columns/values.
- `update()`: add `['username', input.username]` to the user-field map.

### 6.4 Untouched (verified)

`auth.controller.ts` (forwards `req.body` generically), `auth.routes.ts` (references `loginSchema` by name), `validators/auth.ts` (pure re-export), `lib/jwt.ts`, `services/token.service.ts`, all middleware, `config/env.ts`.

## 7. Frontend (`apps/web`)

### 7.1 Service (`services/auth.ts`)
```ts
export async function login(identifier: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/login', { identifier, password })
  setAccessToken(data.accessToken)
  return data
}
```

### 7.2 Store (`stores/auth.ts`)
`login(identifier, password)` — pass-through to the service. Return type and the rest of the store are unchanged.

### 7.3 Login page (`pages/LoginPage.vue`)
- Rename `email` ref → `identifier`.
- Label **"Email or username"**; `<Input type="text" autocomplete="username">`.
- Parse with `loginSchema.safeParse({ identifier: identifier.value, password: password.value })`.
- Call `auth.login(parsed.data.identifier, parsed.data.password)`.

### 7.4 Management forms (required — both create users)

- **`pages/UsersPage.vue`** — add `username` to `EditState`/`emptyEdit()`/`openUpdate()`; add a username `<Input>` to the create/edit dialog; include `username` in the create payload and (when edited) the update payload.
- **`pages/DoctorsPage.vue`** — same treatment: `username` in `EditState`/`emptyEdit()`/`openUpdate()`; username `<Input>` in the dialog; include in create + update payloads.
- Both pages display the new column in their tables (optional but consistent).

### 7.5 Untouched
`lib/http.ts` (transport-only), router/guards, all other pages and components.

## 8. Testing

Mirrors the existing test strategy: unit tests mock `db/client` `query` via `vi.mock`; route tests use `supertest` with `query` mocked; web tests mount components with mocked services.

- **`auth.service.test.ts`** — add: login by email (existing case, updated payload), login by username, wrong identifier → 401, inactive user by username → 403. Verify the `@`-branch selects the expected lookup.
- **`auth.routes.test.ts`** — update all login payloads to `{ identifier, password }`; assert both email- and username-shaped identifiers succeed.
- **`user.service.test.ts`** — add `username` to create/update fixtures; add duplicate-username → 409 case.
- **`doctor.service.test.ts`** / **`doctor.routes.test.ts`** — add `username` to create fixtures and joined-row fixtures; create payloads include `username`.
- **`LoginPage` test (if present)** — update form binding from `email` to `identifier`.
- **`auth.store.test.ts`** — add `username` to mocked `AuthUser` fixtures.
- **`UsersPage` / `DoctorsPage` tests** — add `username` to list fixtures.
- **Schema tests (`packages/shared`)** — assert `loginSchema` requires `identifier`; `createUserSchema`/`createDoctorSchema` reject malformed usernames; valid `[A-Za-z0-9._-]{3,32}` passes.

## 9. Definition of Done

- Fresh setup (`pnpm db:setup`) creates `users` with `username NOT NULL` + `idx_users_username`; seed inserts succeed with usernames.
- Existing dev DB upgraded in place via the idempotent `ALTER`/backfill/`SET NOT NULL`/index block; no manual SQL.
- Login succeeds with `admin`/`changeme123` and with `admin@oncall.local`/`changeme123`.
- `GET /auth/me` and the login response include `username`.
- Admin create/update user flows accept and persist `username`; duplicate username → 409.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass across the monorepo.

## 10. Out of Scope

Password reset, username change history, account lockout/rate-limiting, case-insensitive username matching, multi-hospital identity scoping, SSO/OAuth. Each is future work.
