# User Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append-only audit trail of every mutation and auth event, readable by administrators via a paginated, filterable "Activity" tab.

**Architecture:** A new `activity_log` table written by `activity.service.ts` (`recordActivity` in-transaction / `logActivity` wrapper for non-transactional events). Every mutating service logs who/what/when plus a JSON `detail` snapshot. `GET /activity` (administrator-only) returns `{ items, total, page, limit }`. Vue page with action/user/date filters and Prev/Next pagination.

**Tech Stack:** Express + pg + Zod (@oncall/shared), Vue 3 + Pinia-less local state, existing shadcn-vue style primitives.

**Spec:** `docs/superpowers/specs/2026-08-16-activity-log-design.md`

## Global Constraints

- Parameterized SQL only — never concatenate values into SQL.
- Action strings are a Zod-validated literal union (`ACTIVITY_ACTIONS`); DB column stays TEXT.
- Password hashes and passwords never appear in `detail`.
- `activity_log` is append-only: no update/delete code paths, ever.
- Audit failure fails the business operation (same coupling as `recordGeneration` in `usage.service.ts`).
- Service unit tests mock BOTH `../db/client` and `../services/activity.service` (see Task 4 Step 1 pattern).
- No Prettier, no new lint rules, no new dependencies.
- Every task ends with `pnpm typecheck && pnpm lint` green before committing.
- Commit messages follow repo style: `feat(api): ...`, `feat(web): ...`, `feat(db): ...`, `test(api): ...`.

---

### Task 1: Shared audit types and query schema

**Files:**
- Create: `packages/shared/src/schemas/audit.ts`
- Create: `packages/shared/src/types/audit.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `packages/shared/src/types/index.ts`

**Interfaces:**
- Produces: `ACTIVITY_ACTIONS` (const string array), `ActivityAction` (type), `activityQuerySchema` (Zod), `ActivityActor`, `ActivityLogEntry`, `ActivityQuery`, `PaginatedActivity` — all importable from `@oncall/shared`.

- [ ] **Step 1: Create `packages/shared/src/schemas/audit.ts`**

```ts
import { z } from 'zod'

export const ACTIVITY_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.password_changed',
  'user.created',
  'user.updated',
  'user.deactivated',
  'user.reactivated',
  'user.deleted',
  'doctor.created',
  'doctor.updated',
  'doctor.deactivated',
  'availability.created',
  'availability.updated',
  'availability.deleted',
  'holiday.created',
  'holiday.updated',
  'holiday.deleted',
  'schedule.generated',
  'schedule.published',
  'schedule.reverted',
  'schedule.deleted',
  'duty.assigned',
  'duty.reassigned',
  'duty.removed',
] as const

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)')

export const activityQuerySchema = z.object({
  action: z.enum(ACTIVITY_ACTIONS).optional(),
  userId: z.coerce.number().int().positive().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
```

Note: `user.deactivated`/`reactivated` are emitted by user update when `isActive` flips; `user.deleted` covers the existing hard-delete endpoint; `doctor.deactivated` covers `DELETE /doctors/:id` (which deactivates). These extend the spec table to match real endpoints.

- [ ] **Step 2: Create `packages/shared/src/types/audit.ts`**

```ts
import type { Role } from './auth'
import type { ActivityAction } from '../schemas/audit'

export interface ActivityActor {
  id: number
  username: string
  role: Role
  firstName: string
  lastName: string
}

export interface ActivityLogEntry {
  id: number
  action: ActivityAction
  entityType: string
  entityId: number | null
  detail: Record<string, unknown>
  createdAt: string
  actor: ActivityActor | null
}

export interface ActivityQuery {
  action?: ActivityAction
  userId?: number
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface PaginatedActivity {
  items: ActivityLogEntry[]
  total: number
  page: number
  limit: number
}
```

Do NOT re-export `ActivityAction` from this file — it reaches `@oncall/shared` via the schemas barrel, avoiding a double re-export of the same name.

- [ ] **Step 3: Update the barrels**

In `packages/shared/src/schemas/index.ts` append:

```ts
export { ACTIVITY_ACTIONS, activityQuerySchema } from './audit'
export type { ActivityAction } from './audit'
```

In `packages/shared/src/types/index.ts` append:

```ts
export type {
  ActivityActor,
  ActivityLogEntry,
  ActivityQuery,
  PaginatedActivity,
} from './audit'
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/audit.ts packages/shared/src/types/audit.ts packages/shared/src/schemas/index.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): activity log types and query schema"
```

---

### Task 2: Database table and activity.service

**Files:**
- Modify: `database/schema.sql` (append at end)
- Create: `apps/api/src/services/activity.service.ts`
- Create: `apps/api/src/__tests__/activity.service.test.ts`

**Interfaces:**
- Produces (used by Tasks 3–5):
  - `recordActivity(client: PoolClient, input: ActivityInput): Promise<void>` where `ActivityInput = { userId: number; action: ActivityAction; entityType: string; entityId: number | null; detail?: Record<string, unknown> }`
  - `logActivity(input: ActivityInput): Promise<void>` (own transaction)
  - `list(filters: ActivityQuery): Promise<PaginatedActivity>`

- [ ] **Step 1: Append to `database/schema.sql`** (after the `idx_operator_alerts_open` index, at end of file)

```sql

-- Phase 11: User Activity Log (append-only audit trail; no update/delete paths exist)

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log (action);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at);
```

- [ ] **Step 2: Create `apps/api/src/services/activity.service.ts`**

```ts
import type { PoolClient } from 'pg'
import type {
  ActivityAction,
  ActivityLogEntry,
  ActivityQuery,
  PaginatedActivity,
  Role,
} from '@oncall/shared'
import { query, withTransaction } from '../db/client'

export interface ActivityInput {
  userId: number
  action: ActivityAction
  entityType: string
  entityId: number | null
  detail?: Record<string, unknown>
}

/** Must run inside the caller's transaction: a failed audit write fails the business change. */
export async function recordActivity(client: PoolClient, input: ActivityInput): Promise<void> {
  await client.query(
    'INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES ($1, $2, $3, $4, $5)',
    [input.userId, input.action, input.entityType, input.entityId, JSON.stringify(input.detail ?? {})],
  )
}

/** Wrapper for events that are not part of a business transaction (auth events). */
export async function logActivity(input: ActivityInput): Promise<void> {
  await withTransaction((client) => recordActivity(client, input))
}

interface ActivityRow {
  id: number
  action: ActivityAction
  entity_type: string
  entity_id: number | null
  detail: Record<string, unknown> | null
  created_at: Date
  actor_id: number | null
  actor_username: string | null
  actor_role: Role | null
  actor_first_name: string | null
  actor_last_name: string | null
}

const SELECT = `SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.created_at,
  u.id AS actor_id, u.username AS actor_username, u.role AS actor_role,
  u.first_name AS actor_first_name, u.last_name AS actor_last_name
  FROM activity_log a LEFT JOIN users u ON u.id = a.user_id`

function toEntry(row: ActivityRow): ActivityLogEntry {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: row.detail ?? {},
    createdAt: row.created_at.toISOString(),
    actor:
      row.actor_id === null
        ? null
        : {
            id: row.actor_id,
            username: row.actor_username ?? '',
            role: row.actor_role ?? 'doctor',
            firstName: row.actor_first_name ?? '',
            lastName: row.actor_last_name ?? '',
          },
  }
}

