# Usage Metering & Superadmin Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect license abuse (roster swapping, alternating clinics, disjoint regeneration) via an append-only generation log and alert-only metering, audited through a new superadmin role backed by a signed license file.

**Architecture:** Each installation (one server per clinic) keeps an append-only `schedule_generation_log` written inside the schedule-generation transaction. A `usage` service computes two alert rules (rolling distinct-doctor allowance, disjoint regeneration) and exposes superadmin-only read/resolve endpoints. Entitlements (allowance, window, expiry) come from an Ed25519-signed license file validated at API boot; only the vendor can issue licenses. Doctor deletion becomes deactivation so history survives.

**Tech Stack:** Express + `pg` parameterized SQL, Zod (env + shared schemas), `jsonwebtoken` (EdDSA license verification), Vue 3 + Pinia, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-usage-metering-superadmin-design.md`

## Global Constraints

- Parameterized SQL only — never concatenate SQL.
- Schema changes are idempotent additions to `database/schema.sql`; no migration runner.
- Alerts NEVER block schedule generation (alert-only posture).
- Generation-log/alert failures inside the generation transaction fail the generation.
- Every file kebab-case; DB indexes named `idx_<table>_<cols>`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` must all pass before done.
- Format with Volar conventions; no Prettier config.
- Tests: Vitest, `__tests__/` folders mirroring source, `<name>.test.ts`.

---

### Task 1: Shared types — superadmin role + usage domain types

**Files:**
- Modify: `packages/shared/src/types/auth.ts:1`
- Create: `packages/shared/src/types/usage.ts`
- Modify: `packages/shared/src/types/index.ts` (add `export * from './usage'`)
- Modify: `packages/shared/src/schemas/auth.ts` (role schema, if it enumerates roles)

**Interfaces:**
- Produces: `Role = 'administrator' | 'doctor' | 'superadmin'`; `LicenseInfo`, `GenerationEvent`, `OperatorAlert`, `OperatorAlertType`, `UsageSummary` (used by Tasks 4–8).

- [ ] **Step 1: Extend the Role type**

In `packages/shared/src/types/auth.ts` change line 1 to:

```ts
export type Role = 'administrator' | 'doctor' | 'superadmin'
```

- [ ] **Step 2: Create `packages/shared/src/types/usage.ts`**

```ts
export interface LicenseInfo {
  licensee: string
  doctorAllowance: number
  rollingWindowDays: number
  expiresAt: string | null
}

export interface GenerationEvent {
  year: number
  month: number
  generatedAt: string
  doctorIds: number[]
  doctorNames: string[]
  /** Overlap with the previous generation of the same month; null when there is no previous one. */
  overlapPercent: number | null
}

export type OperatorAlertType = 'allowance_exceeded' | 'disjoint_regeneration'

export interface OperatorAlert {
  id: number
  type: OperatorAlertType
  detail: Record<string, unknown>
  createdAt: string
  resolvedAt: string | null
}

export interface UsageSummary {
  license: LicenseInfo
  rollingDistinctDoctors: number
  openAlerts: number
}
```

- [ ] **Step 3: Export and update the role schema**

In `packages/shared/src/types/index.ts` add `export * from './usage'`. In `packages/shared/src/schemas/auth.ts` line 3 change:

```ts
export const roleSchema = z.enum(['administrator', 'doctor', 'superadmin'])
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (typecheck may surface places that exhaustively switch on `Role` — fix each by extending, not narrowing).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add superadmin role and usage metering types"
```

---

### Task 2: Database — superadmin role, generation log, alerts, backfill, seed

**Files:**
- Modify: `database/schema.sql` (append a new phase section at the end)
- Modify: `database/seed.sql` (append superadmin seed)

**Interfaces:**
- Produces: tables `schedule_generation_log` (columns `id, doctor_id, year, month, created_at`) and `operator_alerts` (`id, type, detail JSONB, created_at, resolved_at`); `users.role` now accepts `'superadmin'`.

- [ ] **Step 1: Append to `database/schema.sql`**

