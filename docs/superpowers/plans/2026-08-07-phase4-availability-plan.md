# Phase 4 — Availability Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add doctor unavailability (exclusions) — inclusive whole-day date ranges with an enum type + optional note — that a doctor manages for themselves and an admin manages for any doctor, with overlap prevention.

**Architecture:** A new `unavailability` table is linked N:1 to `doctors(id)` via `ON DELETE CASCADE`. `@oncall/shared` owns the contract (types + zod). The backend reuses the Phase 3 layering and `withTransaction` primitive; overlap is checked inside a transaction serialized by `SELECT … FOR UPDATE` on the doctor row. A `pg` DATE type parser returns `'YYYY-MM-DD'` strings. Routes mirror `/doctors` + `/doctors/me`: admin collection + `/me` self, with ownership-checked `PATCH/DELETE /:id`. Two web pages: admin `/availability` (all doctors) and doctor `/my-availability` (own).

**Tech Stack:** Node.js + TypeScript + Express 4, PostgreSQL via `pg`, `zod`, Vitest + `supertest`. Vue 3 + Pinia + Vue Router + `@vueuse/core`, hand-rolled shadcn-vue components, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-07-phase4-availability-design.md`

**Branch:** `feat/phase4-availability` (branched from `feat/phase2-auth` which carries Phases 1–3). Commit per task on this branch.

---

## Global Constraints

Carry these verbatim into every task — they are non-negotiable project rules.

- **Runtime:** Node 20+ (developed on 24), pnpm 10+, PostgreSQL 14+ (developed on 17).
- **TypeScript:** `strict`, `noUncheckedIndexedAccess` (index access is `T | undefined`), `verbatimModuleSyntax` (use `import type` for type-only imports), `isolatedModules`, `esModuleInterop`. No `any` where `unknown` works.
- **ESLint:** unused args/vars/caught errors must be prefixed with `_`. **No Prettier**; no formatting scripts.
- **DB:** parameterized queries only (`$1` placeholders), snake_case columns, camelCase API contract. Service layer maps between them. **No ORM.**
- **`schema.sql`/`seed.sql`:** idempotent (`CREATE TABLE IF NOT EXISTS`). **No triggers/functions** — the DB runner splits statements on `;`.
- **Auth:** access token in memory only; refresh cookie `httpOnly + Secure(prod) + SameSite=Lax`. RBAC enforced server-side; never trust client-provided `doctorId` on `/me`.
- **Response envelope:** `{ success: true, data }` or `{ success: false, error }`. HTTP status always set: 200/201/204 success; 400 validation; 401 unauth; 403 forbidden; 404 not found; 409 overlap; 500 server error.
- **Frontend components:** hand-rolled using existing `cn()` + token classes. Inline `<select>` for enums (same pattern as `UsersPage.vue`). Do not introduce `reka-ui`/`radix-vue`.
- **Commits:** conventional commits (`feat:`, `test:`, `chore:`, `docs:`). Commit per task on `feat/phase4-availability`. **Never commit `.env`.**
- **No comments in code** unless explicitly requested.
- **Verification per task:** after implementation, run the task's test command and `pnpm typecheck` + `pnpm lint` for the affected package before committing.

---

## Architecture notes (implementation choices for spec-silent details)

1. **DATE parser uses the literal OID `1082`** via a named `types` import from `pg` (kept in a local const `DATE_OID` to avoid a magic number without a comment). `import { types, Pool, ... } from 'pg'` — named imports from the CJS module work (the codebase already imports `{ Pool }`).
2. **The existing `db-client.test.ts` mocks `'pg'`** with only `{ Pool }`; adding the `types.setTypeParser` call at module load requires the mock to provide `types` too. T2 updates that mock.
3. **`create(doctorId, input)` accepts both admin and self payloads** — both shapes share `type/startDate/endDate/note`; the admin body carries an extra `doctorId` that the controller reads separately (`req.body.doctorId`) and passes as the first arg. The self route derives `doctorId` from `req.user.id` via `resolveDoctorId`.
4. **Overlap query** for create/update is `WHERE doctor_id=$1 AND start_date <= $end AND end_date >= $start` (inclusive-range intersection); update adds `AND id <> $self`.
5. **`update` only re-checks overlap when `startDate` or `endDate` is present** (changing only `type`/`note` cannot introduce an overlap). Effective range = input value or current row value.
6. **`note` handling on update:** `undefined` → leave unchanged; `null` → set `NULL`; string → set it.
7. **Ownership** (`assertOwns`): administrators always pass; a doctor must resolve their own `doctorId` and it must equal the record's — else `403`.
8. **`/me` is registered before `/:id`** so the literal `me` is not swallowed by the numeric `:id` validator.

---

## Task ordering & dependencies

```
T1 (shared) ─┬─> T3 (service) ─> T4 (routes+controller) ─┐
T2 (db) ─────┤                                              ├─> T8 (README + verify)
T1 ─> T5 (web service) ─> T6 (admin page) ──────────────────┤
T1, T5 ─> T7 (doctor page) ─────────────────────────────────┘
```

Suggested linear execution: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8. (T1 and T2 are mutually independent; T5 is independent of the backend.)

---

## T1 — Shared contract (types + zod schemas) + tests

**Files:**
- Create: `packages/shared/src/types/unavailability.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/schemas/unavailability.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts`

**Interfaces:**
- Produces (values): `createUnavailabilityAdminSchema`, `createUnavailabilitySelfSchema`, `updateUnavailabilitySchema`, `unavailabilityQuerySchema`.
- Produces (types): `UnavailabilityType`, `Unavailability`, `CreateUnavailabilityAdminRequest`, `CreateUnavailabilitySelfRequest`, `UpdateUnavailabilityRequest`, `UnavailabilityQuery`.

- [ ] **Step 1: Create `packages/shared/src/types/unavailability.ts`**

```ts
export type UnavailabilityType = 'vacation' | 'sick' | 'conference' | 'other'