export async function list(filters: ActivityQuery): Promise<PaginatedActivity> {
  const page = filters.page ?? 1
  const limit = filters.limit ?? 50
  const where: string[] = []
  const params: unknown[] = []
  if (filters.action !== undefined) {
    params.push(filters.action)
    where.push(`a.action = $${params.length}`)
  }
  if (filters.userId !== undefined) {
    params.push(filters.userId)
    where.push(`a.user_id = $${params.length}`)
  }
  if (filters.from !== undefined) {
    params.push(filters.from)
    where.push(`a.created_at >= $${params.length}::date`)
  }
  if (filters.to !== undefined) {
    params.push(filters.to)
    where.push(`a.created_at < ($${params.length}::date + 1)`)
  }
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''

  const count = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM activity_log a${whereSql}`,
    params,
  )
  const total = count.rows[0]?.n ?? 0

  params.push(limit)
  const limitRef = `$${params.length}`
  params.push((page - 1) * limit)
  const offsetRef = `$${params.length}`
  const res = await query<ActivityRow>(
    `${SELECT}${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limitRef} OFFSET ${offsetRef}`,
    params,
  )
  return { items: res.rows.map(toEntry), total, page, limit }
}
```

Note: `LIMIT`/`OFFSET` reference parameter placeholders, not interpolated values — this is parameterized SQL.

- [ ] **Step 3: Apply the schema**

Run: `pnpm db:setup`
Expected: applies schema + seed with no errors (requires `DATABASE_URL` in `apps/api/.env`).

- [ ] **Step 4: Create `apps/api/src/__tests__/activity.service.test.ts`**

Follows the existing service-test pattern (mock `../db/client`).

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import { list, logActivity, recordActivity } from '../services/activity.service'

function entryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 3,
    action: 'availability.created',
    entity_type: 'unavailability',
    entity_id: 12,
    detail: { type: 'vacation' },
    created_at: new Date('2026-08-16T10:00:00Z'),
    actor_id: 2,
    actor_username: 'admin',
    actor_role: 'administrator',
    actor_first_name: 'Ada',
    actor_last_name: 'Admin',
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('activity.service', () => {
  it('recordActivity inserts user, action, entity, detail as parameterized SQL', async () => {
    const client = { query } as unknown as Parameters<typeof recordActivity>[0]
    await recordActivity(client, {
      userId: 2,
      action: 'availability.created',
      entityType: 'unavailability',
      entityId: 12,
      detail: { type: 'vacation' },
    })
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('INSERT INTO activity_log')
    expect(params).toEqual([2, 'availability.created', 'unavailability', 12, '{"type":"vacation"}'])
  })

  it('recordActivity defaults detail to an empty JSON object', async () => {
    const client = { query } as unknown as Parameters<typeof recordActivity>[0]
    await recordActivity(client, {
      userId: 2,
      action: 'auth.login',
      entityType: 'auth',
      entityId: null,
    })
    expect((query.mock.calls[0] as unknown as unknown[])[1]).toEqual([
      2,
      'auth.login',
      'auth',
      null,
      '{}',
    ])
  })

  it('logActivity wraps recordActivity in a transaction', async () => {
    await logActivity({ userId: 1, action: 'auth.login', entityType: 'auth', entityId: null })
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO activity_log')
  })

  it('list runs count then page, ordered newest first', async () => {
    query.mockResolvedValueOnce({ rows: [{ n: 51 }] })
    query.mockResolvedValueOnce({ rows: [entryRow()] })
    const page = await list({ page: 2, limit: 50 })
    expect(page.total).toBe(51)
    expect(page.page).toBe(2)
    expect(page.items[0]?.actor?.firstName).toBe('Ada')
    const pageSql = query.mock.calls[1]?.[0] as string
    expect(pageSql).toContain('ORDER BY a.created_at DESC, a.id DESC')
    expect(pageSql).toContain('LEFT JOIN users u')
  })

  it('list emits one WHERE clause per filter', async () => {
    query.mockResolvedValue({ rows: [] })
    await list({ action: 'auth.login', userId: 5, from: '2026-08-01', to: '2026-08-31' })
    const countSql = query.mock.calls[0]?.[0] as string
    expect(countSql).toContain('a.action')
    expect(countSql).toContain('a.user_id')
    expect(countSql).toContain('a.created_at >=')
    expect(countSql).toContain('a.created_at <')
  })

  it('list maps a deleted actor to null', async () => {
    query.mockResolvedValueOnce({ rows: [{ n: 1 }] })
    query.mockResolvedValueOnce({
      rows: [
        entryRow({
          actor_id: null,
          actor_username: null,
          actor_role: null,
          actor_first_name: null,
          actor_last_name: null,
        }),
      ],
    })
    const page = await list({})
    expect(page.items[0]?.actor).toBeNull()
  })
})
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @oncall/api test -- activity.service && pnpm typecheck && pnpm lint`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add database/schema.sql apps/api/src/services/activity.service.ts apps/api/src/__tests__/activity.service.test.ts
git commit -m "feat(api): append-only activity log table and service"
```

---

### Task 3: GET /activity endpoint

**Files:**
- Create: `apps/api/src/validators/activity.ts`
- Create: `apps/api/src/controllers/activity.controller.ts`
- Create: `apps/api/src/routes/activity.routes.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/__tests__/activity.routes.test.ts`

**Interfaces:**
- Consumes: `list` from Task 2, `activityQuerySchema` from Task 1.
- Produces: `GET /activity` → 200 `{ success: true, data: { activity: { items, total, page, limit } } }`; 401 unauthenticated; 403 non-admin; 400 invalid query.

- [ ] **Step 1: Create `apps/api/src/validators/activity.ts`**

```ts
export { activityQuerySchema } from '@oncall/shared'
```

- [ ] **Step 2: Create `apps/api/src/controllers/activity.controller.ts`**

```ts
import type { NextFunction, Request, Response } from 'express'
import type { ActivityQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import * as activityService from '../services/activity.service'

export const activityController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const activity = await activityService.list(req.query as ActivityQuery)
      res.status(200).json(ok({ activity }))
    } catch (err) {
      next(err)
    }
  },
}
```

- [ ] **Step 3: Create `apps/api/src/routes/activity.routes.ts`**

```ts
import { Router } from 'express'
import { activityController } from '../controllers/activity.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { activityQuerySchema } from '../validators/activity'

export const activityRouter = Router()

activityRouter.use(authenticate, authorize('administrator'))
activityRouter.get('/', validate(activityQuerySchema, 'query'), activityController.list)
```

`authorize('administrator')` implicitly admits superadmin (existing middleware behavior).

- [ ] **Step 4: Wire into `apps/api/src/app.ts`**

Add import (alphabetical order, after `./routes/auth.routes`):

```ts
import { activityRouter } from './routes/activity.routes'
```

Add mount (after `app.use('/auth', authRouter)`):

```ts
app.use('/activity', activityRouter)
```

- [ ] **Step 5: Create `apps/api/src/__tests__/activity.routes.test.ts`**

Follows the mocked-service route-test pattern (see `holiday.routes.test.ts`).

```ts
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
vi.mock('../services/activity.service', () => ({
  list: (...a: unknown[]) => list(...a),
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { activityRouter } from '../routes/activity.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/activity', activityRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

beforeEach(() => list.mockReset())

describe('activity routes', () => {
  it('admin lists activity (200); unauthenticated is 401; doctor is 403', async () => {
    list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 })
    const ok200 = await request(build())
      .get('/activity')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(ok200.status).toBe(200)
    expect(ok200.body.data.activity.total).toBe(0)

    const unauth = await request(build()).get('/activity')
    expect(unauth.status).toBe(401)

    const forbidden = await request(build())
      .get('/activity')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)
  })

  it('passes validated query filters to the service', async () => {
    list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 })
    const res = await request(build())
      .get('/activity?action=auth.login&userId=2&from=2026-08-01&to=2026-08-31&page=3&limit=25')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(list).toHaveBeenCalledWith({
      action: 'auth.login',
      userId: 2,
      from: '2026-08-01',
      to: '2026-08-31',
      page: 3,
      limit: 25,
    })
  })

  it('rejects invalid query with 400', async () => {
    const res = await request(build())
      .get('/activity?action=bogus.action')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @oncall/api test -- activity && pnpm typecheck && pnpm lint`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/validators/activity.ts apps/api/src/controllers/activity.controller.ts apps/api/src/routes/activity.routes.ts apps/api/src/app.ts apps/api/src/__tests__/activity.routes.test.ts
git commit -m "feat(api): administrator activity log endpoint"
```

---

### Task 4: Audit writes — auth, user, doctor domains

**Files:**
- Modify: `apps/api/src/services/token.service.ts` (revokeRefreshToken returns userId)
- Modify: `apps/api/src/services/auth.service.ts`
- Modify: `apps/api/src/services/user.service.ts`
- Modify: `apps/api/src/services/doctor.service.ts`
- Modify: `apps/api/src/controllers/doctor.controller.ts`
- Modify: `apps/api/src/__tests__/auth.service.test.ts`
- Modify: `apps/api/src/__tests__/user.service.test.ts`
- Modify: `apps/api/src/__tests__/doctor.service.test.ts`

**Interfaces:**
- Consumes: `logActivity` / `recordActivity` from Task 2.
- Produces: `doctorService.create(input, actor)`, `doctorService.update(id, input, actor)`, `doctorService.deactivate(id, actor)` — controllers in this task updated to match. `tokenService.revokeRefreshToken(token): Promise<number | null>`.

**Testing pattern used throughout this and the next task** — add to the top of each affected service test file (right after the `db/client` mock):

```ts
const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))
```

Mocking `activity.service` keeps existing `query.mockResolvedValueOnce` sequences valid (audit inserts consume no mock responses) and lets tests assert calls directly. Reset both fns in the file's `beforeEach`.

- [ ] **Step 1: `token.service.ts` — return the revoked token's user**

Replace `revokeRefreshToken` (keep the other functions untouched):

```ts
export async function revokeRefreshToken(token: string): Promise<number | null> {
  const res = await query<{ user_id: number }>(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING user_id`,
    [hashToken(token)],
  )
  return res.rows[0]?.user_id ?? null
}
```

- [ ] **Step 2: `auth.service.ts` — log login, logout, password change**

Add import at top:

```ts
import { logActivity } from './activity.service'
```

In `login`, before the `return` statement add:

```ts
  await logActivity({ userId: row.id, action: 'auth.login', entityType: 'auth', entityId: null })
```

Replace `logout` with:

```ts
export async function logout(token: string): Promise<void> {
  const userId = await tokenService.revokeRefreshToken(token)
  if (userId === null) return
  await logActivity({ userId, action: 'auth.logout', entityType: 'auth', entityId: null })
}
```

In `changePassword`, after `revokeAllForUser` and before `return`:

```ts
  await logActivity({
    userId,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: userId,
  })
```

- [ ] **Step 3: `user.service.ts` — created / updated / deactivated / reactivated / deleted**

Add imports:

```ts
import { logActivity } from './activity.service'
```

In `create`, before `return toUser(row)`:

```ts
  await logActivity({
    userId: actor.id,
    action: 'user.created',
    entityType: 'user',
    entityId: row.id,
    detail: {
      email: input.email,
      username: input.username,
      role: input.role,
      firstName: input.firstName,
      lastName: input.lastName,
    },
  })
```

In `update`, after the `UPDATE` succeeds (after the `if (!row) throw` check), before `return toUser(row)`:

```ts
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  if (input.email !== undefined && input.email !== existing.email) {
    before.email = existing.email
    after.email = input.email
  }
  if (input.username !== undefined && input.username !== existing.username) {
    before.username = existing.username
    after.username = input.username
  }
  if (input.role !== undefined && input.role !== existing.role) {
    before.role = existing.role
    after.role = input.role
  }
  if (input.firstName !== undefined && input.firstName !== existing.firstName) {
    before.firstName = existing.firstName
    after.firstName = input.firstName
  }
  if (input.lastName !== undefined && input.lastName !== existing.lastName) {
    before.lastName = existing.lastName
    after.lastName = input.lastName
  }
  const isActiveChanged = input.isActive !== undefined && input.isActive !== existing.isActive
  if (isActiveChanged) {
    before.isActive = existing.isActive
    after.isActive = input.isActive
  }
  const action = isActiveChanged
    ? input.isActive
      ? 'user.reactivated'
      : 'user.deactivated'
    : 'user.updated'
  await logActivity({
    userId: actor.id,
    action,
    entityType: 'user',
    entityId: id,
    detail: { before, after },
  })
```

In `remove`, after the successful `DELETE` (after the `res.rows.length === 0` check):

```ts
  await logActivity({
    userId: actor.id,
    action: 'user.deleted',
    entityType: 'user',
    entityId: id,
    detail: { email: existing.email, username: existing.username },
  })
```

- [ ] **Step 4: `doctor.service.ts` — actor param + created / updated / deactivated**

Add imports (the file currently imports no AuthUser type):

```ts
import type { AuthUser } from '@oncall/shared'
import { logActivity, recordActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role'>
```

`create` — change signature to `create(input: CreateDoctorRequest, actor: Actor)`, make the doctors INSERT return its id, and record inside the transaction:

```ts
export async function create(input: CreateDoctorRequest, actor: Actor): Promise<Doctor> {
  const doctorId = await withTransaction(async (client) => {
    const dupEmail = await client.query('SELECT id FROM users WHERE email = $1', [input.email])
    if (dupEmail.rows.length > 0) throw new HttpError(409, 'Email already in use')
    const dupUser = await client.query('SELECT id FROM users WHERE username = $1', [input.username])
    if (dupUser.rows.length > 0) throw new HttpError(409, 'Username already in use')
    const passwordHash = await bcrypt.hash(input.password, 12)
    const ins = await client.query(
      `INSERT INTO users (email, username, password_hash, role, first_name, last_name)
       VALUES ($1, $2, $3, 'doctor', $4, $5) RETURNING id`,
      [input.email, input.username, passwordHash, input.firstName, input.lastName],
    )
    const userId = ins.rows[0]?.id
    if (userId === undefined) throw new HttpError(500, 'Failed to create user')
    const docIns = await client.query<{ id: number }>(
      'INSERT INTO doctors (user_id, max_monthly_duties) VALUES ($1, $2) RETURNING id',
      [userId, input.maxMonthlyDuties ?? 7],
    )
    const docId = docIns.rows[0]?.id
    if (docId === undefined) throw new HttpError(500, 'Failed to create doctor')
    await recordActivity(client, {
      userId: actor.id,
      action: 'doctor.created',
      entityType: 'doctor',
      entityId: docId,
      detail: {
        email: input.email,
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        maxMonthlyDuties: input.maxMonthlyDuties ?? 7,
      },
    })
    return docId
  })
  return getById(doctorId)
}
```

`update` — change signature to `update(id: number, input: UpdateDoctorRequest, actor: Actor)`. Replace the initial `user_id` lookup with a full `getById` so we have before-values, and record inside the transaction after the updates:

```ts
export async function update(id: number, input: UpdateDoctorRequest, actor: Actor): Promise<Doctor> {
  const existing = await getById(id)
  const userId = existing.userId

  await withTransaction(async (client) => {
    const sets: string[] = []
    const params: unknown[] = []
    const map: Array<[string, unknown]> = [
      ['email', input.email],
      ['username', input.username],
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
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (input.email !== undefined && input.email !== existing.email) {
      before.email = existing.email
      after.email = input.email
    }
    if (input.username !== undefined && input.username !== existing.username) {
      before.username = existing.username
      after.username = input.username
    }
    if (input.firstName !== undefined && input.firstName !== existing.firstName) {
      before.firstName = existing.firstName
      after.firstName = input.firstName
    }
    if (input.lastName !== undefined && input.lastName !== existing.lastName) {
      before.lastName = existing.lastName
      after.lastName = input.lastName
    }
    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      before.isActive = existing.isActive
      after.isActive = input.isActive
    }
    if (input.maxMonthlyDuties !== undefined && input.maxMonthlyDuties !== existing.maxMonthlyDuties) {
      before.maxMonthlyDuties = existing.maxMonthlyDuties
      after.maxMonthlyDuties = input.maxMonthlyDuties
    }
    if (Object.keys(before).length > 0) {
      await recordActivity(client, {
        userId: actor.id,
        action: 'doctor.updated',
        entityType: 'doctor',
        entityId: id,
        detail: { before, after },
      })
    }
  })
  return getById(id)
}
```

`deactivate` — change signature and log:

```ts
export async function deactivate(id: number, actor: Actor): Promise<void> {
  const existing = await getById(id)
  await query('UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [
    existing.userId,
  ])
  await logActivity({
    userId: actor.id,
    action: 'doctor.deactivated',
    entityType: 'doctor',
    entityId: id,
    detail: { email: existing.email },
  })
}
```

- [ ] **Step 5: `doctor.controller.ts` — pass the actor**

```ts
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await doctorService.create(req.body, req.user!)
      res.status(201).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await doctorService.update(Number(req.params.id), req.body, req.user!)
      res.status(200).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await doctorService.deactivate(Number(req.params.id), req.user!)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
```

- [ ] **Step 6: Update the three service test files**

In `auth.service.test.ts`, `user.service.test.ts`, `doctor.service.test.ts`:

1. Add the `activity.service` mock from the task header; reset `logActivity`/`recordActivity` in `beforeEach`.
2. In `auth.service.test.ts`: the `token.service` mock's `revokeRefreshToken: vi.fn(async () => undefined)` becomes `vi.fn(async () => null)`.
3. Update every call to `doctorService.create/update/deactivate` to pass an actor, e.g. `{ id: 2, role: 'administrator' }`.
4. Add assertions to at least these cases (one `it` per file is enough; extend existing tests rather than adding new ones where possible):
   - login success → `expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login', userId: <row id> }))`
   - user create → `expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.created' }))`
   - user update with `isActive: false` on an active user → action `'user.deactivated'`
   - doctor create → `expect(recordActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'doctor.created' }))`
   - doctor deactivate → action `'doctor.deactivated'`

- [ ] **Step 7: Verify**

Run: `pnpm --filter @oncall/api test && pnpm typecheck && pnpm lint`
Expected: all PASS (fix any leftover mock-sequence failures by adding one `mockResolvedValueOnce({ rows: [] })`)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/token.service.ts apps/api/src/services/auth.service.ts apps/api/src/services/user.service.ts apps/api/src/services/doctor.service.ts apps/api/src/controllers/doctor.controller.ts apps/api/src/__tests__/auth.service.test.ts apps/api/src/__tests__/user.service.test.ts apps/api/src/__tests__/doctor.service.test.ts
git commit -m "feat(api): audit writes for auth, user, and doctor domains"
```

---

### Task 5: Audit writes — unavailability, holiday, schedule/duty domains

**Files:**
- Modify: `apps/api/src/services/unavailability.service.ts`
- Modify: `apps/api/src/services/holiday.service.ts`
- Modify: `apps/api/src/services/schedule.service.ts`
- Modify: `apps/api/src/controllers/unavailability.controller.ts`
- Modify: `apps/api/src/controllers/holiday.controller.ts`
- Modify: `apps/api/src/controllers/schedule.controller.ts`
- Modify: `apps/api/src/__tests__/unavailability.service.test.ts`
- Modify: `apps/api/src/__tests__/holiday.service.test.ts`
- Modify: `apps/api/src/__tests__/schedule.service.test.ts`

**Interfaces:**
- Consumes: `logActivity` / `recordActivity` from Task 2.
- Produces: `unavailabilityService.create(doctorId, input, actor)`, `holidayService.create(input, actor)` / `update(id, input, actor)` / `remove(id, actor)`, `scheduleService.publish(id, actor)` / `unpublish(id, actor)` / `remove(id, actor)` / `removeDuty(dutyId, actor)`. Controllers updated in this task to match.

Use the same `activity.service` test mock pattern as Task 4 in all three test files.

- [ ] **Step 1: `unavailability.service.ts`**

Add import: `import { logActivity, recordActivity } from './activity.service'`

Change `create` signature to `create(doctorId: number, input: CreateInput, actor: Actor)`. Inside the transaction, after the INSERT and before `return newId`:

```ts
    await recordActivity(client, {
      userId: actor.id,
      action: 'availability.created',
      entityType: 'unavailability',
      entityId: newId,
      detail: {
        doctorId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        note: input.note ?? null,
      },
    })
```

`createOwn` becomes:

```ts
export async function createOwn(
  userId: number,
  input: CreateUnavailabilitySelfRequest,
): Promise<Unavailability> {
  const doctorId = await resolveDoctorId(userId)
  return create(doctorId, input, { id: userId, role: 'doctor' })
}
```

`update`: widen the initial SELECT to load before-values:

```ts
  const existing = await query<{
    doctor_id: number
    type: string
    start_date: string
    end_date: string
    note: string | null
  }>(
    'SELECT doctor_id, type, start_date, end_date, note FROM unavailability WHERE id = $1',
    [id],
  )
```

Then inside the transaction, after the `UPDATE` block (still inside `if (sets.length > 0)` is wrong — put it after that block so it runs once), add:

```ts
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (input.type !== undefined && input.type !== existingRow.type) {
      before.type = existingRow.type
      after.type = input.type
    }
    if (input.startDate !== undefined && input.startDate !== existingRow.start_date) {
      before.startDate = existingRow.start_date
      after.startDate = input.startDate
    }
    if (input.endDate !== undefined && input.endDate !== existingRow.end_date) {
      before.endDate = existingRow.end_date
      after.endDate = input.endDate
    }
    if (input.note !== undefined && input.note !== existingRow.note) {
      before.note = existingRow.note
      after.note = input.note
    }
    if (sets.length > 0) {
      await recordActivity(client, {
        userId: actor.id,
        action: 'availability.updated',
        entityType: 'unavailability',
        entityId: id,
        detail: { doctorId: existingRow.doctor_id, before, after },
      })
    }
```

`remove`: widen the initial SELECT and log after the DELETE:

```ts
  const existing = await query<{
    doctor_id: number
    type: string
    start_date: string
    end_date: string
  }>(
    'SELECT doctor_id, type, start_date, end_date FROM unavailability WHERE id = $1',
    [id],
  )
  const existingRow = existing.rows[0]
  if (!existingRow) throw new HttpError(404, 'Unavailability record not found')
  await assertOwns(existingRow.doctor_id, actor)
  await query('DELETE FROM unavailability WHERE id = $1', [id])
  await logActivity({
    userId: actor.id,
    action: 'availability.deleted',
    entityType: 'unavailability',
    entityId: id,
    detail: {
      doctorId: existingRow.doctor_id,
      type: existingRow.type,
      startDate: existingRow.start_date,
      endDate: existingRow.end_date,
    },
  })
```

`unavailability.controller.ts` `create` handler: pass `req.user!`:

```ts
      const unavailability = await unavailabilityService.create(req.body.doctorId, req.body, req.user!)
```

- [ ] **Step 2: `holiday.service.ts`**

Add imports:

```ts
import type { AuthUser } from '@oncall/shared'
import { logActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role'>
```

`create(input: CreateHolidayRequest, actor: Actor)` — after the INSERT, before `return getById(id)`:

```ts
  await logActivity({
    userId: actor.id,
    action: 'holiday.created',
    entityType: 'holiday',
    entityId: id,
    detail: { name: input.name, date: input.date },
  })
```

`update(id: number, input: UpdateHolidayRequest, actor: Actor)` — after the UPDATE block, before `return getById(id)`:

```ts
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  if (input.name !== undefined && input.name !== existing.rows[0]!.name) {
    before.name = existing.rows[0]!.name
    after.name = input.name
  }
  if (input.date !== undefined && input.date !== existing.rows[0]!.date) {
    before.date = existing.rows[0]!.date
    after.date = input.date
  }
  if (sets.length > 0) {
    await logActivity({
      userId: actor.id,
      action: 'holiday.updated',
      entityType: 'holiday',
      entityId: id,
      detail: { before, after },
    })
  }
```

`remove(id: number, actor: Actor)`:

```ts
export async function remove(id: number, actor: Actor): Promise<void> {
  const existing = await query<HolidayRow>(`${SELECT} WHERE id = $1`, [id])
  if (existing.rows.length === 0) throw new HttpError(404, 'Holiday not found')
  await query('DELETE FROM holidays WHERE id = $1', [id])
  await logActivity({
    userId: actor.id,
    action: 'holiday.deleted',
    entityType: 'holiday',
    entityId: id,
    detail: { name: existing.rows[0]!.name, date: existing.rows[0]!.date },
  })
}
```

`holiday.controller.ts`: pass `req.user!` in `create`, `update`, `remove` handlers:

```ts
      const holiday = await holidayService.create(req.body, req.user!)
```
```ts
      const holiday = await holidayService.update(Number(req.params.id), req.body, req.user!)
```
```ts
      await holidayService.remove(Number(req.params.id), req.user!)
```

- [ ] **Step 3: `schedule.service.ts`**

Add import: `import { logActivity, recordActivity } from './activity.service'`

`generate` — inside the transaction, right after `await recordGeneration(client, year, month, doctorIds)` and before `return id`:

```ts
    await recordActivity(client, {
      userId: actor.id,
      action: 'schedule.generated',
      entityType: 'schedule',
      entityId: id,
      detail: {
        year,
        month,
        dutyCount: planDuties.length,
        doctorCount: doctorIds.length,
        mode: assignments && assignments.length > 0 ? 'manual' : 'engine',
      },
    })
```

`remove(id: number, actor: Actor)` — widen the SELECT and log:

```ts
export async function remove(id: number, actor: Actor): Promise<void> {
  const existing = await query<{ year: number; month: number; status: string }>(
    'SELECT year, month, status FROM schedules WHERE id = $1',
    [id],
  )
  if (existing.rows.length === 0) throw new HttpError(404, 'Schedule not found')
  assertEditable(
    existing.rows[0]!.status,
    'Schedule is published; revert to draft before deleting',
  )
  await query('DELETE FROM schedules WHERE id = $1', [id])
  await logActivity({
    userId: actor.id,
    action: 'schedule.deleted',
    entityType: 'schedule',
    entityId: id,
    detail: { year: existing.rows[0]!.year, month: existing.rows[0]!.month },
  })
}
```

`addDuty` — after the INSERT (before `return getDutyById(id)`):

```ts
  await logActivity({
    userId: actor.id,
    action: 'duty.assigned',
    entityType: 'duty',
    entityId: id,
    detail: { scheduleId, date: input.date, doctorId: input.doctorId },
  })
```

`reassignDuty` — after the UPDATE (before `return getDutyById(dutyId)`):

```ts
  await logActivity({
    userId: actor.id,
    action: 'duty.reassigned',
    entityType: 'duty',
    entityId: dutyId,
    detail: {
      scheduleId: duty.schedule_id,
      date: duty.duty_date,
      fromDoctorId: duty.doctor_id,
      toDoctorId: input.doctorId,
    },
  })
```

`removeDuty(dutyId: number, actor: Actor)`:

```ts
export async function removeDuty(dutyId: number, actor: Actor): Promise<void> {
  const duty = await getDutyRow(dutyId)
  assertEditable(duty.schedule_status)
  await query('DELETE FROM duties WHERE id = $1', [dutyId])
  await logActivity({
    userId: actor.id,
    action: 'duty.removed',
    entityType: 'duty',
    entityId: dutyId,
    detail: { scheduleId: duty.schedule_id, date: duty.duty_date, doctorId: duty.doctor_id },
  })
}
```

`publish(id: number, actor: Actor)` — after the successful UPDATE, before `return`:

```ts
  await logActivity({
    userId: actor.id,
    action: 'schedule.published',
    entityType: 'schedule',
    entityId: id,
    detail: { year: upd.rows[0]!.year, month: upd.rows[0]!.month, dutyCount },
  })
```

For `dutyCount` add right after the successful UPDATE (before the audit call), reusing the existing query helper:

```ts
  const duties = await query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM duties WHERE schedule_id = $1',
    [id],
  )
  const dutyCount = duties.rows[0]?.n ?? 0
```

`unpublish(id: number, actor: Actor)` — same shape, action `'schedule.reverted'`, no dutyCount:

```ts
  await logActivity({
    userId: actor.id,
    action: 'schedule.reverted',
    entityType: 'schedule',
    entityId: id,
    detail: { year: upd.rows[0]!.year, month: upd.rows[0]!.month },
  })
```

- [ ] **Step 4: `schedule.controller.ts` — pass the actor**

```ts
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      await scheduleService.remove(Number(req.params.id), req.user)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
  async removeDuty(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      await scheduleService.removeDuty(Number(req.params.id), req.user)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
  async publish(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const schedule = await scheduleService.publish(Number(req.params.id), req.user)
      res.status(200).json(ok({ schedule }))
    } catch (err) {
      next(err)
    }
  },
  async unpublish(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const schedule = await scheduleService.unpublish(Number(req.params.id), req.user)
      res.status(200).json(ok({ schedule }))
    } catch (err) {
      next(err)
    }
  },
```

- [ ] **Step 5: Update the three service test files**

1. Add the `activity.service` mock (Task 4 header pattern) to `unavailability.service.test.ts`, `holiday.service.test.ts`, `schedule.service.test.ts`; reset the fns in `beforeEach`.
2. Update call sites for the new signatures:
   - `create(5, {...})` → `create(5, {...}, { id: 2, role: 'administrator' })` (unavailability)
   - holiday `create/update/remove` → append `{ id: 2, role: 'administrator' }`
   - schedule `publish/unpublish/remove/removeDuty` → append `{ id: 2, role: 'administrator' }`
3. Add one audit assertion per domain, e.g.:
   - `expect(recordActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'availability.created' }))`
   - `expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'holiday.deleted' }))`
   - `expect(recordActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'schedule.generated' }))`

- [ ] **Step 6: Verify**

Run: `pnpm --filter @oncall/api test && pnpm typecheck && pnpm lint`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/unavailability.service.ts apps/api/src/services/holiday.service.ts apps/api/src/services/schedule.service.ts apps/api/src/controllers/unavailability.controller.ts apps/api/src/controllers/holiday.controller.ts apps/api/src/controllers/schedule.controller.ts apps/api/src/__tests__/unavailability.service.test.ts apps/api/src/__tests__/holiday.service.test.ts apps/api/src/__tests__/schedule.service.test.ts
git commit -m "feat(api): audit writes for availability, holiday, and schedule domains"
```

