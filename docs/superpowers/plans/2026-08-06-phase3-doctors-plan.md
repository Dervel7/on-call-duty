# Phase 3 — Doctor Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add doctor profiles (1:1 with `users`) with a combined admin create flow, an admin-only Doctors page, and a read-only doctor self-view — the only stored profile attribute is `max_monthly_duties` (1–7).

**Architecture:** A new `doctors` table is linked 1:1 to `users(id)` via a unique `ON DELETE CASCADE` FK. `@oncall/shared` owns the doctor contract (types + zod). The backend reuses the Phase 2 layering and adds one reusable `withTransaction` primitive to `db/client.ts`; `doctor.service.create`/`update` run account + profile writes atomically. The Doctors page owns doctor creation (account + profile together); the Phase 2 Users page is narrowed to administrator-only creation. Deleting a doctor deletes the underlying user (cascade).

**Tech Stack:** Node.js + TypeScript + Express 4, PostgreSQL via `pg`, `bcrypt`, `zod`, Vitest + `supertest`. Vue 3 + Pinia + Vue Router + `@vueuse/core`, hand-rolled shadcn-vue components, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-06-phase3-doctors-design.md`

**Branch:** `feat/phase3-doctors` (branched from `feat/phase2-auth`). Commit per task on this branch.

---

## Global Constraints

Carry these verbatim into every task — they are non-negotiable project rules.

- **Runtime:** Node 20+ (developed on 24), pnpm 10+, PostgreSQL 14+ (developed on 17).
- **TypeScript:** `strict`, `noUncheckedIndexedAccess` (index access is `T | undefined`), `verbatimModuleSyntax` (use `import type` for type-only imports), `isolatedModules`, `esModuleInterop`. No `any` where `unknown` works.
- **ESLint:** unused args/vars/caught errors must be prefixed with `_`. Recommended TS + `vue3-recommended` rules at defaults. **No Prettier**; no formatting scripts.
- **DB:** parameterized queries only (`$1` placeholders), snake_case columns, camelCase API contract. Service layer maps between them. **No ORM.**
- **`schema.sql`/`seed.sql`:** idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT`). **No triggers/functions** — the DB runner splits statements on `;`.
- **Auth:** bcrypt cost factor **12**; password min length **6** (lives in shared zod schema once); access token in memory only; refresh cookie `httpOnly + Secure(prod) + SameSite=Lax`, path `/auth`, rotated on use.
- **Doctor policy:** `max_monthly_duties` is an integer **1–7**, default **7** (shared zod schema + DB `CHECK`). Initial doctor password = the email (Phase 2 convention).
- **Response envelope:** `{ success: true, data }` or `{ success: false, error }`. HTTP status always set: 200/201/204 success; 400 validation; 401 unauth; 403 forbidden; 404 not found; 409 duplicate; 500 server error.
- **Frontend components:** hand-rolled using existing `cn()` + token classes. Do not introduce `reka-ui`/`radix-vue`.
- **Commits:** conventional commits (`feat:`, `test:`, `chore:`, `docs:`). Commit per task on `feat/phase3-doctors`. **Never commit `.env`.**
- **No comments in code** unless explicitly requested.
- **Verification per task:** after implementation, run the task's test command and `pnpm typecheck` + `pnpm lint` for the affected package before committing.

---

## Architecture notes (implementation choices for spec-silent details)

These fill in details the spec leaves open and follow the approved spec exactly where it speaks.

1. **`withTransaction` passes the raw `PoolClient`.** The callback calls `client.query(text, params)`; `@types/pg` returns `QueryResult` with `rows: any[]`, so no per-call casts are needed inside the callback. The pool-level `query<T>` generic is unchanged and still used for non-transactional reads.
2. **`doctor.service.create` returns the joined doctor by calling `getByUserId(userId)` after the transaction commits** (single-request, so the just-committed row is visible). This avoids duplicating the join SQL and keeps a single row-mapper.
3. **`update` is always wrapped in `withTransaction`** even when only one table changes, so the two-table case and the one-table case share one code path and `updated_at` stays consistent.
4. **`/doctors/me` is registered before `/doctors/:id`** so the literal `me` is not swallowed by the numeric `:id` param validator.
5. **Initial password = email** on doctor create (no password field in the form), matching `UsersPage.vue`'s Phase 2 behavior.
6. **No new shadcn-vue components.** The Doctors page reuses `Table*`, `Dialog`, `Input`, `Label`, `Button`.

---

## Task ordering & dependencies

```
T1 (shared + AGENTS) ─┬─> T4 (doctor.service) ─> T5 (routes+controller) ─┐
T2 (db schema+seed) ──┤        ▲                                              │
T3 (withTransaction) ─┴────────┘                                              ├─> T9 (README + verify)
T1 ─> T6 (web service) ─> T7 (DoctorsPage + router + header) ─────────────────┤
T1, T6 ─> T8 (UsersPage narrow + Profile self-view) ──────────────────────────┘
```

Suggested linear execution: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9. (T1, T2, T3 are mutually independent and may be parallelized; T6 is independent of the backend.)

---

## T1 — Shared contract (types + zod schemas) + AGENTS.md domain rules

