# Generate Button Press Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count literal presses of the two Generate buttons, store one counter row per user per day (upsert), and show per-user totals + grand total to the superadmin only on the Usage page. Also remove the Preview button from the New schedule dialog.

**Architecture:** Minimal counter table upserted by an administrator-only `POST /usage/generate-presses`; a superadmin-only `GET /usage/generate-presses` aggregates per-user sums; the Usage page renders a new card. Both Generate buttons fire the press fire-and-forget so metering never blocks generation.

**Tech Stack:** Express + `pg` parameterized SQL (API), Zod-free shared TS types, Vue 3 + Pinia (web), Vitest (tests per AGENTS.md — tests are required, overriding the default lean plan).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-03-generate-press-counter-design.md`
- Parameterized SQL only — never concatenate SQL.
- Idempotent DDL in `database/schema.sql`; no migration runner.
- Naming: files kebab-case; DB indexes `idx_<table>_<cols>`; envelope `{ success, data }` / `{ success, error }`.
- Status codes: POST press returns 204; GET returns 200; 401 unauthenticated; 403 unauthorized.
- Access token in memory only; RBAC enforced server-side via `authenticate` + `authorize`.
- `authorize('administrator')` also admits `superadmin` (middleware behavior, do not change).
- Per AGENTS.md: `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass before work is done. Tests ARE included in this plan.
- We are on branch `omp_fixes`; commit after each task (never on main).

---

### Task 1: Database table

**Files:**
- Modify: `database/schema.sql` (append at end of file)

**Interfaces:**
- Produces: table `generate_press_counters (user_id, press_date, count)` with PK `(user_id, press_date)` consumed by Task 3's SQL.

- [ ] **Step 1: Append the DDL**

Append exactly this to the end of `database/schema.sql` (matches the file's existing comment + DDL style):

```sql
-- Generate button press counters: one row per user per day, upserted on press.
-- Minimal by design; read-only for the superadmin via the usage endpoints.
CREATE TABLE IF NOT EXISTS generate_press_counters (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  press_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count      INTEGER NOT NULL,
  CONSTRAINT pk_generate_press_counters PRIMARY KEY (user_id, press_date)
);
```

No extra index (the PK covers user lookups) and no seed rows.

- [ ] **Step 2: Verify and commit**

Run: `git diff --stat`
Expected: only `database/schema.sql` changed.

```bash
git add database/schema.sql
git commit -m "feat(db): add generate_press_counters table"
```

---

### Task 2: Shared types

**Files:**
- Modify: `packages/shared/src/types/usage.ts` (append at end)

**Interfaces:**
- Produces: `GeneratePressUserCount` and `GeneratePressCounts` (imported from `@oncall/shared` in Tasks 3 and 5).

- [ ] **Step 1: Add the types**

Append to `packages/shared/src/types/usage.ts`:

```ts
export interface GeneratePressUserCount {
  userId: number
  username: string
  firstName: string
  lastName: string
  presses: number
}

export interface GeneratePressCounts {
  total: number
  byUser: GeneratePressUserCount[]
}
```

(`types/index.ts` already re-exports `./usage` — no other change needed.)

- [ ] **Step 2: Run typecheck and lint to verify**

Run: `pnpm --filter @oncall/shared typecheck && pnpm --filter @oncall/shared lint`
Expected: PASS with no errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/usage.ts
git commit -m "feat(shared): add generate press counter types"
```

---

### Task 3: API endpoints

**Files:**
- Modify: `apps/api/src/services/usage.service.ts` (append at end)
- Modify: `apps/api/src/controllers/usage.controller.ts` (add two handlers)
- Modify: `apps/api/src/routes/usage.routes.ts` (add two routes)
- Modify: `apps/api/src/__tests__/usage.routes.test.ts` (add tests)

**Interfaces:**
- Consumes: `generate_press_counters` table (Task 1), `GeneratePressCounts` type (Task 2), existing `query` from `../db/client`.
- Produces: `usageService.recordGeneratePress(userId: number): Promise<void>`, `usageService.generatePressCounts(): Promise<GeneratePressCounts>`; routes `POST /usage/generate-presses` (administrator) and `GET /usage/generate-presses` (superadmin). The GET response body is `ok(counts)` — i.e. `{ success: true, data: { total, byUser } }` — consumed by Task 5's web service.

- [ ] **Step 1: Add service functions**

Append to `apps/api/src/services/usage.service.ts`. Add `GeneratePressCounts` to the existing `import type { ... } from '@oncall/shared'` block at the top:

```ts
export async function recordGeneratePress(userId: number): Promise<void> {
  await query(
    `INSERT INTO generate_press_counters (user_id, press_date, count)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, press_date)
     DO UPDATE SET count = generate_press_counters.count + 1`,
    [userId],
  )
}

interface PressCountRow {
  user_id: number
  username: string
  first_name: string
  last_name: string
  presses: number
}

export async function generatePressCounts(): Promise<GeneratePressCounts> {
  const res = await query<PressCountRow>(
    `SELECT u.id AS user_id, u.username, u.first_name, u.last_name,
            COALESCE(SUM(g.count), 0)::int AS presses
     FROM generate_press_counters g JOIN users u ON u.id = g.user_id
     GROUP BY u.id, u.username, u.first_name, u.last_name
     ORDER BY presses DESC, u.id`,
  )
  const byUser = res.rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    presses: r.presses,
  }))
  return { total: byUser.reduce((sum, u) => sum + u.presses, 0), byUser }
}
```

- [ ] **Step 2: Add controller handlers**

In `apps/api/src/controllers/usage.controller.ts`, add inside the existing `usageController` object:

```ts
  async recordGeneratePress(req: Request, res: Response, next: NextFunction) {
    try {
      await usageService.recordGeneratePress(req.user!.id)
      res.status(204).send()
    } catch (err) {
      next(err)
    }
  },
  async generatePresses(_req: Request, res: Response, next: NextFunction) {
    try {
      const presses = await usageService.generatePressCounts()
      res.status(200).json(ok(presses))
    } catch (err) {
      next(err)
    }
  },