---

### Task 6: Web service, route, and navigation

**Files:**
- Create: `apps/web/src/services/activity.ts`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/components/layout/AppHeader.vue`

**Interfaces:**
- Consumes: `ActivityQuery`, `PaginatedActivity` from `@oncall/shared`.
- Produces: `getActivity(query?: ActivityQuery): Promise<PaginatedActivity>`; route `/activity` (administrator + superadmin via guard).

- [ ] **Step 1: Create `apps/web/src/services/activity.ts`**

```ts
import type { ActivityQuery, PaginatedActivity } from '@oncall/shared'
import { apiGet } from '@/lib/http'

export async function getActivity(query: ActivityQuery = {}): Promise<PaginatedActivity> {
  const params = new URLSearchParams()
  if (query.action) params.set('action', query.action)
  if (query.userId) params.set('userId', String(query.userId))
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  if (query.page) params.set('page', String(query.page))
  if (query.limit) params.set('limit', String(query.limit))
  const qs = params.toString()
  const { activity } = await apiGet<{ activity: PaginatedActivity }>(
    `/activity${qs ? `?${qs}` : ''}`,
  )
  return activity
}
```

- [ ] **Step 2: Add the route in `apps/web/src/router/index.ts`** (after the `reports` entry, inside the DefaultLayout children)

```ts
      {
        path: 'activity',
        name: 'activity',
        component: () => import('../pages/ActivityPage.vue'),
        meta: { roles: ['administrator'] },
      },
