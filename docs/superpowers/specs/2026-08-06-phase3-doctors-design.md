# Phase 3 — Doctor Management Design

**Project:** Doctor On-Call Duty Scheduling System
**Phase:** 3 of 8 (Doctor Management)
**Status:** Approved (2026-08-06)
**Scope owner:** backend `apps/api`, frontend `apps/web`, shared `packages/shared`, `database/`
**Builds on:** Phase 2 — Auth & Authorization (complete)

---

## 1. Purpose

Introduce the doctor profile and its management surface. Phase 2 manages only the authentication account; Phase 3 adds a `doctors` table linked 1:1 to users with `role='doctor'`, a combined admin flow that creates the account and profile atomically, an admin-only Doctors page, and a read-only doctor self-view. The only stored profile attribute in this phase is `max_monthly_duties` (1–7, default 7) — the per-doctor ceiling the scheduling engine (Phase 5) must respect. Specialty, contact, and other identity fields are deferred until needed.

The full system is decomposed into eight phases. This phase delivers item 3 of 8.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Data model | New `doctors` table, 1:1 with `users(id)` via a `UNIQUE` `user_id` FK (`ON DELETE CASCADE`) for `role='doctor'`. `users` stays auth-only |
| Stored profile attribute | `max_monthly_duties` only — per-doctor, integer **1–7**, default **7**. Name/email/status come from the joined `users` row |
| Consecutive duty | Fixed system constant **1** (a doctor cannot be assigned on back-to-back days). Not stored per doctor; consumed by the scheduling engine in Phase 5 |
| Creation flow | Combined: a single "Add doctor" form creates the user account (`role='doctor'`) **and** the linked profile atomically in one transaction |
| Atomicity | New `withTransaction(work)` helper in `db/client.ts`; `doctor.service.create` (and `update` when it touches both tables) runs through the transaction client |
| Page responsibilities | Doctors page owns doctor creation; the Phase 2 Users page "New user" becomes **administrator-only** (role select removed). Users page still lists/edits/disables/deletes every account |
| Access | Admin CRUD on `/doctors`; any authenticated user may `GET /doctors/me` (doctors see their own profile; an admin with no profile gets 404) |
| Lifecycle | **Disable** reuses `users.is_active = FALSE` (cannot log in); **Delete** hard-deletes the underlying `users` row, which cascades the profile + refresh tokens |
| Password on create | Follows Phase 2 convention: initial password equals the email; the doctor changes it on first login. No password field in the create form |
| Password reset | Out of scope (consistent with Phase 2). Edit never changes password |

## 3. Architecture & Layering

Phase 3 reuses the Phase 2 layering (Controllers → Services → Database) and adds one reusable primitive (`withTransaction`) to the DB client.

```
apps/api/src/
├── db/
│   └── client.ts            # +withTransaction(client → work)
├── controllers/
│   └── doctor.controller.ts # NEW: list/get/getMe/create/update/remove
├── services/
│   └── doctor.service.ts    # NEW: CRUD + getByUserId; bcrypt + transaction on create
├── routes/
│   └── doctor.routes.ts     # NEW: /doctors/* (admin) + /doctors/me (any authed)
├── validators/
│   ├── doctor.ts            # NEW: re-export shared schemas + idParams
│   └── index.ts             # +export doctor
└── app.ts                   # +app.use('/doctors', doctorRouter)
```

### 3.1 `app.ts` wiring

`doctorRouter` is mounted at `/doctors` after `/users`. The router applies `authenticate` to every route, then `authorize('administrator')` to all routes **except** `/doctors/me`, which any authenticated user may call.

### 3.2 Route ordering

`/doctors/me` is registered **before** `/doctors/:id` so the literal `me` segment is not captured by the numeric `:id` param validator. `idParams` (already defined in `validators/user.ts`) validates `:id` as a positive integer on the `/:id` routes.

## 4. Database Schema

Appended to `database/schema.sql` (idempotent, `CREATE TABLE IF NOT EXISTS`). No triggers/functions — preserves the `;`-splitting DB runner.