**Files:**
- Modify: `packages/shared/src/types/doctor.ts` (create)
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/schemas/doctor.ts` (create)
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces (values): `createDoctorSchema`, `updateDoctorSchema` (re-exported from `@oncall/shared`).
- Produces (types): `Doctor`, `CreateDoctorRequest`, `UpdateDoctorRequest`.

- [ ] **Step 1: Create `packages/shared/src/types/doctor.ts`**

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

- [ ] **Step 2: Re-export the types**

`packages/shared/src/types/index.ts` — append inside the existing file:
```ts
export type { Doctor, CreateDoctorRequest, UpdateDoctorRequest } from './doctor'
```

- [ ] **Step 3: Create `packages/shared/src/schemas/doctor.ts`**

```ts
import { z } from 'zod'

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

- [ ] **Step 4: Re-export the schemas**

`packages/shared/src/schemas/index.ts` — append:
```ts
export { createDoctorSchema, updateDoctorSchema } from './doctor'
```

- [ ] **Step 5: Write the failing tests**

Append to `packages/shared/src/__tests__/schemas.test.ts`:
```ts
import { createDoctorSchema, updateDoctorSchema } from '../index'

describe('doctor schemas', () => {
  const valid = {
    email: 'dr@h.com',
    password: 'secret1',
    firstName: 'Jane',
    lastName: 'Roe',
  }

  it('createDoctorSchema applies default 7 and rejects out-of-range limits', () => {
    const r = createDoctorSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.maxMonthlyDuties).toBe(7)

    expect(
      createDoctorSchema.safeParse({ ...valid, maxMonthlyDuties: 0 }).success,
    ).toBe(false)
    expect(
      createDoctorSchema.safeParse({ ...valid, maxMonthlyDuties: 8 }).success,
    ).toBe(false)
    expect(
      createDoctorSchema.safeParse({ ...valid, maxMonthlyDuties: 4 }).success,
    ).toBe(true)
  })

  it('createDoctorSchema rejects missing names and short password', () => {
    expect(createDoctorSchema.safeParse({ ...valid, firstName: '' }).success).toBe(false)
    expect(
      createDoctorSchema.safeParse({ ...valid, password: '12345' }).success,
    ).toBe(false)
  })

  it('updateDoctorSchema accepts partials and enforces the range', () => {
    expect(updateDoctorSchema.safeParse({ maxMonthlyDuties: 3 }).success).toBe(true)
    expect(updateDoctorSchema.safeParse({ maxMonthlyDuties: 9 }).success).toBe(false)
    expect(updateDoctorSchema.safeParse({ isActive: false }).success).toBe(true)
  })
})
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @oncall/shared test`
Expected: PASS (new doctor schema tests + existing auth schema tests).

- [ ] **Step 7: Add the Domain Rules section to `AGENTS.md`**

Insert a new section immediately **before** the line `## Scheduling Engine Requirements`. The oldString to match is exactly:

```
## Scheduling Engine Requirements
```

Replace with:
```
## Domain Rules

- Regular weekday shift: **07:00–15:00**.
- On-call duty spans **07:00 → next day 15:00** (overnight; hands off at next day's 15:00).
- Max **7 on-call duties per month** per doctor (the cap on `doctors.max_monthly_duties`, 1–7).
- Max **1 consecutive on-call duty** — a doctor cannot be assigned on back-to-back days. Fixed system rule consumed by the scheduling engine.
- On-call duties can fall on **any day**, including weekends.

## Scheduling Engine Requirements
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared AGENTS.md
git commit -m "feat(shared): add doctor types and zod schemas; AGENTS domain rules"
```

---

## T2 — Database schema + seed

**Files:**
- Modify: `database/schema.sql` (append Phase 3 table)
- Modify: `database/seed.sql` (append sample doctors)

**Interfaces:**
- Produces (DB): table `doctors(id, user_id UNIQUE, max_monthly_duties [1–7 default 7], created_at, updated_at)` with `user_id … REFERENCES users(id) ON DELETE CASCADE`.
- Produces (seed): three doctor accounts (`role='doctor'`, password = email) each with a linked profile.

- [ ] **Step 1: Append Phase 3 table to `schema.sql`**

Append to `database/schema.sql`:
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

- [ ] **Step 2: Append sample doctors to `seed.sql`**

The bcrypt hashes below (cost 12) are for the documented default **password = email** for each doctor. Generated offline; the README documents the convention and "change on first login."

Append to `database/seed.sql`:
```sql

-- Phase 3: seed sample doctors (password = email; change on first login)
INSERT INTO users (email, password_hash, role, first_name, last_name, is_active)
VALUES
  ('dr1@oncall.local', '$2b$12$sf0hxnuWvwI17HpZNo.VBubjp35/R3CXtabJsFMpjQxA/erV9m21G', 'doctor', 'Jane',  'Roe',   TRUE),
  ('dr2@oncall.local', '$2b$12$CxcEXDtGy52WGatK9YCNlOdyS6yp1uNd4Ac8f68YZOmHYXN2HR8Sq', 'doctor', 'John',  'Smith', TRUE),
  ('dr3@oncall.local', '$2b$12$nXzGkWp0gNlyFOj8/dp6oOQ0BH7twg.VkgYF95PqOzagOTZsBrJOW', 'doctor', 'Maria', 'Garcia', TRUE)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();

INSERT INTO doctors (user_id, max_monthly_duties)
VALUES
  ((SELECT id FROM users WHERE email = 'dr1@oncall.local'), 7),
  ((SELECT id FROM users WHERE email = 'dr2@oncall.local'), 5),
  ((SELECT id FROM users WHERE email = 'dr3@oncall.local'), 7)
ON CONFLICT (user_id) DO UPDATE SET
  max_monthly_duties = EXCLUDED.max_monthly_duties,
  updated_at         = NOW();
```

- [ ] **Step 3: Apply the schema + seed**

