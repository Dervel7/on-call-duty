# Username + Email Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff log in with either an email or a username, by adding a required unique `username` column to users and routing a single `identifier` login field to the right lookup.

**Architecture:** Single `identifier` payload replaces `{ email, password }`. Backend resolves email vs username by `@` shape. `username` becomes `NOT NULL UNIQUE` on `users`, so every user-creation path (admin users, doctors) carries username end-to-end through the shared contract, both backend services that write `users`, and the frontend forms.

**Tech Stack:** PostgreSQL (idempotent `schema.sql`, no migration runner), Zod (`@oncall/shared` is the single source of truth), Express + `pg` direct SQL, Vue 3 + Pinia, Vitest.

## Global Constraints

- Username format: `^[A-Za-z0-9._-]{3,32}$`, case-sensitive, no `@` (enforced by Zod AND by a DB CHECK on fresh DBs).
- `username` is `NOT NULL UNIQUE` on `users`; uniqueness via idempotent `idx_users_username`.
- No ORM, no migration runner — direct SQL, schema in one `database/schema.sql`.
- Schemas/types live ONLY in `packages/shared`; both apps import from `@oncall/shared`.
- DB columns snake_case; API/TS contract camelCase; service layer maps between them.
- We are on branch `feat/username-login`; commit after each task. Do NOT run on `main`.
- Format with Volar (format-on-save); no Prettier. Do not change lint rules.

---

### Task 1: Database schema + seed

**Files:**
- Modify: `database/schema.sql:11-23` (users table + new evolution block)
- Modify: `database/seed.sql` (admin + doctor user inserts)

**Interfaces:**
- Consumes: nothing
- Produces: `users.username TEXT NOT NULL` + `idx_users_username`; seed rows carry usernames (`admin`, `dr1`, `dr2`, `dr3`)

- [ ] **Step 1: Add username to the users CREATE TABLE**

In `database/schema.sql`, replace the users table block (the `CREATE TABLE IF NOT EXISTS users (...)` ending before `CREATE INDEX IF NOT EXISTS idx_users_role`) with:

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
```

- [ ] **Step 2: Add the idempotent evolution block for pre-existing databases**

Immediately after the `CREATE INDEX IF NOT EXISTS idx_users_role ON users (role) WHERE is_active = TRUE;` line (and before the `refresh_tokens` table), insert:

```sql
-- Username column evolution for pre-existing databases (no migration runner exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
UPDATE users SET username = split_part(email, '@', 1) WHERE username IS NULL;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);
```

- [ ] **Step 3: Add username to the seed admin insert**

In `database/seed.sql`, replace the admin `INSERT INTO users (...)` statement with:

```sql
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
VALUES (
  'admin@oncall.local',
  'admin',
  '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
  'administrator',
  'System',
  'Administrator',
  TRUE
)
ON CONFLICT (email) DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();
```

- [ ] **Step 4: Add username to the seed doctor inserts**

In `database/seed.sql`, replace the doctor `INSERT INTO users (...)` statement with:

```sql
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
VALUES
  ('dr1@oncall.local', 'dr1', '$2b$12$sf0hxnuWvwI17HpZNo.VBubjp35/R3CXtabJsFMpjQxA/erV9m21G', 'doctor', 'Jane',  'Roe',   TRUE),
  ('dr2@oncall.local', 'dr2', '$2b$12$CxcEXDtGy52WGatK9YCNlOdyS6yp1uNd4Ac8f68YZOmHYXN2HR8Sq', 'doctor', 'John',  'Smith', TRUE),
  ('dr3@oncall.local', 'dr3', '$2b$12$nXzGkWp0gNlyFOj8/dp6oOQ0BH7twg.VkgYF95PqOzagOTZsBrJOW', 'doctor', 'Maria', 'Garcia', TRUE)