```sql
-- Phase 10: Usage metering & superadmin audit

-- superadmin role (vendor auditor). Drop/re-add keeps the file idempotent.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('administrator', 'doctor', 'superadmin'));

-- Append-only: one row per doctor included in each generated schedule.
-- Never deleted by schedule deletion or doctor deactivation.
CREATE TABLE IF NOT EXISTS schedule_generation_log (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id  INTEGER NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_schedule_generation_log_doctor
  ON schedule_generation_log (doctor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_schedule_generation_log_period
  ON schedule_generation_log (year, month);

-- One-time backfill from existing duties (no-op once the log has rows).
INSERT INTO schedule_generation_log (doctor_id, year, month, created_at)
SELECT DISTINCT du.doctor_id, s.year, s.month, s.updated_at
FROM duties du JOIN schedules s ON s.id = du.schedule_id
WHERE NOT EXISTS (SELECT 1 FROM schedule_generation_log LIMIT 1);

-- Alert-only abuse flags, visible to the superadmin only.
CREATE TABLE IF NOT EXISTS operator_alerts (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('allowance_exceeded', 'disjoint_regeneration')),
  detail      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_operator_alerts_open
  ON operator_alerts (type, resolved_at);
```

- [ ] **Step 2: Append superadmin seed to `database/seed.sql`**

Use this exact hash (password `changeme123`, bcrypt cost 12):

```sql
-- Phase 10: seed superadmin (vendor audit account, password: changeme123)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
VALUES (
  'superadmin@oncall.local',
  'superadmin',
  '$2b$12$ib69wvBRW9XbWWJagExPNe9QrDklUGCvMBlMivRVOAY03LTNsOwSi',
  'superadmin',
  'Vendor',
  'Superadmin',
  TRUE
)
ON CONFLICT (email) DO NOTHING;
```

- [ ] **Step 3: Apply and verify**

Run: `pnpm db:setup` — expected success. Then verify idempotency by running `pnpm db:setup` a second time — expected success with no errors (the backfill must not duplicate rows).

- [ ] **Step 4: Commit**

```bash
git add database/schema.sql database/seed.sql
git commit -m "feat(db): generation log, operator alerts, superadmin role"
```

---

### Task 3: License file — loader, dev keypair, vendor issue script

**Files:**
- Modify: `apps/api/src/config/env.ts` (add `LICENSE_FILE`)
- Create: `apps/api/src/config/license-public-key.ts`
- Create: `apps/api/dev-license-private-key.pem` (dev-only signing key, safe to commit)
- Create: `apps/api/scripts/license.ts`
- Modify: `apps/api/.env.example` (document `LICENSE_FILE`), `.gitignore` (ignore `license.json` files)

**Interfaces:**
- Produces: `import { license } from './config/license'` → `license: { licensee: string; doctorAllowance: number; rollingWindowDays: number; expiresAt: string | null }` (used by Task 6).

- [ ] **Step 1: Add `LICENSE_FILE` to env schema**

In `apps/api/src/config/env.ts`, inside the zod schema add:

```ts
  LICENSE_FILE: z.string().default(''),
```

Append to `apps/api/.env.example`:

```
# Path to the signed license file (JWT). Required in production.
LICENSE_FILE=
```

- [ ] **Step 2: Create the dev public key constant**

`apps/api/src/config/license-public-key.ts` — this DEV keypair is committed on purpose: it can only issue licenses the dev build trusts. Production deployments regenerate keys via the script in Step 4.

(dev keypair removed from the repository 2026-08-30 — generate a local one with `pnpm --filter @oncall/api exec tsx scripts/license.ts keygen` if you need to sign local licenses)

Add to the repo-root `.gitignore`:

```
# Signed license files (issued per clinic, never commit)
license.json
*.license.json
```

- [ ] **Step 3: Create `apps/api/src/config/license.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs'
import jwt from 'jsonwebtoken'
import { env } from './env'
import { LICENSE_PUBLIC_KEY } from './license-public-key'

export interface License {
  licensee: string
  doctorAllowance: number
  rollingWindowDays: number
  expiresAt: string | null
}

interface LicenseClaims {
  licensee: string
  doctor_allowance: number
  rolling_window_days: number
}

const DEFAULT_ALLOWANCE = 25
const DEFAULT_WINDOW_DAYS = 90

function loadLicense(): License {
  const path = env.LICENSE_FILE
  if (!path || !existsSync(path)) {
    if (env.NODE_ENV === 'production') {
      console.error(`License file not found: ${path || 'LICENSE_FILE is unset'}`)
      process.exit(1)
    }
    return {
      licensee: 'development',
      doctorAllowance: DEFAULT_ALLOWANCE,
      rollingWindowDays: DEFAULT_WINDOW_DAYS,
      expiresAt: null,
    }
  }
  const token = readFileSync(path, 'utf8').trim()
  try {
    const claims = jwt.verify(token, LICENSE_PUBLIC_KEY, {
      algorithms: ['EdDSA'],
    }) as LicenseClaims & jwt.JwtPayload
    return {
      licensee: claims.licensee,
      doctorAllowance: claims.doctor_allowance,
      rollingWindowDays: claims.rolling_window_days,
      expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    }
  } catch (err) {
    console.error('Invalid or expired license:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

export const license = loadLicense()
```

