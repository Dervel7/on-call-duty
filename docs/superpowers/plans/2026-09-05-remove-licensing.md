# Remove Licensing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the license subsystem entirely while keeping superadmin usage statistics (generation history, `disjoint_regeneration` alerts, alert resolution), per `docs/superpowers/specs/2026-09-05-remove-licensing-design.md`.

**Architecture:** A pure removal across four layers (web → shared+API → database schema → deploy config), ordered so every commit typechecks: the web layer stops consuming `UsageSummary` first, then the shared types and API implementation are removed together, then the DB CHECK constraint evolves idempotently, then deploy/config files are cleaned.

**Tech Stack:** Vue 3 + Vite + Pinia, Express + TypeScript, `pg` parameterized SQL, Vitest, single idempotent `database/schema.sql` (no migration runner).

## Global Constraints

- Branch: `remove-licensing` (already checked out). Never commit on `main`.
- Every commit message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Parameterized SQL only — never concatenate SQL strings.
- `database/schema.sql` stays idempotent: `CREATE TABLE IF NOT EXISTS` + drop/re-add constraint swaps (pattern at `database/schema.sql:116-118`).
- No Prettier, no linting-rule changes, no version bumps of GitHub Actions.
- API envelope shapes unchanged: `ok({ ... })` wrappers stay as they are.
- Working-tree note: stale local build artifacts `apps/api/.nitro/` and `apps/api/.output/` break `pnpm lint` on the dev machine — they are git-ignored and must be deleted before any lint gate (Task 5 Step 1).
- Test gate: `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass at the end. `apps/api/src/__tests__/usage.service.test.ts` requires a live Postgres at `DATABASE_URL`; without one that file fails with `ECONNREFUSED` (pre-existing, out of scope).

---

### Task 1: Web — drop license card and summary from the usage page

**Files:**
- Modify: `apps/web/src/__tests__/UsagePage.test.ts` (full rewrite of fixtures/mocks, below)
- Modify: `apps/web/src/services/usage.ts` (remove `summary()`)
- Modify: `apps/web/src/pages/UsagePage.vue` (remove License card, derive open-alert count)

**Interfaces:**
- Consumes: `@oncall/shared` types `GenerationEvent`, `OperatorAlert` (unchanged in this task; `UsageSummary` still exists in shared and is simply no longer imported by web).
- Produces: `services/usage.ts` exports exactly `generations()`, `alerts()`, `resolveAlert(id)`. Web no longer references `UsageSummary` anywhere — Task 2 relies on this when it deletes the shared type.

- [ ] **Step 1: Rewrite the page test to the post-removal surface**

Replace the entire content of `apps/web/src/__tests__/UsagePage.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { GenerationEvent, OperatorAlert } from '@oncall/shared'

const generations = vi.fn()
const alerts = vi.fn()
const resolveAlert = vi.fn()
vi.mock('@/services/usage', () => ({
  generations: (...a: unknown[]) => generations(...a),
  alerts: (...a: unknown[]) => alerts(...a),
  resolveAlert: (...a: unknown[]) => resolveAlert(...a),
}))

import UsagePage from '../pages/UsagePage.vue'

const generationsFixture: GenerationEvent[] = [
  {
    year: 2026,
    month: 8,
    generatedAt: '2026-08-01T07:00:00.000Z',
    doctorIds: [1, 2],
    doctorNames: ['Jane Roe', 'John Doe'],
    overlapPercent: 50,
  },
]

const alertsFixture: OperatorAlert[] = [
  {
    id: 1,
    type: 'disjoint_regeneration',
    detail: { overlapPercent: 40 },
    createdAt: '2026-08-02T07:00:00.000Z',
    resolvedAt: '2026-08-03T07:00:00.000Z',
  },
  {
    id: 2,
    type: 'disjoint_regeneration',
    detail: { overlapPercent: 0 },
    createdAt: '2026-08-04T07:00:00.000Z',
    resolvedAt: null,
  },
]