```

The guard already treats superadmin as a superset of administrator.

- [ ] **Step 3: Add the nav item in `apps/web/src/components/layout/AppHeader.vue`** — inside the `if (auth.isAdmin)` block, after `{ to: '/reports', label: 'Reports' }`:

```ts
      { to: '/activity', label: 'Activity' },
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (page component comes in Task 7 — the lazy import resolves then)

Note: if typecheck fails here because `ActivityPage.vue` does not exist yet, create a minimal placeholder page from Task 7 Step 1's `<script setup>` and template skeleton, then flesh it out in Task 7. Do not commit the placeholder.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/activity.ts apps/web/src/router/index.ts apps/web/src/components/layout/AppHeader.vue
git commit -m "feat(web): activity service, route, and admin nav tab"
```

---

### Task 7: ActivityPage

**Files:**
- Create: `apps/web/src/pages/ActivityPage.vue`
- Create: `apps/web/src/__tests__/ActivityPage.test.ts`

**Interfaces:**
- Consumes: `getActivity` from Task 6, `list` from `@/services/user`, `ACTIVITY_ACTIONS` from `@oncall/shared`.

- [ ] **Step 1: Create `apps/web/src/pages/ActivityPage.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ActivityLogEntry, ActivityQuery, PaginatedActivity, User } from '@oncall/shared'
import { ACTIVITY_ACTIONS } from '@oncall/shared'
import * as activityService from '@/services/activity'
import * as userService from '@/services/user'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const PAGE_SIZE = 50