```

- [ ] **Step 3: Add routes**

In `apps/api/src/routes/usage.routes.ts`, add after the existing `usageRouter.get('/alerts', ...)` line:

```ts
usageRouter.post('/generate-presses', authorize('administrator'), usageController.recordGeneratePress)
usageRouter.get('/generate-presses', authorize('superadmin'), usageController.generatePresses)
```

(`usageRouter.use(authenticate)` at the top already applies.)

- [ ] **Step 4: Add route tests**

Append inside `describe('usage routes', ...)` in `apps/api/src/__tests__/usage.routes.test.ts`:

```ts
  it('POST /generate-presses is 401 unauthenticated', async () => {
    const res = await request(build()).post('/usage/generate-presses')
    expect(res.status).toBe(401)
  })

  it('POST /generate-presses is 403 for a doctor', async () => {
    const res = await request(build())
      .post('/usage/generate-presses')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('POST /generate-presses records the authenticated admin (204)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .post('/usage/generate-presses')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(204)
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]![1]).toEqual([2])
  })

  it('POST /generate-presses also accepts a superadmin (204)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .post('/usage/generate-presses')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(204)
  })

  it('GET /generate-presses is 403 for an administrator', async () => {
    const res = await request(build())
      .get('/usage/generate-presses')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(403)
  })

  it('GET /generate-presses returns totals for a superadmin (200)', async () => {
    query.mockResolvedValue({
      rows: [
        { user_id: 2, username: 'admin1', first_name: 'Ada', last_name: 'Lovelace', presses: 14 },
        { user_id: 3, username: 'admin2', first_name: 'Sam', last_name: 'Doe', presses: 9 },
      ],
    })
    const res = await request(build())
      .get('/usage/generate-presses')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.total).toBe(23)
    expect(res.body.data.byUser).toHaveLength(2)
    expect(res.body.data.byUser[0]).toMatchObject({ userId: 2, presses: 14 })
  })
```

- [ ] **Step 5: Run typecheck, lint, and tests to verify**

Run: `pnpm --filter @oncall/api typecheck && pnpm --filter @oncall/api lint && pnpm --filter @oncall/api test`
Expected: PASS with no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/usage.service.ts apps/api/src/controllers/usage.controller.ts apps/api/src/routes/usage.routes.ts apps/api/src/__tests__/usage.routes.test.ts
git commit -m "feat(api): generate press counter endpoints"
```

---

### Task 4: Web usage service + SchedulesPage (remove Preview, fire press)

**Files:**
- Modify: `apps/web/src/services/usage.ts` (append at end)
- Modify: `apps/web/src/pages/SchedulesPage.vue`
- Modify: `apps/web/src/__tests__/SchedulesPage.test.ts`