- [ ] **Step 4: Create the vendor script `apps/api/scripts/license.ts`**

```ts
/**
 * Vendor-side license tooling (run from apps/api):
 *   pnpm --filter @oncall/api exec tsx scripts/license.ts keygen
 *   pnpm --filter @oncall/api exec tsx scripts/license.ts issue \
 *     --private-key ./license-private.pem --licensee "Clinic X" \
 *     --allowance 25 --window 90 --expires 2027-08-14 --out ./license.json
 *
 * keygen writes license-private.pem (KEEP SECRET) and license-public.pem
 * (bake into src/config/license-public-key.ts for production builds).
 */
import { writeFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function run(): void {
  const cmd = process.argv[2]
  if (cmd === 'keygen') {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    writeFileSync('license-private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }))
    writeFileSync('license-public.pem', publicKey.export({ type: 'spki', format: 'pem' }))
    console.log('Wrote license-private.pem (secret) and license-public.pem.')
    console.log('Replace src/config/license-public-key.ts with the public key for production builds.')
    return
  }
  if (cmd === 'issue') {
    const privateKeyPath = arg('private-key')
    const licensee = arg('licensee')
    const allowance = Number(arg('allowance') ?? 25)
    const window = Number(arg('window') ?? 90)
    const expires = arg('expires')
    const out = arg('out') ?? 'license.json'
    if (!privateKeyPath || !licensee || !expires) {
      console.error('issue requires --private-key, --licensee, --expires (YYYY-MM-DD)')
      process.exit(1)
    }
    const key = readFileSync(privateKeyPath, 'utf8')
    const token = jwt.sign(
      {
        licensee,
        doctor_allowance: allowance,
        rolling_window_days: window,
        exp: Math.floor(Date.parse(`${expires}T23:59:59Z`) / 1000),
      },
      key,
      { algorithm: 'EdDSA' },
    )
    writeFileSync(out, token)
    console.log(`License written to ${out}`)
    return
  }
  console.error('Usage: license.ts keygen | issue --private-key ... --licensee ... --allowance N --window N --expires YYYY-MM-DD [--out file]')
  process.exit(1)
}

run()
```

Add `readFileSync` to the node:fs import in the script: `import { readFileSync, writeFileSync } from 'node:fs'`.

- [ ] **Step 5: Smoke-test issue + verify**

```bash
pnpm --filter @oncall/api exec tsx scripts/license.ts issue --private-key ./dev-license-private-key.pem --licensee "Dev Clinic" --allowance 25 --window 90 --expires 2027-12-31 --out ./license.json
```