export interface Unavailability {
  id: number
  doctorId: number
  doctorFirstName: string
  doctorLastName: string
  type: UnavailabilityType
  startDate: string
  endDate: string
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
  note?: string | null
}

export interface UnavailabilityQuery {
  doctorId?: number
  from?: string
  to?: string
}
```

- [ ] **Step 2: Re-export the types**

Append to `packages/shared/src/types/index.ts`:
```ts
export type {
  UnavailabilityType,
  Unavailability,
  CreateUnavailabilityAdminRequest,
  CreateUnavailabilitySelfRequest,
  UpdateUnavailabilityRequest,
  UnavailabilityQuery,
} from './unavailability'
```

- [ ] **Step 3: Create `packages/shared/src/schemas/unavailability.ts`**

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

- [ ] **Step 4: Re-export the schemas**

Append to `packages/shared/src/schemas/index.ts`:
```ts
export {
  createUnavailabilityAdminSchema,
  createUnavailabilitySelfSchema,
  updateUnavailabilitySchema,
  unavailabilityQuerySchema,
} from './unavailability'
```

- [ ] **Step 5: Write the failing tests**

Append to `packages/shared/src/__tests__/schemas.test.ts`:
```ts
import {
  createUnavailabilityAdminSchema,
  createUnavailabilitySelfSchema,
  unavailabilityQuerySchema,
  updateUnavailabilitySchema,
} from '../index'