**Interfaces:**
- Consumes: `POST /usage/generate-presses` (Task 3), `apiPost`/`apiGet` from `@/lib/http`, `GeneratePressCounts` from `@oncall/shared` (Task 2).
- Produces: `usageService.recordGeneratePress(): Promise<void>` (used here and by Task 5), `usageService.generatePresses(): Promise<GeneratePressCounts>` (used by Task 5).

- [ ] **Step 1: Add web service functions**

Append to `apps/web/src/services/usage.ts`; add `GeneratePressCounts` to the existing `import type { ... } from '@oncall/shared'` and `apiPost` to the existing `import { apiGet, apiPatch } from '@/lib/http'`:

```ts
export async function recordGeneratePress(): Promise<void> {
  await apiPost<void>('/usage/generate-presses', {})
}
export async function generatePresses(): Promise<GeneratePressCounts> {
  const data = await apiGet<GeneratePressCounts>('/usage/generate-presses')
  return data
}
```

- [ ] **Step 2: Update SchedulesPage.vue**

In `apps/web/src/pages/SchedulesPage.vue`:

1. Add the import after the schedule service import:
   `import * as usageService from '@/services/usage'`
2. Delete the entire `goPreview` function (lines with `function goPreview() { ... }`).
3. In `runGenerate`, make the first statement (before `gen.value.errorMsg = ''`):
   `void usageService.recordGeneratePress().catch(() => {})`
4. In the template, replace the dialog footer div containing both buttons:

```html
        <div class="flex items-center gap-2">
          <Button type="button" variant="outline" @click="goPreview">Preview</Button>
          <Button type="submit" :disabled="gen.generating">
            {{ gen.generating ? 'Generating…' : 'Generate' }}
          </Button>
        </div>
```

with only the Generate button (full width is not required — keep the wrapper):

```html
        <div class="flex items-center gap-2">
          <Button type="submit" :disabled="gen.generating">
            {{ gen.generating ? 'Generating…' : 'Generate' }}
          </Button>
        </div>
```

5. Replace the helper text paragraph:

```html
        <p v-else class="text-xs text-muted-foreground">
          Use Preview to review the proposed calendar before generating.
        </p>
```

with:

```html
        <p v-else class="text-xs text-muted-foreground">
          If the month cannot be filled, you will be taken to the preview to adjust it.
        </p>
```

- [ ] **Step 3: Update SchedulesPage tests**

In `apps/web/src/__tests__/SchedulesPage.test.ts`:

1. Add a usage mock next to the existing service mocks (after the `const generate = vi.fn()` line):

```ts
const recordGeneratePress = vi.fn()
vi.mock('@/services/usage', () => ({
  recordGeneratePress: (...a: unknown[]) => recordGeneratePress(...a),
}))
```

and reset it in `beforeEach`: add `recordGeneratePress.mockReset()` and set `recordGeneratePress.mockResolvedValue(undefined)` inside `mountAs` (next to `list.mockResolvedValue([])`).

2. Replace the test `it('Preview button navigates to the preview page with year/month', ...)` entirely with:

```ts
  it('dialog has no Preview button; Generate records a press before generating', async () => {
    generate.mockResolvedValue({
      schedule: { id: 7, year: 2026, month: 9, status: 'draft', createdBy: 1, createdAt: '', updatedAt: '' },
      duties: [],
      days: [],
    })
    const wrapper = mountAs('administrator')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()
    const buttons = Array.from(document.body.querySelectorAll('button'))
    expect(buttons.some((b) => b.textContent?.includes('Preview'))).toBe(false)
    const generateBtn = buttons.find((b) => b.textContent?.includes('Generate'))
    expect(generateBtn).toBeTruthy()
    generateBtn!.click()
    await flushPromises()
    expect(recordGeneratePress).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith(expect.any(Number), expect.any(Number))
    expect(push).toHaveBeenCalledWith('/schedules/7')
  })
```

(`mountAs` opens the dialog with the current year/month, so assert on two numbers, not fixed values.)

- [ ] **Step 4: Run typecheck, lint, and tests to verify**