ON CONFLICT (email) DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();
```

- [ ] **Step 5: Verify (if a local Postgres is available)**

Run: `pnpm db:setup` (or `pnpm db:seed` against an existing DB).
Expected: succeeds; `\d users` shows `username NOT NULL` + `idx_users_username`.
If no local DB, skip — this is SQL-only and typecheck is unaffected.

- [ ] **Step 6: Commit**

```bash
git add database/schema.sql database/seed.sql
git commit -m "feat(db): add required unique username to users with backfill and seed data"
```

---

### Task 2: Shared contract (schemas + types)

**Files:**
- Modify: `packages/shared/src/schemas/auth.ts`
- Modify: `packages/shared/src/schemas/doctor.ts`
- Modify: `packages/shared/src/types/auth.ts`
- Modify: `packages/shared/src/types/doctor.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `usernameSchema`, `loginSchema = { identifier, password }`, `AuthUser.username`, `Doctor.username`, username on `CreateUserRequest`/`UpdateUserRequest`/`CreateDoctorRequest`/`UpdateDoctorRequest`

- [ ] **Step 1: Add usernameSchema and update auth schemas**

Replace the entire contents of `packages/shared/src/schemas/auth.ts` with:

```ts
import { z } from 'zod'

export const roleSchema = z.enum(['administrator', 'doctor'])

export const usernameSchema = z.string().regex(/^[A-Za-z0-9._-]{3,32}$/, 'Invalid username')

export const loginSchema = z.object({
  identifier: z.string().min(1),
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

- [ ] **Step 2: Add username to doctor schemas**

Replace the entire contents of `packages/shared/src/schemas/doctor.ts` with:

```ts
import { z } from 'zod'
import { usernameSchema } from './auth'

export const createDoctorSchema = z.object({
  email: z.string().email(),
  username: usernameSchema,
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  maxMonthlyDuties: z.number().int().min(1).max(7).default(7),
})

export const updateDoctorSchema = z.object({
  email: z.string().email().optional(),
  username: usernameSchema.optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  maxMonthlyDuties: z.number().int().min(1).max(7).optional(),
  isActive: z.boolean().optional(),
})
```

- [ ] **Step 3: Update auth types**

Replace the entire contents of `packages/shared/src/types/auth.ts` with:

```ts
export type Role = 'administrator' | 'doctor'

export interface AuthUser {
  id: number
  email: string
  username: string
  role: Role
  firstName: string
  lastName: string
}

export interface User extends AuthUser {
  isActive: boolean
  createdAt: string
}

export interface LoginRequest {
  identifier: string
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
  username: string
  password: string
  role: Role
  firstName: string
  lastName: string
}
export interface UpdateUserRequest {
  email?: string
  username?: string
  role?: Role
  firstName?: string
  lastName?: string
  isActive?: boolean
}
```

- [ ] **Step 4: Update doctor types**

Replace the entire contents of `packages/shared/src/types/doctor.ts` with:

```ts
export interface Doctor {
  id: number
  userId: number
  email: string
  username: string
  firstName: string
  lastName: string
  isActive: boolean
  maxMonthlyDuties: number
  createdAt: string
  updatedAt: string
}

export interface CreateDoctorRequest {
  email: string
  username: string
  password: string
  firstName: string
  lastName: string
  maxMonthlyDuties?: number
}

export interface UpdateDoctorRequest {
  email?: string
  username?: string
  firstName?: string
  lastName?: string
  maxMonthlyDuties?: number
  isActive?: boolean
}
```

- [ ] **Step 5: Update shared schema tests**

In `packages/shared/src/__tests__/schemas.test.ts`:

Replace the first `it('loginSchema rejects short password and bad email'...)` block (inside `describe('auth schemas')`) with:

```ts
  it('loginSchema requires identifier + min-6 password', () => {
    expect(loginSchema.safeParse({ identifier: '', password: '123456' }).success).toBe(false)
    expect(loginSchema.safeParse({ identifier: 'a@b.com', password: '12345' }).success).toBe(false)
    expect(loginSchema.safeParse({ identifier: 'a@b.com', password: '123456' }).success).toBe(true)
    expect(loginSchema.safeParse({ identifier: 'admin', password: '123456' }).success).toBe(true)
  })

  it('usernameSchema enforces the 3-32 alnum/._- format', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false)
    expect(usernameSchema.safeParse('a@b').success).toBe(false)
    expect(usernameSchema.safeParse('has space').success).toBe(false)
    expect(usernameSchema.safeParse('admin.1_ok').success).toBe(true)
  })
