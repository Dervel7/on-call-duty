# Handoff — Multi-Clinic Hospital Edition (branch `multi-clinic-hospital`)

Date: 2026-09-19. Plan: `docs/superpowers/plans/2026-09-19-multi-clinic-hospital-plan.md`.
This handoff covers Tasks 1–9 (done, committed) and what the next agent must do (Tasks 10–15).

## Ground rules (from user + plan — still binding)

- Stay on branch `multi-clinic-hospital`. NEVER merge to main; NEVER commit on main. One commit per task, conventional messages.
- Follow the plan task-by-task. If a task seems to need a scheduling-engine change, stop: the fix belongs in `schedule.service.ts` (§2.6).
- Gates: run each gate as its OWN command with a visible exit code (`pnpm lint > /dev/null 2>&1; echo "lint=$?"`). NEVER chain `gate | tail && git commit` — pipes mask exit codes and already let two red commits slip through (both caught and amended).
- After Task 9 every commit must keep: root `pnpm typecheck` = 0 errors, `pnpm --filter @oncall/api lint` = clean, full API suite green.
- Live Postgres IS running: `postgres://postgres:excalibur@localhost:5432/oncall_duty` (from `apps/api/.env`). DB was dropped/recreated and seeded with the multi-clinic baseline (Task 3).

## START HERE (first 5 minutes for the next agent)

1. `git log --oneline -15` on branch `multi-clinic-hospital` — Tasks 1–9 are one commit each (plus the plan doc, this handoff, and a post-T9 fixup commit).
2. Run the gates once to confirm the baseline you inherit (each command separately; check the visible exit code):
   `pnpm typecheck` · `pnpm --filter @oncall/api lint` · `pnpm --filter @oncall/api test -- --run` · `pnpm --filter @oncall/web test -- --run`
   Expected: root typecheck 0 errors; API lint clean; API **33 files / 284 tests passed**; web **24 files / 119 tests passed**.
3. Read plan §2.2 (`resolveClinicScope` — the single scope choke point), §2.5 (endpoint scope matrix — the spec you implement against), §2.6 (the four cross-clinic bug patterns; all four already killed for schedules — keep the discipline for stats/reports/usage/activity).
4. Start at **Task 10** below. One task per commit; run gates before each commit; never pipe a gate into `| tail && git commit`.
5. Do NOT touch `apps/api/src/scheduling/` (read-only per plan §3).

## Done so far (Tasks 1–9, one commit each; `git log --oneline` for exact messages)