describe('unavailability schemas', () => {
  const validSelf = { type: 'vacation', startDate: '2026-09-01', endDate: '2026-09-03' }

  it('createUnavailabilityAdminSchema rejects bad type and bad date format', () => {
    expect(
      createUnavailabilityAdminSchema.safeParse({ ...validSelf, doctorId: 1, type: 'holiday' })
        .success,
    ).toBe(false)
    expect(
      createUnavailabilityAdminSchema.safeParse({ ...validSelf, doctorId: 1, startDate: '09-01-2026' })
        .success,
    ).toBe(false)
  })

  it('createUnavailabilitySelfSchema rejects endDate before startDate', () => {
    expect(
      createUnavailabilitySelfSchema.safeParse({ ...validSelf, endDate: '2026-08-31' }).success,
    ).toBe(false)
    expect(createUnavailabilitySelfSchema.safeParse(validSelf).success).toBe(true)
  })

  it('updateUnavailabilitySchema accepts partials and null note', () => {
    expect(updateUnavailabilitySchema.safeParse({ note: null }).success).toBe(true)
    expect(updateUnavailabilitySchema.safeParse({ type: 'sick' }).success).toBe(true)
    expect(updateUnavailabilitySchema.safeParse({ type: 'nap' }).success).toBe(false)
  })

  it('unavailabilityQuerySchema coerces doctorId from string', () => {
    const r = unavailabilityQuerySchema.safeParse({ doctorId: '5', from: '2026-09-01' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.doctorId).toBe(5)
  })
})
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @oncall/shared test`
Expected: PASS (new unavailability schema tests + existing auth/doctor schema tests).

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add unavailability types and zod schemas"
```

---

## T2 — Database schema + DATE parser + seed

**Files:**
- Modify: `database/schema.sql` (append Phase 4 table)
- Modify: `database/seed.sql` (append sample unavailability)
- Modify: `apps/api/src/db/client.ts` (DATE parser)
- Modify: `apps/api/src/__tests__/db-client.test.ts` (pg mock gains `types`)

**Interfaces:**
- Produces (DB): table `unavailability(id, doctor_id FK→doctors ON DELETE CASCADE, type [enum], start_date DATE, end_date DATE, note, timestamps)` with `CHECK (end_date >= start_date)` and two indexes.
- Produces (parser): `DATE` columns returned as `'YYYY-MM-DD'` strings.

- [ ] **Step 1: Append Phase 4 table to `schema.sql`**

Append to `database/schema.sql`:
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

- [ ] **Step 2: Append sample unavailability to `seed.sql`**

Append to `database/seed.sql`:
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

- [ ] **Step 3: Add the DATE parser to `db/client.ts`**

Replace `apps/api/src/db/client.ts` with:
```ts
import { type PoolClient, type QueryResult, type QueryResultRow, Pool, types } from 'pg'
import { env } from '../config/env'

const DATE_OID = 1082
types.setTypeParser(DATE_OID, (val: string) => val)

export const pool = new Pool({ connectionString: env.DATABASE_URL })

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query(text, params) as Promise<QueryResult<T>>
}

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

- [ ] **Step 4: Update the `db-client.test.ts` pg mock to provide `types`**

In `apps/api/src/__tests__/db-client.test.ts`, replace the `vi.mock('pg', …)` block:
```ts
vi.mock('pg', () => {
  class Pool {
    connect = connect
  }
  return { Pool, types: { setTypeParser: () => {} } }
})
```

- [ ] **Step 5: Run the API tests to confirm nothing broke**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (the `withTransaction` db-client tests still pass; the new parser is a no-op under the mock).

- [ ] **Step 6: Apply schema + seed and verify DATE strings**

Ensure `apps/api/.env` has a working `DATABASE_URL`, then:
Run: `pnpm db:setup`
Then verify the DATE columns come back as strings (uses hoisted `pg` + `dotenv`):
```bash
node -e "require('dotenv').config({path:'apps/api/.env'}); const {Client}=require('pg'); const {types}=require('pg'); types.setTypeParser(1082,v=>v); const c=new Client({connectionString:process.env.DATABASE_URL}); (async()=>{await c.connect(); const r=await c.query('SELECT type, start_date, end_date FROM unavailability ORDER BY start_date'); console.log('ROWS', r.rows); await c.end();})().catch(e=>{console.error(e); process.exit(1);})"
```
Expected: two rows; `start_date`/`end_date` printed as `'YYYY-MM-DD'` strings (e.g. `2026-09-07`).

- [ ] **Step 7: Commit**

```bash
git add database/schema.sql database/seed.sql apps/api/src/db/client.ts apps/api/src/__tests__/db-client.test.ts
git commit -m "feat(db): unavailability table + seed + DATE type parser"
```

---

## T3 — `unavailability.service`

**Files:**
- Create: `apps/api/src/services/unavailability.service.ts`
- Test: `apps/api/src/__tests__/unavailability.service.test.ts`

**Interfaces:**
- Consumes: `query`, `withTransaction` from `db/client`; `HttpError`; shared types (`Unavailability`, `UnavailabilityQuery`, `Create*Request`, `UpdateUnavailabilityRequest`, `AuthUser`).
- Produces: `listAll(filters): Promise<Unavailability[]>`; `listOwn(userId)`; `create(doctorId, input)` (404 unknown doctor, 409 overlap); `createOwn(userId, input)`; `update(id, input, actor)` (404/403/409); `remove(id, actor)` (404/403).

- [ ] **Step 1: Write the failing test (db mocked)**

Create `apps/api/src/__tests__/unavailability.service.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import {
  create,
  createOwn,
  listAll,
  listOwn,
  remove,
  update,
} from '../services/unavailability.service'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    doctor_id: 5,
    first_name: 'Jane',
    last_name: 'Roe',
    type: 'vacation',
    start_date: '2026-09-07',
    end_date: '2026-09-11',
    note: null,
    created_at: new Date('2026-09-01'),
    updated_at: new Date('2026-09-01'),
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('unavailability.service', () => {
  it('listAll with no filters runs an unfiltered SELECT', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const xs = await listAll()
    expect(xs).toHaveLength(1)
    expect(xs[0]?.doctorId).toBe(5)
    expect(typeof xs[0]?.startDate).toBe('string')
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).not.toContain('WHERE')
  })

  it('listAll with doctorId + date window emits WHERE clauses', async () => {
    query.mockResolvedValue({ rows: [] })
    await listAll({ doctorId: 5, from: '2026-09-01', to: '2026-09-30' })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('x.doctor_id')
    expect(sql).toContain('x.start_date <=')
    expect(sql).toContain('x.end_date >=')
  })

  it('listOwn resolves doctorId then lists (404 when no profile)', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(listOwn(9)).rejects.toMatchObject({ status: 404 })
  })

  it('create rejects unknown doctor with 404', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(
      create(99, { type: 'sick', startDate: '2026-09-01', endDate: '2026-09-01' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('create rejects overlap with 409 then inserts when clear', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }) // lock: doctor exists
    query.mockResolvedValueOnce({ rows: [{ id: 99 }] }) // overlap found
    await expect(
      create(5, { type: 'vacation', startDate: '2026-09-08', endDate: '2026-09-09' }),
    ).rejects.toMatchObject({ status: 409 })

    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [{ id: 1 }] }
      if (n === 2) return { rows: [] }
      if (n === 3) return { rows: [{ id: 7 }] }
      return { rows: [row({ id: 7 })] }
    })
    const x = await create(5, { type: 'vacation', startDate: '2026-09-20', endDate: '2026-09-21' })
    expect(x.id).toBe(7)
    const insertSql = query.mock.calls[2]?.[0] as string
    expect(insertSql).toContain('INSERT INTO unavailability')
  })

  it('createOwn resolves doctorId then creates', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    query.mockResolvedValueOnce({ rows: [row({ id: 9 })] })
    const x = await createOwn(10, { type: 'sick', startDate: '2026-09-01', endDate: '2026-09-02' })
    expect(x.id).toBe(9)
  })

  it('update excludes self from overlap check and clears note on null', async () => {
    query.mockResolvedValueOnce({
      rows: [{ doctor_id: 5, start_date: '2026-09-07', end_date: '2026-09-11' }],
    })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row({ note: null })] })
    const x = await update(
      1,
      { note: null, endDate: '2026-09-12' },
      { id: 1, role: 'administrator' },
    )
    expect(x.note).toBeNull()
    const overlapSql = query.mock.calls[2]?.[0] as string
    expect(overlapSql).toContain('AND id <>')
    const updateSql = query.mock.calls[3]?.[0] as string
    expect(updateSql).toContain('UPDATE unavailability')
  })

  it('update forbids a non-owner doctor (403)', async () => {
    query.mockResolvedValueOnce({
      rows: [{ doctor_id: 5, start_date: '2026-09-07', end_date: '2026-09-11' }],
    })
    query.mockResolvedValueOnce({ rows: [{ id: 8 }] })
    await expect(
      update(1, { type: 'sick' }, { id: 10, role: 'doctor' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('update 404 when record missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(
      update(99, { type: 'sick' }, { id: 1, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('remove deletes the row; 404 when missing; 403 for non-owner', async () => {
    query.mockResolvedValueOnce({ rows: [{ doctor_id: 5 }] })
    query.mockResolvedValueOnce({ rows: [] })
    await remove(1, { id: 1, role: 'administrator' })
    const del = query.mock.calls[1]?.[0] as string
    expect(del).toContain('DELETE FROM unavailability')

    query.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99, { id: 1, role: 'administrator' })).rejects.toMatchObject({
      status: 404,
    })

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [{ doctor_id: 5 }] })
    query.mockResolvedValueOnce({ rows: [{ id: 8 }] })
    await expect(remove(1, { id: 10, role: 'doctor' })).rejects.toMatchObject({ status: 403 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/api test`
Expected: FAIL (module `../services/unavailability.service` not found).

- [ ] **Step 3: Implement `unavailability.service.ts`**

Create `apps/api/src/services/unavailability.service.ts`:
```ts
import type {
  AuthUser,
  CreateUnavailabilityAdminRequest,
  CreateUnavailabilitySelfRequest,
  Unavailability,
  UnavailabilityQuery,
  UnavailabilityType,
  UpdateUnavailabilityRequest,
} from '@oncall/shared'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'

interface UnavailabilityRow {
  id: number
  doctor_id: number
  first_name: string
  last_name: string
  type: string
  start_date: string
  end_date: string
  note: string | null
  created_at: Date
  updated_at: Date
}

const SELECT = `SELECT x.id, x.doctor_id, x.type, x.start_date, x.end_date, x.note,
  x.created_at, x.updated_at, u.first_name, u.last_name
  FROM unavailability x
  JOIN doctors d ON d.id = x.doctor_id
  JOIN users u ON u.id = d.user_id`

function toUnavailability(row: UnavailabilityRow): Unavailability {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    doctorFirstName: row.first_name,
    doctorLastName: row.last_name,
    type: row.type as UnavailabilityType,
    startDate: row.start_date,
    endDate: row.end_date,
    note: row.note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

async function resolveDoctorId(userId: number): Promise<number> {
  const res = await query<{ id: number }>('SELECT id FROM doctors WHERE user_id = $1', [userId])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Doctor profile not found')
  return row.id
}

async function getById(id: number): Promise<Unavailability> {
  const res = await query<UnavailabilityRow>(`${SELECT} WHERE x.id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Unavailability record not found')
  return toUnavailability(row)
}

async function assertOwns(recordDoctorId: number, actor: AuthUser): Promise<void> {
  if (actor.role === 'administrator') return
  const ownDoctorId = await resolveDoctorId(actor.id)
  if (ownDoctorId !== recordDoctorId) throw new HttpError(403, 'Forbidden')
}

export async function listAll(filters: UnavailabilityQuery = {}): Promise<Unavailability[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.doctorId !== undefined) {
    params.push(filters.doctorId)
    where.push(`x.doctor_id = $${params.length}`)
  }
  if (filters.from !== undefined) {
    params.push(filters.from)
    where.push(`x.end_date >= $${params.length}`)
  }
  if (filters.to !== undefined) {
    params.push(filters.to)
    where.push(`x.start_date <= $${params.length}`)
  }
  const sql =
    where.length > 0
      ? `${SELECT} WHERE ${where.join(' AND ')} ORDER BY x.start_date DESC, u.last_name`
      : `${SELECT} ORDER BY x.start_date DESC, u.last_name`
  const res = await query<UnavailabilityRow>(sql, params)
  return res.rows.map(toUnavailability)
}

export async function listOwn(userId: number): Promise<Unavailability[]> {
  const doctorId = await resolveDoctorId(userId)
  return listAll({ doctorId })
}

type CreateInput = CreateUnavailabilityAdminRequest | CreateUnavailabilitySelfRequest

export async function create(doctorId: number, input: CreateInput): Promise<Unavailability> {
  const id = await withTransaction(async (client) => {
    const lock = await client.query('SELECT 1 FROM doctors WHERE id = $1 FOR UPDATE', [doctorId])
    if (lock.rows.length === 0) throw new HttpError(404, 'Doctor not found')
    const overlap = await client.query(
      'SELECT id FROM unavailability WHERE doctor_id = $1 AND start_date <= $2 AND end_date >= $3',
      [doctorId, input.endDate, input.startDate],
    )
    if (overlap.rows.length > 0)
      throw new HttpError(409, 'Overlapping unavailability record exists')
    const ins = await client.query(
      'INSERT INTO unavailability (doctor_id, type, start_date, end_date, note) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [doctorId, input.type, input.startDate, input.endDate, input.note ?? null],
    )
    const newId = ins.rows[0]?.id
    if (newId === undefined) throw new HttpError(500, 'Failed to create unavailability record')
    return newId
  })
  return getById(id)
}

export async function createOwn(
  userId: number,
  input: CreateUnavailabilitySelfRequest,
): Promise<Unavailability> {
  const doctorId = await resolveDoctorId(userId)
  return create(doctorId, input)
}

export async function update(
  id: number,
  input: UpdateUnavailabilityRequest,
  actor: AuthUser,
): Promise<Unavailability> {
  const existing = await query<{ doctor_id: number; start_date: string; end_date: string }>(
    'SELECT doctor_id, start_date, end_date FROM unavailability WHERE id = $1',
    [id],
  )
  const existingRow = existing.rows[0]
  if (!existingRow) throw new HttpError(404, 'Unavailability record not found')
  await assertOwns(existingRow.doctor_id, actor)

  await withTransaction(async (client) => {
    await client.query('SELECT 1 FROM doctors WHERE id = $1 FOR UPDATE', [existingRow.doctor_id])
    if (input.startDate !== undefined || input.endDate !== undefined) {
      const start = input.startDate ?? existingRow.start_date
      const end = input.endDate ?? existingRow.end_date
      const overlap = await client.query(
        'SELECT id FROM unavailability WHERE doctor_id = $1 AND start_date <= $2 AND end_date >= $3 AND id <> $4',
        [existingRow.doctor_id, end, start, id],
      )
      if (overlap.rows.length > 0)
        throw new HttpError(409, 'Overlapping unavailability record exists')
    }
    const sets: string[] = []
    const params: unknown[] = []
    const map: Array<[string, unknown]> = [
      ['type', input.type],
      ['start_date', input.startDate],
      ['end_date', input.endDate],
      ['note', input.note],
    ]
    for (const [col, value] of map) {
      if (value !== undefined) {
        params.push(value)
        sets.push(`${col} = $${params.length}`)
      }
    }
    if (sets.length > 0) {
      params.push(id)
      await client.query(
        `UPDATE unavailability SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
        params,
      )
    }
  })
  return getById(id)
}

export async function remove(id: number, actor: AuthUser): Promise<void> {
  const existing = await query<{ doctor_id: number }>(
    'SELECT doctor_id FROM unavailability WHERE id = $1',
    [id],
  )
  const existingRow = existing.rows[0]
  if (!existingRow) throw new HttpError(404, 'Unavailability record not found')
  await assertOwns(existingRow.doctor_id, actor)
  await query('DELETE FROM unavailability WHERE id = $1', [id])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (unavailability.service + all existing api tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/unavailability.service.ts apps/api/src/__tests__/unavailability.service.test.ts
git commit -m "feat(api): unavailability service (overlap + ownership)"
```

---

## T4 — Controller, routes, validators, app wiring

**Files:**
- Create: `apps/api/src/controllers/unavailability.controller.ts`
- Create: `apps/api/src/routes/unavailability.routes.ts`
- Create: `apps/api/src/validators/unavailability.ts`
- Modify: `apps/api/src/validators/index.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/__tests__/unavailability.routes.test.ts`

**Interfaces:**
- Consumes: `unavailability.service`; `authenticate`, `authorize`, `validate`; shared schemas; `idParams` (existing, in `validators/user.ts`).
- Produces: `unavailabilityRouter` mounted at `/unavailability` with the six routes from the spec route table.

- [ ] **Step 1: Write the failing route test**

Create `apps/api/src/__tests__/unavailability.routes.test.ts`:
```ts
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { unavailabilityRouter } from '../routes/unavailability.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/unavailability', unavailabilityRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

const row = () => ({
  id: 1,
  doctor_id: 5,
  first_name: 'Jane',
  last_name: 'Roe',
  type: 'vacation',
  start_date: '2026-09-07',
  end_date: '2026-09-11',
  note: null,
  created_at: new Date(),
  updated_at: new Date(),
})

beforeEach(() => query.mockReset())

describe('unavailability routes', () => {
  it('admin lists all (200)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .get('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.unavailability).toEqual([])
  })

  it('doctor is forbidden from admin list (403)', async () => {
    const res = await request(build())
      .get('/unavailability')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('unauthenticated is 401', async () => {
    const res = await request(build()).get('/unavailability')
    expect(res.status).toBe(401)
  })

  it('doctor lists own via /me (200); admin gets 404 there', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const res = await request(build())
      .get('/unavailability/me')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.unavailability[0].doctorId).toBe(5)

    query.mockReset()
    query.mockResolvedValue({ rows: [] })
    const adminRes = await request(build())
      .get('/unavailability/me')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(adminRes.status).toBe(404)
  })

  it('admin creates for a doctor (201); overlap is 409; unknown doctor 404; bad type 400', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [{ id: 1 }] }
      if (n === 2) return { rows: [] }
      if (n === 3) return { rows: [{ id: 9 }] }
      return { rows: [row()] }
    })
    const res = await request(build())
      .post('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 5, type: 'vacation', startDate: '2026-09-20', endDate: '2026-09-21' })
    expect(res.status).toBe(201)
    expect(res.body.data.unavailability).toBeDefined()

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [{ id: 2 }] })
    const overlapRes = await request(build())
      .post('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 5, type: 'vacation', startDate: '2026-09-08', endDate: '2026-09-09' })
    expect(overlapRes.status).toBe(409)

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [] })
    const notFoundRes = await request(build())
      .post('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 999, type: 'sick', startDate: '2026-09-01', endDate: '2026-09-01' })
    expect(notFoundRes.status).toBe(404)

    const badTypeRes = await request(build())
      .post('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 5, type: 'holiday', startDate: '2026-09-01', endDate: '2026-09-01' })
    expect(badTypeRes.status).toBe(400)
  })

  it('doctor creates own via /me (201)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const res = await request(build())
      .post('/unavailability/me')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ type: 'sick', startDate: '2026-09-01', endDate: '2026-09-02' })
    expect(res.status).toBe(201)
  })

  it('PATCH cross-doctor is 403; non-numeric id is 400', async () => {
    query.mockResolvedValueOnce({
      rows: [{ doctor_id: 5, start_date: '2026-09-07', end_date: '2026-09-11' }],
    })
    query.mockResolvedValueOnce({ rows: [{ id: 8 }] })
    const res = await request(build())
      .patch('/unavailability/1')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ type: 'sick' })
    expect(res.status).toBe(403)

    const badId = await request(build())
      .patch('/unavailability/abc')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ type: 'sick' })
    expect(badId.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/api test`
Expected: FAIL (`unavailabilityRouter` not found).

- [ ] **Step 3: Create `validators/unavailability.ts`**

Create `apps/api/src/validators/unavailability.ts`:
```ts
export {
  createUnavailabilityAdminSchema,
  createUnavailabilitySelfSchema,
  unavailabilityQuerySchema,
  updateUnavailabilitySchema,
} from '@oncall/shared'
export { idParams } from './user'
```

- [ ] **Step 4: Register in the validators barrel**

In `apps/api/src/validators/index.ts`, append:
```ts
export * from './unavailability'
```

- [ ] **Step 5: Create `unavailability.controller.ts`**

Create `apps/api/src/controllers/unavailability.controller.ts`:
```ts
import type { NextFunction, Request, Response } from 'express'
import type { UnavailabilityQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import * as unavailabilityService from '../services/unavailability.service'

export const unavailabilityController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const unavailability = await unavailabilityService.listAll(
        req.query as UnavailabilityQuery,
      )
      res.status(200).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async listMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const unavailability = await unavailabilityService.listOwn(req.user.id)
      res.status(200).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const unavailability = await unavailabilityService.create(req.body.doctorId, req.body)
      res.status(201).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async createMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const unavailability = await unavailabilityService.createOwn(req.user.id, req.body)
      res.status(201).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const unavailability = await unavailabilityService.update(
        Number(req.params.id),
        req.body,
        req.user,
      )
      res.status(200).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      await unavailabilityService.remove(Number(req.params.id), req.user)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
}
```

- [ ] **Step 6: Create `unavailability.routes.ts` (note `/me` before `/:id`)**

Create `apps/api/src/routes/unavailability.routes.ts`:
```ts
import { Router } from 'express'
import { unavailabilityController } from '../controllers/unavailability.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  createUnavailabilityAdminSchema,
  createUnavailabilitySelfSchema,
  idParams,
  unavailabilityQuerySchema,
  updateUnavailabilitySchema,
} from '../validators/unavailability'

