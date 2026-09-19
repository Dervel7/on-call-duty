# Handoff 2 — Multi-Clinic Hospital Edition (branch `multi-clinic-hospital`)

Date: 2026-09-19 (session 2). Read `docs/superpowers/2026-09-19-multi-clinic-handoff.md` first —
its ground rules, §2.2/§2.5/§2.6 references, and gotchas 1–9 are still binding. This document
covers session 2's completed work (Tasks 10–13, 14.1–14.6 — one commit each) and what the next
agent must do (Tasks 14.7–14.13, 15).

## Database change (user directive, supersedes handoff 1)

The user created a NEW database: **`oncall_duty_multi_clinic`**. `apps/api/.env` now points at
`postgres://postgres:excalibur@localhost:5432/oncall_duty_multi_clinic` (the old `oncall_duty`
line is kept as an `@REM` comment, as the user had structured it). `pnpm db:setup` was run and
verified against it: Radiology 3 / Cardiology 3 / Neurology 2 doctors; 2 NULL-clinic vendor roles;
0 doctors/users clinic mismatches; all 13 seeded users present. All live-DB tests ran green against
this DB. Do not switch back; do not commit `.env` (it is gitignored).

## Verified state at handoff (all run immediately before writing this doc)

- Root `pnpm typecheck` = 0 errors.
- `pnpm --filter @oncall/api lint` = clean; API suite **33 files / 297 tests passed** (live-DB tests included, against `oncall_duty_multi_clinic`).
- `pnpm --filter @oncall/web typecheck` = clean; web suite **28 files / 143 tests passed**.
- `pnpm --filter @oncall/shared test -- --run` = 26 passed.
- Working tree clean; `git log --oneline -1` = `9b573e7` (Task 14.6).

## Commit ledger (session 2, newest first)

```
9b573e7 feat(web): manager drill-down dashboard with clinic selector          (Task 14.6)
3f74c06 feat(web): clinic chip in header and manager navigation set           (Task 14.5)
2f93cf0 feat(web): manager route metas and clinics route with guard coverage   (Task 14.2)
fcde975 feat(web): ClinicsPage - clinic lifecycle and per-clinic admin mgmt    (Task 14.4)
61f82ec feat(web): clinic selection composable and manager-only ClinicSelector(Task 14.3)
a01be72 feat(web): thread clinicId through read services and add clinics service (Task 14.1)
76521b1 feat(api): scope activity log to clinics and admit manager to payment-alert (Task 13)
9110a71 feat(api): partition usage metering by clinic - batch grouping, alert detail, dedup (Task 12)
d1138db feat(api): scope reports to clinics - manager drill-down, clinicName header, roster 404 (Task 11)
e10f288 feat(api): scope stats to clinics - admin drill-down and doctor own-clinic filters (Task 10)
```

Note the commit ORDER: 14.1 → 14.3 → 14.4 → **14.2** → 14.5 → 14.6. 14.2 was done after 14.4
because the router's `/clinics` route imports `ClinicsPage.vue` — the route cannot typecheck
before the page exists. Keep that in mind if you ever reorder/rebase.

## What session 2 built (details the next agent needs)

### API (Tasks 10–13)

- **T10 stats**: `adminStats(year, month, scope: ClinicScope)` — schedule lookup
  `AND s.clinic_id = $3`; active doctors `WHERE u.is_active = TRUE AND d.clinic_id = $1`; inactive
  via `AND d.clinic_id = $2`. `meStats` resolves `doctor.clinicId` and adds `clinic_id`/`s.clinic_id`
  predicates to the published-check, upcoming, and who's-on-call queries. Routes: `/admin` =
  `authorize('administrator', 'manager')`; controller resolves scope. Covered: I15, I16, I20
  (routes + SQL-keyed service tests).
- **T11 reports**: `monthlyReport(year, month, actor, scope)` — actor forwarded to
  `getScheduleDuties(id, actor)` so the object-level cross-clinic 404 propagates; `MonthlyReport`
  gained **`clinicName: string | null`** (shared `types/reports.ts`); route admits manager.
  **Assert detail**: `reports.service.test.ts` now asserts `getScheduleDuties` is called with
  `(7, actor)` — update it if you touch the delegation.