Ensure `apps/api/.env` has a working `DATABASE_URL`, then:
Run: `pnpm db:setup`
Expected: completes without error.

- [ ] **Step 4: Verify the doctor rows exist**

Run from repo root (uses hoisted `pg` + `dotenv`):
```bash
node -e "require('dotenv').config({path:'apps/api/.env'}); const {Client}=require('pg'); const c=new Client({connectionString:process.env.DATABASE_URL}); (async()=>{await c.connect(); const d=await c.query('SELECT u.email, u.role, d.max_monthly_duties FROM doctors d JOIN users u ON u.id=d.user_id ORDER BY u.email'); console.log('DOCTORS', d.rows); await c.end();})().catch(e=>{console.error(e); process.exit(1);})"
```
Expected: three rows — `dr1@…/7`, `dr2@…/5`, `dr3@…/7`, all `role=doctor`.

- [ ] **Step 5: Commit**

```bash
git add database/schema.sql database/seed.sql
git commit -m "feat(db): add doctors table + seed sample doctors"
```

---

## T3 — `withTransaction` helper

**Files:**
- Modify: `apps/api/src/db/client.ts`
- Test: `apps/api/src/__tests__/db-client.test.ts`

**Interfaces:**
- Produces: `withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>` — checks out a client, runs `BEGIN`, executes `work(client)`, `COMMIT`s on success; on throw, `ROLLBACK`s and rethrows; always `release()`s. The callback calls `client.query(text, params)`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/db-client.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const release = vi.fn()
const connect = vi.fn()

vi.mock('../config/env', () => ({ env: { DATABASE_URL: 'postgres://x' } }))
vi.mock('pg', () => {
  class Pool {
    connect = connect
  }
  return { Pool }
})

import { withTransaction } from '../db/client'

beforeEach(() => {
  query.mockReset()
  release.mockReset()
  connect.mockReset()
  connect.mockResolvedValue({ query, release })
})