```sql
-- Phase 3: Doctor Management

CREATE TABLE IF NOT EXISTS doctors (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  max_monthly_duties INTEGER NOT NULL DEFAULT 7
                     CHECK (max_monthly_duties BETWEEN 1 AND 7),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Design points:
- Surrogate `id` PK matches every other table's convention. `user_id` is `UNIQUE` (the 1:1 link) and its `UNIQUE` constraint auto-creates an index, so no extra index is declared.
- `ON DELETE CASCADE` on `user_id` means deleting the **user** removes the profile. The delete endpoint deletes the user row (the canonical lifecycle), which also cascades `refresh_tokens`.
- `max_monthly_duties` enforces the 7/month policy at the DB level (`CHECK`); the shared zod schema enforces the same cap at the API edge and in web forms.
- `updated_at` maintained by the service layer (no trigger).

### 4.1 Seed (`database/seed.sql`)

Three sample doctors so later phases (availability, scheduling) are testable from a clean clone. Each is a `users` row (`role='doctor'`) plus a linked `doctors` row. Following the Phase 2 convention, **password = email**; bcrypt cost-12 hashes are generated offline and embedded literally. Seed order: insert the doctor users, then insert the `doctors` rows with `user_id = (SELECT id FROM users WHERE email = $1)`, all `ON CONFLICT` idempotent. The README documents the plaintext convention and "change on first login."

## 5. Shared Types & Schemas (`@oncall/shared`)

`@oncall/shared` remains the single source of truth for the doctor contract — types **and** zod schemas.

```
packages/shared/src/
├── types/
│   ├── doctor.ts            # NEW
│   └── index.ts             # +re-export doctor types
├── schemas/
│   ├── doctor.ts            # NEW
│   └── index.ts             # +re-export doctor schemas
└── index.ts                 # unchanged barrel (already export type/exports)
```

**`types/doctor.ts`** (camelCase API contract; responses are denormalized joins with `users`):
```ts
export interface Doctor {
  id: number
  userId: number
  email: string
  firstName: string
  lastName: string
  isActive: boolean
  maxMonthlyDuties: number
  createdAt: string
  updatedAt: string
}

export interface CreateDoctorRequest {
  email: string
  password: string
  firstName: string
  lastName: string
  maxMonthlyDuties?: number
}

export interface UpdateDoctorRequest {
  email?: string
  firstName?: string
  lastName?: string
  maxMonthlyDuties?: number
  isActive?: boolean
}
```

**`schemas/doctor.ts`** (reused by the API `validate` middleware and the web form):
```ts
export const createDoctorSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  maxMonthlyDuties: z.number().int().min(1).max(7).default(7),
})

export const updateDoctorSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  maxMonthlyDuties: z.number().int().min(1).max(7).optional(),
  isActive: z.boolean().optional(),
})
```

The 1–7 cap and the 6-char password minimum live in one place, propagated to both ends. `createDoctorSchema.maxMonthlyDuties` defaults to `7` when omitted.

## 6. Backend API Surface (`apps/api`)

### 6.1 New dependencies

None. `bcrypt`, `pg`, and `zod` are already present from Phase 2.

### 6.2 Transaction helper (`db/client.ts`)

Added alongside the existing generic `query`:
```ts
import { type PoolClient } from 'pg'

