# Doctor Soft Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the redundant "Deactivate" action with a true soft delete (`users.is_deleted`) that hides a doctor everywhere while preserving history and freeing email/username for reuse.

**Architecture:** Single boolean column on `users` with partial unique indexes on `email`/`username`. Deletion sets `is_deleted = TRUE, is_active = FALSE`, revokes refresh tokens, and is blocked (409) when the doctor has duties in a draft schedule. All read paths filter `is_deleted = FALSE`, making deleted doctors completely invisible.

**Tech Stack:** PostgreSQL (raw SQL, no migration runner), Express + TypeScript, Vitest, Vue 3.

**Spec:** `docs/superpowers/specs/2026-08-16-doctor-soft-delete-design.md`

## Global Constraints

- Repository is on `main`. Per AGENTS.md: **do not commit on main** — leave changes uncommitted and tell the user. Only commit if the work happens on a non-main branch.
- No Prettier. No new lint rules. No migration runner — schema evolves via idempotent blocks in `database/schema.sql`.
- Parameterized SQL only; never concatenate SQL.
- AGENTS.md requires tests: update the listed test files. Verification for every task = `pnpm typecheck && pnpm lint && pnpm test` (from repo root) must pass before the task is done.
- Run commands from the repository root (`C:\Users\kalamata\Documents\GitHub\on-call-duty`).

---

### Task 1: Database — `is_deleted` column + partial unique indexes

**Files:**
- Modify: `database/schema.sql` (append at end of file)

**Interfaces:**
- Produces: `users.is_deleted BOOLEAN NOT NULL DEFAULT FALSE`; partial unique indexes `idx_users_email_live` and `idx_users_username_live` replacing the old full-unique constraint/index on `email`/`username`. All later tasks rely on this column existing.

- [ ] **Step 1: Append the Phase 12 evolution block**

Append to the end of `database/schema.sql`:

```sql
-- Phase 12: Doctor soft delete
-- Deleted accounts: is_deleted = TRUE (and always is_active = FALSE).
-- Partial unique indexes free email/username of deleted accounts for reuse.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
DROP INDEX IF EXISTS idx_users_username;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_live
  ON users (email) WHERE is_deleted = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_live
  ON users (username) WHERE is_deleted = FALSE;
```

- [ ] **Step 2: Apply to the local database**

Run: `pnpm db:setup`
Expected: schema + seed apply with no errors (script is idempotent).

If no local database is available, note it and rely on Task 4's SQL-assertion tests.

---

### Task 2: Backend — doctor service soft delete + hidden reads

**Files:**
- Modify: `apps/api/src/services/doctor.service.ts` (lines 46-63 queries, 65-101 create, 177-191 deactivate)
- Modify: `apps/api/src/controllers/doctor.controller.ts` (line 50)

**Interfaces:**
- Consumes: `users.is_deleted` (Task 1); `revokeAllForUser(userId: number): Promise<void>` from `src/services/token.service.ts` (existing).
- Produces: `remove(id: number, actor: Pick<AuthUser, 'id' | 'role'>): Promise<void>` — exported from `doctor.service.ts` (replaces `deactivate`). Controller calls `doctorService.remove`. `list`/`getById`/`getByUserId` now exclude deleted doctors.

- [ ] **Step 1: Filter deleted doctors from reads**

In `apps/api/src/services/doctor.service.ts`, change the three read queries:

```ts
export async function list(): Promise<Doctor[]> {
  const res = await query<DoctorRow>(
    `${SELECT} WHERE u.is_deleted = FALSE ORDER BY u.last_name, u.first_name`,
    [],
  )
  return res.rows.map(toDoctor)
}

export async function getById(id: number): Promise<Doctor> {
  const res = await query<DoctorRow>(`${SELECT} WHERE d.id = $1 AND u.is_deleted = FALSE`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Doctor not found')
  return toDoctor(row)
}

export async function getByUserId(userId: number): Promise<Doctor> {
  const res = await query<DoctorRow>(
    `${SELECT} WHERE d.user_id = $1 AND u.is_deleted = FALSE`,
    [userId],
  )
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Doctor not found')
  return toDoctor(row)
}
```

- [ ] **Step 2: Allow email/username reuse in create()**

In `create()`, change the two duplicate checks (lines 67-70) to ignore deleted accounts:

```ts
    const dupEmail = await client.query(
      'SELECT id FROM users WHERE email = $1 AND is_deleted = FALSE',
      [input.email],
    )
    if (dupEmail.rows.length > 0) throw new HttpError(409, 'Email already in use')
    const dupUser = await client.query(
      'SELECT id FROM users WHERE username = $1 AND is_deleted = FALSE',
      [input.username],
    )
    if (dupUser.rows.length > 0) throw new HttpError(409, 'Username already in use')
```

- [ ] **Step 3: Replace deactivate() with remove()**

Add the token.service import at the top of the file:

```ts
import * as tokenService from './token.service'
```

Delete the entire `deactivate` function (lines 177-191) and replace with:

```ts
export async function remove(id: number, actor: Actor): Promise<void> {
  const existing = await getById(id)
  await withTransaction(async (client) => {
    const draft = await client.query(
      `SELECT 1 FROM duties du JOIN schedules s ON s.id = du.schedule_id
       WHERE du.doctor_id = $1 AND s.status = 'draft' LIMIT 1`,
      [id],
    )
    if (draft.rows.length > 0) {
      throw new HttpError(409, 'Doctor has duties in a draft schedule')
    }
    await client.query(
      'UPDATE users SET is_deleted = TRUE, is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [existing.userId],
    )
    await recordActivity(client, {
      userId: actor.id,
      action: 'doctor.deleted',
      entityType: 'doctor',
      entityId: id,
      detail: { email: existing.email },
    })
  })
  await tokenService.revokeAllForUser(existing.userId)
}
```

- [ ] **Step 4: Update the controller**

In `apps/api/src/controllers/doctor.controller.ts` line 50, change:

```ts
      await doctorService.remove(Number(req.params.id), req.user!)
```

Routes file needs no change (`DELETE /doctors/:id` already wires to `doctorController.remove`).

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (`pnpm test` will fail on old `deactivate` tests — fixed in Task 4.)

---

### Task 3: Backend — auth and user services hide deleted accounts

**Files:**
- Modify: `apps/api/src/services/auth.service.ts` (lines 34-49 lookups)
- Modify: `apps/api/src/services/user.service.ts` (lines 46-66 list/getById, 72-75 dup checks)

**Interfaces:**
- Consumes: `users.is_deleted` (Task 1).
- Produces: deleted users cannot log in (401), refresh (401), or appear via user.service reads; their email/username pass user.service duplicate checks.

- [ ] **Step 1: Filter deleted users in auth.service lookups**

In `apps/api/src/services/auth.service.ts`, replace the three finder functions (lines 34-49):

```ts
async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const res = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 AND is_deleted = FALSE`,
    [email],
  )
  return res.rows[0]
}

async function findUserByUsername(username: string): Promise<UserRow | undefined> {
  const res = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 AND is_deleted = FALSE`,
    [username],
  )
  return res.rows[0]
}

async function findUserById(id: number): Promise<UserRow | undefined> {
  const res = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND is_deleted = FALSE`,
    [id],
  )
  return res.rows[0]
}
```

A deleted user now falls into the existing `!row` paths: login → 401 "Invalid credentials", refresh → 401 "Invalid refresh token", getUser/changePassword → 404. No other code changes in this file.

- [ ] **Step 2: Filter deleted users in user.service**

In `apps/api/src/services/user.service.ts`, change `list()` (lines 46-56):

```ts
export async function list(actor?: Actor): Promise<User[]> {
  if (actor && actor.role !== 'superadmin') {
    const filtered = await query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE is_deleted = FALSE AND role <> $1 ORDER BY created_at`,
      ['superadmin'],
    )
    return filtered.rows.map(toUser)
  }
  const res = await query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE is_deleted = FALSE ORDER BY created_at`,
    [],
  )
  return res.rows.map(toUser)
}
```

Change `getById()` WHERE clause (line 59) to:

```ts
  const res = await query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1 AND is_deleted = FALSE`,
    [id],
  )
```

Change the duplicate checks in `create()` (lines 72-75) to:

```ts
  const existingEmail = await query(
    'SELECT id FROM users WHERE email = $1 AND is_deleted = FALSE',
    [input.email],
  )
  if (existingEmail.rows.length > 0) throw new HttpError(409, 'Email already in use')
  const existingUsername = await query(
    'SELECT id FROM users WHERE username = $1 AND is_deleted = FALSE',
    [input.username],
  )
  if (existingUsername.rows.length > 0) throw new HttpError(409, 'Username already in use')
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

---

### Task 4: Backend tests — doctor/auth/user soft delete coverage

**Files:**
- Modify: `apps/api/src/__tests__/doctor.service.test.ts`
- Modify: `apps/api/src/__tests__/doctor.routes.test.ts`
- Modify: `apps/api/src/__tests__/auth.service.test.ts`
- Modify: `apps/api/src/__tests__/user.service.test.ts`

**Interfaces:**
- Consumes: `remove` from Task 2, `is_deleted = FALSE` filters from Tasks 2-3.

- [ ] **Step 1: Update doctor.service.test.ts**

Add a token.service mock next to the existing mocks (after the bcrypt mock, ~line 18):

```ts
const revokeAllForUser = vi.fn(async () => undefined)
vi.mock('../services/token.service', () => ({
  revokeAllForUser: (...a: unknown[]) => revokeAllForUser(...a),
}))
```

Reset it in `beforeEach` (add `revokeAllForUser.mockReset()` and `revokeAllForUser.mockResolvedValue(undefined)`).

Change the import block (lines 20-27) from `deactivate` to `remove`:

```ts
import {
  create,
  getById,
  getByUserId,
  list,
  remove,
  update,
} from '../services/doctor.service'
```

Replace the three `deactivate` tests (lines 129-164) with:

```ts
  it('remove soft-deletes: sets is_deleted and is_active, revokes tokens, keeps rows', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 2, user_id: 7 })] })
    query.mockResolvedValueOnce({ rows: [] }) // draft-duty check: none
    query.mockResolvedValueOnce({ rows: [] }) // UPDATE users
    await remove(2, actor)
    const draftCheck = query.mock.calls[1]?.[0] as string
    expect(draftCheck).toContain("s.status = 'draft'")
    const upd = query.mock.calls[2]?.[0] as string
    expect(upd).toContain('UPDATE users')
    expect(upd).toContain('is_deleted = TRUE')
    expect(upd).toContain('is_active = FALSE')
    expect((query.mock.calls[2]?.[1] as unknown[])[0]).toBe(7)
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM users'))).toBe(false)
    expect(revokeAllForUser).toHaveBeenCalledWith(7)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'doctor.deleted', entityId: 2 }),
    )
  })

  it('remove throws 409 when the doctor has duties in a draft schedule', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 2, user_id: 7 })] })
    query.mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // draft duty found
    await expect(remove(2, actor)).rejects.toMatchObject({ status: 409 })
    expect(revokeAllForUser).not.toHaveBeenCalled()
  })

  it('remove allows deletion when duties exist only in published schedules', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 2, user_id: 7 })] })
    query.mockResolvedValueOnce({ rows: [] }) // draft-duty check: none
    query.mockResolvedValueOnce({ rows: [] }) // UPDATE users
    await remove(2, actor)
    expect(revokeAllForUser).toHaveBeenCalledWith(7)
  })

  it('remove throws 404 when doctor missing', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(remove(99, actor)).rejects.toMatchObject({ status: 404 })
  })

  it('getById excludes deleted doctors (404)', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(getById(2)).rejects.toMatchObject({ status: 404 })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('u.is_deleted = FALSE')
  })

  it('create duplicate checks ignore deleted accounts', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [] } // email check
      if (n === 2) return { rows: [] } // username check
      if (n === 3) return { rows: [{ id: 10 }] }
      if (n === 4) return { rows: [{ id: 1 }] }
      return { rows: [doctorRow({ id: 1 })] }
    })
    await create(
      { email: 'd@h.com', username: 'dr1', password: 'secret1', firstName: 'J', lastName: 'R' },
      actor,
    )
    expect(query.mock.calls[0]?.[0]).toContain('AND is_deleted = FALSE')
    expect(query.mock.calls[1]?.[0]).toContain('AND is_deleted = FALSE')
  })
```

- [ ] **Step 2: Update doctor.routes.test.ts DELETE test**

Replace the DELETE test (lines 111-122) with (note the extra draft-check mock):

```ts
  it('admin DELETE /doctors/:id soft-deletes (204, rows kept)', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [] }) // draft-duty check
    query.mockResolvedValueOnce({ rows: [] }) // UPDATE users
    const res = await request(build())
      .delete('/doctors/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(204)
    const upd = query.mock.calls[2]?.[0] as string
    expect(upd).toContain('UPDATE users')
    expect(upd).toContain('is_deleted = TRUE')
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM users'))).toBe(false)
  })
```

- [ ] **Step 3: Update auth.service.test.ts**

Add a deleted-user login test after the "login throws 403 when inactive" test (~line 103):

```ts
  it('login throws 401 when the account is deleted (invisible)', async () => {
    query.mockResolvedValue({ rows: [] }) // lookups filter is_deleted = FALSE
    await expect(
      login({ identifier: 'gone@h.com', password: 'whatever' }),
    ).rejects.toMatchObject({ status: 401 })
  })