describe('withTransaction', () => {
  it('runs BEGIN / work / COMMIT and releases on success', async () => {
    const calls: string[] = []
    query.mockImplementation(async (sql: string) => {
      calls.push(sql)
      return { rows: [] }
    })
    const result = await withTransaction(async (client) => {
      await client.query('SELECT 1')
      return 42
    })
    expect(result).toBe(42)
    expect(calls).toEqual(['BEGIN', 'SELECT 1', 'COMMIT'])
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('runs ROLLBACK and rethrows on failure', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(
      withTransaction(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
    expect(release).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/api test`
Expected: FAIL (`withTransaction is not a function`).

- [ ] **Step 3: Implement `withTransaction`**

Replace `apps/api/src/db/client.ts` with:
```ts
import { type PoolClient, type QueryResult, type QueryResultRow, Pool } from 'pg'
import { env } from '../config/env'

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (db-client tests + all existing api tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/client.ts apps/api/src/__tests__/db-client.test.ts
git commit -m "feat(api): withTransaction helper for atomic multi-table writes"
```

---

## T4 — `doctor.service`

**Files:**
- Create: `apps/api/src/services/doctor.service.ts`
- Test: `apps/api/src/__tests__/doctor.service.test.ts`

**Interfaces:**
- Consumes: `query`, `withTransaction` from `db/client`; `bcrypt`; `HttpError`; shared types.
- Produces: `list(): Promise<Doctor[]>`; `getById(id): Promise<Doctor>` (404); `getByUserId(userId): Promise<Doctor>` (404, used by `/doctors/me`); `create(input: CreateDoctorRequest): Promise<Doctor>` (409 duplicate email; transactional); `update(id, input: UpdateDoctorRequest): Promise<Doctor>` (404; transactional); `remove(id): Promise<void>` (404; deletes the underlying user → cascade).

- [ ] **Step 1: Write the failing test (db + bcrypt mocked)**

Create `apps/api/src/__tests__/doctor.service.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (client: { query: typeof query }) => Promise<unknown>) =>
    work({ query }),
}))

const hash = vi.fn(async () => 'HASH')
vi.mock('bcrypt', () => ({ default: { hash: (...a: unknown[]) => hash(...a) } }))

import {
  create,
  getByUserId,
  list,
  remove,
  update,
} from '../services/doctor.service'

function doctorRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    user_id: 10,
    email: 'd@h.com',
    first_name: 'Jane',
    last_name: 'Roe',
    is_active: true,
    max_monthly_duties: 7,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
  hash.mockReset()
  hash.mockResolvedValue('HASH')
})

describe('doctor.service', () => {
  it('list maps joined rows to Doctor', async () => {
    query.mockResolvedValue({ rows: [doctorRow(), doctorRow({ id: 2, email: 'x@y.z' })] })
    const ds = await list()
    expect(ds).toHaveLength(2)
    expect(ds[0].firstName).toBe('Jane')
    expect(typeof ds[0].createdAt).toBe('string')
  })

  it('getByUserId throws 404 when no profile (used by /me)', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getByUserId(9)).rejects.toMatchObject({ status: 404 })
  })

  it('create rejects duplicate email with 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      create({ email: 'd@h.com', password: 'secret1', firstName: 'J', lastName: 'R' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('create inserts user (role=doctor) + doctor in a transaction and returns the joined doctor', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [] }
      if (n === 2) return { rows: [{ id: 10 }] }
      if (n === 3) return { rows: [] }
      return { rows: [doctorRow({ user_id: 10, max_monthly_duties: 5 })] }
    })
    const d = await create({
      email: 'd@h.com',
      password: 'secret1',
      firstName: 'Jane',
      lastName: 'Roe',
      maxMonthlyDuties: 5,
    })
    expect(d.userId).toBe(10)
    expect(d.maxMonthlyDuties).toBe(5)
    const insertUserSql = query.mock.calls[1]?.[0] as string
    expect(insertUserSql).toContain("'doctor'")
    expect((query.mock.calls[2]?.[1] as unknown[])).toEqual([10, 5])
    expect(hash).toHaveBeenCalledWith('secret1', 12)
  })

  it('update writes users + doctors tables when both field groups are present', async () => {
    query.mockResolvedValueOnce({ rows: [{ user_id: 5 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 1, user_id: 5, max_monthly_duties: 3 })] })
    const d = await update(1, { firstName: 'Janet', maxMonthlyDuties: 3 })
    expect(d.maxMonthlyDuties).toBe(3)
    const updateUserSql = query.mock.calls[1]?.[0] as string
    expect(updateUserSql).toContain('UPDATE users')
    expect(updateUserSql).toContain('first_name')
    const updateDoctorSql = query.mock.calls[2]?.[0] as string
    expect(updateDoctorSql).toContain('UPDATE doctors')
  })

  it('remove deletes the underlying user row (cascade)', async () => {
    query.mockResolvedValueOnce({ rows: [{ user_id: 7 }] })
    query.mockResolvedValueOnce({ rows: [] })
    await remove(2)
    const del = query.mock.calls[1]?.[0] as string
    expect(del).toContain('DELETE FROM users')
    expect((query.mock.calls[1]?.[1] as unknown[])[0]).toBe(7)
  })

  it('remove throws 404 when doctor missing', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(remove(99)).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/api test`
Expected: FAIL (module `../services/doctor.service` not found).

- [ ] **Step 3: Implement `doctor.service.ts`**

Create `apps/api/src/services/doctor.service.ts`:
```ts
import bcrypt from 'bcrypt'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import type { CreateDoctorRequest, Doctor, UpdateDoctorRequest } from '@oncall/shared'

interface DoctorRow {
  id: number
  user_id: number
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  max_monthly_duties: number
  created_at: Date
  updated_at: Date
}

const SELECT = `SELECT d.id, d.user_id, d.max_monthly_duties, d.created_at, d.updated_at,
  u.email, u.first_name, u.last_name, u.is_active
  FROM doctors d JOIN users u ON u.id = d.user_id`

function toDoctor(row: DoctorRow): Doctor {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    isActive: row.is_active,
    maxMonthlyDuties: row.max_monthly_duties,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function list(): Promise<Doctor[]> {
  const res = await query<DoctorRow>(`${SELECT} ORDER BY u.last_name, u.first_name`, [])
  return res.rows.map(toDoctor)
}

export async function getById(id: number): Promise<Doctor> {
  const res = await query<DoctorRow>(`${SELECT} WHERE d.id = $1`, [id])
  if (res.rows.length === 0) throw new HttpError(404, 'Doctor not found')
  return toDoctor(res.rows[0])
}

export async function getByUserId(userId: number): Promise<Doctor> {
  const res = await query<DoctorRow>(`${SELECT} WHERE d.user_id = $1`, [userId])
  if (res.rows.length === 0) throw new HttpError(404, 'Doctor not found')
  return toDoctor(res.rows[0])
}

export async function create(input: CreateDoctorRequest): Promise<Doctor> {
  const userId = await withTransaction(async (client) => {
    const dup = await client.query('SELECT id FROM users WHERE email = $1', [input.email])
    if (dup.rows.length > 0) throw new HttpError(409, 'Email already in use')
    const passwordHash = await bcrypt.hash(input.password, 12)
    const ins = await client.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, 'doctor', $3, $4) RETURNING id`,
      [input.email, passwordHash, input.firstName, input.lastName],
    )
    const id = ins.rows[0]?.id
    if (id === undefined) throw new HttpError(500, 'Failed to create user')
    await client.query(
      'INSERT INTO doctors (user_id, max_monthly_duties) VALUES ($1, $2)',
      [id, input.maxMonthlyDuties ?? 7],
    )
    return id
  })
  return getByUserId(userId)
}

export async function update(id: number, input: UpdateDoctorRequest): Promise<Doctor> {
  const existing = await query<{ user_id: number }>(
    'SELECT user_id FROM doctors WHERE id = $1',
    [id],
  )
  if (existing.rows.length === 0) throw new HttpError(404, 'Doctor not found')
  const userId = existing.rows[0].user_id

  await withTransaction(async (client) => {
    const sets: string[] = []
    const params: unknown[] = []
    const map: Array<[string, unknown]> = [
      ['email', input.email],
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
    if (sets.length > 0) {
      params.push(new Date())
      sets.push(`updated_at = $${params.length}`)
      params.push(userId)
      await client.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      )
    }
    if (input.maxMonthlyDuties !== undefined) {
      await client.query(
        'UPDATE doctors SET max_monthly_duties = $1, updated_at = NOW() WHERE id = $2',
        [input.maxMonthlyDuties, id],
      )
    }
  })
  return getById(id)
}

export async function remove(id: number): Promise<void> {
  const existing = await query<{ user_id: number }>(
    'SELECT user_id FROM doctors WHERE id = $1',
    [id],
  )
  if (existing.rows.length === 0) throw new HttpError(404, 'Doctor not found')
  await query('DELETE FROM users WHERE id = $1', [existing.rows[0].user_id])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @oncall/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/doctor.service.ts apps/api/src/__tests__/doctor.service.test.ts
git commit -m "feat(api): doctor service (transactional create/update, cascade remove)"
```

---

## T5 — Controller, routes, validators, app wiring

**Files:**
- Create: `apps/api/src/controllers/doctor.controller.ts`
- Create: `apps/api/src/routes/doctor.routes.ts`
- Create: `apps/api/src/validators/doctor.ts`
- Modify: `apps/api/src/validators/index.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/__tests__/doctor.routes.test.ts`

**Interfaces:**
- Consumes: `doctor.service`; `authenticate`, `authorize`, `validate`; shared schemas; `idParams` (existing, in `validators/user.ts`).
- Produces: `doctorRouter` mounted at `/doctors` with `GET /`, `GET /me`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`.

- [ ] **Step 1: Write the failing route test**

Create `apps/api/src/__tests__/doctor.routes.test.ts`:
```ts
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))
vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async () => 'HASH'), compare: vi.fn(async () => true) },
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { doctorRouter } from '../routes/doctor.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/doctors', doctorRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

