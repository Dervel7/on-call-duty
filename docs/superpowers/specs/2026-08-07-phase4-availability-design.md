# Phase 4 — Availability Management Design

**Project:** Doctor On-Call Duty Scheduling System
**Phase:** 4 of 8 (Availability Management)
**Status:** Approved (2026-08-07)
**Scope owner:** backend `apps/api`, frontend `apps/web`, shared `packages/shared`, `database/`
**Builds on:** Phase 3 — Doctor Management (complete)

---

## 1. Purpose

Phase 4 introduces **doctor unavailability** — the data the Phase 5 scheduling engine consumes to know which doctors cannot be assigned to on-call duty on which days.

The model is **exclusions only**: doctors are available by default, and we record only periods of *unavailability* (vacation, sick leave, conference, etc.). Each record is an inclusive whole-day `DATE` range (a single day is `start_date == end_date`) with a fixed enum `type` and an optional free-text `note`.

Access is split by role: a doctor manages their **own** records (self-service), and an administrator can manage **any** doctor's records (override/coverage). The scheduling engine (Phase 5) reads these records to exclude doctors from days they are unavailable.

The full system is decomposed into eight phases. This phase delivers item 4 of 8.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Model | Exclusions only. A doctor is available by default; records capture periods of *unavailability*. No explicit "available" declarations |
| Granularity | Whole days. Each record is an inclusive `DATE` range; a single day is `start_date == end_date`. No partial-day/hourly granularity |
| Type | Fixed enum `vacation \| sick \| conference \| other`, stored as `TEXT` with a `CHECK`. Plus an optional `note TEXT` (≤ 500 chars, nullable) |
| Access | A doctor creates/edits/deletes **own** records; an administrator can manage **any** doctor's records |
| Overlaps | Prevented. Two records for the same doctor may not cover the same day. Overlap → `409 Conflict`. Enforced in the service inside `withTransaction`, serialized by `SELECT … FOR UPDATE` on the doctor row (race-safe, no Postgres extension needed) |
| Past dates | Allowed. Records may be created/edited/deleted on any date (past, present, future). The scheduling engine only reads future dates, so historical records are harmless |
| Dates | `DATE` columns, returned to the client as `'YYYY-MM-DD'` strings via a `pg` DATE type parser (avoids node-pg's local-timezone `Date` off-by-one). No existing column is affected (all current date columns are `TIMESTAMPTZ`) |
| Lifecycle | `doctor_id … REFERENCES doctors(id) ON DELETE CASCADE` — deleting a doctor removes their unavailability rows |
| UI structure | Two pages: `/availability` (admin, all doctors) and `/my-availability` (doctor, own). CRUD via Dialog date-range forms. No calendar view this phase |

## 3. Architecture & Layering

Phase 4 reuses the Phase 2/3 layering (Controllers → Services → Database) and the Phase 3 `withTransaction` primitive. No new middleware.

```
apps/api/src/
├── db/
│   └── client.ts                  # +DATE type parser (DATE -> 'YYYY-MM-DD' string)
├── controllers/
│   └── unavailability.controller.ts # NEW: list/listMe/create/createMe/update/remove
├── services/
│   └── unavailability.service.ts    # NEW: list/listOwn/create/createOwn/update/remove + overlap + ownership
├── routes/
│   └── unavailability.routes.ts     # NEW: /unavailability/* (admin) + /unavailability/me (self)
├── validators/
│   ├── unavailability.ts            # NEW: re-export shared schemas + idParams + query schema
│   └── index.ts                     # +export unavailability
└── app.ts                           # +app.use('/unavailability', unavailabilityRouter)
```

### 3.1 Route table

New router mounted at `/unavailability`. Every route runs `authenticate`. The `/me` routes are registered **before** `/:id` so the literal `me` is not captured by the numeric `:id` validator.

| Method | Path | Auth | Body / Query | Response |
|---|---|---|---|---|
| GET | `/unavailability` | admin | query `?doctorId=&from=&to=` (all optional) | 200 `{ unavailability: Unavailability[] }` |
| GET | `/unavailability/me` | any authed | — | 200 list own; admin with no doctor profile → 404 |
| POST | `/unavailability` | admin | `createUnavailabilityAdminSchema` body | 201 `{ unavailability }` |
| POST | `/unavailability/me` | any authed | `createUnavailabilitySelfSchema` body (doctorId from caller) | 201 `{ unavailability }` |
| PATCH | `/unavailability/:id` | owner or admin | `updateUnavailabilitySchema` partial body | 200 `{ unavailability }` |
| DELETE | `/unavailability/:id` | owner or admin | — | 204 |

**Query filter semantics** (`?from=&to=`): a record is included when its range overlaps the query window — `start_date <= $to AND end_date >= $from`. `doctorId`, `from`, `to` are independently optional; omitted filters are not applied.

**Ownership on PATCH/DELETE** (`/:id`): load the record (404 if missing). If the caller's role is `doctor` and `record.doctorId !== caller's doctorId` → `403`. Administrators may modify any record.

Router skeleton (note `/me` before `/:id`):
```ts
unavailabilityRouter.use(authenticate)
unavailabilityRouter.get('/', authorize('administrator'), validate(unavailabilityQuerySchema, 'query'), unavailabilityController.list)
unavailabilityRouter.get('/me', unavailabilityController.listMe)
unavailabilityRouter.post('/', authorize('administrator'), validate(createUnavailabilityAdminSchema, 'body'), unavailabilityController.create)
unavailabilityRouter.post('/me', validate(createUnavailabilitySelfSchema, 'body'), unavailabilityController.createMe)
unavailabilityRouter.patch('/:id', validate(idParams, 'params'), validate(updateUnavailabilitySchema, 'body'), unavailabilityController.update)
unavailabilityRouter.delete('/:id', validate(idParams, 'params'), unavailabilityController.remove)
```

Status mapping: 200/201/204 success; 400 validation (bad `idParams`/body/query, `endDate < startDate`); 401 unauthenticated; 403 forbidden (non-admin hitting admin routes; doctor modifying another's record); 404 not found (record, or caller with no doctor profile on `/me`); 409 overlap; 500 server error. All responses use the standard envelope.

## 4. Database Schema

Appended to `database/schema.sql` (idempotent, `CREATE TABLE IF NOT EXISTS`). No triggers/functions — preserves the `;`-splitting DB runner.

```sql
-- Phase 4: Availability Management

CREATE TABLE IF NOT EXISTS unavailability (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id  INTEGER NOT NULL REFERENCES doctors (id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('vacation','sick','conference','other')),
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_unavailability_doctor ON unavailability (doctor_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_unavailability_dates ON unavailability (start_date, end_date);
```

Design points:
- `doctor_id` FK targets `doctors(id)` (the profile PK), `ON DELETE CASCADE` — deleting a doctor's user row cascades the profile, which cascades these rows.
- `type` constrained to the four enum values at the DB; the shared zod schema enforces the same set at the API edge and in web forms.
- `CHECK (end_date >= start_date)` is a backstop; the zod `.refine` catches it earlier with a friendlier message.
- Two indexes serve the two query shapes: `(doctor_id, start_date, end_date)` for per-doctor listing, overlap checks, and the Phase 5 "available on day D?" lookup; `(start_date, end_date)` for the admin cross-doctor range query.

### 4.1 DATE type parser (`db/client.ts`)

node-pg parses `DATE` columns into JS `Date` objects using the **local** timezone, which causes off-by-one bugs when mapping to ISO day strings. Because the API contract is `'YYYY-MM-DD'` strings, register a parser that returns the raw Postgres text. Added once in `db/client.ts`:

```ts
import pg from 'pg'
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v)
```

No existing column is affected (Phases 1–3 use only `TIMESTAMPTZ`, OID 1184, which is untouched).

### 4.2 Seed (`database/seed.sql`)

A few sample records for the seeded doctors in a fixed sample month so Phase 5 and the web UI are testable from a clean clone. There is no natural unique key, so idempotency uses `INSERT … SELECT … WHERE NOT EXISTS`:

```sql
-- Phase 4: seed sample unavailability (fixed sample month 2026-09)
INSERT INTO unavailability (doctor_id, type, start_date, end_date, note)
SELECT d.id, 'vacation', '2026-09-07', '2026-09-11', 'Summer break'
FROM doctors d JOIN users u ON u.id = d.user_id
WHERE u.email = 'dr1@oncall.local'
AND NOT EXISTS (SELECT 1 FROM unavailability x WHERE x.doctor_id = d.id AND x.start_date = '2026-09-07' AND x.end_date = '2026-09-11');

INSERT INTO unavailability (doctor_id, type, start_date, end_date, note)
SELECT d.id, 'sick', '2026-09-15', '2026-09-15', NULL
FROM doctors d JOIN users u ON u.id = d.user_id
WHERE u.email = 'dr2@oncall.local'
AND NOT EXISTS (SELECT 1 FROM unavailability x WHERE x.doctor_id = d.id AND x.start_date = '2026-09-15' AND x.end_date = '2026-09-15');
```

## 5. Shared Types & Schemas (`@oncall/shared`)

`@oncall/shared` remains the single source of truth for the unavailability contract — types **and** zod schemas.

```
packages/shared/src/
├── types/
│   ├── unavailability.ts           # NEW
│   └── index.ts                    # +re-export
├── schemas/
│   ├── unavailability.ts           # NEW
│   └── index.ts                    # +re-export
└── index.ts                        # unchanged barrel
```

**`types/unavailability.ts`** (camelCase API contract; responses are denormalized joins with `doctors` + `users`):
```ts
export type UnavailabilityType = 'vacation' | 'sick' | 'conference' | 'other'

export interface Unavailability {
  id: number
  doctorId: number
  doctorFirstName: string
  doctorLastName: string
  type: UnavailabilityType
  startDate: string // 'YYYY-MM-DD'
  endDate: string   // 'YYYY-MM-DD'
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateUnavailabilityAdminRequest {
  doctorId: number
  type: UnavailabilityType
  startDate: string
  endDate: string
  note?: string
}

export interface CreateUnavailabilitySelfRequest {
  type: UnavailabilityType
  startDate: string
  endDate: string
  note?: string
}

export interface UpdateUnavailabilityRequest {
  type?: UnavailabilityType
  startDate?: string
  endDate?: string
  note?: string | null // null clears the note
}

export interface UnavailabilityQuery {
  doctorId?: number
  from?: string // 'YYYY-MM-DD'
  to?: string   // 'YYYY-MM-DD'
}
```

**`schemas/unavailability.ts`** (reused by the API `validate` middleware and the web forms):
```ts
import { z } from 'zod'

const unavailabilityTypeEnum = z.enum(['vacation', 'sick', 'conference', 'other'])
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)')

export const createUnavailabilityAdminSchema = z
  .object({
    doctorId: z.number().int().positive(),
    type: unavailabilityTypeEnum,
    startDate: dateStr,
    endDate: dateStr,
    note: z.string().max(500).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })

export const createUnavailabilitySelfSchema = createUnavailabilityAdminSchema.omit({ doctorId: true })

export const updateUnavailabilitySchema = z
  .object({
    type: unavailabilityTypeEnum.optional(),
    startDate: dateStr.optional(),
    endDate: dateStr.optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((d) => !(d.startDate && d.endDate && d.endDate < d.startDate), {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })

export const unavailabilityQuerySchema = z.object({
  doctorId: z.coerce.number().int().positive().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
})
```

The date regex, the enum set, and the end≥start rule each live in one place, propagated to both ends. `doctorId` in the query schema coerces from string because Express query params are always strings. Lexicographic comparison of `'YYYY-MM-DD'` strings is equivalent to date comparison, so the `.refine` is correct.

## 6. Backend API Surface (`apps/api`)

### 6.1 New dependencies

None. `pg`, `zod`, and the Phase 3 `withTransaction` helper are already present.

### 6.2 DATE parser

See §4.1. One line added to `db/client.ts`; covered by manual `db:setup` verification in the plan.

### 6.3 `unavailability.service.ts`

Row mapping joins `unavailability x JOIN doctors d ON d.id = x.doctor_id JOIN users u ON u.id = d.user_id` and maps snake_case columns → camelCase `Unavailability`. The DATE columns arrive as strings via the §4.1 parser.

- **`listAll({ doctorId?, from?, to? }): Promise<Unavailability[]>`** — admin. Builds a dynamic `WHERE` from the provided filters (each optional). Date filter is the overlap form `start_date <= $to AND end_date >= $from`. `ORDER BY x.start_date DESC, u.last_name`.
- **`listOwn(userId): Promise<Unavailability[]>`** — resolves the caller's `doctorId` via `SELECT id FROM doctors WHERE user_id = $1` (404 if none), then lists that doctor's records.
- **`create(doctorId, input: CreateUnavailabilityAdminRequest | CreateUnavailabilitySelfRequest): Promise<Unavailability>`** — runs in `withTransaction`:
  1. `SELECT 1 FROM doctors WHERE id = $1 FOR UPDATE` — serializes per-doctor writes; 404 `'Doctor not found'` if the row is absent (covers admin creating for an unknown `doctorId`).
  2. Overlap check: `SELECT id FROM unavailability WHERE doctor_id = $1 AND start_date <= $2 AND end_date >= $3` with `[$doctorId, input.endDate, input.startDate]`. If any row → `409 'Overlapping unavailability record exists'`.
  3. `INSERT INTO unavailability (doctor_id, type, start_date, end_date, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`.
  4. Return the joined `Unavailability` via `getById(id)`.
- **`createOwn(userId, input): Promise<Unavailability>`** — resolves `doctorId` from `userId` (404 if no profile), then calls `create(doctorId, input)`.
- **`update(id, input: UpdateUnavailabilityRequest, actor): Promise<Unavailability>`** — load record by `id` (404 if missing). Ownership: if `actor.role === 'doctor'`, resolve the caller's `doctorId`; if it differs from `record.doctorId` → `403`. Then `withTransaction`:
  1. `SELECT 1 FROM doctors WHERE id = $1 FOR UPDATE` on the record's `doctorId`.
  2. If `startDate` or `endDate` is present in the input, compute the effective range (input value or current row value) and run the overlap check **excluding self**: `… AND id <> $self`. Any row → 409.
  3. Build a dynamic `UPDATE unavailability SET …, updated_at = NOW() WHERE id = $id` from the provided fields. `note` handling: `undefined` → leave unchanged; `null` → set `NULL`; a string → set it.
  4. Return the joined `Unavailability`.
- **`remove(id, actor): Promise<void>`** — load record (404); ownership check (403 for non-owner doctor); `DELETE FROM unavailability WHERE id = $1`.
- **`getById(id): Promise<Unavailability>`** — `WHERE x.id = $1`; 404 if missing. Used internally to return joined rows after create/update.

The `actor` argument is the Express `req.user` (`{ id, role }`); the service resolves the caller's `doctorId` only when role is `doctor`. Client-provided `doctorId` is never trusted on `/me` (it is derived from `req.user.id`).

### 6.4 `unavailability.controller.ts`

Thin controller, same `try { … } catch (err) { next(err) }` shape as `doctor.controller.ts`.
- `list` → `unavailabilityService.listAll(req.query)`; `ok({ unavailability })`.
- `listMe` → guards `req.user`; `listOwn(req.user.id)`; `ok({ unavailability })`.
- `create` → `create(req.body.doctorId, req.body)`; 201 `ok({ unavailability })`.
- `createMe` → `createOwn(req.user.id, req.body)`; 201 `ok({ unavailability })`.
- `update` → `update(Number(req.params.id), req.body, req.user)`; `ok({ unavailability })`.
- `remove` → `remove(Number(req.params.id), req.user)`; 204.

### 6.5 Middleware & validators

No new middleware. `validators/unavailability.ts` re-exports `createUnavailabilityAdminSchema`, `createUnavailabilitySelfSchema`, `updateUnavailabilitySchema`, `unavailabilityQuerySchema` from `@oncall/shared`, and re-uses the existing `idParams` (from `validators/user.ts`). `validators/index.ts` adds `export * from './unavailability'`.

### 6.6 `app.ts` wiring

`unavailabilityRouter` is mounted at `/unavailability` after `/doctors`.

## 7. Frontend (`apps/web`)

### 7.1 `services/unavailability.ts` (new)

Mirrors `services/doctor.ts`; each call unwraps the envelope:
```ts
export async function listAll(query?: UnavailabilityQuery): Promise<Unavailability[]>
export async function listMine(): Promise<Unavailability[]>
export async function createForDoctor(doctorId: number, input: CreateUnavailabilitySelfRequest): Promise<Unavailability>
export async function createMine(input: CreateUnavailabilitySelfRequest): Promise<Unavailability>
export async function update(id: number, input: UpdateUnavailabilityRequest): Promise<Unavailability>
export async function remove(id: number): Promise<void>
```

### 7.2 Router (`router/index.ts`)

Two new children under `DefaultLayout`:
- `/availability` → `AvailabilityPage.vue`, `meta: { roles: ['administrator'] }`.
- `/my-availability` → `MyAvailabilityPage.vue` (any authenticated user; an admin calling it gets 404 from the API since they have no doctor profile).

### 7.3 `AvailabilityPage.vue` (admin, all doctors)

Clones the `DoctorsPage` table + Dialog structure:
- Columns: **Doctor · Type · Start · End · Note · Actions**.
- Filters (optional): `<input type="date">` from/to, plus a doctor `<select>` populated from `doctorService.list()`. On change, re-query `unavailabilityService.listAll({ doctorId, from, to })`.
- **New exclusion** Dialog: doctor `<select>` (admin picks the target doctor), type `<select>` (vacation/sick/conference/other), `startDate` / `endDate` `<input type="date">`, optional `note` `<input>`. Client-validates with `createUnavailabilityAdminSchema`.
- Row actions: **Edit** (Dialog, validates with `updateUnavailabilitySchema`), **Delete** (confirm → `remove`).
- `<input type="date">` emits `'YYYY-MM-DD'` natively, matching the contract; the same `string`-state + `Number()` coercion note as Phase 3 does not apply here (dates stay strings).

### 7.4 `MyAvailabilityPage.vue` (doctor, own)

Same table + Dialog pattern but **no doctor selector** (records are the caller's own). Validates create with `createUnavailabilitySelfSchema`, edit with `updateUnavailabilitySchema`. Row actions Edit/Delete. On a 404 (caller has no doctor profile) the page shows a small inline notice.

### 7.5 `AppHeader.vue`

- Admins gain an **Availability** link, after **Doctors**.
- Doctors gain a **My availability** link, before **Profile**.

### 7.6 Components

Reuses existing `Table*`, `Dialog`, `Input`, `Label`, `Button`. The type and doctor `<select>` use the same inline `<select>` + token-class pattern as `UsersPage.vue`'s role selector. **No new shadcn-vue components.**

## 8. Security & Testing

### 8.1 Security
- RBAC: `GET /` and `POST /` are `authenticate` + `authorize('administrator')` (doctors get 403). `/me` routes and `PATCH/DELETE /:id` require only authentication, with ownership enforced in the service (non-owner doctor → 403).
- Client-provided `doctorId` is never trusted on `/me` — it is derived from `req.user.id`.
- Overlap prevention is race-safe: the `SELECT … FOR UPDATE` on the doctor row serializes concurrent writes for the same doctor.
- Parameterized queries only (`$1` placeholders); no ORM. `note` is capped at 500 chars by zod.
- Deleting a doctor cascades their unavailability (FK), so no orphaned records.

### 8.2 Testing strategy

- **`@oncall/shared`** — extend `schemas.test.ts`: enum rejects unknown values; `dateStr` rejects bad formats; `createUnavailabilityAdminSchema` rejects `endDate < startDate`; `updateUnavailabilitySchema` accepts partials and `note: null`; `unavailabilityQuerySchema` coerces `doctorId` from string.
- **`@oncall/api` services** — `unavailability.service.test.ts` mocks `db/client` (`query` and `withTransaction`) and the doctor lookup. Cases: `listAll` emits the expected `WHERE` clauses for each filter combination; `listOwn` 404 when no profile; `create` runs overlap check then insert, → 409 on overlap, → 404 when `doctorId` unknown; `createOwn` resolves `doctorId` then creates; `update` excludes self from the overlap check, → 403 for a non-owner doctor, → 404 when record missing, clears `note` on `null`; `remove` → 404 missing, → 403 non-owner.
- **`@oncall/api` routes** — `unavailability.routes.test.ts` with supertest, `query` mocked at the module level. Admin list 200; doctor list 403; `/me` doctor 200 / admin 404; admin create 201 / overlap 409 / unknown `doctorId` 404 / bad `type` 400 / `endDate < startDate` 400; doctor `POST /me` 201; PATCH cross-doctor → 403; non-numeric `:id` → 400.
- **`@oncall/api` DATE parser** — covered by the manual `db:setup` verification step in the plan (the service tests mock `query` and do not exercise the real parser).
- **`@oncall/web`** — `AvailabilityPage.test.ts` and `MyAvailabilityPage.test.ts` mount with mocked `services/unavailability`: render the list, show `[role="alert"]` on list failure. The existing `guard.test.ts` already covers admin-only routes (reused for `/availability`).

### 8.3 Definition of Done (Phase 4)

- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone; sample unavailability rows are seeded.
- A doctor can list/create/edit/delete their own exclusions on `/my-availability`; an admin gets 404 on `/unavailability/me`.
- An admin can list all doctors' exclusions (with optional `doctorId`/date filters), create for any doctor, and edit/delete any record; a doctor gets 403 on `GET /unavailability` and `POST /unavailability`.
- Overlapping record → 409; `endDate < startDate` → 400; non-numeric `:id` → 400; unknown doctor → 404; a doctor editing another doctor's record → 403.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.

## 9. Out of Scope (Phase 4)

Scheduling engine (Phase 5), schedule management UI (Phase 6), statistics & dashboard (Phase 7), reporting (Phase 8); calendar visualisation; recurring/templated availability; an approval/request workflow for vacation; partial-day/hourly granularity; a system **holidays** table (holiday balancing belongs with the scheduling engine in Phase 5); mutual doctor-to-doctor visibility of availability; pagination; multi-hospital.