```

The existing `WHERE username = $1` substring assertion (line 79) still matches the new SQL `WHERE username = $1 AND is_deleted = FALSE` — no change needed there.

- [ ] **Step 4: Update user.service.test.ts**

Add tests to the existing `describe` (keep the file's existing `row` helper and mocks):

```ts
  it('list excludes deleted users in both role-filtered and full queries', async () => {
    query.mockResolvedValue({ rows: [] })
    await list()
    await list({ id: 1, role: 'administrator' as const })
    expect(query.mock.calls[0]?.[0]).toContain('is_deleted = FALSE')
    expect(query.mock.calls[1]?.[0]).toContain('is_deleted = FALSE')
  })

  it('create duplicate checks ignore deleted accounts', async () => {
    query.mockResolvedValueOnce({ rows: [] }) // email check
    query.mockResolvedValueOnce({ rows: [] }) // username check
    query.mockImplementation(async () => ({ rows: [] }))
    await create(
      {
        email: 'gone@h.com',
        username: 'gone',
        password: 'secret1',
        role: 'doctor',
        firstName: 'G',
        lastName: 'O',
      },
      { id: 1, role: 'administrator' as const },
    ).catch(() => undefined)
    expect(query.mock.calls[0]?.[0]).toContain('AND is_deleted = FALSE')
    expect(query.mock.calls[1]?.[0]).toContain('AND is_deleted = FALSE')
  })
```

- [ ] **Step 5: Run typecheck, lint, and API tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. If `user.service.test.ts`'s existing mocks differ (e.g. `withTransaction` shape), adapt the new tests to the file's established mock pattern — the assertions to keep are the SQL `is_deleted = FALSE` checks.

---

### Task 5: Frontend — "Deactivate" becomes "Delete"

**Files:**
- Modify: `apps/web/src/pages/DoctorsPage.vue` (lines 111-116 function, 155 button)
- Modify: `apps/web/src/__tests__/DoctorsPage.test.ts`

**Interfaces:**
- Consumes: `DELETE /doctors/:id` via existing `doctorService.remove(id)` (unchanged, `apps/web/src/services/doctor.ts`).

- [ ] **Step 1: Rename the action and update copy**

In `apps/web/src/pages/DoctorsPage.vue`, replace the `deactivate` function (lines 111-116):

```ts
async function deleteDoctor(d: Doctor) {
  if (
    !confirm(
      `Delete doctor ${d.email}? They will be permanently hidden from the list. Past duties in published schedules are kept. This cannot be undone.`,
    )
  )
    return
  await doctorService.remove(d.id)
  await load()
}
```

Change the button (line 155):

```html
              <Button size="sm" variant="destructive" @click="deleteDoctor(d)">Delete</Button>
```

The Disable/Enable toggle (lines 106-109, 152-154) stays unchanged.

- [ ] **Step 2: Add a DoctorsPage test for delete**

In `apps/web/src/__tests__/DoctorsPage.test.ts`, extend the existing `vi.mock('@/services/doctor', ...)` to capture `remove`:

```ts
const remove = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => list(...a),
  get: vi.fn(),
  me: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: (...a: unknown[]) => remove(...a),
}))
```

Add `remove.mockReset()` to `beforeEach` and add this test inside the describe:

```ts
  it('Delete button asks for confirmation and calls remove', async () => {
    list.mockResolvedValue([
      {
        id: 1,
        userId: 10,
        email: 'dr@h.com',
        username: 'dr1',
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthlyDuties: 7,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    list.mockResolvedValue([]) // reload after delete
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const btn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Delete')
    await btn!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('permanently hidden'),
    )
    expect(remove).toHaveBeenCalledWith(1)
    confirmSpy.mockRestore()
  })
```

If jsdom does not define `window.confirm` by default, use `vi.stubGlobal('confirm', vi.fn(() => true))` instead of `spyOn`, and assert on the stub.

- [ ] **Step 3: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors across all workspaces.

- [ ] **Step 4: Commit (only if NOT on main)**

Check with `git branch --show-current`. If (and only if) it is not `main`:

```bash
git add database/schema.sql apps/api/src apps/web/src docs/superpowers
git commit -m "feat: soft-delete doctors with is_deleted flag"
```

If on `main`: leave all changes uncommitted and inform the user so they can commit.