export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```
Inside the callback, services call `client.query(...)` (not the pool-level `query`) so all statements share the same transaction.

### 6.3 `doctor.service.ts`

Row mapping joins `doctors d JOIN users u ON u.id = d.user_id` and maps snake_case columns → camelCase `Doctor`. `password_hash` is never selected into responses.

- **`list(): Promise<Doctor[]>`** — `SELECT … ORDER BY u.last_name, u.first_name`. Returns **all** doctors, active and disabled, so admins can re-enable or delete disabled ones (the Status column reflects `users.is_active`).
- **`getById(id): Promise<Doctor>`** — `WHERE d.id = $1`; throws `HttpError(404, 'Doctor not found')`.
- **`getByUserId(userId): Promise<Doctor>`** — `WHERE d.user_id = $1`; 404 if no profile (used by `/doctors/me`).
- **`create(input: CreateDoctorRequest): Promise<Doctor>`** — runs in `withTransaction`:
  1. `SELECT id FROM users WHERE email = $1` → if present, throw `HttpError(409, 'Email already in use')`.
  2. `passwordHash = await bcrypt.hash(input.password, 12)`.
  3. `INSERT INTO users (email, password_hash, role, first_name, last_name) VALUES ($1,$2,'doctor',$3,$4) RETURNING id`.
  4. `INSERT INTO doctors (user_id, max_monthly_duties) VALUES ($1, $2) RETURNING …`.
  5. Return the joined `Doctor`.
- **`update(id, input: UpdateDoctorRequest): Promise<Doctor>`** — load the doctor (404 if missing); if any account field (`email`/`firstName`/`lastName`/`isActive`) is present, build and run a dynamic `UPDATE users SET … WHERE id = $user_id`; if `maxMonthlyDuties` is present, `UPDATE doctors SET max_monthly_duties = …, updated_at = NOW()`; both writes wrapped in `withTransaction`. `role` is never changed. Returns the joined `Doctor`.
- **`remove(id): Promise<void>`** — find the doctor (404 if missing), then `DELETE FROM users WHERE id = $user_id`. The `ON DELETE CASCADE` removes the profile and refresh tokens. 404 if the doctor does not exist.

### 6.4 `doctor.controller.ts`

Thin controller, same `try { … } catch (err) { next(err) }` shape as `user.controller.ts`. `getMe` reads `req.user.id` and calls `getByUserId`. Success responses use `ok({ doctor })` / `ok({ doctors })`; create returns 201; remove returns 204.

### 6.5 Middleware & validators

No new middleware. `validators/doctor.ts` re-exports `createDoctorSchema`, `updateDoctorSchema` from `@oncall/shared` and re-uses the existing `idParams` (from `validators/user.ts`). `validators/index.ts` adds `export * from './doctor'`.

### 6.6 Routes

| Method | Path | Auth | Body / Source | Response |
|---|---|---|---|---|
| GET  | `/doctors`      | admin      | — | 200 `{ doctors: Doctor[] }` |
| GET  | `/doctors/me`   | any authed | — | 200 `{ doctor }` (404 if caller has no profile) |
| GET  | `/doctors/:id`  | admin      | `idParams` | 200 `{ doctor }` |
| POST | `/doctors`      | admin      | `createDoctorSchema` body | 201 `{ doctor }` |
| PATCH| `/doctors/:id`  | admin      | `idParams` + `updateDoctorSchema` body | 200 `{ doctor }` |
| DELETE | `/doctors/:id` | admin    | `idParams` | 204 |

Router skeleton (note `/me` before `/:id`):
```ts
doctorRouter.use(authenticate)
doctorRouter.get('/', authorize('administrator'), doctorController.list)
doctorRouter.get('/me', doctorController.getMe)
doctorRouter.get('/:id', authorize('administrator'), validate(idParams, 'params'), doctorController.getById)
doctorRouter.post('/', authorize('administrator'), validate(createDoctorSchema, 'body'), doctorController.create)
doctorRouter.patch('/:id', authorize('administrator'), validate(idParams, 'params'), validate(updateDoctorSchema, 'body'), doctorController.update)
doctorRouter.delete('/:id', authorize('administrator'), validate(idParams, 'params'), doctorController.remove)
```

Status mapping: 200/201/204 success; 400 validation (bad `idParams` or body); 401 unauthenticated; 403 forbidden (non-admin hitting admin routes); 404 not found (incl. `/me` for a caller with no profile); 409 duplicate email; 500 server error. All responses use the standard envelope.

### 6.7 Phase 2 `/users` endpoint

Unchanged on the backend. The `/users` POST still accepts `role`; the restriction of doctor creation to the Doctors page is enforced at the web UX layer (§7.4). `/users` remains the account-management surface for every account.

## 7. Frontend (`apps/web`)

### 7.1 `services/doctor.ts` (new)

Mirrors `services/user.ts`. Each call unwraps the envelope:
```ts
export async function list(): Promise<Doctor[]>
export async function get(id: number): Promise<Doctor>
export async function me(): Promise<Doctor>
export async function create(input: CreateDoctorRequest): Promise<Doctor>
export async function update(id: number, input: UpdateDoctorRequest): Promise<Doctor>
export async function remove(id: number): Promise<void>
```

### 7.2 Router (`router/index.ts`)

- Add `/doctors` → `DoctorsPage.vue` with `meta: { roles: ['administrator'] }`, placed as a sibling of `/users` under `DefaultLayout`.
- `/profile` already exists for every authenticated user; it gains the doctor self-view card (§7.5). No new route for self-view.

### 7.3 `DoctorsPage.vue` (admin CRUD)

Clones the `UsersPage` structure and table components:
- Columns: **Name · Email · Status · Max monthly duties · Actions**.
- Row actions: **Edit** (Dialog), **Disable/Enable** (toggle `isActive` via `update`), **Delete** (confirm → `remove`, which cascades the account).
- **New doctor** button → Dialog fields: email, firstName, lastName, maxMonthlyDuties (number input, default 7, min 1 max 7). Client-validates with `createDoctorSchema`.
- On create the form sends `{ email, password: email, firstName, lastName, maxMonthlyDuties }` — initial password equals the email, with the same note shown on the Users page: "Initial password equals the email. Change on first login." No password field is rendered.
- Edit fields: email, firstName, lastName, maxMonthlyDuties, isActive. Password is never edited.
- Uses existing `Table*`, `Dialog`, `Input`, `Label`, `Button` components — **no new shadcn-vue components**.

### 7.4 `UsersPage.vue` (Phase 2 page — narrowed)

- The create role `<select>` is removed; new users from this page are always `administrator`. Dialog title becomes "New administrator". Doctors are created exclusively on the Doctors page.
- The table and the remaining actions (edit name/email/role/isActive, disable, delete) are unchanged and still apply to **every** account, including existing doctors.

### 7.5 `ProfilePage.vue` (doctor self-view, read-only)

Adds a "My on-call profile" card shown **only when `auth.user.role === 'doctor'`**. On mount it calls `doctorService.me()` and displays name, email, and `maxMonthlyDuties` (read-only). A load failure shows a small inline error and never blocks the existing change-password card. Administrators see no such card (they have no doctor profile; `/doctors/me` would 404).

### 7.6 `AppHeader.vue`

Add a **Doctors** nav link visible to admins, between Users and Profile.

## 8. Security & Testing

### 8.1 Security
- RBAC: all `/doctors` mutations and the admin reads are behind `authenticate` + `authorize('administrator')`; `/doctors/me` requires only authentication.
- `password_hash` never serialized; bcrypt cost 12; passwords never logged.
- Disabling a doctor (`is_active = FALSE`) prevents login and refresh (Phase 2 behavior, unchanged).
- Atomic create/update prevent orphan accounts or profile-less accounts from partial failures.
- Parameterized queries only (`$1` placeholders); no ORM.

### 8.2 Testing strategy

- **`@oncall/shared`** — extend `schemas.test.ts`: `createDoctorSchema` rejects `maxMonthlyDuties` 0 and 8, accepts 1–7, applies the `7` default when omitted, and requires email/password/names; `updateDoctorSchema` accepts partials and enforces the same range.
- **`@oncall/api` services** — `doctor.service.test.ts` mocks `db/client` (`query` and `withTransaction`) and `bcrypt`. Cases: `create` runs within the transaction, rejects duplicate email → 409, inserts the user with `role='doctor'` then the doctor row; `list` maps joined rows; `getById` 404; `getByUserId` 404; `update` writes only the tables whose fields are present; `remove` deletes the **user** row.
- **`@oncall/api` DB client** — `withTransaction` test with a fake `PoolClient` (`query` mock): success path calls `BEGIN` then `COMMIT` and returns the value; failure path calls `ROLLBACK` and rethrows.
- **`@oncall/api` routes** — `doctor.routes.test.ts` with supertest, `query` mocked at the module level. Admin CRUD returns correct status/envelope; a **doctor** token hitting `/doctors` (list) → **403**; `/doctors/me` with a doctor token returns the profile; `/doctors/:id` non-numeric → 400.
- **`@oncall/web`** — `DoctorsPage.test.ts` mounts with mocked `services/doctor`: renders the list, shows `[role="alert"]` on list failure. The existing `guard.test.ts` already covers admin-only routes (reused for `/doctors`).

### 8.3 Definition of Done (Phase 3)

- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone; the seeded admin and three seeded doctors are present.
- Admin can list/create/edit/disable/delete doctors; create produces a matching account + profile atomically; delete removes the account (cascade) and its refresh tokens.
- A doctor can `GET /doctors/me` (own profile, read-only); an admin gets 404 there.
- Doctors page is admin-only (403 for doctors on the API; router redirect on the web).
- Users page creates administrators only; doctors are created on the Doctors page.
- Duplicate doctor email → 409; out-of-range `maxMonthlyDuties` → 400.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.

## 9. Out of Scope (Phase 3)

Availability/vacation management (Phase 4), the scheduling engine and conflict detection (Phase 5), schedule management UI (Phase 6), statistics & dashboard (Phase 7), reporting (Phase 8), admin password reset, MFA, specialty/phone/department/license/pager fields (deferred until needed), multi-hospital, audit logging, rate limiting, production Docker.