- **T1** branch + baseline recorded (baseline was fully green incl. live-DB tests).
- **T2** shared: `Role` + `manager`; `AuthUser/User` `clinicId/clinicName` (required), `Doctor`/`ScheduleSummary` clinic fields (required); `GenerationEvent.clinicId/clinicName` still **optional** (tighten in T12); `Clinic` types + `createClinicSchema`/`updateClinicSchema`; `clinicId` added to the five query schemas.
- **T3** fresh DB baseline: `clinics` table, `clinic_id` on users/doctors/schedules/schedule_generation_log/activity_log, 4-role CHECK + role↔clinic CHECK, `UNIQUE (clinic_id, year, month)` on schedules. Seed: 3 clinics, `manager@oncall.local`/`changeme123`, three per-clinic admins, dr1-3 Radiology / dr4-6 Cardiology / dr7-8 Neurology. Old clinic-less `admin@oncall.local` was REMOVED (violates the CHECK). `pnpm db:setup` verified idempotent.
- **T4** `lib/scope.ts` `resolveClinicScope` (plan §2.2 verbatim); JWT `{sub, role, clinicId}` (claim-less tokens rejected); `req.user.clinicId`; auth.service joins clinics, login 403 "Clinic is deactivated" after password check; `recordActivity` writes `clinic_id`.
- **T5** clinics domain (`clinic.service/controller/routes`, `GET/POST/PATCH /clinics` — `authorize('manager','superadmin')`; note the plan's "superadmin passes via blanket rule" parenthetical is wrong, blanket only covers administrator routes); live-DB fixture `src/__tests__/helpers/clinic-fixtures.ts` (`seedTwoClinics()` + FK-safe `dispose()`).
- **T6** users: scope-resolved list, object-level 404, create rules (admin forces own clinic; manager only administrators into an active clinic; superadmin payload rules), clinic reassignment superadmin/manager-only with `doctors.clinic_id` sync, role swaps keep the role↔clinic CHECK satisfiable.
- **T7** doctors: `list(scope)`, `getById(id, actor)` visibility, `create` writes both clinic columns (equality invariant, mocked + live-DB tested), manager read-only.
- **T8** unavailability: `listAll(filters, scope?)` via `d.clinic_id`; create locks doctor in scope (cross-clinic 404); update/remove: manager 403 in service, admin cross-clinic 404; audit rows carry clinicId.
- **T9** schedules (the big one): `buildContext(year, month, clinicId)` (pool/unavailability/adjacency all scoped), §2.6.1 neighbor JOINs, `generate(..., scope, ...)` per-clinic pre-check + `clinic_id` insert, `recordGeneration(client, clinicId, year, month, ids)` clinic-partitioned (this ALSO made the live `usage.service.test.ts` green again), `monthCaps`/`validateAssignment` clinic-scoped, publish/unpublish/remove/addDuty/reassign/removeDuty object-scoped 404, list admits manager via `?clinicId=`, doctor forced own clinic. Live `schedule.isolation.test.ts` covers I7–I11.

### Post-Task-9 fixups (same session, one commit after T9)

Three defects found by review after T9 was committed; fixed before handoff, so the tree you inherit is clean:

1. **Two published-lock tests had been silently dropped** during the T9 test rework (`addDuty 409 when published`, `reassignDuty 409 when published`). Restored in `schedule.service.test.ts` (both are one-mock tests; the block now covers addDuty/reassignDuty/removeDuty/remove-schedule).
2. **`doctor.service.create` did not validate the target clinic** — a superadmin `POST /doctors?clinicId=<unknown>` hit the FK and returned 500, and creation into a deactivated clinic was not blocked (both violate §2.2/D10). Now: unknown clinic → 404, inactive clinic → 403, before the transaction. Tests added in `doctor.service.test.ts` (`create into an unknown clinic is 404, inactive clinic is 403`); note `create` issues an extra leading `SELECT is_active FROM clinics` query, so SQL-keyed mocks (not call-order mocks) are required for create flows.
3. **`database/seed.sql` doctors comment misdocumented credentials** — it said `password: changeme123` for dr1–dr8, but their hashes match their **email address** (verified by bcrypt compare; the three per-clinic admins + manager/superadmin do use `changeme123`). Comment corrected to `password = email`.

Current state (all verified immediately before this handoff): root `pnpm typecheck` 0 errors; `pnpm --filter @oncall/api lint` clean; **API 33 files / 284 tests passed**; web 24 files / 119 tests passed; `pnpm db:setup` re-applies cleanly (idempotent).

## Remaining work

### Task 10 — Stats per clinic (plan §Task 10)
- `stats.service.adminStats(year, month, scope)`: schedule lookup `WHERE s.year AND s.month AND s.clinic_id` (the select already joins clinics for clinic fields); workload/active/inactive doctor queries filter `d.clinic_id`; `meStats(userId)`: resolve doctor → clinic, then published-check, upcoming-duties and who's-on-call queries add `s.clinic_id = <doctor's clinic>`.
- `stats.routes` `/admin`: `authorize('administrator', 'manager')` + `validate(statsQuerySchema, 'query')` (schema already has clinicId) + `resolveClinicScope` in controller; `/me` unchanged.
- Tests: `stats.service.test.ts` + `stats.routes.test.ts` fixtures already carry clinic fields; add clinic predicates + I15/I16/I20 (manager 400 without clinicId; manager with clinicId sees that clinic only; doctor meStats on-call filtered to own clinic). Mock-key note: adminStats key is now `FROM schedules s JOIN clinics` (already fixed); meStats keys are still unaliased (`FROM schedules WHERE status`).

### Task 11 — Reports (plan §Task 11)
- `reports.service.monthlyReport(year, month, scope)`: delegate to `scheduleService.getScheduleDuties(id, actor)`; header data gains `clinicName` (add `clinicName` to `MonthlyReport` in shared `types/reports.ts`, from the schedule summary).
- `reports.routes`: `authorize('administrator', 'manager')`, scope via query; controller passes actor+scope.
- Tests: manager happy path + cross-clinic 404.

### Task 12 — Usage metering (plan §Task 12)
- `generations()` groups by `(clinic_id, year, month, created_at)`, joins clinic name, returns `clinicId`/`clinicName` per event → then tighten `GenerationEvent.clinicId/clinicName` to required in `packages/shared/src/types/usage.ts`.
- `recordGeneration` is DONE (T9) — do not duplicate.
- Alert `detail` gains `clinicId`/`clinicName`; the unresolved-alert dedup check should partition by clinic too (detail->>'clinicId').
- `usage.service.test.ts` (live DB): decisive new case — clinic A and B generate the same month with disjoint doctor sets → NO alert (I22); within one clinic disjoint regeneration still alerts. Existing tests pass `clinicId=1`; they select the first 8 doctors (mixed clinics) — keep as-is or restrict to one clinic's doctors.

### Task 13 — Activity log (plan §Task 13)
- `activity.service.list` scope filter `a.clinic_id = $` (activityQuerySchema already has clinicId); `activity.routes` `authorize('administrator', 'manager')` + scope via query.
- `billing.routes`: `GET /billing/payment-alert` becomes `authorize('administrator', 'manager')`.
- Tests: entries carry clinic; admin sees own clinic only; manager drills down (I23).

### Task 14 — Web (plan §Task 14) — biggest remaining chunk
Read plan §Task 14 line by line. Highlights: auth store carries clinicId/clinicName (API already returns them); `services/clinics.ts` new; `ClinicSelector.vue` (route query `?clinic=` persistence); `ClinicsPage.vue` (table + create/rename/deactivate + per-clinic administrator management via scoped `/users`); manager drill-down mode on Home/Schedules/ScheduleDetail/Roster/Reports/Users/MyAvailability/Activity (hide edit controls when manager); AppHeader clinic chip; UsagePage Clinic column; ReportsPage clinic name + CSV filename `oncall-{clinicName}-{year}-{month}.csv`; router role metas per §2.5 (manager on drill-down routes; `/clinics` route `meta: { roles: ['manager'] }` — also admit superadmin where sensible per §2.5); guard unchanged logic. Update page tests + guard test (manager allowed on drill-down, blocked on preview/generate). **Acceptance is visual**: run `pnpm dev`, walk the three personas (radiology.admin / manager / superadmin), report observations. Web fixture note: AuthUser now requires clinicId/clinicName — copy the fixture pattern from `HomePage.test.ts`.

### Task 15 — Final gates + docs
- README (remove "Multi-hospital is out of scope", describe clinic model/manager/fresh-start), AGENTS.md Domain Rules (clinics table + Manager role), `docs/admin-manual/manual.html` new section.
- `pnpm db:setup` re-run must be a clean no-op; then `pnpm typecheck && pnpm lint && pnpm test` at root — report verbatim.
- Check off the `- [ ]` boxes in the plan file as tasks complete (I did NOT tick them; the commits are the source of truth).

## Gotchas / decisions the next agent must know

1. **Plan deviations (documented in commits):** Task 2's "no breakage expected" was wrong — shared clinic fields were added optional-interim and tightened per domain task (all done except `GenerationEvent`, tighten in T12). `admin@oncall.local` removed from seed. `authorize('manager','superadmin')` on clinics routes (blanket rule covers administrator routes only). Unavailability PATCH/DELETE routes stay authenticate-only with a manager-403 in the service (plan-mandated).
2. **pg driver quirk:** this environment flattens array params in some contexts — avoid `ANY($1)` in NEW code inside fixtures/helpers; `IN ($1, $2, ...)` worked. (Existing `ANY` in usage.service works — don't churn it.)
3. **Edit discipline:** re-read the exact target lines immediately before every `edit` — line anchors drift after each write. For bulk mechanical changes prefer `sed -i` or `xd://ast_edit` codemods (see the token-builder and AuthUser-fixture codemods in the log).
4. **Mocked tests are SQL-keyed:** most route/service tests route `query` mocks by SQL substrings. When you change SQL, update the keys (e.g. `WHERE s.id =`, `du.duty_date IN`). Live-DB tests (doctor/schedule isolation, usage.service) must dynamically import `./helpers/clinic-fixtures` FIRST (env bootstrap), then `../db/client`.
5. **`pnpm -r` exit codes:** `pnpm --filter X typecheck 2>&1 | grep -c error` returns 0 lines on success but grep exits 1 — check output, not shell color.
6. Isolation matrix rows already covered: I1–I5, I6(route), I7–I11, I12, I13, I17, I18, I24, I25 + user/doctor/clinic/unavailability/schedule suites. Still to cover: I15/I16/I20 (T10), I22 listing (T12), I21 (already implicitly via login tests + T4), I23 (T13), I19 (doctor GET /schedules own clinic — service test asserts clinic predicate; route-level covered by list scoping).

## Quick verification (should all be green right now)

```
pnpm typecheck && pnpm --filter @oncall/api lint && pnpm --filter @oncall/api test -- --run
```
(Expected: 33 files / 284 tests; web: `pnpm --filter @oncall/web test -- --run` → 24 files / 119 tests.)