- **T12 usage**: `generations()` groups by `(clinic_id, year, month, created_at)` joining clinic
  name; every batch/overlap query is clinic-filtered; `GenerationEvent.clinicId/clinicName` are
  now **required** (shared `types/usage.ts`) — web `UsagePage.test.ts` fixture already carries
  them. `recordGeneration` alert INSERT gains `'clinicId'`/`'clinicName'` in detail and the
  unresolved dedup partitions by `detail->>'clinicId'` (fetches clinic name inside the
  transaction). Live-DB I22 test seeds two temp clinics with 4+8 doctors and cleans up.
- **T13 activity**: `list(filters, scope)` always predicates `a.clinic_id = $1` (so
  `LIMIT $2 OFFSET $3` — params array is SHARED between count/page queries and mutates; don't
  assert `calls[0][1]` equals the count-time snapshot). Route: `authorize('administrator',
  'manager')`; controller destructures `clinicId` out of the query. `billing.routes`
  `/payment-alert` admits manager (test pins admin+manager 200, doctor 403).

### Web (14.1–14.6)

- **14.1**: `clinicId?: number` threaded through `schedule/stats/reports/activity/user/doctor/unavailability`
  services (toQuery/URLSearchParams pattern); new `services/clinics.ts` (`list/create/update` against
  `{ clinics }`/`{ clinic }` envelopes — matches controller). Shared `UnavailabilityQuery` gained
  `clinicId?: number`.
- **14.3**: `composables/useClinicSelection.ts` — route query `?clinic=` is the source of truth,
  `setClinic` merges query (other params survive). `components/layout/ClinicSelector.vue` —
  manager-only (`v-if="auth.isManager"`), fetches `clinics.list()` only for managers, Select with
  a disabled placeholder option. `stores/auth.ts` gained `isManager`.
- **14.4**: `pages/ClinicsPage.vue` — clinics table (name/status/doctors/admins), create + rename
  dialogs (`createClinicSchema`), deactivate via `useConfirm` + reactivate (no confirm), and a
  per-clinic Administrators section: `watch(selectedClinicId, ..., { immediate: true })` →
  `user.list(clinicId)` filtered to `role === 'administrator'`, create-administrator dialog
  (`createUserSchema` with `clinicId`), deactivate/reactivate admins via `user.update`.