Run: `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test`
Expected: PASS with no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/usage.ts apps/web/src/pages/SchedulesPage.vue apps/web/src/__tests__/SchedulesPage.test.ts
git commit -m "feat(web): count generate presses and drop dialog preview button"
```

---

### Task 5: SchedulePreviewPage press + Usage page card

**Files:**
- Modify: `apps/web/src/pages/SchedulePreviewPage.vue`
- Modify: `apps/web/src/pages/UsagePage.vue`
- Modify: `apps/web/src/__tests__/SchedulePreviewPage.test.ts`
- Modify: `apps/web/src/__tests__/UsagePage.test.ts`

**Interfaces:**
- Consumes: `usageService.recordGeneratePress()` and `usageService.generatePresses()` (Task 4).

- [ ] **Step 1: Fire the press in SchedulePreviewPage.generate()**

In `apps/web/src/pages/SchedulePreviewPage.vue`:

1. Add the import after the doctor service import:
   `import * as usageService from '@/services/usage'`
2. In `generate()`, make the first statement (before `generating.value = true`):
   `void usageService.recordGeneratePress().catch(() => {})`

- [ ] **Step 2: Add the presses card to UsagePage.vue**

In `apps/web/src/pages/UsagePage.vue`:

1. Extend the shared type import: `import type { GeneratePressCounts, GenerationEvent, OperatorAlert, UsageSummary } from '@oncall/shared'`
2. Add state next to the other refs: `const presses = ref<GeneratePressCounts | null>(null)`
3. In `load()`, add `usageService.generatePresses()` to the `Promise.all` (fourth item) and assign `presses.value = p`.
4. Add a card after the License card:

```html
    <Card v-if="presses">
      <CardHeader>
        <CardTitle>Generate button presses</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <p class="text-sm text-muted-foreground">
          Total:
          <span class="text-foreground">{{ presses.total }}</span>
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead class="text-right">Presses</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="u in presses.byUser" :key="u.userId">
              <TableCell>{{ u.firstName }} {{ u.lastName }} ({{ u.username }})</TableCell>
              <TableCell class="text-right">{{ u.presses }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
```

- [ ] **Step 3: Update tests**

In `apps/web/src/__tests__/SchedulePreviewPage.test.ts`:

1. Add a usage mock after the doctor service mock:

```ts
const recordGeneratePress = vi.fn()
vi.mock('@/services/usage', () => ({
  recordGeneratePress: (...a: unknown[]) => recordGeneratePress(...a),
}))
```

2. Reset it in `beforeEach` (`recordGeneratePress.mockReset(); recordGeneratePress.mockResolvedValue(undefined)`).
3. In the test `'assigning one doctor per day via selects enables Generate and sends the plan'`, after `await button.trigger('click')` and `await flushPromises()`, add:

```ts
    expect(recordGeneratePress).toHaveBeenCalledTimes(1)
```

In `apps/web/src/__tests__/UsagePage.test.ts`:

1. Extend the usage mock with a `generatePresses` mock (add to the `vi.mock('@/services/usage', ...)` factory):
   `generatePresses: (...a: unknown[]) => generatePresses(...a),`
   with `const generatePresses = vi.fn()` declared with the others, reset in `beforeEach`, and `generatePresses.mockResolvedValue(pressesFixture)` added to `mockResolved()` plus a fixture:

```ts
const pressesFixture: GeneratePressCounts = {
  total: 23,
  byUser: [{ userId: 2, username: 'admin1', firstName: 'Ada', lastName: 'Lovelace', presses: 23 }],
}
```

(add `GeneratePressCounts` to the type import from `@oncall/shared`). In the "shows an error message when loading fails" test, set `generatePresses.mockResolvedValue({ total: 0, byUser: [] })` alongside the other mocks so `Promise.all` only rejects from `summary`.

2. Add an assertion to the first render test:

```ts
    expect(wrapper.text()).toContain('Generate button presses')
    expect(wrapper.text()).toContain('Ada Lovelace (admin1)')
    expect(wrapper.text()).toContain('23')
```

- [ ] **Step 4: Run typecheck, lint, and tests to verify**

Run: `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test`
Expected: PASS with no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SchedulePreviewPage.vue apps/web/src/pages/UsagePage.vue apps/web/src/__tests__/SchedulePreviewPage.test.ts apps/web/src/__tests__/UsagePage.test.ts
git commit -m "feat(web): preview page press counter and usage presses card"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run the whole suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors

- [ ] **Step 2: Manual smoke (optional, needs DB)**

Run: `pnpm db:setup` (applies the new table idempotently), then press Generate in the UI and check the superadmin Usage page shows the counter.