export const unavailabilityRouter = Router()

unavailabilityRouter.use(authenticate)
unavailabilityRouter.get('/', authorize('administrator'), validate(unavailabilityQuerySchema, 'query'), unavailabilityController.list)
unavailabilityRouter.get('/me', unavailabilityController.listMe)
unavailabilityRouter.post('/', authorize('administrator'), validate(createUnavailabilityAdminSchema, 'body'), unavailabilityController.create)
unavailabilityRouter.post('/me', validate(createUnavailabilitySelfSchema, 'body'), unavailabilityController.createMe)
unavailabilityRouter.patch('/:id', validate(idParams, 'params'), validate(updateUnavailabilitySchema, 'body'), unavailabilityController.update)
unavailabilityRouter.delete('/:id', validate(idParams, 'params'), unavailabilityController.remove)
```

- [ ] **Step 7: Wire the router into `app.ts`**

In `apps/api/src/app.ts`, add the import next to the other router imports:
```ts
import { unavailabilityRouter } from './routes/unavailability.routes'
```
and mount it after `app.use('/doctors', doctorRouter)`:
```ts
app.use('/unavailability', unavailabilityRouter)
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (unavailability.routes + all existing api tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/controllers/unavailability.controller.ts apps/api/src/routes/unavailability.routes.ts apps/api/src/validators/unavailability.ts apps/api/src/validators/index.ts apps/api/src/app.ts apps/api/src/__tests__/unavailability.routes.test.ts
git commit -m "feat(api): unavailability routes (admin collection + /me self + ownership)"
```

---

## T5 — Web unavailability service

**Files:**
- Create: `apps/web/src/services/unavailability.ts`

**Interfaces:**
- Consumes: `@oncall/shared` types; `apiGet`/`apiPost`/`apiPatch`/`apiDelete` from `@/lib/http`.
- Produces: `listAll`, `listMine`, `createForDoctor`, `createMine`, `update`, `remove`.

- [ ] **Step 1: Create `services/unavailability.ts`**

Create `apps/web/src/services/unavailability.ts`:
```ts
import type {
  CreateUnavailabilitySelfRequest,
  Unavailability,
  UnavailabilityQuery,
  UpdateUnavailabilityRequest,
} from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

function toQuery(query?: UnavailabilityQuery): string {
  if (!query) return ''
  const parts: string[] = []
  if (query.doctorId !== undefined) parts.push(`doctorId=${query.doctorId}`)
  if (query.from !== undefined) parts.push(`from=${query.from}`)
  if (query.to !== undefined) parts.push(`to=${query.to}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export async function listAll(query?: UnavailabilityQuery): Promise<Unavailability[]> {
  const { unavailability } = await apiGet<{ unavailability: Unavailability[] }>(
    `/unavailability${toQuery(query)}`,
  )
  return unavailability
}
export async function listMine(): Promise<Unavailability[]> {
  const { unavailability } = await apiGet<{ unavailability: Unavailability[] }>(
    '/unavailability/me',
  )
  return unavailability
}
export async function createForDoctor(
  doctorId: number,
  input: CreateUnavailabilitySelfRequest,
): Promise<Unavailability> {
  const { unavailability } = await apiPost<{ unavailability: Unavailability }>('/unavailability', {
    doctorId,
    ...input,
  })
  return unavailability
}
export async function createMine(input: CreateUnavailabilitySelfRequest): Promise<Unavailability> {
  const { unavailability } = await apiPost<{ unavailability: Unavailability }>(
    '/unavailability/me',
    input,
  )
  return unavailability
}
export async function update(
  id: number,
  input: UpdateUnavailabilityRequest,
): Promise<Unavailability> {
  const { unavailability } = await apiPatch<{ unavailability: Unavailability }>(
    `/unavailability/${id}`,
    input,
  )
  return unavailability
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/unavailability/${id}`)
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @oncall/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/unavailability.ts
git commit -m "feat(web): unavailability service"
```

---

## T6 — Admin Availability page, router, header

**Files:**
- Create: `apps/web/src/pages/AvailabilityPage.vue`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/components/layout/AppHeader.vue`
- Test: `apps/web/src/__tests__/AvailabilityPage.test.ts`

**Interfaces:**
- Consumes: `@/services/unavailability`; `@/services/doctor` (doctor `<select>` options); shared types + schemas; existing UI components.
- Produces: admin-only `/availability` route and the "Availability" nav link.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/AvailabilityPage.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const listAll = vi.fn()
vi.mock('@/services/unavailability', () => ({
  listAll: (...a: unknown[]) => listAll(...a),
  listMine: vi.fn(),
  createForDoctor: vi.fn(),
  createMine: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
const doctorList = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
  get: vi.fn(),
  me: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import AvailabilityPage from '../pages/AvailabilityPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  listAll.mockReset()
  doctorList.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('AvailabilityPage', () => {
  it('renders the list on mount', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([
      {
        id: 1,
        doctorId: 5,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        type: 'vacation',
        startDate: '2026-09-07',
        endDate: '2026-09-11',
        note: 'Summer break',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Jane')
    expect(wrapper.text()).toContain('2026-09-07')
  })

  it('shows an error when listing fails', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockRejectedValue(new Error('nope'))
    const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/web test`
Expected: FAIL (`AvailabilityPage` not found).

- [ ] **Step 3: Create `AvailabilityPage.vue`**

Create `apps/web/src/pages/AvailabilityPage.vue`:
```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type {
  CreateUnavailabilitySelfRequest,
  Doctor,
  Unavailability,
  UpdateUnavailabilityRequest,
} from '@oncall/shared'
import { createUnavailabilityAdminSchema, updateUnavailabilitySchema } from '@oncall/shared'
import * as unavailabilityService from '@/services/unavailability'
import * as doctorService from '@/services/doctor'
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

const TYPES = ['vacation', 'sick', 'conference', 'other'] as const

const records = ref<Unavailability[]>([])
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')

const filterDoctorId = ref<string>('')
const filterFrom = ref('')
const filterTo = ref('')

interface EditState {
  open: boolean
  id: number | null
  doctorId: string
  type: (typeof TYPES)[number]
  startDate: string
  endDate: string
  note: string
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  doctorId: '',
  type: 'vacation',
  startDate: '',
  endDate: '',
  note: '',
})
const edit = ref<EditState>(emptyEdit())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const query = {
      doctorId: filterDoctorId.value ? Number(filterDoctorId.value) : undefined,
      from: filterFrom.value || undefined,
      to: filterTo.value || undefined,
    }
    records.value = await unavailabilityService.listAll(query)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load availability'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

function openUpdate(x: Unavailability) {
  edit.value = {
    open: true,
    id: x.id,
    doctorId: String(x.doctorId),
    type: x.type,
    startDate: x.startDate,
    endDate: x.endDate,
    note: x.note ?? '',
  }
}

async function save() {
  errorMsg.value = ''
  if (edit.value.id === null) {
    const payload = {
      doctorId: Number(edit.value.doctorId),
      type: edit.value.type,
      startDate: edit.value.startDate,
      endDate: edit.value.endDate,
      note: edit.value.note || undefined,
    }
    const r = createUnavailabilityAdminSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await unavailabilityService.createForDoctor(r.data.doctorId, {
      type: r.data.type,
      startDate: r.data.startDate,
      endDate: r.data.endDate,
      note: r.data.note,
    })
  } else {
    const payload: UpdateUnavailabilityRequest = {
      type: edit.value.type,
      startDate: edit.value.startDate,
      endDate: edit.value.endDate,
      note: edit.value.note === '' ? null : edit.value.note,
    }
    const r = updateUnavailabilitySchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await unavailabilityService.update(edit.value.id, r.data)
  }
  edit.value = emptyEdit()
  await load()
}

async function remove(x: Unavailability) {
  if (!confirm(`Delete ${x.doctorFirstName} ${x.doctorLastName}'s ${x.type} record?`)) return
  await unavailabilityService.remove(x.id)
  await load()
}

onMounted(async () => {
  try {
    doctors.value = await doctorService.list()
  } catch {
    doctors.value = []
  }
  await load()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Availability</h1>
      <Button @click="openCreate">New exclusion</Button>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="f-doctor">Doctor</Label>
        <select
          id="f-doctor"
          v-model="filterDoctorId"
          class="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All</option>
          <option v-for="d in doctors" :key="d.id" :value="d.id">
            {{ d.firstName }} {{ d.lastName }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <Label for="f-from">From</Label>
        <Input id="f-from" v-model="filterFrom" type="date" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="f-to">To</Label>
        <Input id="f-to" v-model="filterTo" type="date" />
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Doctor</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Start</TableHead>
          <TableHead>End</TableHead>
          <TableHead>Note</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in records" :key="x.id">
          <TableCell>{{ x.doctorFirstName }} {{ x.doctorLastName }}</TableCell>
          <TableCell>{{ x.type }}</TableCell>
          <TableCell>{{ x.startDate }}</TableCell>
          <TableCell>{{ x.endDate }}</TableCell>
          <TableCell>{{ x.note ?? '' }}</TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(x)">Edit</Button>
              <Button size="sm" variant="destructive" @click="remove(x)">Delete</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New exclusion' : 'Edit exclusion'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="e-doctor">Doctor</Label>
          <select
            id="e-doctor"
            v-model="edit.doctorId"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="" disabled>Select a doctor</option>
            <option v-for="d in doctors" :key="d.id" :value="d.id">
              {{ d.firstName }} {{ d.lastName }}
            </option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-type">Type</Label>
          <select
            id="e-type"
            v-model="edit.type"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-start">Start date</Label>
          <Input id="e-start" v-model="edit.startDate" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-end">End date</Label>
          <Input id="e-end" v-model="edit.endDate" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-note">Note (optional)</Label>
          <Input id="e-note" v-model="edit.note" />
        </div>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
```

- [ ] **Step 4: Register the route**

In `apps/web/src/router/index.ts`, add inside the `DefaultLayout` children array, after the `doctors` route:
```ts
      {
        path: 'availability',
        name: 'availability',
        component: () => import('../pages/AvailabilityPage.vue'),
        meta: { roles: ['administrator'] },
      },
```

- [ ] **Step 5: Add the admin nav link**

In `apps/web/src/components/layout/AppHeader.vue`, add right after the Doctors `RouterLink`:
```vue
        <RouterLink v-if="auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/availability">Availability</RouterLink>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @oncall/web test`
Expected: PASS (AvailabilityPage + existing web tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/AvailabilityPage.vue apps/web/src/router/index.ts apps/web/src/components/layout/AppHeader.vue apps/web/src/__tests__/AvailabilityPage.test.ts
git commit -m "feat(web): admin Availability page, route, header link"
```

---

## T7 — Doctor My Availability page, router, header

**Files:**
- Create: `apps/web/src/pages/MyAvailabilityPage.vue`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/components/layout/AppHeader.vue`
- Test: `apps/web/src/__tests__/MyAvailabilityPage.test.ts`

**Interfaces:**
- Consumes: `@/services/unavailability`; shared types + schemas; existing UI components.
- Produces: `/my-availability` route (any authenticated) and the doctor "My availability" nav link.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/MyAvailabilityPage.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const listMine = vi.fn()
vi.mock('@/services/unavailability', () => ({
  listAll: vi.fn(),
  listMine: (...a: unknown[]) => listMine(...a),
  createForDoctor: vi.fn(),
  createMine: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import MyAvailabilityPage from '../pages/MyAvailabilityPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  listMine.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('MyAvailabilityPage', () => {
  it('renders own records on mount', async () => {
    listMine.mockResolvedValue([
      {
        id: 1,
        doctorId: 5,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        type: 'sick',
        startDate: '2026-09-15',
        endDate: '2026-09-15',
        note: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('sick')
    expect(wrapper.text()).toContain('2026-09-15')
  })

  it('shows an error when listing fails', async () => {
    listMine.mockRejectedValue(new Error('nope'))
    const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/web test`
Expected: FAIL (`MyAvailabilityPage` not found).

- [ ] **Step 3: Create `MyAvailabilityPage.vue`**

Create `apps/web/src/pages/MyAvailabilityPage.vue`:
```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CreateUnavailabilitySelfRequest, Unavailability, UpdateUnavailabilityRequest } from '@oncall/shared'
import { createUnavailabilitySelfSchema, updateUnavailabilitySchema } from '@oncall/shared'
import * as unavailabilityService from '@/services/unavailability'
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

const TYPES = ['vacation', 'sick', 'conference', 'other'] as const

const records = ref<Unavailability[]>([])
const loading = ref(false)
const errorMsg = ref('')

interface EditState {
  open: boolean
  id: number | null
  type: (typeof TYPES)[number]
  startDate: string
  endDate: string
  note: string
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  type: 'vacation',
  startDate: '',
  endDate: '',
  note: '',
})
const edit = ref<EditState>(emptyEdit())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    records.value = await unavailabilityService.listMine()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load availability'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

function openUpdate(x: Unavailability) {
  edit.value = {
    open: true,
    id: x.id,
    type: x.type,
    startDate: x.startDate,
    endDate: x.endDate,
    note: x.note ?? '',
  }
}

async function save() {
  errorMsg.value = ''
  const base = {
    type: edit.value.type,
    startDate: edit.value.startDate,
    endDate: edit.value.endDate,
    note: edit.value.note || undefined,
  }
  if (edit.value.id === null) {
    const r = createUnavailabilitySelfSchema.safeParse(base)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    const payload: CreateUnavailabilitySelfRequest = {
      type: r.data.type,
      startDate: r.data.startDate,
      endDate: r.data.endDate,
      note: r.data.note,
    }
    await unavailabilityService.createMine(payload)
  } else {
    const payload: UpdateUnavailabilityRequest = {
      type: edit.value.type,
      startDate: edit.value.startDate,
      endDate: edit.value.endDate,
      note: edit.value.note === '' ? null : edit.value.note,
    }
    const r = updateUnavailabilitySchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await unavailabilityService.update(edit.value.id, r.data)
  }
  edit.value = emptyEdit()
  await load()
}

async function remove(x: Unavailability) {
  if (!confirm(`Delete your ${x.type} record (${x.startDate} → ${x.endDate})?`)) return
  await unavailabilityService.remove(x.id)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">My availability</h1>
      <Button @click="openCreate">New exclusion</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Start</TableHead>
          <TableHead>End</TableHead>
          <TableHead>Note</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in records" :key="x.id">
          <TableCell>{{ x.type }}</TableCell>
          <TableCell>{{ x.startDate }}</TableCell>
          <TableCell>{{ x.endDate }}</TableCell>
          <TableCell>{{ x.note ?? '' }}</TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(x)">Edit</Button>
              <Button size="sm" variant="destructive" @click="remove(x)">Delete</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New exclusion' : 'Edit exclusion'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="m-type">Type</Label>
          <select
            id="m-type"
            v-model="edit.type"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="m-start">Start date</Label>
          <Input id="m-start" v-model="edit.startDate" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="m-end">End date</Label>
          <Input id="m-end" v-model="edit.endDate" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="m-note">Note (optional)</Label>
          <Input id="m-note" v-model="edit.note" />
        </div>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
```

- [ ] **Step 4: Register the route**

In `apps/web/src/router/index.ts`, add inside the `DefaultLayout` children array (any position; no `roles` meta — any authenticated user may access; admin gets 404 from the API):
```ts
      {
        path: 'my-availability',
        name: 'my-availability',
        component: () => import('../pages/MyAvailabilityPage.vue'),
      },
```

- [ ] **Step 5: Add the doctor nav link**

In `apps/web/src/components/layout/AppHeader.vue`, add right before the Profile `RouterLink`:
```vue
        <RouterLink v-if="!auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/my-availability">My availability</RouterLink>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @oncall/web test`
Expected: PASS (MyAvailabilityPage + existing web tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/MyAvailabilityPage.vue apps/web/src/router/index.ts apps/web/src/components/layout/AppHeader.vue apps/web/src/__tests__/MyAvailabilityPage.test.ts
git commit -m "feat(web): doctor My availability page, route, header link"
```

---

## T8 — README status + final monorepo verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- None (documentation + verification only).

- [ ] **Step 1: Update the README**

1a. In the **Status** section, change "Remaining business features (availability, scheduling, reports) arrive in later phases." to note Phase 4 is complete, and add a Phase 4 paragraph after the Phase 3 paragraph:

> **Phase 4 — Availability Management** is complete. This phase adds a `unavailability` table of doctor exclusions (inclusive whole-day date ranges with a type of vacation/sick/conference/other and an optional note), an admin Availability page (manage any doctor's exclusions with optional date/doctor filters), and a doctor My Availability page (self-service). Doctors are available by default; overlapping records are rejected (409). The scheduling engine (Phase 5) consumes these exclusions.

1b. In the **Roadmap** list, mark item 4 complete:
```
4. Availability Management (complete)
```

1c. Update the "Remaining business features…" sentence to: "Remaining business features (scheduling, schedule UI, statistics, reports) arrive in later phases."

1d. Add a **Definition of Done (Phase 4)** section after the Phase 3 DoD, mirroring spec §8.3:
```markdown
## Definition of Done (Phase 4)

- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone; sample unavailability rows are seeded.
- A doctor can list/create/edit/delete their own exclusions on `/my-availability`; an admin gets 404 on `/unavailability/me`.
- An admin can list all doctors' exclusions (optional `doctorId`/date filters), create for any doctor, and edit/delete any record; a doctor gets 403 on `GET /unavailability` and `POST /unavailability`.
- Overlapping record → 409; `endDate < startDate` → 400; non-numeric `:id` → 400; unknown doctor → 404; a doctor editing another doctor's record → 403.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.
```

1e. Append the Phase 4 design + plan paths to the **Documentation** list:
```markdown
- Phase 4 design: `docs/superpowers/specs/2026-08-07-phase4-availability-design.md`
- Phase 4 implementation plan: `docs/superpowers/plans/2026-08-07-phase4-availability-plan.md`
```

- [ ] **Step 2: Run the full monorepo verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS across `@oncall/shared`, `@oncall/api`, `@oncall/web`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Phase 4 availability management status, definition of done"
```