- **14.2**: router metas — manager added to `schedules`, `schedules/:id`, `roster`, `reports`,
  `activity`, `users`, `availability`; `/clinics` route `meta: { roles: ['manager'] }` (superadmin
  deliberately locked out — guard's blanket rule only fires when `administrator` is listed);
  `usage` stays superadmin-only, `schedule-preview` administrator-only. Guard tests cover manager
  drill-down allow, preview/usage redirect, clinics lockout, superadmin pass-through.
- **14.5**: `AppHeader.vue` — clinic chip next to the brand block (`data-testid="clinic-chip"`):
  admin/doctor → their `clinicName`; manager → selected clinic name (from `clinics.list()` map) or
  "All clinics"; superadmin → none. Nav: doctor gets roster+my-availability ONLY for doctors now
  (`auth.user?.role === 'doctor'`); manager gets Home/Users/Availability/Schedules/Reports/Activity/Clinics/Profile.
- **14.6**: `HomePage` renders AdminDashboard for `isAdmin || isManager`; `AdminDashboard` renders
  `<ClinicSelector />` in the filter row, includes `clinicId` in `stats.admin()` when manager, and
  watches `selectedClinicId` to reload. Its test mocks `vue-router` with BOTH `useRouter` and
  `useRoute: () => route` (plain mutable object) — copy that pattern.

## Remaining work

### Task 14.7 — SchedulesPage manager mode (was started, then reverted — plan below)

Reverted cleanly; nothing landed. Plan that was already read and shaped:
- Script: import `ClinicSelector` + `useClinicSelection`; `load()` builds
  `const query: ScheduleQuery = filterYear.value ? { year: Number(filterYear.value) } : {}`,
  adds `query.clinicId = selectedClinicId.value` when `auth.isManager`, passes it to
  `scheduleService.list(query)` (empty object is fine — toQuery handles it);
  `watch(selectedClinicId, () => { if (auth.isManager) void load() })`.
- Template: `<ClinicSelector />` inside the filter row before the Apply button.
  The "New schedule" button is already `v-if="auth.isAdmin"` → hidden for manager automatically.
- Tests (`SchedulesPage.test.ts`): the file mocks `vue-router` with ONLY `useRouter` — add
  `useRoute: () => route` (mutable object reset in beforeEach) and a `@/services/clinics` mock, widen
  `mountAs` to `'manager'`, then: manager case asserting selector present, no "New schedule"
  button, `list` called with `{ clinicId: 2 }` (drive via `route.query = { clinic: '2' }`).

### Task 14.8 — ScheduleDetailPage + ScheduleRosterPage manager mode

Detail: read-only for manager — hide inline duty assignment, reassign/remove duty buttons,
publish/unpublish, delete schedule; calendar and roster link stay. Check how the page branches on
role today (`isAdmin` likely); add manager branches that render the read-only surface.
Roster: allowed by 14.2 metas; verify it renders for manager without edit affordances; add a
minimal roster manager test if none exists. Accept: `ScheduleDetailPage.test.ts` manager case
asserts edit controls absent + calendar still renders.

### Task 14.9 — ReportsPage manager mode + clinic-aware CSV

Selector + `clinicId` on `reports.monthly()`; header shows `report.clinicName` (present since
T11, null when no schedule — render gracefully); CSV filename
`oncall-{slug(clinicName)}-{year}-{month}.csv`, slug = lowercase, non-alphanumerics → `-`,
collapse/trim. Accept: manager test + filename unit test (extend `__tests__/download.test.ts`).

### Task 14.10 — UsersPage manager mode

Manager: no create/edit/delete controls; list scoped via `user.list(clinicId)`. Administrator
lifecycle for managers lives in ClinicsPage (14.4), so this page is read-only in manager mode.
Accept: UsersPage manager test (no add/edit buttons, scoped list call).

### Task 14.11 — Availability + MyAvailability + Activity manager mode

- `AvailabilityPage` (admin unavailability list): scope via `unavailability.listAll({ clinicId })`
  for manager; hide create/edit/delete for manager.
- `MyAvailabilityPage`: give the route `meta: { roles: ['doctor'] }` in router/index.ts (§2.5:
  unavailability `/me` is doctor-only; manager redirects home). Nav already excludes it for managers (14.5).
- `ActivityPage`: scope via `clinicId` (activity service already accepts it — 14.1); already read-only.
Accept: AvailabilityPage + ActivityPage manager cases; MyAvailability unaffected for doctors
(existing tests must stay green after the meta change — check the guard tests still list it as open? It is
currently meta-less; adding roles: ['doctor'] means administrators/superadmins now redirect away —
confirm no existing test pins open access).

### Task 14.12 — UsagePage clinic column (superadmin)

Add a Clinic column to the generations table from `clinicId`/`clinicName` (both REQUIRED in
`GenerationEvent` since T12 — no `—` fallback needed; fixture already updated). Accept:
`UsagePage.test.ts` clinic-column case.

### Task 14.13 — Acceptance walkthrough + gates

`pnpm dev` against the seeded `oncall_duty_multi_clinic` DB; personas:
1. `radiology.admin@oncall.local` / `changeme123` → header chip "Radiology"; schedules/users/
   doctors/unavailability show only Radiology rows.
2. `manager@oncall.local` / `changeme123` → `/clinics` create/rename/deactivate works;
   administrator lifecycle works; drill-down per clinic shows that clinic's stats/rosters/reports;
   NO edit button anywhere.
3. `superadmin@oncall.local` / `changeme123` → usage shows clinic names.
Then `pnpm --filter @oncall/web typecheck`, `pnpm --filter @oncall/web test -- --run`, root
`pnpm typecheck`. Defects found get their own follow-up commits (never folded into 14.12/14.13).

### Task 15 — Final gates + docs

- README: remove "Multi-hospital is out of scope"; describe clinic model/manager/fresh-start.
- AGENTS.md Domain Rules: add clinics table + Manager role; Auth section role list.
- `docs/admin-manual/manual.html`: "Clinics and the Manager role" section.
- `pnpm db:setup` re-run must be a clean no-op on the populated DB.
- Root `pnpm typecheck && pnpm lint && pnpm test` — report verbatim.
- Tick the `- [ ]` boxes in the plan file for Tasks 1–15 (commits are the source of truth).

## Session-2 gotchas (add these to handoff 1's list)

1. **vitest 3.2.7 mock-rejection attribution quirk (FOLLOW-UP CANDIDATE):** a test file with
   `beforeEach(() => someMock.mockReset())` where the mock is later given
   `mockRejectedValue(...)` (or `mockImplementation(() => Promise.reject(...))`) and the rejection
   is consumed inside a MOUNTED component's async catch — vitest fails the test with the raw
   rejection even though the component handles it and renders the error. Bisect result: the SAME
   variants WITHOUT the `mockReset` hook all pass. For this reason `ClinicSelector.test.ts` has
   no error-path test (the component was verified correct by a manual repro: error rendered,
   exactly one service call). If you need an error-path test on a component, either skip the
   `mockReset` hook in that file, use `mockClear()` instead (clears calls, keeps implementations —
   untested variant, try it first), or reset mocks at the end of each test instead. Candidate to
   re-add: an error-path test for `ClinicSelector` via the `mockClear` route.
2. **Manager with NO clinic selected → API 400 surfaces as a page error (UX NIT, decide in
   14.7+):** manager drill-down pages call e.g. `stats.admin({year, month})` without `clinicId`
   until a clinic is picked; the API answers 400 "clinicId query parameter is required" and the
   page shows it in `[role="alert"]`. Options: friendly "Select a clinic" empty state when
   manager && no selection, or auto-select the first clinic. Apply the chosen treatment
   consistently across Home/Schedules/Reports/Activity/Availability drill-downs.
3. **Dialog content teleports to `document.body`** (`Dialog.vue` uses `<Teleport to="body">`).
   In tests, page-level buttons are reachable via `wrapper.findAll('button')` but dialog form
   fields/buttons only via `document.body.querySelector` — copy `bodyButton`/`setBodyValue` from
   `ClinicsPage.test.ts` / `UsersPage.test.ts`.
4. **`edit` tool anchor discipline:** several edits this session produced duplicated blocks when a
   PUT range was off by a line or an insert echoed adjacent content. ALWAYS re-read the touched
   region after every edit and before the next; prefer `write` for whole new files.
5. **Test doubles that mock `vue-router` partially:** any component (or composable it uses) that
   calls `useRoute` needs the mock to provide `useRoute` too — pattern: mutable `const route =
   { query: {} as Record<string, string> }` returned by the factory, reset in beforeEach (see
   `AdminDashboard.test.ts`, planned for `SchedulesPage.test.ts`).
6. **Live-DB I22 test** (`usage.service.test.ts`) seeds its own temp clinics/doctors with
   `generate_series` and cleans up FK-safe in `afterAll`; it uses YEAR 2031 so it cannot collide
   with the 2030 fixtures of the older recordGeneration tests. If you add cases there, keep the
   years disjoint.
7. **`HomePage.test.ts` `user()` helper** assigns `clinicId: 1` even for the manager fixture —
   harmless there (only role is read), but don't copy it into tests that assert clinic semantics;
   manager/superadmin fixtures should use `clinicId: null, clinicName: null`.

## Quick verification (should be green right now)

```
pnpm typecheck && pnpm --filter @oncall/api lint && pnpm --filter @oncall/api test -- --run
pnpm --filter @oncall/web test -- --run
```

Expected: root typecheck 0 errors; API 33 files / 297 tests; web 28 files / 143 tests.