const actionGroups: Array<[string, string[]]> = (() => {
  const groups = new Map<string, string[]>()
  for (const action of ACTIVITY_ACTIONS) {
    const [domain, verb] = action.split('.')
    const list = groups.get(domain) ?? []
    list.push(verb)
    groups.set(domain, list)
  }
  return [...groups.entries()]
})()

const filters = ref({ action: '', userId: '', from: '', to: '' })
const page = ref(1)
const data = ref<PaginatedActivity | null>(null)
const users = ref<User[]>([])
const loading = ref(false)
const errorMsg = ref('')

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const query: ActivityQuery = { page: page.value, limit: PAGE_SIZE }
    if (filters.value.action) query.action = filters.value.action as ActivityQuery['action']
    if (filters.value.userId) query.userId = Number(filters.value.userId)
    if (filters.value.from) query.from = filters.value.from
    if (filters.value.to) query.to = filters.value.to
    data.value = await activityService.getActivity(query)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load activity'
  } finally {
    loading.value = false
  }
}

watch(
  filters,
  () => {
    page.value = 1
    void load()
  },
  { deep: true },
)

function prevPage() {
  if (page.value > 1) {
    page.value--
    void load()
  }
}

function nextPage() {
  if (data.value && page.value * PAGE_SIZE < data.value.total) {
    page.value++
    void load()
  }
}