Expected: "License written to ./license.json". Delete `apps/api/license.json` afterwards (it is gitignored).

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint` — expected PASS.

```bash
git add apps/api .gitignore
git commit -m "feat(api): signed license file loader and vendor issue script"
```

---

### Task 4: API role plumbing — superadmin as superset of administrator

**Files:**
- Modify: `apps/api/src/middleware/authorize.ts`
- Modify: `apps/api/src/services/schedule.service.ts:345` (`list`) and `:379` (`getById`)
- Modify: `apps/api/src/services/user.service.ts:49` (`create`) and `:65` (`update`)
- Modify: `apps/api/src/controllers/user.controller.ts` (pass actor)

**Interfaces:**
- Consumes: `Role` from Task 1.
- Produces: `authorize('administrator')` routes accept superadmin; `user.service.create(input, actor)` / `update(id, input, actor)` signatures with `actor: Pick<AuthUser, 'id' | 'role'>`.

- [ ] **Step 1: Superset semantics in `authorize.ts`**

Replace the function body:

```ts
export function authorize(...roles: Role[]) {
  const allowed = new Set<Role>(roles)
  if (roles.includes('administrator')) allowed.add('superadmin')
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !allowed.has(req.user.role)) {
      throw new HttpError(403, 'Forbidden')
    }
    next()
  }
}
```

(`authorize('superadmin')` grants only superadmin — used by Task 7 for usage routes.)

- [ ] **Step 2: Admin checks in `schedule.service.ts`**

In `list()` change:

```ts
  if (actor && actor.role !== 'administrator') {
```

to:

```ts
  if (actor && actor.role !== 'administrator' && actor.role !== 'superadmin') {
```

In `getById()` change:

```ts
  const isAdmin = actor?.role === 'administrator'
```

to:

```ts
  const isAdmin = actor?.role === 'administrator' || actor?.role === 'superadmin'
```

- [ ] **Step 3: Superadmin account protection in `user.service.ts`**

Change signatures and add guards:

```ts
type Actor = Pick<AuthUser, 'id' | 'role'>
```

Import `AuthUser` from `@oncall/shared`. In `create`, add a second parameter and first check:

```ts
export async function create(input: CreateUserRequest, actor: Actor): Promise<User> {
  if (input.role === 'superadmin' && actor.role !== 'superadmin') {
    throw new HttpError(403, 'Only a superadmin can create superadmin accounts')
  }
  // ... existing body unchanged
```

In `update`, add actor and guards before the SET-building:

```ts
export async function update(id: number, input: UpdateUserRequest, actor: Actor): Promise<User> {
  const existing = await getById(id)
  if (actor.role !== 'superadmin') {
    if (existing.role === 'superadmin' || input.role === 'superadmin') {
      throw new HttpError(403, 'Only a superadmin can manage superadmin accounts')
    }
  }
  // ... existing body unchanged
```

- [ ] **Step 4: Pass the actor from `user.controller.ts`**

In `create` and `update` handlers change the service calls:

```ts
      const user = await userService.create(req.body, req.user!)
```

```ts
      const user = await userService.update(Number(req.params.id), req.body, req.user!)
```

(Route already runs `authenticate`, so `req.user` is present.)

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint` — expected PASS.

```bash
git add apps/api
git commit -m "feat(api): superadmin role superset of administrator with account protection"
```

---

### Task 5: Doctor deactivation instead of deletion

**Files:**
- Modify: `apps/api/src/services/doctor.service.ts:124` (`remove`)
- Modify: `apps/web/src/pages/DoctorsPage.vue:111-115` and the Delete button at `:154`

**Interfaces:**
- Consumes: none new.
- Produces: `DELETE /doctors/:id` now deactivates (204); reactivation stays `PATCH /doctors/:id { isActive: true }` (already works).

- [ ] **Step 1: Replace `remove` in `doctor.service.ts`**

```ts
export async function deactivate(id: number): Promise<void> {
  const existing = await query<{ user_id: number }>(
    'SELECT user_id FROM doctors WHERE id = $1',
    [id],
  )
  const row = existing.rows[0]
  if (!row) throw new HttpError(404, 'Doctor not found')
  await query('UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [
    row.user_id,
  ])
}
```

Delete the old `remove` function entirely (the duties-check and `DELETE FROM users` go away — that is the point). In `doctor.controller.ts` change the `remove` handler's body to call `doctorService.deactivate(Number(req.params.id))` and keep responding `204`.

- [ ] **Step 2: Update `DoctorsPage.vue` copy and flow**

Replace the `remove` function:

```ts
async function deactivate(d: Doctor) {
  if (!confirm(`Deactivate doctor ${d.email}? They keep their history and can be re-enabled later.`))
    return
  await doctorService.remove(d.id)
  await load()
}
```

Change the Delete button:

```html
              <Button size="sm" variant="destructive" @click="deactivate(d)">Deactivate</Button>
```

- [ ] **Step 3: Update tests**

In `apps/api/src/__tests__/doctor.service.test.ts` and `doctor.routes.test.ts`, update any test that exercises deletion to assert: response 204, then `doctorService.getById(id)` still resolves with `isActive === false`, and the doctor's duties (if any were seeded) still exist. Add a reactivation case: `update(id, { isActive: true })` restores `isActive === true`.

- [ ] **Step 4: Typecheck, lint, test, commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` — expected PASS.

```bash
git add apps/api apps/web
git commit -m "feat: doctor deletion becomes deactivation preserving history"
```

---

### Task 6: Generation log + alert-only metering at generation time

**Files:**
- Create: `apps/api/src/services/usage.service.ts` (recording + metering part)
- Modify: `apps/api/src/services/schedule.service.ts` (`generate`, inside the transaction)
- Create: `apps/api/src/__tests__/usage.service.test.ts`

**Interfaces:**
- Consumes: `license` from Task 3; tables from Task 2.
- Produces: `overlapPercent(prev: number[], next: number[]): number` (pure); `recordGeneration(client: PoolClient, year: number, month: number, doctorIds: number[]): Promise<void>`.

- [ ] **Step 1: Create `usage.service.ts` with metering**

```ts
import type { PoolClient } from 'pg'
import { license } from '../config/license'

/** Share of `next` doctors already present in `prev`, as a percentage of the larger set. */
export function overlapPercent(prev: number[], next: number[]): number {
  if (prev.length === 0 || next.length === 0) return 100
  const p = new Set(prev)
  const shared = next.filter((id) => p.has(id)).length
  return (shared / Math.max(prev.length, next.length)) * 100
}

export const DISJOINT_OVERLAP_THRESHOLD = 50
export const DISJOINT_MIN_SET_SIZE = 4

/**
 * Append-only record of one schedule generation plus alert-only metering.
 * Must run INSIDE the schedule-creation transaction: a failed log write fails
 * the generation. Never throws for alert conditions — alerts do not block.
 */
export async function recordGeneration(
  client: PoolClient,
  year: number,
  month: number,
  doctorIds: number[],
): Promise<void> {
  for (const doctorId of doctorIds) {
    await client.query(
      'INSERT INTO schedule_generation_log (doctor_id, year, month) VALUES ($1, $2, $3)',
      [doctorId, year, month],
    )
  }

  // Rule 1: rolling allowance over distinct doctors within the window.
  const rolling = await client.query<{ n: number }>(
    `SELECT COUNT(DISTINCT doctor_id)::int AS n FROM schedule_generation_log
     WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [license.rollingWindowDays],
  )
  const distinct = rolling.rows[0]?.n ?? 0
  if (distinct > license.doctorAllowance) {
    await client.query(
      `INSERT INTO operator_alerts (type, detail)
       SELECT 'allowance_exceeded',
              jsonb_build_object('distinctDoctors', $1, 'allowance', $2, 'windowDays', $3)
       WHERE NOT EXISTS (
         SELECT 1 FROM operator_alerts
         WHERE type = 'allowance_exceeded' AND resolved_at IS NULL
       )`,
      [distinct, license.doctorAllowance, license.rollingWindowDays],
    )
  }

  // Rule 2: disjoint regeneration vs the most recent prior generation of this month.
  // Rows written by this transaction share NOW(), so `created_at < NOW()` cleanly
  // selects only prior generations.
  const prevBatch = await client.query<{ created_at: Date }>(
    `SELECT MAX(created_at) AS created_at FROM schedule_generation_log
     WHERE year = $1 AND month = $2 AND created_at < NOW()`,
    [year, month],
  )
  const prevTime = prevBatch.rows[0]?.created_at
  if (prevTime) {
    const prevDocs = await client.query<{ doctor_id: number }>(
      `SELECT DISTINCT doctor_id FROM schedule_generation_log
       WHERE year = $1 AND month = $2 AND created_at = $3`,
      [year, month, prevTime],
    )
    const prevIds = prevDocs.rows.map((r) => r.doctor_id)
    const overlap = overlapPercent(prevIds, doctorIds)
    if (
      prevIds.length >= DISJOINT_MIN_SET_SIZE &&
      doctorIds.length >= DISJOINT_MIN_SET_SIZE &&
      overlap < DISJOINT_OVERLAP_THRESHOLD
    ) {
      const names = await client.query<{ id: number; name: string }>(
        `SELECT DISTINCT d.id, u.first_name || ' ' || u.last_name AS name
         FROM doctors d JOIN users u ON u.id = d.user_id
         WHERE d.id = ANY($1) OR d.id = ANY($2)`,
        [prevIds, doctorIds],
      )
      const nameOf = new Map(names.rows.map((r) => [r.id, r.name]))
      await client.query(
        `INSERT INTO operator_alerts (type, detail)
         SELECT 'disjoint_regeneration', jsonb_build_object(
           'year', $1, 'month', $2,
           'previousGeneratedAt', $3, 'previousDoctors', $4::jsonb,
           'currentDoctors', $5::jsonb, 'overlapPercent', $6
         )
         WHERE NOT EXISTS (
           SELECT 1 FROM operator_alerts
           WHERE type = 'disjoint_regeneration' AND resolved_at IS NULL
             AND detail->>'year' = $1 AND detail->>'month' = $2
         )`,
        [
          year,
          month,
          prevTime.toISOString(),
          JSON.stringify(prevIds.map((id) => ({ id, name: nameOf.get(id) ?? String(id) }))),
          JSON.stringify(doctorIds.map((id) => ({ id, name: nameOf.get(id) ?? String(id) }))),
          Math.round(overlap),
        ],
      )
    }
  }
}
```

- [ ] **Step 2: Call it from `schedule.service.ts` `generate()`**

Add the import at the top:

```ts
import { recordGeneration } from './usage.service'
```

Inside `generate`, in the `withTransaction` block after the duty-insert loop and before `return id`:

```ts
    const doctorIds = [...new Set(planDuties.map((d) => d.doctorId))]
    await recordGeneration(client, year, month, doctorIds)
```

- [ ] **Step 3: Tests in `apps/api/src/__tests__/usage.service.test.ts`**

Pure tests (no DB) for `overlapPercent`: identical sets → 100; empty → 100; 10-vs-10 with 2 shared → 20; subset → share/max formula.

DB tests (tests use the real `DATABASE_URL`, following `schedule.service.test.ts` conventions): seed two doctor groups, call `recordGeneration` within `withTransaction` twice for the same `(year, month)` with <50% overlap and both sets ≥4 → a `disjoint_regeneration` alert exists; repeat a third time → still exactly one unresolved alert for that month (dedup); regenerate with the same roster → no new alert. Then insert log rows for more than `license.doctorAllowance` distinct doctors within the window and generate once more → exactly one unresolved `allowance_exceeded` alert. Clean up inserted rows in `afterAll`/`afterEach` (delete from `operator_alerts` and `schedule_generation_log` by the test's doctor ids).

- [ ] **Step 4: Typecheck, lint, test, commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` — expected PASS.

```bash
git add apps/api
git commit -m "feat(api): append-only generation log with alert-only abuse metering"
```

---

### Task 7: Superadmin usage API

**Files:**
- Modify: `apps/api/src/services/usage.service.ts` (append read functions)
- Create: `apps/api/src/controllers/usage.controller.ts`
- Create: `apps/api/src/routes/usage.routes.ts`
- Modify: `apps/api/src/app.ts` (mount router)
- Create: `apps/api/src/__tests__/usage.routes.test.ts`

**Interfaces:**
- Consumes: shared types from Task 1; `authorize` from Task 4.
- Produces: `GET /usage/summary` → `{ summary: UsageSummary }`; `GET /usage/generations` → `{ generations: GenerationEvent[] }`; `GET /usage/alerts` → `{ alerts: OperatorAlert[] }` (unresolved first, newest first); `PATCH /usage/alerts/:id/resolve` → `{ alert: OperatorAlert }`. All superadmin-only.

- [ ] **Step 1: Read functions in `usage.service.ts`**

```ts
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'
import type { GenerationEvent, OperatorAlert, UsageSummary } from '@oncall/shared'

interface AlertRow {
  id: number
  type: 'allowance_exceeded' | 'disjoint_regeneration'
  detail: Record<string, unknown>
  created_at: Date
  resolved_at: Date | null
}

function toAlert(row: AlertRow): OperatorAlert {
  return {
    id: row.id,
    type: row.type,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  }
}

export async function summary(): Promise<UsageSummary> {
  const res = await query<{ n: number }>(
    `SELECT COUNT(DISTINCT doctor_id)::int AS n FROM schedule_generation_log
     WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [license.rollingWindowDays],
  )
  const open = await query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM operator_alerts WHERE resolved_at IS NULL',
  )
  return {
    license: {
      licensee: license.licensee,
      doctorAllowance: license.doctorAllowance,
      rollingWindowDays: license.rollingWindowDays,
      expiresAt: license.expiresAt,
    },
    rollingDistinctDoctors: res.rows[0]?.n ?? 0,
    openAlerts: open.rows[0]?.n ?? 0,
  }
}

export async function generations(): Promise<GenerationEvent[]> {
  const batches = await query<{ year: number; month: number; created_at: Date }>(
    `SELECT year, month, created_at FROM schedule_generation_log
     GROUP BY year, month, created_at ORDER BY created_at DESC`,
  )
  const events: GenerationEvent[] = []
  for (const b of batches.rows) {
    const docs = await query<{ doctor_id: number; name: string }>(
      `SELECT DISTINCT l.doctor_id, u.first_name || ' ' || u.last_name AS name
       FROM schedule_generation_log l
       JOIN doctors d ON d.id = l.doctor_id JOIN users u ON u.id = d.user_id
       WHERE l.year = $1 AND l.month = $2 AND l.created_at = $3`,
      [b.year, b.month, b.created_at],
    )
    const ids = docs.rows.map((r) => r.doctor_id)
    const prev = batches.rows.find(
      (o) =>
        o.year === b.year &&
        o.month === b.month &&
        o.created_at.getTime() < b.created_at.getTime(),
    )
    let overlap: number | null = null
    if (prev) {
      const prevDocs = await query<{ doctor_id: number }>(
        `SELECT DISTINCT doctor_id FROM schedule_generation_log
         WHERE year = $1 AND month = $2 AND created_at = $3`,
        [prev.year, prev.month, prev.created_at],
      )
      overlap = Math.round(
        overlapPercent(
          prevDocs.rows.map((r) => r.doctor_id),
          ids,
        ),
      )
    }
    events.push({
      year: b.year,
      month: b.month,
      generatedAt: b.created_at.toISOString(),
      doctorIds: ids,
      doctorNames: docs.rows.map((r) => r.name),
      overlapPercent: overlap,
    })
  }
  return events
}

export async function listAlerts(): Promise<OperatorAlert[]> {
  const res = await query<AlertRow>(
    `SELECT id, type, detail, created_at, resolved_at FROM operator_alerts
     ORDER BY resolved_at IS NOT NULL, created_at DESC`,
  )
  return res.rows.map(toAlert)
}

export async function resolveAlert(id: number): Promise<OperatorAlert> {
  const res = await query<AlertRow>(
    `UPDATE operator_alerts SET resolved_at = NOW()
     WHERE id = $1 AND resolved_at IS NULL
     RETURNING id, type, detail, created_at, resolved_at`,
    [id],
  )
  const row = res.rows[0]
  if (!row) {
    const found = await query('SELECT 1 FROM operator_alerts WHERE id = $1', [id])
    if (found.rows.length === 0) throw new HttpError(404, 'Alert not found')
    throw new HttpError(409, 'Alert already resolved')
  }
  return toAlert(row)
}
```

- [ ] **Step 2: Controller `usage.controller.ts`**

Follow the exact pattern of `doctor.controller.ts` (try/catch, `next(err)`, `ok()` envelope):

```ts
import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import * as usageService from '../services/usage.service'

export const usageController = {
  async summary(_req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await usageService.summary()
      res.status(200).json(ok({ summary }))
    } catch (err) {
      next(err)
    }
  },
  async generations(_req: Request, res: Response, next: NextFunction) {
    try {
      const generations = await usageService.generations()
      res.status(200).json(ok({ generations }))
    } catch (err) {
      next(err)
    }
  },
  async alerts(_req: Request, res: Response, next: NextFunction) {
    try {
      const alerts = await usageService.listAlerts()
      res.status(200).json(ok({ alerts }))
    } catch (err) {
      next(err)
    }
  },
  async resolveAlert(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid alert id')
      const alert = await usageService.resolveAlert(id)
      res.status(200).json(ok({ alert }))
    } catch (err) {
      next(err)
    }
  },
}
```

- [ ] **Step 3: Routes `usage.routes.ts` and mount**

```ts
import { Router } from 'express'
import { usageController } from '../controllers/usage.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'

export const usageRouter = Router()

usageRouter.use(authenticate)
usageRouter.get('/summary', authorize('superadmin'), usageController.summary)
usageRouter.get('/generations', authorize('superadmin'), usageController.generations)
usageRouter.get('/alerts', authorize('superadmin'), usageController.alerts)
usageRouter.patch('/alerts/:id/resolve', authorize('superadmin'), usageController.resolveAlert)
```

In `app.ts` add `import { usageRouter } from './routes/usage.routes'` and `app.use('/usage', usageRouter)` after the reports router.

- [ ] **Step 4: Route tests `usage.routes.test.ts`**

Following `doctor.routes.test.ts` conventions (supertest, seeded users): administrator token on `GET /usage/summary` → 403; doctor token → 403; superadmin token (seeded in Task 2, password `changeme123`) → 200 with `summary.license.doctorAllowance` present; `PATCH /usage/alerts/999999/resolve` → 404.

- [ ] **Step 5: Typecheck, lint, test, commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` — expected PASS.

```bash
git add apps/api
git commit -m "feat(api): superadmin usage and alerts endpoints"
```

---

### Task 8: Web — superadmin usage page and navigation

**Files:**
- Modify: `apps/web/src/stores/auth.ts:12`
- Modify: `apps/web/src/components/layout/AppHeader.vue:17-35` (nav)
- Modify: `apps/web/src/router/index.ts` (route)
- Create: `apps/web/src/services/usage.ts`
- Create: `apps/web/src/pages/UsagePage.vue`
- Create: `apps/web/src/__tests__/UsagePage.test.ts`

**Interfaces:**
- Consumes: API from Task 7; shared types from Task 1; UI primitives `Card.vue`, `Button.vue`, `Table*.vue` (existing).

- [ ] **Step 1: Auth store**

In `stores/auth.ts` change and add:

```ts
  const isAdmin = computed(
    () => user.value?.role === 'administrator' || user.value?.role === 'superadmin',
  )
  const isSuperadmin = computed(() => user.value?.role === 'superadmin')
```

Export `isSuperadmin` in the store's return object.

- [ ] **Step 2: Nav link in `AppHeader.vue`**

In `navItems`, after the `if (auth.isAdmin)` block add:

```ts
  if (auth.isSuperadmin) {
    items.push({ to: '/usage', label: 'Usage' })
  }
```

- [ ] **Step 3: Route in `router/index.ts`**

Inside the DefaultLayout children, after the `reports` route:

```ts
      {
        path: 'usage',
        name: 'usage',
        component: () => import('../pages/UsagePage.vue'),
        meta: { roles: ['superadmin'] },
      },
```

- [ ] **Step 4: Service `services/usage.ts`**

```ts
import type { GenerationEvent, OperatorAlert, UsageSummary } from '@oncall/shared'
import { apiGet, apiPatch } from '@/lib/http'

export async function summary(): Promise<UsageSummary> {
  const { summary } = await apiGet<{ summary: UsageSummary }>('/usage/summary')
  return summary
}
export async function generations(): Promise<GenerationEvent[]> {
  const { generations } = await apiGet<{ generations: GenerationEvent[] }>('/usage/generations')
  return generations
}
export async function alerts(): Promise<OperatorAlert[]> {
  const { alerts } = await apiGet<{ alerts: OperatorAlert[] }>('/usage/alerts')
  return alerts
}
export async function resolveAlert(id: number): Promise<OperatorAlert> {
  const { alert } = await apiPatch<{ alert: OperatorAlert }>(`/usage/alerts/${id}/resolve`)
  return alert
}
```

- [ ] **Step 5: `UsagePage.vue`**

Three sections, styled like `DoctorsPage.vue` (tables) and `AdminDashboard.vue` (cards):

1. **License card** (`Card`, `CardHeader`, `CardTitle`, `CardContent`): licensee, expiry (`expiresAt ?? 'no expiry (dev)'`), `rollingDistinctDoctors / license.doctorAllowance` with a destructive-colored count when over, window days, open alerts count.
2. **Generation history table**: columns Generated at (`new Date(e.generatedAt).toLocaleString()`), Month (`${e.year}-${String(e.month).padStart(2, '0')}`), Doctors (`e.doctorNames.join(', ')`), Overlap (`e.overlapPercent === null ? '—' : e.overlapPercent + '%'`).
3. **Alerts table**: columns Created, Type, Detail (`JSON.stringify(a.detail)`), State (`a.resolvedAt ? 'resolved' : 'open'`), Action — a `Resolve` button (size sm, outline, disabled when resolved) calling `resolveAlert(a.id)` then reloading.

Script setup loads all three service calls in `onMounted` with a shared `loading`/`errorMsg` pattern identical to `DoctorsPage.vue`.

- [ ] **Step 6: Test `UsagePage.test.ts`**

Following `DoctorsPage.test.ts` conventions (jsdom, `@vue/test-utils`, mocked services): mock `@/services/usage` to return fixture summary/generations/alerts; assert license numbers render, an alert with `resolvedAt: null` shows a Resolve button and clicking it calls `resolveAlert`; a resolved alert shows no enabled Resolve button.

- [ ] **Step 7: Typecheck, lint, test, commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` — expected PASS.

```bash
git add apps/web
git commit -m "feat(web): superadmin usage page with license, generations, and alerts"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 2: End-to-end sanity**

Run `pnpm db:setup` then `pnpm dev`. Log in as the seeded superadmin (`superadmin@oncall.local` / `changeme123`), open Usage, verify the license card shows allowance 25 / window 90 (dev defaults). Generate a schedule as admin, reload Usage — one generation event appears. Delete the schedule, swap the active doctor set (deactivate half, activate others), regenerate the same month — Usage shows the second event with low overlap and an open `disjoint_regeneration` alert; resolve it from the page.

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: usage metering final verification fixes"
```