```

Update the import at the top of the file to also import `usernameSchema`:

```ts
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  roleSchema,
  updateUserSchema,
  usernameSchema,
} from '../index'
```

Update the `createUserSchema validates a doctor` block to include `username`:

```ts
  it('createUserSchema validates a doctor', () => {
    expect(
      createUserSchema.safeParse({
        email: 'd@h.com',
        username: 'dr1',
        password: 'secret1',
        role: 'doctor',
        firstName: 'Jane',
        lastName: 'Roe',
      }).success,
    ).toBe(true)
  })
```

In the `describe('doctor schemas')` block, update the `valid` fixture to include `username: 'dr1'`:

```ts
  const valid = {
    email: 'dr@h.com',
    username: 'dr1',
    password: 'secret1',
    firstName: 'Jane',
    lastName: 'Roe',
  }
```

- [ ] **Step 6: Run shared typecheck and tests**

Run: `pnpm --filter @oncall/shared typecheck && pnpm --filter @oncall/shared test`
Expected: PASS with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add username to auth/doctor schemas and types, identifier login"
```

---

### Task 3: Backend services + tests

**Files:**
- Modify: `apps/api/src/services/auth.service.ts`
- Modify: `apps/api/src/services/user.service.ts`
- Modify: `apps/api/src/services/doctor.service.ts`
- Modify: `apps/api/src/__tests__/auth.service.test.ts`
- Modify: `apps/api/src/__tests__/auth.routes.test.ts`
- Modify: `apps/api/src/__tests__/user.service.test.ts`
- Modify: `apps/api/src/__tests__/user.routes.test.ts`
- Modify: `apps/api/src/__tests__/doctor.service.test.ts`
- Modify: `apps/api/src/__tests__/doctor.routes.test.ts`

**Interfaces:**
- Consumes: `LoginRequest.identifier`, `AuthUser.username`, `Doctor.username`, username on create/update requests (from Task 2)
- Produces: `auth.service.login` resolves identifier→email|username; `user.service`/`doctor.service` persist + return username

- [ ] **Step 1: Update auth.service.ts — UserRow + columns + toAuthUser**

In `apps/api/src/services/auth.service.ts`:

In the `UserRow` interface, add `username: string` after `email: string`:

```ts
interface UserRow {
  id: number
  email: string
  username: string
  password_hash: string
  role: 'administrator' | 'doctor'
  first_name: string
  last_name: string
  is_active: boolean
  created_at: Date
}
```

In `toAuthUser`, add `username: row.username` after `email: row.email`:

```ts
function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
  }
}
```

Change `USER_COLUMNS` to include `username`:

```ts
const USER_COLUMNS = `id, email, username, password_hash, role, first_name, last_name, is_active, created_at`
```

- [ ] **Step 2: Add findUserByUsername and branch in login**

In `apps/api/src/services/auth.service.ts`, add a new helper immediately after `findUserByEmail`:

```ts
async function findUserByUsername(username: string): Promise<UserRow | undefined> {
  const res = await query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE username = $1`, [username])
  return res.rows[0]
}
```

Replace the body of `login()` (the first two lines that look up the user) so the function reads:

```ts
export async function login(
  input: LoginRequest,
): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const row = input.identifier.includes('@')
    ? await findUserByEmail(input.identifier)
    : await findUserByUsername(input.identifier)
  if (!row) throw new HttpError(401, 'Invalid credentials')
  const ok = await bcrypt.compare(input.password, row.password_hash)
  if (!ok) throw new HttpError(401, 'Invalid credentials')
  if (!row.is_active) throw new HttpError(403, 'Account disabled')
  const accessToken = signAccessToken({ sub: row.id, role: row.role })
  const refreshToken = await tokenService.issueRefreshToken(row.id)
  return { user: toAuthUser(row), accessToken, refreshToken }
}
```

- [ ] **Step 3: Update user.service.ts — UserRow + columns + toUser**

In `apps/api/src/services/user.service.ts`:

In the `UserRow` interface, add `username: string` after `email: string`. In `toUser`, add `username: row.username` after `email: row.email`. Change `COLUMNS` to:

```ts
const COLUMNS = `id, email, username, password_hash, role, first_name, last_name, is_active, created_at`
```

- [ ] **Step 4: user.service create() — username dup check + insert**

In `apps/api/src/services/user.service.ts`, replace the `create` function with:

```ts
export async function create(input: CreateUserRequest): Promise<User> {
  const existingEmail = await query(`SELECT id FROM users WHERE email = $1`, [input.email])
  if (existingEmail.rows.length > 0) throw new HttpError(409, 'Email already in use')
  const existingUsername = await query(`SELECT id FROM users WHERE username = $1`, [input.username])
  if (existingUsername.rows.length > 0) throw new HttpError(409, 'Username already in use')
  const passwordHash = await bcrypt.hash(input.password, 12)
  const res = await query<UserRow>(
    `INSERT INTO users (email, username, password_hash, role, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [input.email, input.username, passwordHash, input.role, input.firstName, input.lastName],
  )
  const row = oneRow(res.rows)
  if (!row) throw new HttpError(500, 'Failed to create user')
  return toUser(row)
}
```

- [ ] **Step 5: user.service update() — add username to the map**

In `apps/api/src/services/user.service.ts` `update()`, add `['username', input.username]` as the second entry of the `map` array:

```ts
  const map: Array<[string, unknown]> = [
    ['email', input.email],
    ['username', input.username],
    ['role', input.role],
    ['first_name', input.firstName],
    ['last_name', input.lastName],
    ['is_active', input.isActive],
  ]
```

- [ ] **Step 6: Update doctor.service.ts — DoctorRow + SELECT + toDoctor**

In `apps/api/src/services/doctor.service.ts`:

In `DoctorRow`, add `username: string` after `email: string`. Change `SELECT` to project `u.username`:

```ts
const SELECT = `SELECT d.id, d.user_id, d.max_monthly_duties, d.created_at, d.updated_at,
  u.email, u.username, u.first_name, u.last_name, u.is_active
  FROM doctors d JOIN users u ON u.id = d.user_id`
```

In `toDoctor`, add `username: row.username` after `email: row.email`:

```ts
function toDoctor(row: DoctorRow): Doctor {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    isActive: row.is_active,
    maxMonthlyDuties: row.max_monthly_duties,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}
```

- [ ] **Step 7: doctor.service create() — username dup check + insert**

In `apps/api/src/services/doctor.service.ts`, replace the `create` function body (inside the transaction) with:

```ts
export async function create(input: CreateDoctorRequest): Promise<Doctor> {
  const userId = await withTransaction(async (client) => {
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
```

- [ ] **Step 8: doctor.service update() — add username to the map**

In `apps/api/src/services/doctor.service.ts` `update()`, add `['username', input.username]` after `['email', input.email]` in the `map` array:

```ts
    const map: Array<[string, unknown]> = [
      ['email', input.email],
      ['username', input.username],
      ['first_name', input.firstName],
      ['last_name', input.lastName],
      ['is_active', input.isActive],
    ]
```

- [ ] **Step 9: Update auth.service.test.ts**

In `apps/api/src/__tests__/auth.service.test.ts`:

Add `username: 'admin',` to the `userRow` helper (after `email: 'admin@oncall.local',`):

```ts
function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'admin@oncall.local',
    username: 'admin',
    password_hash: SEED_HASH,
    role: 'administrator',
    first_name: 'System',
    last_name: 'Administrator',
    is_active: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}
```

Replace the four login calls in the first four `it` blocks to use `{ identifier, password }`. The updated blocks:

```ts
  it('login returns tokens on valid credentials (by email)', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await login({ identifier: 'admin@oncall.local', password: 'changeme123' })
    expect(r.accessToken).toBe('ACCESS')
    expect(r.refreshToken).toBe('REFRESH')
    expect(r.user.email).toBe('admin@oncall.local')
    expect(r.user.username).toBe('admin')
    expect(bcrypt.compare).toHaveBeenCalledWith('changeme123', SEED_HASH)
  })

  it('login by username resolves via the username lookup', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await login({ identifier: 'admin', password: 'changeme123' })
    expect(r.accessToken).toBe('ACCESS')
    expect(r.user.username).toBe('admin')
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('WHERE username = $1')
    expect(query.mock.calls[0]?.[1]).toEqual(['admin'])
  })

  it('login throws 401 when user not found', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(login({ identifier: 'x@y.z', password: 'whatever' })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('login throws 401 on wrong password', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    compare.mockResolvedValue(false)
    await expect(login({ identifier: 'admin@oncall.local', password: 'bad' })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('login throws 403 when inactive', async () => {
    query.mockResolvedValue({ rows: [userRow({ is_active: false })] })
    await expect(
      login({ identifier: 'admin@oncall.local', password: 'changeme123' }),
    ).rejects.toMatchObject({ status: 403 })
  })
```

- [ ] **Step 10: Update auth.routes.test.ts**

In `apps/api/src/__tests__/auth.routes.test.ts`:

Add `username: 'admin',` to the `userRow` helper (after `email`). Update the login `send` payloads from `{ email, password }` to `{ identifier, password }`. The first success test becomes:

```ts
  it('returns 200, access token + Set-Cookie on success', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ identifier: 'admin@oncall.local', password: 'changeme123' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.user.email).toBe('admin@oncall.local')
    const setCookie = res.headers['set-cookie']?.[0] ?? ''
    expect(setCookie).toContain('refresh_token=')
    expect(setCookie.toLowerCase()).toContain('httponly')
  })
```

The invalid-body test: keep it asserting 400 by sending `{ identifier: '', password: '1' }`:

```ts
  it('returns 400 on invalid body', async () => {
    const res = await request(buildApp()).post('/auth/login').send({ identifier: '', password: '1' })
    expect(res.status).toBe(400)
  })
```

The wrong-password test: send `{ identifier: 'admin@oncall.local', password: 'wrongpass' }`:

```ts
  it('returns 401 on wrong password (real bcrypt compare)', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ identifier: 'admin@oncall.local', password: 'wrongpass' })
    expect(res.status).toBe(401)
  })
```

- [ ] **Step 11: Update user.service.test.ts**

In `apps/api/src/__tests__/user.service.test.ts`:

Add `username: 'dr1',` to the `row` helper (after `email: 'd@h.com',`). Update the create calls to include `username`:

```ts
  it('create rejects duplicate email with 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      create({
        email: 'd@h.com',
        username: 'dr1',
        password: 'secret1',
        role: 'doctor',
        firstName: 'J',
        lastName: 'R',
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('create rejects duplicate username with 409', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      create({
        email: 'd@h.com',
        username: 'dr1',
        password: 'secret1',
        role: 'doctor',
        firstName: 'J',
        lastName: 'R',
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('create hashes the password and inserts', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const u = await create({
      email: 'd@h.com',
      username: 'dr1',
      password: 'secret1',
      role: 'doctor',
      firstName: 'Jane',
      lastName: 'Roe',
    })
    expect(hash).toHaveBeenCalledWith('secret1', 12)
    expect(u.email).toBe('d@h.com')
    const insertSql = query.mock.calls[2]?.[0] as string
    expect(insertSql).toContain('INSERT INTO users')
  })
```

(The `update` and `remove` tests need `username: 'dr1'` only on the `row` helper, already added; their bodies are unchanged.)

- [ ] **Step 12: Update user.routes.test.ts**

In `apps/api/src/__tests__/user.routes.test.ts`:

Add `username: 'dr1',` to the `row` helper (after `email`). In the `POST /users` tests, add `username: 'newdr'` to the `send(...)` payloads. The success create:

```ts
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', role: 'doctor', firstName: 'Jane', lastName: 'Roe' })
```

The duplicate-email create (note: now needs two mock rows — first the email dup check):

```ts
  it('returns 409 on duplicate email', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'd@h.com', username: 'newdr', password: 'secret1', role: 'doctor', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(409)
  })
```

The success create needs the email-check mock to return empty, then the username-check empty, then the insert row. Update its mocks:

```ts
  it('returns 201 and creates a user', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row({ id: 5, email: 'new@h.com' })] })
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', role: 'doctor', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(201)
    expect(res.body.data.user.email).toBe('new@h.com')
  })
```

- [ ] **Step 13: Update doctor.service.test.ts**

In `apps/api/src/__tests__/doctor.service.test.ts`:

Add `username: 'dr1',` to the `doctorRow` helper (after `email: 'd@h.com',`).

Update the `create rejects duplicate email` call to include `username: 'dr1'`:

```ts
  it('create rejects duplicate email with 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      create({ email: 'd@h.com', username: 'dr1', password: 'secret1', firstName: 'J', lastName: 'R' }),
    ).rejects.toMatchObject({ status: 409 })
  })
```

The `create inserts user + doctor` test now has an extra query (username dup check). Update its mock sequence (5 steps instead of 4): email-check empty, username-check empty, insert returns id, insert doctor empty, then select returns doctor:

```ts
  it('create inserts user (role=doctor) + doctor in a transaction and returns the joined doctor', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [] }
      if (n === 2) return { rows: [] }
      if (n === 3) return { rows: [{ id: 10 }] }
      if (n === 4) return { rows: [] }
      return { rows: [doctorRow({ user_id: 10, max_monthly_duties: 5 })] }
    })
    const d = await create({
      email: 'd@h.com',
      username: 'dr1',
      password: 'secret1',
      firstName: 'Jane',
      lastName: 'Roe',
      maxMonthlyDuties: 5,
    })
    expect(d.userId).toBe(10)
    expect(d.maxMonthlyDuties).toBe(5)
    const insertUserSql = query.mock.calls[2]?.[0] as string
    expect(insertUserSql).toContain("'doctor'")
    expect((query.mock.calls[3]?.[1] as unknown[])).toEqual([10, 5])
    expect(hash).toHaveBeenCalledWith('secret1', 12)
  })
```

- [ ] **Step 14: Update doctor.routes.test.ts**

In `apps/api/src/__tests__/doctor.routes.test.ts`:

Add `username: 'dr1',` to the `row` helper (after `email: 'd@h.com',`).

The `admin creates a doctor (201)` test now has an extra username-check query. Update its mock sequence (email-check empty, username-check empty, insert id, insert doctor empty, then select) and add `username` to the payload:

```ts
  it('admin creates a doctor (201)', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [] }
      if (n === 2) return { rows: [] }
      if (n === 3) return { rows: [{ id: 12 }] }
      if (n === 4) return { rows: [] }
      return { rows: [row()] }
    })
    const res = await request(build())
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(201)
    expect(res.body.data.doctor).toBeDefined()
  })
```

The out-of-range maxMonthlyDuties test: add `username: 'newdr'` to the payload (validation fails before any query):

```ts
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 9 })
```

- [ ] **Step 15: Run backend typecheck + tests**

Run: `pnpm --filter @oncall/api typecheck && pnpm --filter @oncall/api test`
Expected: PASS with no errors.

- [ ] **Step 16: Commit**

```bash
git add apps/api
git commit -m "feat(api): identifier login (email or username) and username on user/doctor create"
```

---

### Task 4: Frontend service, store, login + management forms + tests

**Files:**
- Modify: `apps/web/src/services/auth.ts`
- Modify: `apps/web/src/stores/auth.ts`
- Modify: `apps/web/src/pages/LoginPage.vue`
- Modify: `apps/web/src/pages/UsersPage.vue`
- Modify: `apps/web/src/pages/DoctorsPage.vue`
- Modify: `apps/web/src/__tests__/auth.store.test.ts`
- Modify: `apps/web/src/__tests__/UsersPage.test.ts`
- Modify: `apps/web/src/__tests__/DoctorsPage.test.ts`

**Interfaces:**
- Consumes: `loginSchema = { identifier, password }`, `AuthUser.username`, username on create/update requests (from Task 2)
- Produces: combined login field; username inputs in both management dialogs; green monorepo

- [ ] **Step 1: auth service — identifier payload**

In `apps/web/src/services/auth.ts`, change the `login` function signature and body:

```ts
export async function login(identifier: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/login', { identifier, password })
  setAccessToken(data.accessToken)
  return data
}
```

- [ ] **Step 2: auth store — identifier pass-through**

In `apps/web/src/stores/auth.ts`, change the `login` action signature and the call to the service:

```ts
  async function login(identifier: string, password: string): Promise<void> {
    const data = await authService.login(identifier, password)
    user.value = data.user
    accessToken.value = data.accessToken
  }
```

- [ ] **Step 3: LoginPage — combined identifier field**

In `apps/web/src/pages/LoginPage.vue`:

Rename the `email` ref to `identifier` (line `const email = ref('')`):

```ts
const identifier = ref('')
const password = ref('')
```

Update the parse + call inside `onSubmit`:

```ts
async function onSubmit() {
  formError.value = ''
  const parsed = loginSchema.safeParse({ identifier: identifier.value, password: password.value })
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  submitting.value = true
  try {
    await auth.login(parsed.data.identifier, parsed.data.password)
    const redirect = (route.query.redirect as string) || '/'
    await router.push(redirect)
  } catch (e) {
    formError.value = e instanceof ApiError ? e.message : 'Login failed'
  } finally {
    submitting.value = false
  }
}
```

Update the template field (label + input id + binding + type):

```html
          <div class="flex flex-col gap-2">
            <Label for="identifier">Email or username</Label>
            <Input id="identifier" v-model="identifier" type="text" autocomplete="username" />
          </div>
```

- [ ] **Step 4: UsersPage — add username to state, payloads, dialog, table**

In `apps/web/src/pages/UsersPage.vue`:

Add `username: string` to the `EditState` interface (after `email: string`):

```ts
interface EditState {
  open: boolean
  id: number | null
  email: string
  username: string
  firstName: string
  lastName: string
  role: 'administrator' | 'doctor'
  isActive: boolean
}
```

Add `username: ''` to `emptyEdit()` (after `email: ''`):

```ts
const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  email: '',
  username: '',
  firstName: '',
  lastName: '',
  role: 'doctor',
  isActive: true,
})
```

In `openUpdate`, add `username: u.username` (after `email: u.email`):

```ts
function openUpdate(u: User) {
  edit.value = {
    open: true,
    id: u.id,
    email: u.email,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    isActive: u.isActive,
  }
}
```

In `save()`, add `username` to both payloads:

```ts
    const payload: CreateUserRequest = {
      email: edit.value.email,
      username: edit.value.username,
      password: edit.value.email,
      role: 'administrator',
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
    }
```

and

```ts
    const payload: UpdateUserRequest = {
      email: edit.value.email,
      username: edit.value.username,
      role: edit.value.role,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      isActive: edit.value.isActive,
    }
```

Add a Username input to the dialog (immediately after the Email `<div>` block):

```html
        <div class="flex flex-col gap-1">
          <Label for="e-username">Username</Label>
          <Input id="e-username" v-model="edit.username" autocomplete="username" />
        </div>
```

Add a Username column header (after the Email `<TableHead>`):

```html
          <TableHead>Username</TableHead>
```

and the matching cell (after the `{{ u.email }}` cell):

```html
          <TableCell>{{ u.username }}</TableCell>
```

- [ ] **Step 5: DoctorsPage — add username to state, payloads, dialog, table**

In `apps/web/src/pages/DoctorsPage.vue`:

Add `username: string` to the `EditState` interface (after `email: string`):

```ts
interface EditState {
  open: boolean
  id: number | null
  email: string
  username: string
  firstName: string
  lastName: string
  maxMonthlyDuties: string
}
```

Add `username: ''` to `emptyEdit()` (after `email: ''`):

```ts
const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  email: '',
  username: '',
  firstName: '',
  lastName: '',
  maxMonthlyDuties: '7',
})
```

In `openUpdate`, add `username: d.username` (after `email: d.email`):

```ts
function openUpdate(d: Doctor) {
  edit.value = {
    open: true,
    id: d.id,
    email: d.email,
    username: d.username,
    firstName: d.firstName,
    lastName: d.lastName,
    maxMonthlyDuties: String(d.maxMonthlyDuties),
  }
}
```

In `save()`, add `username` to both payloads:

```ts
    const payload: CreateDoctorRequest = {
      email: edit.value.email,
      username: edit.value.username,
      password: edit.value.email,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      maxMonthlyDuties: Number(edit.value.maxMonthlyDuties),
    }
```

and

```ts
    const payload: UpdateDoctorRequest = {
      email: edit.value.email,
      username: edit.value.username,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      maxMonthlyDuties: Number(edit.value.maxMonthlyDuties),
    }
```

Add a Username input to the dialog (immediately after the Email `<div>` block):

```html
        <div class="flex flex-col gap-1">
          <Label for="d-username">Username</Label>
          <Input id="d-username" v-model="edit.username" autocomplete="username" />
        </div>
```

Add a Username column header (after the Email `<TableHead>`):

```html
          <TableHead>Username</TableHead>
```

and the matching cell (after the `{{ d.email }}` cell):

```html
          <TableCell>{{ d.username }}</TableCell>
```

- [ ] **Step 6: Update auth.store.test.ts fixtures**

In `apps/web/src/__tests__/auth.store.test.ts`, add `username: 'admin',` to every mocked user object inside the `vi.mock('@/services/auth', ...)` factory (there are three: login, refresh, fetchMe, changePassword). Example for the `login` mock:

```ts
  login: vi.fn(async () => ({
    user: { id: 1, email: 'a@b.com', username: 'admin', role: 'administrator', firstName: 'A', lastName: 'B' },
    accessToken: 'AAA',
  })),
```

Apply the same `username: 'admin',` addition to the `refresh`, `fetchMe`, and `changePassword` mock returns. The `auth.login('a@b.com', 'secret1')` calls remain valid (identifier arg is positional).

- [ ] **Step 7: Update UsersPage.test.ts fixtures**

In `apps/web/src/__tests__/UsersPage.test.ts`, add `username: 'admin',` to the user object in the `list.mockResolvedValue([...])` call (after `email: 'a@b.com',`).

- [ ] **Step 8: Update DoctorsPage.test.ts fixtures**

In `apps/web/src/__tests__/DoctorsPage.test.ts`, add `username: 'dr1',` to the doctor object in the `list.mockResolvedValue([...])` call (after `email: 'dr@h.com',`).

- [ ] **Step 9: Run full monorepo verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: ALL PASS with no errors across shared, api, and web.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): combined email/username login field and username in management forms"
```

---

## Self-Review (completed during planning)

**Spec coverage:** DB schema/seed (Task 1) ✓; shared schemas/types auth+doctor (Task 2) ✓; auth/user/doctor services (Task 3) ✓; login identifier logic (Task 3) ✓; frontend service/store/LoginPage (Task 4) ✓; UsersPage/DoctorsPage forms (Task 4) ✓; all affected tests (Tasks 2–4) ✓. Doctor path (required by NOT NULL) explicitly covered — was the spec gap, now in Task 2/3/4.

**Placeholder scan:** No TBD/TODO; every code step shows exact code.

**Type consistency:** `identifier` used consistently in loginSchema/LoginRequest/service/store/LoginPage ✓. `username: string` on AuthUser/User/Doctor and on all create/update requests, mirrored in every service `Row`/columns/mapper ✓. Test fixtures updated to match ✓. Mock query sequences updated where an extra username-dup-check query was added (user.service create, doctor.service create, and their route tests) ✓.