const row = () => ({
  id: 1,
  user_id: 10,
  email: 'd@h.com',
  first_name: 'Jane',
  last_name: 'Roe',
  is_active: true,
  max_monthly_duties: 7,
  created_at: new Date(),
  updated_at: new Date(),
})

beforeEach(() => query.mockReset())

describe('doctor routes', () => {
  it('admin lists doctors (200, envelope)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .get('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.doctors).toEqual([])
  })

  it('unauthenticated is 401', async () => {
    const res = await request(build()).get('/doctors')
    expect(res.status).toBe(401)
  })

  it('doctor is forbidden from the admin list (403)', async () => {
    const res = await request(build())
      .get('/doctors')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('doctor reads own profile via /doctors/me (200)', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const res = await request(build())
      .get('/doctors/me')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.doctor.userId).toBe(10)
  })

  it('non-numeric :id is 400', async () => {
    const res = await request(build())
      .get('/doctors/abc')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('admin creates a doctor (201)', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [] }
      if (n === 2) return { rows: [{ id: 12 }] }
      if (n === 3) return { rows: [] }
      return { rows: [row()] }
    })
    const res = await request(build())
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@h.com', password: 'secret1', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(201)
    expect(res.body.data.doctor).toBeDefined()
  })

  it('admin create with out-of-range maxMonthlyDuties is 400', async () => {
    const res = await request(build())
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@h.com', password: 'secret1', firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 9 })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/api test`
Expected: FAIL (`doctorRouter` not found).

- [ ] **Step 3: Create `validators/doctor.ts`**

Create `apps/api/src/validators/doctor.ts`:
```ts
export { createDoctorSchema, updateDoctorSchema } from '@oncall/shared'
export { idParams } from './user'
```

- [ ] **Step 4: Register in the validators barrel**

`apps/api/src/validators/index.ts`:
```ts
export * from './auth'
export * from './doctor'
export * from './user'
```

- [ ] **Step 5: Create `doctor.controller.ts`**

Create `apps/api/src/controllers/doctor.controller.ts`:
```ts
import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import * as doctorService from '../services/doctor.service'

export const doctorController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const doctors = await doctorService.list()
      res.status(200).json(ok({ doctors }))
    } catch (err) {
      next(err)
    }
  },
  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const doctor = await doctorService.getByUserId(req.user.id)
      res.status(200).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await doctorService.getById(Number(req.params.id))
      res.status(200).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await doctorService.create(req.body)
      res.status(201).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await doctorService.update(Number(req.params.id), req.body)
      res.status(200).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await doctorService.remove(Number(req.params.id))
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
}
```

- [ ] **Step 6: Create `doctor.routes.ts` (note `/me` before `/:id`)**

Create `apps/api/src/routes/doctor.routes.ts`:
```ts
import { Router } from 'express'
import { doctorController } from '../controllers/doctor.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { createDoctorSchema, idParams, updateDoctorSchema } from '../validators/doctor'

export const doctorRouter = Router()

doctorRouter.use(authenticate)
doctorRouter.get('/', authorize('administrator'), doctorController.list)
doctorRouter.get('/me', doctorController.getMe)
doctorRouter.get('/:id', authorize('administrator'), validate(idParams, 'params'), doctorController.getById)
doctorRouter.post('/', authorize('administrator'), validate(createDoctorSchema, 'body'), doctorController.create)
doctorRouter.patch('/:id', authorize('administrator'), validate(idParams, 'params'), validate(updateDoctorSchema, 'body'), doctorController.update)
doctorRouter.delete('/:id', authorize('administrator'), validate(idParams, 'params'), doctorController.remove)
```

- [ ] **Step 7: Wire the router into `app.ts`**

In `apps/api/src/app.ts`, add the import next to the other router imports:
```ts
import { doctorRouter } from './routes/doctor.routes'
```
and mount it after `app.use('/users', userRouter)`:
```ts
app.use('/doctors', doctorRouter)
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (doctor.routes + all existing api tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/controllers/doctor.controller.ts apps/api/src/routes/doctor.routes.ts apps/api/src/validators/doctor.ts apps/api/src/validators/index.ts apps/api/src/app.ts apps/api/src/__tests__/doctor.routes.test.ts
git commit -m "feat(api): doctor routes (admin CRUD + /me self-view)"
```

---

## T6 — Web doctor service

**Files:**
- Create: `apps/web/src/services/doctor.ts`

**Interfaces:**
- Consumes: `@oncall/shared` types; `apiGet`/`apiPost`/`apiPatch`/`apiDelete` from `@/lib/http`.
- Produces: `list`, `get`, `me`, `create`, `update`, `remove`.

- [ ] **Step 1: Create `services/doctor.ts`**

Create `apps/web/src/services/doctor.ts`:
```ts
import type { CreateDoctorRequest, Doctor, UpdateDoctorRequest } from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

export async function list(): Promise<Doctor[]> {
  const { doctors } = await apiGet<{ doctors: Doctor[] }>('/doctors')
  return doctors
}
export async function get(id: number): Promise<Doctor> {
  const { doctor } = await apiGet<{ doctor: Doctor }>(`/doctors/${id}`)
  return doctor
}
export async function me(): Promise<Doctor> {
  const { doctor } = await apiGet<{ doctor: Doctor }>('/doctors/me')
  return doctor
}
export async function create(input: CreateDoctorRequest): Promise<Doctor> {
  const { doctor } = await apiPost<{ doctor: Doctor }>('/doctors', input)
  return doctor
}
export async function update(id: number, input: UpdateDoctorRequest): Promise<Doctor> {
  const { doctor } = await apiPatch<{ doctor: Doctor }>(`/doctors/${id}`, input)
  return doctor
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/doctors/${id}`)
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @oncall/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/doctor.ts
git commit -m "feat(web): doctor service"
```

---

## T7 — Web Doctors page, router, header

**Files:**
- Create: `apps/web/src/pages/DoctorsPage.vue`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/components/layout/AppHeader.vue`
- Test: `apps/web/src/__tests__/DoctorsPage.test.ts`

**Interfaces:**
- Consumes: `@/services/doctor`; shared types + schemas; existing UI components.
- Produces: admin-only `/doctors` route and the "Doctors" nav link.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/DoctorsPage.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => list(...a),
  get: vi.fn(),
  me: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import DoctorsPage from '../pages/DoctorsPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('DoctorsPage', () => {
  it('renders the doctor list on mount', async () => {
    list.mockResolvedValue([
      {
        id: 1,
        userId: 10,
        email: 'dr@h.com',
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthlyDuties: 7,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('dr@h.com')
    expect(wrapper.text()).toContain('Jane')
  })

  it('shows an error message when listing fails', async () => {
    list.mockRejectedValue(new Error('nope'))
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/web test`
Expected: FAIL (`DoctorsPage` not found).

- [ ] **Step 3: Create `DoctorsPage.vue`**

Create `apps/web/src/pages/DoctorsPage.vue`:
```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CreateDoctorRequest, Doctor, UpdateDoctorRequest } from '@oncall/shared'
import { createDoctorSchema, updateDoctorSchema } from '@oncall/shared'
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

const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')

interface EditState {
  open: boolean
  id: number | null
  email: string
  firstName: string
  lastName: string
  maxMonthlyDuties: string
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  email: '',
  firstName: '',
  lastName: '',
  maxMonthlyDuties: '7',
})
const edit = ref<EditState>(emptyEdit())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    doctors.value = await doctorService.list()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load doctors'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

function openUpdate(d: Doctor) {
  edit.value = {
    open: true,
    id: d.id,
    email: d.email,
    firstName: d.firstName,
    lastName: d.lastName,
    maxMonthlyDuties: String(d.maxMonthlyDuties),
  }
}

async function save() {
  errorMsg.value = ''
  if (edit.value.id === null) {
    const payload: CreateDoctorRequest = {
      email: edit.value.email,
      password: edit.value.email,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      maxMonthlyDuties: Number(edit.value.maxMonthlyDuties),
    }
    const r = createDoctorSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await doctorService.create(r.data)
  } else {
    const payload: UpdateDoctorRequest = {
      email: edit.value.email,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      maxMonthlyDuties: Number(edit.value.maxMonthlyDuties),
    }
    const r = updateDoctorSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await doctorService.update(edit.value.id, r.data)
  }
  edit.value = emptyEdit()
  await load()
}

async function toggleActive(d: Doctor) {
  await doctorService.update(d.id, { isActive: !d.isActive })
  await load()
}

async function remove(d: Doctor) {
  if (!confirm(`Delete doctor ${d.email}? This removes their account too.`)) return
  await doctorService.remove(d.id)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Doctors</h1>
      <Button @click="openCreate">New doctor</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Max monthly duties</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="d in doctors" :key="d.id">
          <TableCell>{{ d.firstName }} {{ d.lastName }}</TableCell>
          <TableCell>{{ d.email }}</TableCell>
          <TableCell>{{ d.isActive ? 'active' : 'disabled' }}</TableCell>
          <TableCell>{{ d.maxMonthlyDuties }}</TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(d)">Edit</Button>
              <Button size="sm" variant="outline" @click="toggleActive(d)">
                {{ d.isActive ? 'Disable' : 'Enable' }}
              </Button>
              <Button size="sm" variant="destructive" @click="remove(d)">Delete</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New doctor' : 'Edit doctor'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="d-email">Email</Label>
          <Input id="d-email" v-model="edit.email" type="email" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="d-first">First name</Label>
          <Input id="d-first" v-model="edit.firstName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="d-last">Last name</Label>
          <Input id="d-last" v-model="edit.lastName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="d-max">Max monthly duties (1–7)</Label>
          <Input id="d-max" v-model="edit.maxMonthlyDuties" type="number" />
        </div>
        <p v-if="edit.id === null" class="text-xs text-muted-foreground">
          Initial password equals the email. The doctor should change it on first login.
        </p>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
```

> The `Input` component emits its value as a string. `EditState.maxMonthlyDuties` is therefore a `string` (default `'7'`), coerced with `Number(...)` when building the payload so the shared `number()` zod schema is satisfied.

- [ ] **Step 4: Register the route**

In `apps/web/src/router/index.ts`, add the doctor route as a sibling of `/users` inside the `DefaultLayout` children array:
```ts
      {
        path: 'doctors',
        name: 'doctors',
        component: () => import('../pages/DoctorsPage.vue'),
        meta: { roles: ['administrator'] },
      },
```

- [ ] **Step 5: Add the nav link**

In `apps/web/src/components/layout/AppHeader.vue`, add a Doctors link right after the Users `RouterLink`:
```vue
        <RouterLink v-if="auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/doctors">Doctors</RouterLink>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @oncall/web test`
Expected: PASS (DoctorsPage + existing web tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/DoctorsPage.vue apps/web/src/router/index.ts apps/web/src/components/layout/AppHeader.vue apps/web/src/__tests__/DoctorsPage.test.ts
git commit -m "feat(web): admin Doctors page, route, header link"
```

---

## T8 — Narrow Users page (admin-only creation) + doctor self-view on Profile

**Files:**
- Modify: `apps/web/src/pages/UsersPage.vue`
- Modify: `apps/web/src/pages/ProfilePage.vue`
- Test: `apps/web/src/__tests__/UsersPage.test.ts` (extend)
- Test: `apps/web/src/__tests__/ProfilePage.test.ts` (create)

**Interfaces:**
- Consumes: `@/services/doctor` (for self-view); `@/stores/auth`.
- Produces: Users page "New user" is administrator-only (role select shown only when editing); Profile page shows a read-only doctor profile card for doctors.

- [ ] **Step 1: Extend the UsersPage test for the narrowed create**

Append to `apps/web/src/__tests__/UsersPage.test.ts`:
```ts
describe('UsersPage create narrowing', () => {
  it('create dialog is titled "New administrator" with no role selector for new users', async () => {
    list.mockResolvedValue([])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    const openBtn = wrapper.findAll('button').find((b) => b.text().includes('New user'))
    expect(openBtn).toBeTruthy()
    await openBtn?.trigger('click')
    await wrapper.vm.$nextTick()
    // The Dialog teleports to document.body, so query the document, not wrapper.
    expect(document.body.textContent).toContain('New administrator')
    expect(document.querySelector('#e-role')).toBeNull()
  })
})
```

> If `mount`/`createPinia`/`list` are not already imported at the top of the file (they are, per the existing test), do not re-import. Only add the `describe` block. The role `<select>` is hidden for new users via `v-if="edit.id !== null"`; querying `document.querySelector('#e-role')` (the teleported Dialog content) confirms it is absent.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/web test`
Expected: FAIL (title still "New user").

- [ ] **Step 3: Narrow `UsersPage.vue`**

In `apps/web/src/pages/UsersPage.vue`:

3a. Force new users to the administrator role. In `save()`, replace the create-branch payload's `role: edit.value.role` with `role: 'administrator'`. The create branch should read:
```ts
    const payload: CreateUserRequest = {
      email: edit.value.email,
      password: edit.value.email,
      role: 'administrator',
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
    }
```

3b. Show the role selector only when editing. In the template, add `v-if="edit.id !== null"` to the role `<select>` block (the `<div>` wrapping the `Label`/`select` with `for="e-role"`):
```vue
        <div v-if="edit.id !== null" class="flex flex-col gap-1">
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
```

3c. Update the Dialog title expression from `edit.id === null ? 'New user' : 'Edit user'` to `edit.id === null ? 'New administrator' : 'Edit user'`.

3d. Replace the create-only note text from "Initial password equals the email. The user should change it on first login." to "Initial password equals the email. The administrator should change it on first login."

- [ ] **Step 4: Run the UsersPage test to verify it passes**

Run: `pnpm --filter @oncall/web test`
Expected: PASS.

- [ ] **Step 5: Write the failing Profile self-view test**

Create `apps/web/src/__tests__/ProfilePage.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const me = vi.fn()
vi.mock('@/services/doctor', () => ({ me: (...a: unknown[]) => me(...a) }))

import ProfilePage from '../pages/ProfilePage.vue'

beforeEach(() => {
  me.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('ProfilePage doctor self-view', () => {
  it('shows the on-call profile card for a doctor', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 10,
      email: 'dr@h.com',
      role: 'doctor',
      firstName: 'Jane',
      lastName: 'Roe',
    }
    me.mockResolvedValue({
      id: 1,
      userId: 10,
      email: 'dr@h.com',
      firstName: 'Jane',
      lastName: 'Roe',
      isActive: true,
      maxMonthlyDuties: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('My on-call profile')
    expect(wrapper.text()).toContain('Max monthly duties')
  })
})
```

> Use a single shared `pinia` instance for both `useAuthStore()` and `mount(..., { global: { plugins: [pinia] } })` so the seeded `auth.user` is visible to the component.

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @oncall/web test`
Expected: FAIL (no "My on-call profile" text).

- [ ] **Step 7: Add the self-view card to `ProfilePage.vue`**

7a. In the `<script setup>` block, extend imports and add state + fetch. Replace the existing import line `import { computed, ref } from 'vue'` with:
```ts
import { computed, onMounted, ref } from 'vue'
import type { Doctor } from '@oncall/shared'
import * as doctorService from '@/services/doctor'
```
Add (after the existing refs, before `async function onSubmit`):
```ts
const myDoctor = ref<Doctor | null>(null)
const doctorError = ref('')
const isDoctor = computed(() => auth.user?.role === 'doctor')

async function loadMyDoctor() {
  if (!isDoctor.value) return
  doctorError.value = ''
  try {
    myDoctor.value = await doctorService.me()
  } catch (e) {
    doctorError.value = e instanceof Error ? e.message : 'Could not load profile'
  }
}

onMounted(loadMyDoctor)
```

7b. In the template, add a second card **before** the closing `</div>` of the `<div class="mx-auto max-w-md">` wrapper (i.e. as a sibling after the existing password `<Card>`):
```vue
    <Card v-if="isDoctor" class="mt-4">
      <CardHeader>
        <CardTitle>My on-call profile</CardTitle>
        <CardDescription>Your doctor profile (read-only).</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="doctorError" class="text-sm text-destructive" role="alert">{{ doctorError }}</p>
        <dl v-else-if="myDoctor" class="grid grid-cols-2 gap-y-2 text-sm">
          <dt class="text-muted-foreground">Email</dt>
          <dd>{{ myDoctor.email }}</dd>
          <dt class="text-muted-foreground">Status</dt>
          <dd>{{ myDoctor.isActive ? 'active' : 'disabled' }}</dd>
          <dt class="text-muted-foreground">Max monthly duties</dt>
          <dd>{{ myDoctor.maxMonthlyDuties }}</dd>
        </dl>
      </CardContent>
    </Card>
```

- [ ] **Step 8: Run all web tests to verify they pass**

Run: `pnpm --filter @oncall/web test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/UsersPage.vue apps/web/src/pages/ProfilePage.vue apps/web/src/__tests__/UsersPage.test.ts apps/web/src/__tests__/ProfilePage.test.ts
git commit -m "feat(web): admin-only user creation + doctor self-view on profile"
```

---

## T9 — README update + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Status section**

In `README.md`, change the Phase 2 status paragraph and add a Phase 3 paragraph. Replace the line:
```
Remaining business features (doctors, scheduling, reports) arrive in later phases.
```
with:
```
**Phase 3 — Doctor Management** is complete. This phase adds a `doctors` profile table linked 1:1 to doctor accounts, a combined admin flow that creates the account and profile atomically, an admin-only Doctors page (create / edit / disable / delete), and a read-only doctor self-view on the profile page. The only stored profile attribute is `max_monthly_duties` (1–7, default 7); other scheduling rules (max 1 consecutive duty, duty spans 07:00 → next day 15:00) live in `AGENTS.md`.

Remaining business features (availability, scheduling, reports) arrive in later phases.
```

- [ ] **Step 2: Update the Roadmap list**

Replace:
```
1. Foundation (complete)
2. Auth & Authorization (complete)
3. Doctor Management
```
with:
```
1. Foundation (complete)
2. Auth & Authorization (complete)
3. Doctor Management (complete)
```

- [ ] **Step 3: Document the seeded doctors**

In the `### Default administrator` subsection, after the existing list item describing the admin, add:
```
- Doctors: `dr1@oncall.local`, `dr2@oncall.local`, `dr3@oncall.local` — the initial password for each is the email itself (change on first login).
```

- [ ] **Step 4: Add a Phase 3 Definition of Done + doc links**

After the existing `## Definition of Done (Phase 2)` section, add:
```markdown
## Definition of Done (Phase 3)

- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone; the seeded admin and three doctors are present.
- Admin can list/create/edit/disable/delete doctors; create produces a matching account + profile atomically; delete removes the account (cascade).
- A doctor can `GET /doctors/me` (own profile, read-only); an admin gets 404 there.
- The Doctors page is admin-only (doctors get 403 / are redirected); the Users page creates administrators only.
- Duplicate doctor email → 409; out-of-range `maxMonthlyDuties` → 400.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.
```

In the `## Documentation` list, add:
```
- Phase 3 design: `docs/superpowers/specs/2026-08-06-phase3-doctors-design.md`
- Phase 3 implementation plan: `docs/superpowers/plans/2026-08-06-phase3-doctors-plan.md`
```

- [ ] **Step 5: Full clean-clone verification**

Run each from repo root:
```bash
pnpm install
pnpm db:setup
pnpm typecheck
pnpm lint
pnpm test
```
Expected: all succeed; tests pass across `@oncall/shared`, `@oncall/api`, `@oncall/web`.

- [ ] **Step 6: Smoke-test the API manually (optional but recommended)**

Start the API (`pnpm --filter @oncall/api dev`), then:
```bash
# admin login (returns accessToken)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@oncall.local","password":"changeme123"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.accessToken))")

# list doctors
curl -s http://localhost:3000/doctors -H "Authorization: Bearer $TOKEN"
```
Expected: `{ "success": true, "data": { "doctors": [ ... 3 doctors ... ] } }`.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: Phase 3 doctor management status, seeded doctors, definition of done"
```

---

## Self-review notes

- **Spec coverage:** schema/seed (T2), shared contract (T1), transaction helper (T3), service (T4), controller/routes/validators/app (T5), web service (T6), Doctors page/router/header (T7), Users page narrowing + Profile self-view (T8), README + DoD (T9). All spec sections §1–§9 map to tasks.
- **Type/name consistency:** `Doctor.userId`, `maxMonthlyDuties`, `getByUserId`, `doctorController.getMe`, `withTransaction`, `idParams` reused — names match across tasks. The numeric coercion note in T7 keeps the `number()` zod schema satisfied from a string `<input>`.
- **No placeholders:** every code step contains the full code; commit messages and run commands are concrete.