function mockResolved() {
  generations.mockResolvedValue(generationsFixture)
  alerts.mockResolvedValue(alertsFixture)
}

beforeEach(() => {
  setActivePinia(createPinia())
  generations.mockReset()
  alerts.mockReset()
  resolveAlert.mockReset()
})
afterEach(() => vi.restoreAllMocks())

async function mountPage() {
  mockResolved()
  const wrapper = mount(UsagePage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  return wrapper
}

describe('UsagePage', () => {
  it('renders the locally computed open-alert count, generations, and alerts on mount', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Open alerts: 1')
    expect(wrapper.text()).toContain('2026-08')
    expect(wrapper.text()).toContain('Jane Roe, John Doe')
    expect(wrapper.text()).toContain('50%')
    expect(wrapper.text()).toContain('disjoint_regeneration')
    expect(wrapper.text()).not.toContain('License')
  })

  it('shows an enabled Resolve button for open alerts and calls resolveAlert on click', async () => {
    resolveAlert.mockResolvedValue(alertsFixture[1])
    const wrapper = await mountPage()
    const buttons = wrapper.findAll('button').filter((b) => b.text() === 'Resolve')
    const openBtn = buttons.find((b) => !(b.element as HTMLButtonElement).disabled)
    const resolvedBtn = buttons.find((b) => (b.element as HTMLButtonElement).disabled)
    expect(buttons).toHaveLength(2)
    expect(openBtn).toBeDefined()
    expect(resolvedBtn).toBeDefined()
    await openBtn!.trigger('click')
    await flushPromises()
    expect(resolveAlert).toHaveBeenCalledWith(2)
  })

  it('shows a page-level error and does not reload when resolveAlert fails', async () => {
    resolveAlert.mockRejectedValue(new Error('resolve failed'))
    const wrapper = await mountPage()
    const openBtn = wrapper
      .findAll('button')
      .filter((b) => b.text() === 'Resolve')
      .find((b) => !(b.element as HTMLButtonElement).disabled)
    await openBtn!.trigger('click')
    await flushPromises()
    expect(resolveAlert).toHaveBeenCalledWith(2)
    expect(wrapper.find('[role="alert"]').text()).toContain('resolve failed')
    expect(generations).toHaveBeenCalledTimes(1)
  })

  it('shows an error message when loading fails', async () => {
    generations.mockRejectedValue(new Error('nope'))
    alerts.mockResolvedValue([])
    const wrapper = mount(UsagePage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/web test -- --run src/__tests__/UsagePage.test.ts`
Expected: FAIL — the current page renders the License card (assertion `not.toContain('License')` fails) and calls a `summary` service the new mock no longer exports (`summary is not a function`).

- [ ] **Step 3: Remove `summary()` from the web service**

Replace the entire content of `apps/web/src/services/usage.ts` with:

```ts
import type { GenerationEvent, OperatorAlert } from '@oncall/shared'
import { apiGet, apiPatch } from '@/lib/http'

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

- [ ] **Step 4: Update `UsagePage.vue`**

In `apps/web/src/pages/UsagePage.vue`:

4a. Replace the script header (lines 1–21 region) so it reads:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { GenerationEvent, OperatorAlert } from '@oncall/shared'
import * as usageService from '@/services/usage'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const generations = ref<GenerationEvent[]>([])
const alerts = ref<OperatorAlert[]>([])
const loading = ref(false)
const errorMsg = ref('')

const openAlerts = computed(() => alerts.value.filter((a) => a.resolvedAt === null).length)
```

4b. In `load()`, drop the `summary` leg — the `Promise.all` becomes:

```ts
    const [g, a] = await Promise.all([
      usageService.generations(),
      usageService.alerts(),
    ])
    generations.value = g
    alerts.value = a
```

(Delete the `const summary = ref<UsageSummary | null>(null)` line, the `summary.value = s` assignment, and the `usageService.summary()` call.)

4c. In the template, replace the whole `<Card v-if="summary">…</Card>` block (the License card, lines 70–104) with:

```vue
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <p class="text-sm text-muted-foreground">
          Open alerts:
          <span class="text-foreground">{{ openAlerts }}</span>
        </p>
      </CardContent>
    </Card>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @oncall/web test -- --run src/__tests__/UsagePage.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Typecheck the web package**

Run: `pnpm --filter @oncall/web typecheck`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/__tests__/UsagePage.test.ts apps/web/src/services/usage.ts apps/web/src/pages/UsagePage.vue
git commit -m "refactor(web): drop license card and summary call from usage page

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Shared + API — remove license config, allowance rule, and summary endpoint

**Files:**
- Modify: `packages/shared/src/types/usage.ts`
- Modify: `apps/api/src/__tests__/usage.routes.test.ts` (full rewrite, below)
- Modify: `apps/api/src/__tests__/usage.service.test.ts` (edits, below)
- Modify: `apps/api/src/services/usage.service.ts`
- Modify: `apps/api/src/controllers/usage.controller.ts`
- Modify: `apps/api/src/routes/usage.routes.ts`
- Modify: `apps/api/src/config/env.ts`
- Delete: `apps/api/src/config/license.ts`
- Delete: `apps/api/src/config/license-public-key.ts`
- Delete: `apps/api/src/config/__tests__/license.test.ts`
- Delete: `apps/api/scripts/license.ts`

**Interfaces:**
- Consumes: Task 1's guarantee that web no longer imports `UsageSummary` (deleting the shared type cannot break the web build).
- Produces: `packages/shared` exports `GenerationEvent`, `OperatorAlert`, `OperatorAlertType` (now `'disjoint_regeneration'` only) — no `UsageSummary`, no `LicenseInfo`. API service exports `overlapPercent`, `DISJOINT_OVERLAP_THRESHOLD`, `DISJOINT_MIN_SET_SIZE`, `recordGeneration`, `generations`, `listAlerts`, `resolveAlert` — no `summary`. Routes: `GET /usage/generations`, `GET /usage/alerts`, `PATCH /usage/alerts/:id/resolve` (all `authenticate` + `authorize('superadmin')`); `GET /usage/summary` returns 404.

- [ ] **Step 1: Rewrite the routes test to the post-removal surface**

Replace the entire content of `apps/api/src/__tests__/usage.routes.test.ts` with:

```ts
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
}))

import { errorHandler } from '../middleware/error-handler'
import { signAccessToken } from '../lib/jwt'
import { usageRouter } from '../routes/usage.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/usage', usageRouter)
  app.use(errorHandler)
  return app
}

const superadminToken = () => signAccessToken({ sub: 1, role: 'superadmin' })
const adminToken = () => signAccessToken({ sub: 2, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

beforeEach(() => query.mockReset())

describe('usage routes', () => {
  it('unauthenticated is 401', async () => {
    const res = await request(build()).get('/usage/generations')
    expect(res.status).toBe(401)
  })

  it('administrator is forbidden from usage (403)', async () => {
    const res = await request(build())
      .get('/usage/generations')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(403)
  })

  it('doctor is forbidden from usage (403)', async () => {
    const res = await request(build())
      .get('/usage/alerts')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('superadmin reads generation history (200)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .get('/usage/generations')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.generations).toEqual([])
  })

  it('superadmin resolving a missing alert is 404', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .patch('/usage/alerts/999999/resolve')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(404)
  })

  it('usage summary no longer exists (404)', async () => {
    const res = await request(build())
      .get('/usage/summary')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the routes test to verify the summary test fails**

Run: `pnpm --filter @oncall/api test -- --run src/__tests__/usage.routes.test.ts`
Expected: FAIL — `usage summary no longer exists (404)` gets 200 while the endpoint still exists; all other tests pass.

- [ ] **Step 3: Trim the shared usage types**

Replace the entire content of `packages/shared/src/types/usage.ts` with:

```ts
export interface GenerationEvent {
  year: number
  month: number
  generatedAt: string
  doctorIds: number[]
  doctorNames: string[]
  /** Overlap with the previous generation of the same month; null when there is no previous one. */
  overlapPercent: number | null
}

export type OperatorAlertType = 'disjoint_regeneration'

export interface OperatorAlert {
  id: number
  type: OperatorAlertType
  detail: Record<string, unknown>
  createdAt: string
  resolvedAt: string | null
}
```

(`packages/shared/src/types/index.ts:54` re-exports `./usage` with `export *` — no change needed there.)

- [ ] **Step 4: Update `usage.service.ts`**

4a. Delete line 3 (`import { license } from '../config/license'`) and drop `UsageSummary` from the type import on line 2:

```ts
import type { PoolClient } from 'pg'
import type { GenerationEvent, OperatorAlert } from '@oncall/shared'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'
```

4b. In `recordGeneration`, delete the entire "Rule 1" block — the rolling-window query and the `allowance_exceeded` insert (current lines 36–54). The function keeps the per-doctor `INSERT INTO schedule_generation_log` loop, then continues directly with the existing `// Rule 2: disjoint regeneration…` block, unchanged.

4c. Delete the whole `summary()` function (current lines 132–151).

4d. Narrow the local row type (currently line 116):

```ts
interface AlertRow {
  id: number
  type: 'disjoint_regeneration'
  detail: Record<string, unknown>
  created_at: Date
  resolved_at: Date | null
}
```

- [ ] **Step 5: Remove the summary handler and route**

5a. In `apps/api/src/controllers/usage.controller.ts`, delete the `summary` handler (current lines 6–13). The object starts directly with `generations`.

5b. In `apps/api/src/routes/usage.routes.ts`, delete the line:

```ts
usageRouter.get('/summary', authorize('superadmin'), usageController.summary)
```

- [ ] **Step 6: Remove `LICENSE_FILE` from env validation**

In `apps/api/src/config/env.ts`, delete the line:

```ts
    LICENSE_FILE: z.string().default(''),
```

- [ ] **Step 7: Delete the license files**

```bash
git rm apps/api/src/config/license.ts apps/api/src/config/license-public-key.ts apps/api/src/config/__tests__/license.test.ts apps/api/scripts/license.ts
```

- [ ] **Step 8: Update the live-DB service test**

In `apps/api/src/__tests__/usage.service.test.ts`:

8a. Delete line 10: `const { license } = await import('../config/license')`

8b. Delete the constants (current lines 37–38):

```ts
const SYNTHETIC_EMAIL_PREFIX = 'usage-t+'
const SYNTHETIC_COUNT = license.doctorAllowance + 2
```

8c. Replace the `unresolvedCount`, `cleanup`, and `deleteLeftoverAlerts` helpers (current lines 44–85) with:

```ts
function unresolvedDisjointForMonth(): Promise<number> {
  return query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM operator_alerts
     WHERE type = 'disjoint_regeneration' AND resolved_at IS NULL
       AND detail->>'year' = $1 AND detail->>'month' = $2`,
    [String(YEAR), String(MONTH)],
  ).then((r) => r.rows[0]?.n ?? 0)
}

async function cleanup(): Promise<void> {
  await query(
    `DELETE FROM operator_alerts
     WHERE type = 'disjoint_regeneration' AND created_at >= $1`,
    [runStart],
  )
  await query(`DELETE FROM schedule_generation_log WHERE year = $1`, [YEAR])
}

async function deleteLeftoverAlerts(): Promise<void> {
  await query(
    `DELETE FROM operator_alerts
     WHERE type = 'disjoint_regeneration' AND detail->>'year' = $1 AND detail->>'month' = $2`,
    [String(YEAR), String(MONTH)],
  )
}
```

8d. In the first `recordGeneration` test (`logs the batch and raises no alerts on the first generation of a month`), delete the assertion line:

```ts
    expect(await unresolvedCount('allowance_exceeded')).toBe(0)
```

8e. Delete the entire final test `raises exactly one allowance_exceeded alert when distinct doctors exceed the allowance` (current lines 133–155).

- [ ] **Step 9: Run the routes test to verify it passes**

Run: `pnpm --filter @oncall/api test -- --run src/__tests__/usage.routes.test.ts`
Expected: PASS — 6 tests (including `usage summary no longer exists (404)`).

- [ ] **Step 10: Typecheck shared + API**

Run: `pnpm --filter @oncall/shared typecheck && pnpm --filter @oncall/api typecheck`
Expected: exit 0, no errors (this proves no source file still references the deleted types/modules).

- [ ] **Step 11: Commit**

```bash
git add -A apps/api packages/shared
git commit -m "refactor(api)!: remove licensing subsystem and usage summary endpoint

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Database — restrict operator alerts to disjoint_regeneration

**Files:**
- Modify: `database/schema.sql:140-149` (operator_alerts section)

**Interfaces:**
- Consumes: Task 2's service code, which only ever writes `type = 'disjoint_regeneration'`.
- Produces: `operator_alerts.type` CHECK `('disjoint_regeneration')` on both fresh and existing databases; legacy `allowance_exceeded` rows deleted so the constraint swap cannot fail.

- [ ] **Step 1: Update the operator_alerts section**

In `database/schema.sql`, replace the block (current lines 140–149):

```sql
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

with:

```sql
-- Alert-only flags, visible to the superadmin only.
-- Licensing was removed: only disjoint_regeneration alerts remain. Legacy
-- allowance_exceeded rows are deleted first so the constraint swap is safe.
CREATE TABLE IF NOT EXISTS operator_alerts (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('disjoint_regeneration')),
  detail      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
DELETE FROM operator_alerts WHERE type = 'allowance_exceeded';
ALTER TABLE operator_alerts DROP CONSTRAINT IF EXISTS operator_alerts_type_check;
ALTER TABLE operator_alerts ADD CONSTRAINT operator_alerts_type_check
  CHECK (type IN ('disjoint_regeneration'));
CREATE INDEX IF NOT EXISTS idx_operator_alerts_open
  ON operator_alerts (type, resolved_at);
```

This follows the existing idempotent drop/re-add pattern at `database/schema.sql:116-118` (`users_role_check`): fresh databases get the CHECK inline; existing databases get the delete + swap; re-runs are no-ops.

- [ ] **Step 2: Verify idempotency against a local database (when available)**

Run: `pnpm db:setup && pnpm db:setup`
Expected: both runs exit 0 (the second proves the drop/re-add and DELETE are idempotent).
If no local Postgres is reachable, note it and rely on CI (`.github/workflows/ci.yml` applies schema + seed against a real Postgres service container on every push).

- [ ] **Step 3: Commit**

```bash
git add database/schema.sql
git commit -m "refactor(db): restrict operator alerts to disjoint_regeneration

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Deploy/config — strip license wiring from compose, env examples, ignore files

**Files:**
- Modify: `docker-compose.yml:55-59`
- Modify: `.env.example:25-30`
- Modify: `apps/api/.env.example:12-13`
- Modify: `.gitignore:15-21`
- Modify: `.dockerignore:19-23`

**Interfaces:**
- Consumes: nothing (pure config text).
- Produces: deployment files with zero license references; the API container no longer receives `LICENSE_FILE` or a license mount (which also removes the "Docker creates a directory when license.json is missing" boot blocker).

- [ ] **Step 1: `docker-compose.yml` — remove the license env and mount**

Delete these lines from the `api` service:

```yaml
      # Signed license file, mounted read-only below. Required in production —
      # the API exits at boot without a valid license.
      LICENSE_FILE: ${LICENSE_FILE:-/license.json}
    volumes:
      - ./license.json:/license.json:ro
```

The `environment:` block now ends with `COOKIE_SAMESITE: ${COOKIE_SAMESITE:-lax}` and the api service has no `volumes:` key at all.

- [ ] **Step 2: Root `.env.example` — remove the License section**

Delete:

```text
# --- License ---
# Signed license file required by the API in production (NODE_ENV=production).
# docker-compose mounts ./license.json from the repo root read-only into the
# api container at /license.json. Keep LICENSE_FILE at its default unless you
# also change the mount in docker-compose.yml. Issued per clinic, never commit.
LICENSE_FILE=/license.json

```

The file flows directly from `LOG_LEVEL=info` to `# --- Deployment ---`.

- [ ] **Step 3: `apps/api/.env.example` — remove the LICENSE_FILE lines**

Delete:

```text

# Path to the signed license file (JWT). Required in production.
LICENSE_FILE=
```

The file now ends at `COOKIE_SAMESITE=lax`.

- [ ] **Step 4: `.gitignore` — remove license entries**

Delete:

```text
# Signed license files (issued per clinic, never commit)
license.json
*.license.json
# License signing keys (local keygen artifacts, never commit)
license-private.pem
license-public.pem
dev-license-private-key.pem
```

The file flows directly from `.superpowers/` to `.turbo/`.

- [ ] **Step 5: `.dockerignore` — remove license entries**

Delete:

```text
# License signing keys & signed license files (mounted at runtime, never baked into images)
**/*.pem
license.json
**/license.json
**/*.license.json
```

The file flows directly from the env-files block to `# Logs`. The plain `LICENSE` entry under `# Not needed inside the images` stays — that is the repo's own license text, unrelated to the removed subsystem.

- [ ] **Step 6: Verify no license references remain in deployment files**

Run: `grep -riIn "licen" docker-compose.yml .env.example apps/api/.env.example .gitignore .dockerignore || echo CLEAN`
Expected: `CLEAN`

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example apps/api/.env.example .gitignore .dockerignore
git commit -m "chore: remove license wiring from compose, env examples, and ignore files

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Full verification gate

**Files:**
- No source changes (only local stale-artifact cleanup and verification runs).

**Interfaces:**
- Consumes: Tasks 1–4 complete.
- Produces: green `typecheck` / `lint` / `test` / `build` across the monorepo — the repo's definition of done.

- [ ] **Step 1: Remove stale local lint-breaking artifacts**

Run (PowerShell): `Remove-Item -Recurse -Force apps/api/.nitro, apps/api/.output -ErrorAction SilentlyContinue`
These are git-ignored Nitro leftovers from an earlier experiment; `eslint .` currently fails on them (7 errors). Expected: no output; directories gone.

- [ ] **Step 2: Repo-wide license-reference sweep**

Run: `grep -riIn "license" --include="*.ts" --include="*.vue" --include="*.sql" --include="*.yml" --include="*.yaml" apps packages database docker-compose.yml .env.example || echo CLEAN`
Expected: `CLEAN` (historical docs under `docs/` are intentionally out of scope).

- [ ] **Step 3: Typecheck all packages**

Run: `pnpm typecheck`
Expected: all 4 workspace projects pass (`packages/utils`, `packages/shared`, `apps/api`, `apps/web`).

- [ ] **Step 4: Lint all packages**

Run: `pnpm lint`
Expected: exit 0 (after Step 1 removed the stale `.nitro/`/`.output/` artifacts).

- [ ] **Step 5: Run all tests**

Run: `pnpm test`
Expected: web suites pass; API suites pass except `usage.service.test.ts` when no local Postgres is reachable (`ECONNREFUSED` — pre-existing condition, unchanged by this work). With a live DB at `DATABASE_URL`, everything passes including the rewritten `usage.service.test.ts` (disjoint-regeneration cases only).

- [ ] **Step 6: Production build**

Run: `pnpm build`
Expected: all packages build; web emits `dist/`.

- [ ] **Step 7: Report**

Report the actual command outcomes verbatim (pass/fail per gate). If any gate fails, stop and report — do not claim success without output.