function clearFilters() {
  filters.value = { action: '', userId: '', from: '', to: '' }
}

function actorName(entry: ActivityLogEntry): string {
  if (!entry.actor) return 'Deleted user'
  return `${entry.actor.firstName} ${entry.actor.lastName}`
}

function entityText(entry: ActivityLogEntry): string {
  return entry.entityId === null ? entry.entityType : `${entry.entityType} #${entry.entityId}`
}

function detailText(detail: Record<string, unknown>): string {
  const json = JSON.stringify(detail)
  if (json === '{}') return ''
  return json.length > 60 ? `${json.slice(0, 57)}…` : json
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

const rangeText = computed(() => {
  if (!data.value || data.value.items.length === 0) return ''
  const first = (data.value.page - 1) * data.value.limit + 1
  const last = first + data.value.items.length - 1
  return `Showing ${first}–${last} of ${data.value.total}`
})

onMounted(() => {
  void load()
  void userService
    .list()
    .then((u) => {
      users.value = u
    })
    .catch(() => {
      // Filter dropdown stays empty; the log itself still loads.
    })
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold text-foreground">User Activity</h1>

    <Card>
      <CardContent class="grid gap-4 p-6 pt-6 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div class="flex flex-col gap-1">
          <Label for="f-action">Action</Label>
          <Select id="f-action" v-model="filters.action">
            <option value="">All actions</option>
            <optgroup v-for="[domain, verbs] in actionGroups" :key="domain" :label="domain">
              <option v-for="verb in verbs" :key="verb" :value="`${domain}.${verb}`">
                {{ verb }}
              </option>
            </optgroup>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="f-user">User</Label>
          <Select id="f-user" v-model="filters.userId">
            <option value="">All users</option>
            <option v-for="u in users" :key="u.id" :value="String(u.id)">
              {{ u.firstName }} {{ u.lastName }} ({{ u.username }})
            </option>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="f-from">From</Label>
          <Input id="f-from" v-model="filters.from" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="f-to">To</Label>
          <Input id="f-to" v-model="filters.to" type="date" />
        </div>
        <Button variant="outline" @click="clearFilters">Clear filters</Button>
      </CardContent>
    </Card>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>User</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Entity</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in data?.items ?? []" :key="x.id">
          <TableCell class="whitespace-nowrap">{{ formatTime(x.createdAt) }}</TableCell>
          <TableCell>
            <span>{{ actorName(x) }}</span>
            <span
              v-if="x.actor"
              class="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {{ x.actor.role }}
            </span>
          </TableCell>
          <TableCell>
            <span
              class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
            >
              {{ x.action }}
            </span>
          </TableCell>
          <TableCell class="whitespace-nowrap">{{ entityText(x) }}</TableCell>
          <TableCell>
            <code
              v-if="detailText(x.detail)"
              class="text-xs text-muted-foreground"
              :title="JSON.stringify(x.detail)"
            >
              {{ detailText(x.detail) }}
            </code>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <p v-if="data && data.items.length === 0 && !loading" class="text-sm text-muted-foreground">
      No activity found.
    </p>

    <div v-if="data && data.total > 0" class="flex items-center justify-between">
      <span class="text-sm text-muted-foreground">{{ rangeText }}</span>
      <div class="inline-flex gap-2">
        <Button size="sm" variant="outline" :disabled="page <= 1" @click="prevPage">Prev</Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="page * PAGE_SIZE >= data.total"
          @click="nextPage"
        >
          Next
        </Button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `apps/web/src/__tests__/ActivityPage.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const getActivity = vi.fn()
vi.mock('@/services/activity', () => ({
  getActivity: (...a: unknown[]) => getActivity(...a),
}))
const listUsers = vi.fn()
vi.mock('@/services/user', () => ({
  list: (...a: unknown[]) => listUsers(...a),
}))

import ActivityPage from '../pages/ActivityPage.vue'

function page(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        id: 1,
        action: 'availability.created',
        entityType: 'unavailability',
        entityId: 12,
        detail: { type: 'vacation', startDate: '2026-09-07', endDate: '2026-09-11' },
        createdAt: '2026-08-16T10:00:00.000Z',
        actor: {
          id: 3,
          username: 'jroe',
          role: 'doctor',
          firstName: 'Jane',
          lastName: 'Roe',
        },
      },
    ],
    total: 1,
    page: 1,
    limit: 50,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  getActivity.mockReset()
  listUsers.mockReset()
  listUsers.mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('ActivityPage', () => {
  it('renders entries on mount', async () => {
    getActivity.mockResolvedValue(page())
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('availability.created')
    expect(wrapper.text()).toContain('Jane Roe')
    expect(wrapper.text()).toContain('unavailability #12')
    expect(wrapper.text()).toContain('Showing 1–1 of 1')
  })

  it('renders "Deleted user" for a null actor', async () => {
    const p = page()
    p.items[0]!.actor = null
    getActivity.mockResolvedValue(p)
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Deleted user')
  })

  it('refetches with the selected action filter', async () => {
    getActivity.mockResolvedValue(page())
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const select = wrapper.find('#f-action')
    await select.setValue('auth.login')
    await flushPromises()
    expect(getActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'auth.login', page: 1, limit: 50 }),
    )
  })

  it('paginates forward and back', async () => {
    getActivity.mockResolvedValue(page({ items: [], total: 120, page: 1, limit: 50 }))
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const buttons = wrapper.findAll('button')
    const next = buttons.find((b) => b.text() === 'Next')!
    await next.trigger('click')
    await flushPromises()
    expect(getActivity).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 50 }))
  })

  it('shows an error when loading fails', async () => {
    getActivity.mockRejectedValue(new Error('nope'))
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @oncall/web test -- ActivityPage && pnpm typecheck && pnpm lint`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ActivityPage.vue apps/web/src/__tests__/ActivityPage.test.ts
git commit -m "feat(web): admin activity log page with filters and pagination"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full monorepo gates**

Run from repo root:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all three PASS with zero errors.

- [ ] **Step 2: Smoke check the running system (optional but recommended)**

Run `pnpm db:setup` then `pnpm dev`; log in as an administrator, open the Activity tab, and confirm your own `auth.login` row appears. Declare availability as a doctor and confirm `availability.created` appears with detail.

- [ ] **Step 3: No commit needed** — Tasks 1–7 committed everything. Only commit if Steps 1–2 surfaced fixes.
