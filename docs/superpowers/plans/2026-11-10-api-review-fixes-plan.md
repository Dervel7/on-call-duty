# API (`apps/api`) review - findings and fixes

Date: 2026-11-10. Scope: everything under `apps/api/` (source, tests, `package.json`, `tsconfig.json`, `vitest.config.ts`, `Dockerfile`, `.env.example`). Contracts were checked against `packages/shared`, `database/schema.sql`, `docs/database.md` and the web callers in `apps/web/src`.

This file is the hand-off for the agents that implement the fixes, one batch at a time. Every finding names the files and lines, the triggering scenario, the fix, and the tests to add, change or delete. Line numbers are from the review snapshot (commit `af11309`); re-read each file before editing.

Related plans (do not repeat their items here):

- `docs/superpowers/plans/2026-11-10-low-resource-server-plan.md`: performance and deployment items (INF-*, SOL-*, AUTH-*, DB-*, DATA-*, QRY-*). Findings below that overlap say so.
- `docs/superpowers/plans/2026-11-09-web-review-fixes-plan.md`: the API halves of its CORE-03, CORE-05, ADM-01, ADM-04 and ADM-07 were re-checked here (see CORE "Verified as correct", ADM-04, ADM-08, RPT-01).

## Rules for the implementing agent

- Follow `AGENTS.md`. Take **one batch per session**, in the order below. Within a batch, follow the listed order.
- Implement only what each finding says. Do not add improvements that are not listed here.
- Findings marked **Needs decision** are listed in the decisions table. Ask the user before implementing them; if there is no answer, skip them and note that in the Status table.
- Findings with a **Merge note** are the same defect seen from two slices. Implement them once, as one change.
- Every bugfix needs a test (see each finding's *Fix*). Delete tests that only pin behaviour a finding removes.
- Any change to `database/schema.sql` must update `docs/database.md` in the same change. Do not add a migration runner.
- The low-resource plan edits many of the same API files. Before a batch, check its Status there. Do not implement an item that a finding marks as tracked in that plan (for example SCH-16 = QRY-02, SCH-06 = SOL-05). Do not run a batch from each plan on the same files at the same time.
- When a batch is done, run from the repo root: `pnpm typecheck`, `pnpm lint`, `pnpm test`. All three must pass. Then update the Status table in this file. Commit per `AGENTS.md` (only on a non-`main` branch, only the files of the batch).

## Status

| Batch | Topic | Findings | Status |
|---|---|---|---|
| 1 | Security: accounts and sessions | 8 | Done (ADM-06 merged into CORE-02) |
| 2 | Scheduling hard rules | 9 | Done (SCH-04 had no decision: manual edits strict, plan saves keep the minimum relaxation) |
| 3 | Solver and options robustness | 7 | Done except ENG-05 (no decision; skipped). SCH-10 not reproducible: `eligibilityFor` is synchronous now, so no await sits between the solve and `options.push`; no change. SCH-11 merged into CORE-05 (`retryAfterSeconds` = solver budget, 45 s). ENG-11 fixed without a dedicated test (not reachable through `generate` with the fixtures tried) |
| 4 | Validation and request plumbing | 8 | Done (RPT-15 superseded by CORE-12) |
| 5 | Audit trail and atomic writes | 9 | Partly done: RPT-02, ADM-17, RPT-14, RPT-03 done; RPT-13 done except the RPT-05 resolve tests. RPT-01, ADM-07, RPT-06, RPT-05 skipped (no decision) |
| 6 | User and doctor account boundaries | 8 | Done with the recommended decisions: ADM-02/ADM-04 reject doctor accounts on /users (superadmin clinic-only move allowed); CORE-08 case-insensitive email; ADM-08 admin hash is a required psql variable (no flag); ADM-14 allowed, documented as snapshot |
| 7 | Stats and reports | 5 | Partly done: RPT-11, RPT-04, RPT-09, RPT-10 done. RPT-08 skipped (no decision) |
| 8 | Schedule API surface | 6 | Done with the recommended decisions: SCH-06 engine-only saves dropped; SCH-07 /schedules/preview retired; SCH-13 managers see published schedules only in the list; SCH-14, SCH-19 done. SCH-16 skipped (tracked as QRY-02). AGENTS.md still names /schedules/preview (batch 13, CORE-24) |
| 9 | Simplification and dead code | 11 | Done (ENG-06 decided: option A, field dropped from shared type and web text). SCH-05: `calendarDays(days, ...)` takes a day list; `computeEligibility` does not use `classifyDays` (ENG-10 optional part). ADM-16: `maxMonthlyDuties` stays optional in the service type; `doctor.isolation` test passes it explicitly. Billing and settings services still declare a local `Actor` |
| 10 | Split schedule.service.ts | 1 | Done (extra file `schedule-rows.ts` for shared row types and mappers; no `schedule-rules.test.ts`, since no test calls `validatePlan` directly) |
| 11 | Test quality | 8 | Not started |
| 12 | Runtime, config and dependencies | 7 | Not started |
| 13 | Docs and ASCII cleanup | 7 | Not started |

## Summary

94 findings: 1 Critical, 6 High, 20 Medium, 67 Low. Some are duplicates across slices and carry a merge note; they count once in the work.

ID prefixes: `CORE` = app, config, middleware, lib, auth, build. `ENG` = scheduling engine (`src/scheduling`). `SCH` = schedule service, controller, routes. `ADM` = doctors, users, unavailability, holidays, clinics, settings. `RPT` = stats, reports, usage, billing, activity.

| ID | Severity | Category | Batch | Title |
|---|---|---|---|---|
| [ADM-01](#adm-01) | Critical | Security | 1 | An administrator can promote any user in their clinic, including themselves, to the hospital-level `manager` role |
| [CORE-01](#core-01) | High | Security | 1 | The raw refresh token is written to the request log in plaintext |
| [ADM-03](#adm-03) | High | Security | 1 | Nothing stops users from deactivating, deleting, demoting or password-resetting themselves, or removing the last administrator or superadmin |
| [ENG-01](#eng-01) | High | Bug | 2 | Engines ignore next month's first day, so they can create back-to-back duties across the month boundary |
| [SCH-01](#sch-01) | High | Bug | 2 | Holiday cap ignores marked holidays when the new duty falls on a weekend |
| [SCH-02](#sch-02) | High | Bug | 2 | Saving a plan, and the engine, ignore the next month's first-day duties (back-to-back across the month boundary) |
| [ADM-02](#adm-02) | High | Bug | 6 | `/users` breaks the 1:1 link between doctor users and `doctors` rows |
| [CORE-02](#core-02) | Medium | Security | 1 | Refresh keeps sessions in a deactivated clinic alive |
| [ADM-06](#adm-06) | Medium | Security | 1 | Deactivating a clinic does not end existing sessions |
| [ENG-03](#eng-03) | Medium | Correctness | 2 | Greedy lets optional slots on critical holiday days go over the holiday cap |
| [ENG-04](#eng-04) | Medium | Correctness | 2 | Schedule-service eligibility and plan validation re-implement blockingRule with different holiday rules |
| [SCH-03](#sch-03) | Medium | Correctness | 2 | Duty edit validation runs before the schedule lock (races on cap, back-to-back, slots, holiday and open caps); reassign/remove log changes that didn't happen |
| [SCH-04](#sch-04) | Medium | Maintainability | 2 | Hard rules are implemented three times and have already diverged |
| [SCH-09](#sch-09) | Medium | Test gap | 2 | Test gaps: manual-edit rules and the month boundary have no tests |
| [ENG-02](#eng-02) | Medium | Correctness | 3 | A time-limited later stage replaces a better earlier solution without comparing them |
| [ADM-05](#adm-05) | Medium | Bug | 4 | `POST /unavailability` and `PUT /holidays/month` never validate the `clinicId` query parameter |
| [ADM-07](#adm-07) | Medium | Security | 5 | The deployment-wide open-duty interval can be changed by any clinic's administrator |
| [RPT-01](#rpt-01) | Medium | Correctness | 5 | Hospital-wide settings events still never show in the activity log (rest of ADM-04) |
| [RPT-02](#rpt-02) | Medium | Bug | 5 | Billing update and its audit row are not atomic; same pattern in settings and changePassword |
| [RPT-03](#rpt-03) | Medium | Test gap | 5 | Billing lock tests check a JS re-implementation, not the SQL |
| [ADM-04](#adm-04) | Medium | Correctness | 6 | `/users` PATCH and DELETE on doctor accounts skip doctor rules: no draft-duty check, and audit entries are `user.*` (ADM-07 API side) |
| [ADM-08](#adm-08) | Medium | Security | 6 | Production `initialize.sql` creates `admin@oncall.local` with the public password `changeme123`, and nothing forces a change (ADM-01 carry-over, API side) |
| [SCH-06](#sch-06) | Medium | Simplification | 8 | `POST /schedules` without `assignments` still runs a fresh solve and saves it, bypassing the options flow |
| [SCH-07](#sch-07) | Medium | Correctness | 8 | `POST /schedules/preview` with a plan returns `conflicts: []` and validates nothing; the endpoint has no web consumer |
| [SCH-05](#sch-05) | Medium | Simplification | 9 | `getById` repeats `eligibilityFor`/`buildDutyMaps` line for line |
| [SCH-08](#sch-08) | Medium | Maintainability | 10 | `schedule.service.ts` (1251 lines) mixes five concerns; split it |
| [CORE-03](#core-03) | Medium | Test gap | 11 | Refresh, logout and change-password have no route tests; one test only checks the bcrypt library |
| [CORE-07](#core-07) | Low | Correctness | 1 | changePassword updates the password and revokes sessions outside one transaction |
| [ADM-09](#adm-09) | Low | Security | 1 | Deactivation does not revoke refresh tokens, so reactivating an account revives old sessions |
| [ADM-10](#adm-10) | Low | Bug | 1 | A superadmin moving a user to `manager`/`superadmin` with a `clinicId` gets 500 |
| [ENG-07](#eng-07) | Low | Simplification | 2 | Constraint helpers return reason strings nobody reads, and `isAvailable` has an unused parameter |
| [CORE-05](#core-05) | Low | Bug | 3 | Every 429 sends `Retry-After: 10`, including 15-minute rate-limit windows |
| [ENG-05](#eng-05) | Low | Correctness | 3 | A failed alternative solve looks like "no more equally good options" |
| [ENG-11](#eng-11) | Low | Correctness | 3 | Repeat-weekday note can land on the first duty of that weekday |
| [SCH-10](#sch-10) | Low | Bug | 3 | Two concurrent requests for the same alternative solve twice and store a misnumbered option |
| [SCH-11](#sch-11) | Low | Correctness | 3 | The fixed `Retry-After: 10` and its comment don't match the solver budget |
| [SCH-12](#sch-12) | Low | Bug | 3 | The publish activity log's `dutyCount` holds the number of covered days, not duties |
| [CORE-04](#core-04) | Low | Bug | 4 | Numeric ids above the integer range return 500 instead of 400 |
| [CORE-12](#core-12) | Low | Simplification | 4 | `validators/` only re-exports shared schemas; the three local schemas belong in `@oncall/shared` |
| [CORE-13](#core-13) | Low | Simplification | 4 | Zod failures are mapped in two places, and the errorHandler branch is never reached |
| [CORE-14](#core-14) | Low | Dead code | 4 | `fail()` is unused while the error envelope is written out by hand six times |
| [ADM-12](#adm-12) | Low | Bug | 4 | Two concurrent `PUT /holidays/month` for the same month merge both sets instead of keeping the last one |
| [RPT-07](#rpt-07) | Low | Correctness | 4 | Activity filter accepts from > to and silently returns an empty page |
| [RPT-15](#rpt-15) | Low | Maintainability | 4 | Billing and usage routes import validators from other domains' files |
| [ADM-17](#adm-17) | Low | Maintainability | 5 | Settings changes and their audit rows are written in separate transactions |
| [RPT-05](#rpt-05) | Low | Bug | 5 | Resolving an alert that is already resolved returns 409 instead of being idempotent |
| [RPT-06](#rpt-06) | Low | Correctness | 5 | Clinic create/update/deactivate and alert resolution are not audited |
| [RPT-13](#rpt-13) | Low | Test gap | 5 | Alert resolve/list and generation overlap have no tests |
| [RPT-14](#rpt-14) | Low | Simplification | 5 | isLocked duplicates getState's SQL |
| [CORE-08](#core-08) | Low | Correctness | 6 | Email login is case-sensitive |
| [ADM-11](#adm-11) | Low | Correctness | 6 | `PATCH /users/me/theme` and `/me/language` return `clinicName: null` for clinic users |
| [ADM-13](#adm-13) | Low | Correctness | 6 | Unavailability edits on a soft-deleted doctor commit and then return 404 |
| [ADM-14](#adm-14) | Low | Correctness | 6 | Holiday, unavailability and max-duty changes for months that already have schedules are accepted without any warning |
| [ADM-15](#adm-15) | Low | Dead code | 6 | The hospital-role filter in `user.list` never filters anything |
| [RPT-04](#rpt-04) | Low | Correctness | 7 | Workload drops duties of doctors moved to another clinic; doctor dashboard mixes clinics |
| [RPT-08](#rpt-08) | Low | Correctness | 7 | "Today" and the default month are UTC calendar days, not the hospital's local day |
| [RPT-09](#rpt-09) | Low | Simplification | 7 | monthlyReport passes `actor` only for an unreachable check and reads the schedule twice |
| [RPT-10](#rpt-10) | Low | Dead code | 7 | MonthlyReport.clinicName is unused and duplicates schedule.clinicName |
| [RPT-11](#rpt-11) | Low | Simplification | 7 | Identical stats/report query schemas and a duplicated default-month step in two controllers |
| [SCH-13](#sch-13) | Low | Correctness | 8 | Manager sees drafts in the list but gets 403 on `GET /schedules/:id` |
| [SCH-14](#sch-14) | Low | Security | 8 | Optional `actor`/`scope` parameters silently skip authorization |
| [SCH-16](#sch-16) | Low | Performance | 8 | Saving a draft inserts duties one row at a time |
| [SCH-19](#sch-19) | Low | Maintainability | 8 | `docs/database.md` describes `duties.reason` as the engine's text only |
| [CORE-18](#core-18) | Low | Simplification | 9 | `ClinicScope.kind` is a one-value tag that nothing reads |
| [CORE-19](#core-19) | Low | Maintainability | 9 | The request-actor type is declared eight times |
| [CORE-20](#core-20) | Low | Simplification | 9 | auth.service has three finders that differ only in the WHERE column |
| [CORE-21](#core-21) | Low | Simplification | 9 | The role list and the token-issue helper are duplicated |
| [ENG-06](#eng-06) | Low | Dead code | 9 | `ConflictTally.atHolidayCap` is always 0 |
| [ENG-08](#eng-08) | Low | Dead code | 9 | Dead fields and re-exports in the scheduling module |
| [ENG-09](#eng-09) | Low | Maintainability | 9 | Local `AssignmentPlan` duplicates the `@oncall/shared` type |
| [ENG-10](#eng-10) | Low | Simplification | 9 | Duplicated budget and day-classification helpers between greedy, model and service |
| [SCH-15](#sch-15) | Low | Dead code | 9 | Dead exports, redundant parameters and redundant queries |
| [ADM-16](#adm-16) | Low | Simplification | 9 | The same account-CRUD code is copied across `doctor.service` and `user.service` |
| [CORE-22](#core-22) | Low | Maintainability | 11 | Live-DB test helpers reverse the DATABASE_URL precedence |
| [ENG-13](#eng-13) | Low | Test gap | 11 | Untested date helpers |
| [ENG-14](#eng-14) | Low | Test gap | 11 | solver-model tests pin LP text formatting |
| [SCH-17](#sch-17) | Low | Test gap | 11 | Low-value tests: mock echoes and SQL-substring pins |
| [ADM-18](#adm-18) | Low | Test gap | 11 | Several tests assert nothing useful or duplicate other tests |
| [ADM-19](#adm-19) | Low | Test gap | 11 | Key admin rules have no tests |
| [RPT-12](#rpt-12) | Low | Test gap | 11 | Tests that cannot catch consumer-visible bugs |
| [CORE-06](#core-06) | Low | Config | 12 | The env schema accepts values that only fail later, at runtime |
| [CORE-09](#core-09) | Low | Security | 12 | The API container runs as root |
| [CORE-10](#core-10) | Low | Config | 12 | SIGTERM is not handled, so every container stop waits 10 s and ends in SIGKILL |
| [CORE-11](#core-11) | Low | Config | 12 | `trust proxy` is hard-coded to one hop |
| [CORE-15](#core-15) | Low | Maintainability | 12 | `@types/express` 5 is paired with the Express 4 runtime |
| [CORE-16](#core-16) | Low | Dead code | 12 | `@oncall/utils` is an unused API dependency |
| [CORE-17](#core-17) | Low | Dead code | 12 | The API `build`/`start` scripts produce output that nothing runs |
| [CORE-23](#core-23) | Low | Maintainability | 13 | Non-ASCII characters in comments |
| [CORE-24](#core-24) | Low | Maintainability | 13 | AGENTS.md disagrees with the code on roles and the validation status code |
| [ENG-12](#eng-12) | Low | Maintainability | 13 | Misleading or stale comments and non-ASCII characters |
| [SCH-18](#sch-18) | Low | Maintainability | 13 | Non-ASCII characters and stray indentation in `schedule.service.ts` |
| [ADM-20](#adm-20) | Low | Maintainability | 13 | Non-ASCII characters in code comments |
| [RPT-16](#rpt-16) | Low | Maintainability | 13 | docs/database.md leaves `currentDoctors` out of the disjoint_regeneration detail |
| [RPT-17](#rpt-17) | Low | Maintainability | 13 | Non-ASCII characters in code and tests |

## Decisions needed from the user

| ID | Batch | Question |
|---|---|---|
| SCH-04 | 2 | should manual edits get the same "over-cap holiday duty allowed when the day is at its minimum" relaxation that plan saves already get? |
| ENG-05 | 3 | should an alternative-solve failure reach the web app as an error (retry possible), or stay a silent "no more options"? |
| ADM-07 | 5 | Is the open on-call cycle a hospital-wide fact (restrict the write to hospital roles) or per clinic (new `clinics` column plus a `schema.sql`/`docs/database.md` update)? |
| RPT-01 | 5 | Should hospital-wide events (billing deadline, global open-duty interval) appear in every clinic's activity view? The other option is to drop `billing.updated` from the filterable actions and accept that billing changes are never visible. |
| RPT-05 | 5 | Is dropping the 409 for an already-resolved alert acceptable to the web? (UsagePage just reloads, so no web change is needed.) |
| RPT-06 | 5 | Should clinic lifecycle events (and operator-alert resolution) be part of the audit trail? This adds new actions to the web filter. |
| CORE-08 | 6 | should email be case-insensitive? Existing accounts that differ only in case would block the new unique index and need a manual merge. |
| ADM-02 | 6 | Should `/users` refuse doctor creation and role changes across the doctor boundary (recommended), or create/remove the `doctors` row inside the same transaction? |
| ADM-04 | 6 | Should doctor accounts be rejected on `/users` (recommended; the web already complies), or should `user.service` delegate to `doctorService` internally? |
| ADM-08 | 6 | Is a forced-change flag (schema change) in scope, or only removing the known hash from `initialize.sql`? |
| ADM-14 | 6 | Should holiday, unavailability and `maxMonthlyDuties` changes that conflict with an existing draft or published schedule be refused (409), warned about, or allowed silently as now? |
| RPT-08 | 7 | Should server-side "today" and the activity date range follow the hospital timezone instead of UTC? |
| SCH-06 | 8 | drop engine-only saves via `POST /schedules`? This changes the API contract for any non-web client. |
| SCH-07 | 8 | keep preview, and if so, with real plan validation, or retire it in favour of `/schedules/options`? |
| SCH-13 | 8 | may a manager read draft schedules, and should they get eligibility data? |
| ENG-06 | 9 | drop the field from the shared API contract and the UI text? |
| CORE-24 | 13 | confirm 400 is the intended status for validation errors, rather than moving the API and web to 422. |

## Implementation order

Batches group findings that touch the same files, so each file is edited in as few passes as possible. Security and hard scheduling rules come first; pure refactors, tests and cleanup come last so they do not conflict with behaviour fixes.

### Batch 1: Security: accounts and sessions

- Findings, in order: [CORE-01](#core-01), [ADM-01](#adm-01), [ADM-03](#adm-03), [ADM-10](#adm-10), [ADM-09](#adm-09), [CORE-02](#core-02), [ADM-06](#adm-06), [CORE-07](#core-07).
- Files: `middleware/request-logger.ts`, `services/user.service.ts`, `services/doctor.service.ts`, `services/auth.service.ts`, `services/token.service.ts`, `services/clinic.service.ts`, matching tests.
- Notes: Do ADM-01 first (Critical). ADM-01, ADM-03 and ADM-10 all edit `user.service.update`; do them in one pass. CORE-07 adds an optional `client` to `revokeAllForUser`; ADM-09 and CORE-02 then use it.

### Batch 2: Scheduling hard rules

- Findings, in order: [ENG-03](#eng-03), [ENG-07](#eng-07), [SCH-04](#sch-04) (needs decision), [ENG-04](#eng-04), [SCH-01](#sch-01), [SCH-02](#sch-02), [ENG-01](#eng-01), [SCH-03](#sch-03), [SCH-09](#sch-09).
- Files: `scheduling/constraints.ts`, `conflicts.ts`, `engine.ts`, `solver-model.ts`, `types.ts`, `services/schedule.service.ts`, `scheduling/__tests__/*`, `__tests__/schedule.service.test.ts`.
- Notes: ENG-03 adds `holidayCapAllows`; ENG-07 changes the helper signatures; SCH-04 + ENG-04 build the one pure checker on top. SCH-01 is then a test case of the checker. SCH-02 + ENG-01 add `nextDayDoctorIds`. SCH-03 moves validation under the row lock. SCH-09 lists the tests for this batch.

### Batch 3: Solver and options robustness

- Findings, in order: [ENG-02](#eng-02), [ENG-11](#eng-11), [ENG-05](#eng-05) (needs decision), [SCH-10](#sch-10), [CORE-05](#core-05), [SCH-11](#sch-11), [SCH-12](#sch-12).
- Files: `scheduling/solver.ts`, `solver-model.ts`, `services/schedule.service.ts` (options and publish parts), `lib/http-error.ts`, `middleware/error-handler.ts`, `middleware/rate-limit.ts`, matching tests.
- Notes: ENG-05 needs a decision; skip it if none.

### Batch 4: Validation and request plumbing

- Findings, in order: [CORE-04](#core-04), [CORE-12](#core-12), [RPT-15](#rpt-15), [CORE-13](#core-13), [CORE-14](#core-14), [ADM-05](#adm-05), [ADM-12](#adm-12), [RPT-07](#rpt-07).
- Files: `packages/shared/src/schemas/*`, every `routes/*.routes.ts`, `apps/api/src/validators/` (deleted), `middleware/validate.ts`, `middleware/error-handler.ts`, `middleware/not-found.ts`, `services/holiday.service.ts`, controllers that name old schemas.
- Notes: CORE-04 and CORE-12 ship together (both add `idSchema`). ADM-05 uses the new `clinicQuerySchema`. ADM-12 shares the clinic `FOR UPDATE` lookup with ADM-05.

### Batch 5: Audit trail and atomic writes

- Findings, in order: [RPT-02](#rpt-02), [ADM-17](#adm-17), [RPT-14](#rpt-14), [RPT-03](#rpt-03), [RPT-01](#rpt-01) (needs decision), [ADM-07](#adm-07) (needs decision), [RPT-06](#rpt-06) (needs decision), [RPT-05](#rpt-05) (needs decision), [RPT-13](#rpt-13).
- Files: `services/billing.service.ts`, `settings.service.ts`, `activity.service.ts`, `clinic.service.ts`, `usage.service.ts`, `routes/settings.routes.ts`, `packages/shared/src/schemas/audit.ts`, `docs/database.md` (note only), `apps/web/src/pages/ActivityPage.vue` (RPT-01 only).
- Notes: RPT-02 first (transactions), then RPT-14 and RPT-03 (billing tests). RPT-01 and ADM-07 are one decision about the global open-duty setting; decide them together. RPT-05 tests are part of RPT-13.

### Batch 6: User and doctor account boundaries

- Findings, in order: [ADM-02](#adm-02) (needs decision), [ADM-04](#adm-04) (needs decision), [ADM-11](#adm-11), [ADM-15](#adm-15), [ADM-13](#adm-13), [CORE-08](#core-08) (needs decision), [ADM-08](#adm-08) (needs decision), [ADM-14](#adm-14) (needs decision).
- Files: `services/user.service.ts`, `controllers/user.controller.ts`, `services/unavailability.service.ts`, `services/auth.service.ts`, `database/schema.sql`, `database/initialize.sql`, `docs/database.md`, shared auth schemas.
- Notes: ADM-11, ADM-15 and ADM-13 need no decision. ADM-02, ADM-04, CORE-08, ADM-08 and ADM-14 need one; skip each until it is decided. CORE-08 and ADM-08 (flag option) change `schema.sql` and `docs/database.md` together.

### Batch 7: Stats and reports

- Findings, in order: [RPT-11](#rpt-11), [RPT-04](#rpt-04), [RPT-08](#rpt-08) (needs decision), [RPT-09](#rpt-09), [RPT-10](#rpt-10).
- Files: `services/stats.service.ts`, `services/reports.service.ts`, `controllers/stats.controller.ts`, `controllers/reports.controller.ts`, `packages/shared/src/schemas/{stats,reports}.ts`, `packages/shared/src/types/{stats,reports}.ts`, `config/env.ts` (RPT-08), matching tests.
- Notes: RPT-11 first (moves the default month into the service), then RPT-08 (needs a decision). RPT-09 and RPT-10 both edit `reports.service.test.ts`.

### Batch 8: Schedule API surface

- Findings, in order: [SCH-06](#sch-06) (needs decision), [SCH-07](#sch-07) (needs decision), [SCH-13](#sch-13) (needs decision), [SCH-14](#sch-14), [SCH-19](#sch-19), [SCH-16](#sch-16).
- Files: `services/schedule.service.ts` (generate, preview, list, getById), `packages/shared/src/schemas/schedule.ts`, `routes/schedule.routes.ts`, `docs/database.md`, matching tests.
- Notes: SCH-06 and SCH-07 both edit `generateScheduleSchema`; decide them together. SCH-19 goes with SCH-06. SCH-16 is skipped (tracked as QRY-02).

### Batch 9: Simplification and dead code

- Findings, in order: [SCH-05](#sch-05), [SCH-15](#sch-15), [ENG-06](#eng-06) (needs decision), [ENG-08](#eng-08), [ENG-09](#eng-09), [ENG-10](#eng-10), [ADM-16](#adm-16), [CORE-18](#core-18), [CORE-19](#core-19), [CORE-20](#core-20), [CORE-21](#core-21).
- Files: `services/schedule.service.ts`, `scheduling/*`, `services/doctor.service.ts`, `services/user.service.ts`, new `services/account.ts`, `lib/scope.ts`, `lib/jwt.ts`, `types/express.d.ts`, `services/auth.service.ts`, `services/token.service.ts`, `packages/shared/src/types/*`, about 15 test files (CORE-18).
- Notes: No behaviour change except ENG-06 (needs a decision; it also edits `apps/web` locales). Existing tests must stay green.

### Batch 10: Split schedule.service.ts

- Findings, in order: [SCH-08](#sch-08).
- Files: `services/schedule.service.ts` into the modules listed in SCH-08, `controllers/schedule.controller.ts`, `__tests__/schedule.service.test.ts` (split the same way).
- Notes: Do this after batches 2, 3, 8 and 9 so the move carries no behaviour change.

### Batch 11: Test quality

- Findings, in order: [CORE-03](#core-03), [CORE-22](#core-22), [SCH-17](#sch-17), [RPT-12](#rpt-12), [ADM-18](#adm-18), [ADM-19](#adm-19), [ENG-13](#eng-13), [ENG-14](#eng-14).
- Files: `apps/api/src/__tests__/*`, `apps/api/src/scheduling/__tests__/*`, `apps/api/vitest.config.ts`.
- Notes: Tests already listed inside other findings belong to those batches. Here, add only what is still missing and delete the low-value tests.

### Batch 12: Runtime, config and dependencies

- Findings, in order: [CORE-06](#core-06), [CORE-11](#core-11), [CORE-10](#core-10), [CORE-09](#core-09), [CORE-15](#core-15), [CORE-16](#core-16), [CORE-17](#core-17).
- Files: `config/env.ts`, `app.ts`, `server.ts`, `apps/api/Dockerfile`, `apps/api/package.json`, `apps/api/tsconfig.json`, `pnpm-lock.yaml`, `render.env.example`, `AGENTS.md`/README rows for `pnpm build` (CORE-17).
- Notes: CORE-06 and CORE-11 share `env.test.ts`. CORE-09 goes with INF-05 in the low-resource plan if that batch runs first. Do not change GitHub Action versions or lint rules.

### Batch 13: Docs and ASCII cleanup

- Findings, in order: [CORE-24](#core-24) (needs decision), [RPT-16](#rpt-16), [ENG-12](#eng-12), [SCH-18](#sch-18), [RPT-17](#rpt-17), [ADM-20](#adm-20), [CORE-23](#core-23).
- Files: `AGENTS.md`, `docs/database.md`, and the comments listed in each finding (many files).
- Notes: Run last: earlier batches rewrite many of these lines. Before starting, find what is left with `git grep -nP "[^\x00-\x7F]" -- apps/api`. CORE-24 needs a decision on 400 vs 422.

## Cross-batch dependencies

- **Batch 2 before 8, 9 and 10:** the shared pure checker (SCH-04) and `nextDayDoctorIds` (SCH-02 + ENG-01) change the functions that SCH-05, SCH-15 and the SCH-08 split move around.
- **Batch 4 before 6 and 9:** CORE-12 deletes `validators/` and adds `clinicQuerySchema`/`idParamsSchema`; ADM-16 and later route edits import from `@oncall/shared` directly.
- **Batch 1 CORE-07 before batch 5 RPT-02:** both wrap password and audit writes in transactions; RPT-02 must not redo `changePassword`.
- **Batch 3 CORE-05 and batch 9 SCH-15** both edit `gated()` in `schedule.service.ts`.
- **Batch 5 RPT-06** adds `clinic.*` actions to `ACTIVITY_ACTIONS`; the web activity filter and locales must follow (web change, same commit).
- **Batch 9 ENG-06 and batch 5 RPT-01** change shared contracts used by `apps/web`; update the web callers and their tests in the same change.
- **Low-resource plan overlap:** if its Batch 2 (solver) or Batch 4 (pool, settings cache) runs first, re-check SCH-03, SCH-10, RPT-02 and RPT-14 line numbers; the fixes still apply.

## A. Core: app, config, middleware, lib, auth, build

<a id="core-01"></a>
### CORE-01 - The raw refresh token is written to the request log in plaintext
- Batch: 1
- Severity: High
- Category: Security
- Location: `apps/api/src/middleware/request-logger.ts:4-10` (related `apps/api/src/controllers/auth.controller.ts:21-23`, `apps/api/src/logger.ts:4-7`)
- Problem: pino-http logs every response at `info` level using the default `res` serializer. That serializer (pino-std-serializers 7.1.0 `lib/res.js`) sets `_res.headers = res.getHeaders()`, so all response headers go into the log. The redact list only covers request headers (`req.headers.authorization`, `req.headers.cookie`). As a result, the `Set-Cookie: refresh_token=<raw token>` header from `POST /auth/login` and every `POST /auth/refresh` ends up in stdout, which is also the Docker json-file log. I ran a reproduction with the same `pinoHttp` options and the log line contained `"res":{"statusCode":200,"headers":{"set-cookie":"refresh_token=SECRET123; Path=/; HttpOnly",...}}`. Anyone who can read the logs (`docker logs`, log shipping, a support bundle) can replay that cookie on `/auth/refresh` and get access tokens for the user until the session deadline. This defeats both the httpOnly cookie and the hashed-at-rest storage.
- Fix: add `'res.headers["set-cookie"]'` to `redact.paths` in `request-logger.ts`. Add `src/__tests__/request-logger.test.ts`:
  - Use `vi.hoisted` to create a `lines: string[]` buffer, then `vi.mock('../logger.ts', ...)` to return `pino({ level: 'info' }, { write: (s) => lines.push(s) })`.
  - Mount `requestLogger` on an express app with a route that calls `res.cookie('refresh_token', 'SECRET')`.
  - Send a request with `Authorization: Bearer XYZ` and assert that no captured line contains `SECRET` or `XYZ`.
- Confidence: High - I read the serializer source in node_modules and ran the reproduction script against the installed express, pino and pino-http.

<a id="core-02"></a>
### CORE-02 - Refresh keeps sessions in a deactivated clinic alive
- Batch: 1
- Severity: Medium
- Category: Security
- Location: `apps/api/src/services/auth.service.ts:107-119` (login check at `:89`; related `apps/api/src/services/clinic.service.ts:66-74`, `apps/api/src/middleware/authenticate.ts:22-24`)
- Problem: `login` rejects `clinic_is_active === false` with 403 "Clinic is deactivated" (D10). `refresh` only checks `is_active` and the billing lock, even though `USER_COLUMNS` already selects `clinic_is_active`. Deactivating a clinic (`clinic.service.ts` UPDATE `is_active`) revokes no tokens, and `authenticate` never looks at the clinic. So after a manager or superadmin deactivates a clinic, its administrators and doctors keep refreshing and using the API until the absolute refresh deadline. That is 1h by default, and 12h if AUTH-01 from the low-resource plan is adopted.
- Fix: in `refresh()`, right after the `is_active` check, add `if (row.clinic_is_active === false) throw new HttpError(403, 'Clinic is deactivated')`. Outstanding access tokens then expire within 15 minutes. Test in `auth.service.test.ts`: `refresh('old')` with `userRow({ clinic_is_active: false })` rejects with `{ status: 403, message: 'Clinic is deactivated' }`.
- Confidence: High - read `auth.service.ts`, `clinic.service.ts` update SQL and `authenticate.ts`; grep shows no token revocation in clinic.service.
- **Merge note:** ADM-06 is the same defect. Its optional extra (revoke refresh tokens in `clinic.update` when `isActive` becomes false) is part of this fix.

<a id="core-03"></a>
### CORE-03 - Refresh, logout and change-password have no route tests; one test only checks the bcrypt library
- Batch: 11
- Severity: Medium
- Category: Test gap
- Location: `apps/api/src/__tests__/auth.routes.test.ts:52-180`; behaviour in `apps/api/src/controllers/auth.controller.ts:10-30,42-64`
- Problem: the route tests cover login, `/me` returning 401, and the lock scenarios. The following behaviour, which the web app depends on, has no test:
  - **Refresh success:** a successful `POST /auth/refresh` sets a new cookie with `Path=/auth`. nginx `proxy_cookie_path /auth /api/auth` only works with that exact path.
  - **Refresh without a cookie:** returns 401 and clears the cookie.
  - **Logout:** `POST /auth/logout` returns 204 and really expires the cookie. Removing `maxAge` in `clearRefreshCookie` (`:25-30`) was a bugfix with no test; with `maxAge` left in, Express 4 sends a future Expires date.
  - **Change-password:** a wrong current password returns 400 (the carried-over item, today only tested at the service level), and a request without a bearer token returns 401.

  Separately, `describe('bcrypt sanity')` (`:88-92`) only checks `bcrypt.compare` against a constant defined in the test file. The 200 login test already proves the same thing.
- Fix: in `auth.routes.test.ts`, reuse the `installDb` pattern:
  - refresh with a cookie: 200, `set-cookie` contains `refresh_token=`, `Path=/auth`, `HttpOnly`, `SameSite=Lax`.
  - refresh without a cookie: 401, and `set-cookie` contains `Expires=Thu, 01 Jan 1970`.
  - logout with a cookie: 204, plus the same expired `set-cookie`.
  - change-password with a valid bearer token and wrong current password (real bcrypt against `SEED_HASH`): 400 with `{ success: false, error: 'Current password is incorrect' }`.
  - change-password without a bearer token: 401.
  - Delete the `bcrypt sanity` block.
- Confidence: High - read all of auth.routes.test.ts; grep for `logout`, `1970` and `change-password` in `__tests__` finds no route coverage.

<a id="core-04"></a>
### CORE-04 - Numeric ids above the integer range return 500 instead of 400
- Batch: 4
- Severity: Low
- Category: Bug
- Location: `apps/api/src/validators/user.ts:12-16`, `apps/api/src/validators/doctor.ts:6-8`; shared `clinicId`/`doctorId`/`userId` query fields in `packages/shared/src/schemas/{audit,holiday,reports,schedule,settings,stats,unavailability}.ts`
- Problem: `z.coerce.number().int().positive()` has no upper bound. Requests like `GET /doctors/3000000000` or `GET /users?clinicId=3000000000` pass validation. Postgres then rejects the parameter for the INTEGER id column with error 22003 (out of range). `errorHandler` only maps 23505, so the client gets 500 "Internal server error" and an error-level log entry, instead of 400.
- Fix: add `export const idSchema = z.coerce.number().int().positive().max(2_147_483_647)` to `packages/shared/src/schemas/common.ts` and use it for `idParams`, the clinic query schema (see CORE-12) and every id query field listed above. Tests:
  - `packages/shared/src/__tests__/schemas.test.ts`: `idSchema.safeParse('2147483648')` fails and `'5'` passes.
  - `doctor.routes.test.ts`: `GET /doctors/2147483648` returns 400.
- Confidence: High - ids are `INTEGER GENERATED ALWAYS AS IDENTITY` in schema.sql, and errorHandler has no 22003 mapping.

<a id="core-05"></a>
### CORE-05 - Every 429 sends `Retry-After: 10`, including 15-minute rate-limit windows
- Batch: 3
- Severity: Low
- Category: Bug
- Location: `apps/api/src/middleware/error-handler.ts:6-7,20`, `apps/api/src/middleware/rate-limit.ts:43`, `apps/api/src/lib/http-error.ts` (related `apps/api/src/services/schedule.service.ts:463-469`)
- Problem: `errorHandler` sets a fixed `Retry-After: 10` on every `HttpError` with status 429. The constant was meant for "Solver busy". When the login limiter (15-minute window, `auth.routes.ts:12-21`) or the refresh limiter trips, clients are told to retry after 10 seconds and keep getting 429 for up to 15 minutes.
- Fix:
  - Give `HttpError` an optional `retryAfterSeconds` field. Assign it explicitly in the constructor, because `erasableSyntaxOnly` forbids parameter properties.
  - In `errorHandler`, set the header only when the field is present, then delete `RETRY_AFTER_SECONDS`.
  - In `rateLimit`, throw `new HttpError(429, msg, Math.ceil((entry.resetAt - now) / 1000))`.
  - In `schedule.service.ts` `gated()`, pass `10`.
  - Tests: `rate-limit.test.ts` asserts the thrown error has `retryAfterSeconds` 60 for `windowMs: 60_000`. Update the `schedule.routes.test.ts:144,181` mocks to `new HttpError(429, 'Solver busy, try again shortly', 10)` and keep the `'10'` header assertions.
- Confidence: High - read errorHandler, rateLimit and all 429 producers (grep).
- **Merge note:** SCH-11 is the same defect from the solver side. Use `retryAfterSeconds` for both. For "Solver busy" use a value that matches the solver budget (SCH-11), not 10.

<a id="core-06"></a>
### CORE-06 - The env schema accepts values that only fail later, at runtime
- Batch: 12
- Severity: Low
- Category: Config
- Location: `apps/api/src/config/env.ts:13-16,21-24`
- Problem: three variables are validated too loosely:
  - **`JWT_ACCESS_EXPIRES_IN`** accepts any string. A value like `15 minutes` passes, and then every `signAccessToken` call throws, so every login and refresh returns 500. I checked that jsonwebtoken 9.0.3 throws `"expiresIn" should be a number of seconds or string representing a timespan`.
  - **`LOG_LEVEL`** accepts any string. pino then throws at import time instead of the env error message.
  - **`COOKIE_SECURE`** treats anything other than exactly `true` (for example `TRUE` or `1`) as false. The refresh cookie then loses the Secure flag on an HTTPS deployment.
- Fix:
  - `JWT_ACCESS_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default('15m')`
  - `LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info')`
  - `COOKIE_SECURE: z.enum(['true','false']).optional().transform(...)`
  - Export the schema as `envSchema` and add `src/__tests__/env.test.ts` asserting that each bad value makes `safeParse` fail.
- Confidence: High - read env.ts; ran jsonwebtoken with an invalid `expiresIn`.

<a id="core-07"></a>
### CORE-07 - changePassword updates the password and revokes sessions outside one transaction
- Batch: 1
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/services/auth.service.ts:149-153` (same pattern in `user.service.ts` `resetPassword` around `:370-378` and `doctor.service.ts:283`)
- Problem: the `UPDATE users SET password_hash` runs on its own, and `revokeAllForUser` runs afterwards. If the revoke fails (a DB error), the caller gets 500 but the new password is already committed and the other sessions stay valid, even though revoking them is why users change passwords. A retry then fails with "Current password is incorrect".
- Fix: run the UPDATE and the revoke inside `withTransaction`. Let `revokeAllForUser(userId, client?: PoolClient)` use `client` when it is given, otherwise the module `query`. Keep `logActivity` after the transaction. Apply the same change to `resetPassword`. Test in `auth.service.test.ts`: mock `withTransaction` to record BEGIN/ROLLBACK and make the revoke reject; assert that `changePassword` rejects and the update ran through the transaction client.
- Confidence: Medium - read the code; impact needs a DB failure between the two statements.

<a id="core-08"></a>
### CORE-08 - Email login is case-sensitive
- Batch: 6
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/services/auth.service.ts:52-58,80-82`; `database/schema.sql:231-232`; `packages/shared/src/schemas/auth.ts` (`createUserSchema.email`, `loginSchema`)
- Problem: emails are stored exactly as typed. Lookup is `u.email = $1` and the unique index is on the raw value. A user created as `Maria.P@hospital.gr` who types `maria.p@hospital.gr` gets 401 "Invalid credentials". Two live accounts that differ only in letter case can also exist side by side. No `toLowerCase`/`lower(` exists anywhere in api or shared.
- Fix:
  - In the shared schemas, apply `.trim().toLowerCase()` to user and doctor email fields, and to `identifier` when it contains `@`.
  - Make the lookup `lower(u.email) = lower($1)`.
  - In schema.sql, normalise existing rows with `UPDATE users SET email = lower(email) WHERE email <> lower(email)` and replace `idx_users_email_live` with `ON users (lower(email)) WHERE is_deleted = FALSE`. Update `docs/database.md` in the same change.
  - Tests: a login with a mixed-case identifier finds the user; a shared schema test checks the lowercasing.
- Confidence: High - read the queries, the indexes and the shared schemas.
- Needs decision: should email be case-insensitive? Existing accounts that differ only in case would block the new unique index and need a manual merge.

<a id="core-09"></a>
### CORE-09 - The API container runs as root
- Batch: 12
- Severity: Low
- Category: Security
- Location: `apps/api/Dockerfile:43-46`
- Problem: the image has no `USER` line, so the API process runs as root inside the container. The process only reads source files and listens on port 3000, so it does not need root. `node:24-slim` already includes a `node` user.
- Fix: add `USER node` before `CMD`. Do it as part of the INF-05 multi-stage rewrite.
- Confidence: High - read the Dockerfile.

<a id="core-10"></a>
### CORE-10 - SIGTERM is not handled, so every container stop waits 10 s and ends in SIGKILL
- Batch: 12
- Severity: Low
- Category: Config
- Location: `apps/api/src/server.ts:6-8`, `docker-compose.yml:39-68`
- Problem: `CMD ["node", "src/server.ts"]` makes Node PID 1, and `server.ts` registers no signal handlers. PID 1 ignores signals whose default action is "terminate", so `docker compose stop` or `up` waits out the grace period and then SIGKILLs. That cuts in-flight requests, including a running solve, without draining them. [INFERENCE] This is standard Docker/Linux behaviour; I did not run it.
- Fix: in `server.ts`, keep the server handle: `const server = app.listen(...)`. Add `for (const sig of ['SIGTERM','SIGINT']) process.once(sig, () => server.close(() => void pool.end().finally(() => process.exit(0))))`. Optionally add `init: true` to the compose `api` service. Manual check: `docker compose stop api` returns in under 2 s.
- Confidence: Medium.

<a id="core-11"></a>
### CORE-11 - `trust proxy` is hard-coded to one hop
- Batch: 12
- Severity: Low
- Category: Config
- Location: `apps/api/src/app.ts:25-27` (related `render.env.example`)
- Problem: one hop is correct for compose (browser -> nginx -> api). The Render setup described in `render.env.example` adds an edge proxy in front of the web nginx. [INFERENCE] There, `req.ip` would become the Render edge address. The IP-keyed refresh limiter (60 per 15 min, `auth.routes.ts:22`) would then be shared by all users, and the login limiter would effectively be per identifier only.
- Fix: add `TRUST_PROXY: z.coerce.number().int().min(0).default(1)` to env.ts and use `app.set('trust proxy', env.TRUST_PROXY)`. Document `TRUST_PROXY=2` in `render.env.example` once verified. Cover it with the env schema test from CORE-06.
- Confidence: Low - not verified against Render's actual forwarding headers.

<a id="core-12"></a>
### CORE-12 - `validators/` only re-exports shared schemas; the three local schemas belong in `@oncall/shared`
- Batch: 4
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/validators/*.ts` (12 files); importers in `apps/api/src/routes/*.routes.ts`; `packages/shared/src/schemas/settings.ts:26-28`
- Problem: the folder is not needed:
  - 9 of the 12 files are pure re-exports from `@oncall/shared`.
  - `index.ts` re-exports 6 of the 11 modules and is imported only by `clinic.routes.ts:6`.
  - `billing.routes.ts:6` gets `updateBillingSchema` from `validators/settings.ts`.
  - `idParams` is re-exported through doctor, schedule and unavailability.

  The only real code is `idParams`, `userQuerySchema` (`user.ts:12-16`) and `doctorQuerySchema` (`doctor.ts:6-8`). The two query schemas are identical to each other and to shared `dutySlotsQuerySchema`. Keeping them in the API also breaks the AGENTS rule that schemas live in `packages/shared/src`.
- Fix:
  - In `packages/shared/src/schemas/common.ts`, add `idParamsSchema = z.object({ id: idSchema })` and `clinicQuerySchema = z.object({ clinicId: idSchema.optional() })` (using `idSchema` from CORE-04), and export both from `schemas/index.ts`.
  - Replace `dutySlotsQuerySchema` (no web usage, per grep), `doctorQuerySchema` and `userQuerySchema` with `clinicQuerySchema`.
  - Have every route import directly from `@oncall/shared`, then delete `apps/api/src/validators/`.
  - Update the comments in `doctor.controller.ts:10,38` and `user.controller.ts:8` that name the old schemas.
  - The low-resource plan's Batch 2 file list references `validators/schedule.ts`; update it. No extra test beyond CORE-04.
- Confidence: High - read all 12 files and grepped every importer.

<a id="core-13"></a>
### CORE-13 - Zod failures are mapped in two places, and the errorHandler branch is never reached
- Batch: 4
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/middleware/validate.ts:9-13`, `apps/api/src/middleware/error-handler.ts:14-18`
- Problem: `validate` calls `safeParse` and throws `HttpError(400, first issue)`. `errorHandler` separately maps `ZodError` to 400 with the same message logic. No code in `apps/api/src` calls `.parse(` (grep), so the ZodError branch only runs in `error-handler.test.ts`.
- Fix: replace the body of `validate` with `req[part] = schema.parse(req[part]); next()` and drop the `HttpError` import, so the mapping lives only in errorHandler. Keep `error-handler.test.ts` "ZodError maps to 400" (now reachable in production) and `middleware.test.ts` "validate rejects bad body with 400".
- Confidence: High.

<a id="core-14"></a>
### CORE-14 - `fail()` is unused while the error envelope is written out by hand six times
- Batch: 4
- Severity: Low
- Category: Dead code
- Location: `apps/api/src/lib/envelope.ts:7-9`; `apps/api/src/middleware/error-handler.ts:16,21,26,33,36`; `apps/api/src/middleware/not-found.ts:4`
- Problem: grep finds no caller of `fail(` anywhere in `apps/api/src`, while `errorHandler` and `notFound` build `{ success: false, error }` inline.
- Fix: use `fail(message)` at all six sites. The existing error-handler tests cover it.
- Confidence: High.

<a id="core-15"></a>
### CORE-15 - `@types/express` 5 is paired with the Express 4 runtime
- Batch: 12
- Severity: Low
- Category: Maintainability
- Location: `apps/api/package.json:21,35`
- Problem: installed versions are express 4.22.2 and @types/express 5.0.6. The code relies on Express 4 behaviour:
  - `authenticate.ts:7-9` explains that rejected promises must go through `next(err)`.
  - All 70 async controller handlers have manual try/catch.
  - `validate.ts` assigns `req.query`, which Express 5 makes read-only (a getter).

  The types describe the other major version, so they cannot flag misuse of either API.
- Fix: pin `"@types/express": "^4.17.21"` and run `pnpm --filter @oncall/api typecheck`. Upgrading to Express 5 instead would remove the try/catch boilerplate, but `validate` would have to stop assigning `req.query`; only do that as a separate decision.
- Confidence: High - read the installed package versions.

<a id="core-16"></a>
### CORE-16 - `@oncall/utils` is an unused API dependency
- Batch: 12
- Severity: Low
- Category: Dead code
- Location: `apps/api/package.json:16`
- Problem: `git grep "@oncall/utils"` finds no import under `apps/api`; only the web app uses it.
- Fix: remove it from `dependencies` and refresh the lockfile. After INF-05's `--filter @oncall/api...` install, `COPY packages/utils/package.json` in the API Dockerfile is no longer needed either.
- Confidence: High.

<a id="core-17"></a>
### CORE-17 - The API `build`/`start` scripts produce output that nothing runs
- Batch: 12
- Severity: Low
- Category: Dead code
- Location: `apps/api/package.json:8-9`, `apps/api/tsconfig.json:4-8`
- Problem:
  - The Dockerfile runs `node src/server.ts` (`:46`); CI only runs typecheck, lint and test.
  - Root `pnpm build` runs `tsc` and emits `apps/api/dist`, which nothing consumes.
  - `todos/scheduling-solver-status.md:22` records that `node dist/server.js` did not start.
  - `outDir`, `declaration` and `rewriteRelativeImportExtensions` exist only for this unused output.
- Fix: delete the `build` and `start` scripts. In tsconfig, replace the emit options with `"noEmit": true` (typecheck becomes `tsc -p tsconfig.json`). Adjust the `pnpm build` rows in AGENTS.md and README to "builds the web app".
- Confidence: Medium - I did not run the dist output (read-only review).

<a id="core-18"></a>
### CORE-18 - `ClinicScope.kind` is a one-value tag that nothing reads
- Batch: 9
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/lib/scope.ts:6-10,27,33,39`
- Problem: `kind: 'clinic'` is the only possible value, and grep for `\.kind\b` in `apps/api/src` returns no matches. Consumers only read `scope.clinicId`.
- Fix: change to `export interface ClinicScope { clinicId: number }`, drop `kind` from the three returns, and remove `kind: 'clinic'` from test literals (about 15 test files). Purely mechanical.
- Confidence: High.

<a id="core-19"></a>
### CORE-19 - The request-actor type is declared eight times
- Batch: 9
- Severity: Low
- Category: Maintainability
- Location: `apps/api/src/types/express.d.ts:5`, `apps/api/src/lib/scope.ts:20`, and `type Actor = Pick<AuthUser, 'id' | 'role' | 'clinicId'>` in the doctor, holiday, reports, schedule, unavailability and user services
- Problem: the same shape is repeated locally, which goes against the "shared types from `@oncall/shared`" rule. The copies can drift apart, for example if a claim is added to the JWT.
- Fix: add `export type Actor = Pick<AuthUser, 'id' | 'role' | 'clinicId'>` to `packages/shared/src/types/auth.ts`, declare `Request.user?: Actor` in express.d.ts, and import `Actor` in scope.ts and the six services.
- Confidence: High.

<a id="core-20"></a>
### CORE-20 - auth.service has three finders that differ only in the WHERE column
- Batch: 9
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/services/auth.service.ts:52-74`
- Problem: `findUserByEmail`, `findUserByUsername` and `findUserById` are the same query with a different column.
- Fix: replace them with one `async function findUser(column: 'email' | 'username' | 'id', value: string | number)`, using a fixed column union interpolated into `WHERE u.${column} = $1 AND u.is_deleted = FALSE`. The existing service tests cover it.
- Confidence: High.

<a id="core-21"></a>
### CORE-21 - The role list and the token-issue helper are duplicated
- Batch: 9
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/lib/jwt.ts:11,24`; `apps/api/src/services/token.service.ts:73-75`
- Problem: `ROLES` repeats the shared `roleSchema` enum, so adding a role means editing both places. `issueRefreshToken` is a one-line wrapper around `insertToken`.
- Fix: in jwt.ts use `roleSchema.safeParse(role).success` from `@oncall/shared` and delete `ROLES`. Rename `insertToken` to the exported `issueRefreshToken` and delete the wrapper. `jwt-token.test.ts` and `token.service.test.ts` keep passing.
- Confidence: High.

<a id="core-22"></a>
### CORE-22 - Live-DB test helpers reverse the DATABASE_URL precedence
- Batch: 11
- Severity: Low
- Category: Maintainability
- Location: `apps/api/src/__tests__/helpers/clinic-fixtures.ts:1-10`, `apps/api/src/__tests__/usage.service.test.ts:5-8`, `apps/api/vitest.config.ts:11`
- Problem: `vitest.config.ts` and `env.ts` (dotenv never overrides) both let an exported `DATABASE_URL` win, and `render.env.example` documents that. The fixture and usage.service.test do the opposite and force the `.env` value. A developer who exports `DATABASE_URL` to run the suite against a scratch database still gets isolation tests inserting and deleting rows in the `.env` database, while the rest of the suite uses the exported one.
- Fix: in `vitest.config.ts`, read `apps/api/.env` once with dotenv (no override) and set `DATABASE_URL: process.env.DATABASE_URL ?? parsed.DATABASE_URL ?? '<default>'`. Then delete both override blocks and the dynamic-import workaround in clinic-fixtures (a static import of `db/client.ts` works once the env is set before workers load).
- Confidence: High - read all three files.

<a id="core-23"></a>
### CORE-23 - Non-ASCII characters in comments
- Batch: 13
- Severity: Low
- Category: Maintainability
- Location: `apps/api/src/db/client.ts:36`, `apps/api/src/middleware/authenticate.ts:8`, `apps/api/src/services/token.service.ts:98`, `apps/api/src/__tests__/token.service.test.ts:106`, `apps/api/src/__tests__/helpers/clinic-fixtures.ts:8,28`, `docker-compose.yml:1`
- Problem: these lines contain em-dashes, plus a section sign in clinic-fixtures.ts:28. AGENTS.md forbids non-ASCII characters in code and docs.
- Fix: replace each em-dash with ` - ` and the section sign with "section".
- Confidence: High - found with a grep for non-ASCII characters.

<a id="core-24"></a>
### CORE-24 - AGENTS.md disagrees with the code on roles and the validation status code
- Batch: 13
- Severity: Low
- Category: Maintainability
- Location: `AGENTS.md:129-132,183`; code in `database/schema.sql:146-155`, `packages/shared/src/schemas/auth.ts:4`, `apps/api/src/lib/scope.ts`, `apps/api/src/middleware/validate.ts`
- Problem: the roles list leaves out `manager`, which exists in schema.sql, the shared `roleSchema`, `scope.ts` and the routes. The status-code line says 422 is for validation, but every Zod failure returns 400, nothing in the API returns 422 (grep), and the web tests expect 400.
- Fix: add Manager to the roles list (hospital-level, `clinic_id` NULL, names a clinic via `?clinicId`). Change the status line to "400 (bad input / validation) ... 422 (unfillable)".
- Confidence: High.
- Needs decision: confirm 400 is the intended status for validation errors, rather than moving the API and web to 422.

## B. Scheduling engine

<a id="eng-01"></a>
### ENG-01 - Engines ignore next month's first day, so they can create back-to-back duties across the month boundary
- Batch: 2
- Severity: High
- Category: Bug
- Location: `apps/api/src/scheduling/conflicts.ts:54-61`, `apps/api/src/scheduling/solver-model.ts:107-120`, `apps/api/src/scheduling/types.ts:21-36`. Related: `apps/api/src/services/schedule.service.ts:215-222` (buildContext), `:308-323` (seedAdjacentDuties), `:749-756` (validatePlan)
- Problem: `SchedulingContext` only has `priorDayDoctorIds`. `blockingRule` looks up `counts.byDate.get(nextDate(day.date))`, and for the month's last day that entry is always missing. `indexModel` only drops the first-day cell for prior-day doctors. Scenario: November already has a schedule (draft or published) with doctor 5 on 11-01. The admin deletes and regenerates October. Both the solver and greedy can put doctor 5 on 10-31, and `generate()` saves it with no check. The rule is "no back-to-back, also across month boundary" (AGENTS.md; README acceptance line 224). The single-duty path (`validateAssignment`, prev+next query at :1017-1029) and preview eligibility (`seedAdjacentDuties` seeds `nextDate(last)`) both enforce it, so the engine output contradicts its own `days[].eligibleDoctorIds`. The comment at conflicts.ts:54-55 and the solver design doc (row at line 63: "Parity with greedy: the first day of the next month is not checked") record the gap but not the rule.
- Fix: Add `nextDayDoctorIds: Set<number>` to `SchedulingContext`. Load it in `buildContext` with the same clinic-joined query on `nextDate(last)`, and have `seedAdjacentDuties` use `ctx.nextDayDoctorIds` so the query is not duplicated. In `blockingRule`, use `onDutyTomorrow = day.date === ctx.days.at(-1)?.date ? ctx.nextDayDoctorIds.has(doctor.id) : ...`. In `indexModel`, skip the last-day cell when `ctx.nextDayDoctorIds.has(doctor.id)` (mirroring line 114). Add a next-day check to `validatePlan`. Update the conflicts.ts comment and the design-doc row. Tests: in the `engine.test.ts` describe.each, add "respects next-month first-day duty via nextDayDoctorIds" (days ending 2026-09-30, doctor 1 in the set, expect no duty for doctor 1 on 09-30). In `solver-model.test.ts`, expect the last-day variable to be missing. Add `nextDayDoctorIds` to `helpers.ts`/fixture defaults. In the service test, assert buildContext queries `nextDate(last)`.
- Confidence: High - read blockingRule, indexModel, buildContext, seedAdjacentDuties, validateAssignment, validatePlan, and the design doc row.
- **Merge note:** Implement together with SCH-02 (service half). One change, one set of tests.

<a id="eng-02"></a>
### ENG-02 - A time-limited later stage replaces a better earlier solution without comparing them
- Batch: 3
- Severity: Medium
- Category: Correctness
- Location: `apps/api/src/scheduling/solver.ts:203-235` (lines 227-230)
- Problem: When stage k hits the time limit with an incumbent, `chosen = chosenCells(index, solved.Columns)` overwrites the solution from stage k-1. HiGHS gets no MIP start (the LP text carries none), so its incumbent only has to meet the bound rows for stages < k. It can be clearly worse than the previous solution on stage k itself. Example: a timeout in `cover-regular-2` returns an incumbent with more unfilled positions than the `cover-critical` solution had. The result then has extra conflicts and `generate()` returns 422 even though a better schedule was already in hand. The same applies to `share`/`holidays` (worse fairness) and `fill` (fewer duties). The result also depends on CPU speed, which breaks determinism (D5).
- Fix: Add `stageObjective(index, stage, chosen, capacity): number` in `solver-model.ts`. It should compute the same objective from chosen cells: unmet positions per cover stage; relax = sum of holiday excess + Fri/Sat/Sun repeats; weekdays = missing; share = max(0, max_i(|E*t_i - cap_i*T|) - (E-1)); holidays = max(0, max-min-1); fill = count. At lines 227-230, keep the incumbent only if it beats the previous solution on stage k (`<` for minimized stages, `>` for fill); otherwise keep `chosen`. Test: in `solver.test.ts`, add a fake loader that wraps the real solver, saves the first cover-stage columns, and at the `fill` stage returns `Time limit reached` with those columns. Assert the result has at least as many duties as the pre-fill solution.
- Confidence: Medium - logic read in solveStages/solveOnce; impact needs a time limit (large clinics).

<a id="eng-03"></a>
### ENG-03 - Greedy lets optional slots on critical holiday days go over the holiday cap
- Batch: 2
- Severity: Medium
- Category: Correctness
- Location: `apps/api/src/scheduling/engine.ts:87-107,125`, `apps/api/src/scheduling/conflicts.ts:47-53`; compare `apps/api/src/scheduling/solver-model.ts:228-255`
- Problem: Solver design 4.3 and the model encode `nonCritical <= max(0, 2 - critical) + relaxation`: critical holiday duties count first, and any excess costs a relaxation that the `relax` stage only allows where coverage needs it. Greedy fills critical optional slots in pass 3, after the regular required slots in pass 2, and `blockingRule(..., critical=true, ...)` skips the cap entirely. Scenario: open Saturday 19 with 3 slots and minimum 2. Doctor X already took regular Saturdays 5 and 12 in pass 2. Pass 3 gives X the optional third slot on the 19th, so X has 3 holiday duties and no coverage needed it. The solver would leave that slot empty or give it to someone else. The fallback breaks the spec's assumption that "critical days are filled first".
- Fix: Track regular and critical holiday counts separately in `RunState`/`DutyCounts`. Add one predicate in `constraints.ts`, `holidayCapAllows(regular, critical) => regular <= Math.max(0, HOLIDAY_DUTY_CAP - critical)`. In `blockingRule`, keep the exemption only for required critical slots (pass `critical && required` from `fillDay`). For optional critical slots, block when `holidayCapAllows(regular, critical + 1)` is false. Reuse the predicate for the `excess` computation in `decode` (solver.ts:300). Test: add an `engine.test.ts` describe.each case with this setup, asserting no doctor ends with `regular > max(0, 2 - critical)` when the extra duty sits above the day's minimum.
- Confidence: Medium - read the pass order, blockingRule, the model rows, and design doc 4.3.

<a id="eng-04"></a>
### ENG-04 - Schedule-service eligibility and plan validation re-implement blockingRule with different holiday rules
- Batch: 2
- Severity: Medium
- Category: Correctness
- Location: `apps/api/src/services/schedule.service.ts:280-284` (computeEligibility), `:727-748` (validatePlan). The engine rules are in `apps/api/src/scheduling/conflicts.ts:30-63`. This overlaps with the schedule-service review.
- Problem:
  - `computeEligibility` applies `underHolidayCap` on critical days and ignores the minimum-coverage relaxation. Both engines and `validateAssignment` (:996) exempt critical days. Result: a doctor the engine put on a critical Sunday as their third holiday duty shows as not eligible for their own day. The select then hides valid swaps, against the design rule "Identical to validateAssignment" (schedule-calendar design line 22).
  - `validatePlan` counts `c.holiday` in the order of the client's array, so the same duty set passes or fails depending on whether the critical holiday comes before or after the regular one.
- Fix: Build both from the shared helpers. Use the ENG-03 `holidayCapAllows` predicate with the critical exemption in `computeEligibility`, and evaluate `validatePlan` on final per-doctor counts (regular vs critical) rather than running order. Tests: a `computeEligibility` case where a critical holiday day keeps a doctor holding 2 regular holidays eligible; a `validatePlan` case where reversing the assignment order gives the same outcome.
- Confidence: High - read all three implementations.
- **Merge note:** Implement together with SCH-04 (one shared pure checker).

<a id="eng-05"></a>
### ENG-05 - A failed alternative solve looks like "no more equally good options"
- Batch: 3
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/scheduling/solver.ts:146-196`; consumer `apps/api/src/services/schedule.service.ts:543-551`
- Problem: `solveAlternative` catches every error (HiGHS error, retired worker, watchdog) and returns null. `solveNext` does the same for loader errors. The service treats null as `entry.exhausted = true`, so a one-off worker crash reports `moreAvailable: false` for 15 minutes (the cache TTL), until the admin regenerates. Options design D3 only allows stopping on `Infeasible` or "no incumbent in budget", not on errors.
- Fix: Return null only for `Infeasible` and for a time limit with no incumbent. Let other errors propagate (still logged). In the service, map them to an error response without setting `exhausted`. Change the `solver.test.ts` case "keeps the primary option when an alternative solve fails" to expect a rejection, and add a service test that `exhausted` stays false after a failure.
- Confidence: High - read solveNext/solveAlternative and the service consumer.
- Needs decision: should an alternative-solve failure reach the web app as an error (retry possible), or stay a silent "no more options"?

<a id="eng-06"></a>
### ENG-06 - `ConflictTally.atHolidayCap` is always 0
- Batch: 9
- Severity: Low
- Category: Dead code
- Location: `apps/api/src/scheduling/conflicts.ts:11-13,47-53`, `apps/api/src/scheduling/engine.ts:156-171`, `apps/api/src/scheduling/solver.ts:327-331`; `packages/shared/src/types/schedule.ts:44`; `apps/web/src/locales/*.json` (conflict.pool)
- Problem: Greedy only records a conflict for required slots. Critical days skip the holiday cap, and regular days re-tally with `relaxFairness=true`. The solver tallies with `relaxFairness=true`. So `atHolidayCap` is never counted, and every conflict message in the UI says "0 at holiday cap".
- Fix: Remove `atHolidayCap` from `ConflictTally`, `emptyTally`, the web locales/`conflict-text.ts` and their tests. `blockingRule` keeps returning it for greedy eligibility only: return a separate internal union or keep the key out of the tally type.
- Confidence: High - traced every `tally` producer.
- Needs decision: drop the field from the shared API contract and the UI text?

<a id="eng-07"></a>
### ENG-07 - Constraint helpers return reason strings nobody reads, and `isAvailable` has an unused parameter
- Batch: 2
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/scheduling/constraints.ts:1-47`; `apps/api/src/scheduling/__tests__/constraints.test.ts:25-26`
- Problem: Every caller (conflicts.ts, solver-model.ts:113, schedule.service.ts:266, 273, 277, 282, 287, 649, 942, 955, 1010, 1028) reads only `.ok`. The `reason` strings are read only by the test, which just pins their wording. `_doctorId` is never used.
- Fix: Return `boolean` (`isAvailable(date, ranges)`, `underCap`, `underOpenDutyCap`, `underHolidayCap`), make `notConsecutive` a plain negation or inline it, and update the callers. Delete the `.reason` assertions; add an `underOpenDutyCap` boundary assertion.
- Confidence: High - grep of all callers.

<a id="eng-08"></a>
### ENG-08 - Dead fields and re-exports in the scheduling module
- Batch: 9
- Severity: Low
- Category: Dead code
- Location: `apps/api/src/scheduling/types.ts:10`, `apps/api/src/scheduling/index.ts:1-12`
- Problem: `DoctorSpec.isActive` is never read (buildContext hard-codes `true` and only loads active doctors). `index.ts` re-exports `generateGreedy` and all of `scoring.ts`, which nothing outside the module imports (tests import `engine.ts`/`scoring.ts` directly). `schedule.service.ts` imports partly via `index.ts` and partly from `dates.ts`/`types.ts` directly, so there are two import conventions.
- Fix: Remove `isActive` from `DoctorSpec`, the helpers, the fixture and the service test. Trim `index.ts` to what the service uses, and route all service imports through it (or delete `index.ts` and import modules directly - pick one).
- Confidence: High - grep for `isActive`, `generateGreedy`, scoring symbols.

<a id="eng-09"></a>
### ENG-09 - Local `AssignmentPlan` duplicates the `@oncall/shared` type
- Batch: 9
- Severity: Low
- Category: Maintainability
- Location: `apps/api/src/scheduling/types.ts:43-50`; `packages/shared/src/types/schedule.ts:30-37`
- Problem: Field-for-field identical copy, against "shared types come from @oncall/shared". `types.ts` already re-exports `ConflictPlan`/`ConflictTally` from shared.
- Fix: `import type { AssignmentPlan } from '@oncall/shared'` and re-export it like `ConflictPlan`. No test change needed.
- Confidence: High.

<a id="eng-10"></a>
### ENG-10 - Duplicated budget and day-classification helpers between greedy, model and service
- Batch: 9
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/scheduling/scoring.ts:9-15`; `apps/api/src/scheduling/engine.ts:56-104,115,165-167`; `apps/api/src/scheduling/solver-model.ts:98-106`
- Problem: `weekendBudget` and `fridayBudget` have identical bodies. Greedy re-derives critical/open/slots/minimum per call (`minimumForDate` up to 3 times per fill) while `indexModel` already builds the same `ModelDay` record. `computeEligibility` derives it a third time.
- Fix: Merge the budgets into `fairShareBudget(slots, doctors)`. Extract `classifyDays(ctx): ModelDay[]` (move it next to `slotsForDate` in dates.ts) and use it in `indexModel`, `generateGreedy` and, optionally, `computeEligibility`. Existing tests cover the behaviour; update `scoring.test.ts` for the renamed function.
- Confidence: High.

<a id="eng-11"></a>
### ENG-11 - Repeat-weekday note can land on the first duty of that weekday
- Batch: 3
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/scheduling/solver.ts:292-297`
- Problem: `same.filter(needed).slice(1 - same.length)` filters first and then takes the last `len-1` elements. With 3 Saturdays where only the 1st and 3rd are at their day's minimum, both get "repeat weekday to reach minimum", including the chronologically first. Design ("Repeat note: on the later (count - 1) duties ... at their minimum") requires `same.slice(1).filter(needed)`. At a proven-optimal relax stage every repeat is needed, so this only shows up in `time limit` solutions that stop at or before `relax`.
- Fix: `repeats.push(...same.slice(1).filter(needed))`. Test: use `timeLimitedLoader` stopping at the relax stage on a fixture with one doctor and three Saturdays where the first day is above its minimum, then assert the first Saturday's reason has no repeat note.
- Confidence: Medium - the logic is certain; reachability is narrow.

<a id="eng-12"></a>
### ENG-12 - Misleading or stale comments and non-ASCII characters
- Batch: 13
- Severity: Low
- Category: Maintainability
- Location:
  - `apps/api/src/scheduling/dates.ts:46-61`: `requiresDoubleCoverage` doc says "must always carry 2 on-call doctors", but minimums are per-clinic settings (min 1).
  - `apps/api/src/scheduling/constraints.ts:6`: stale note about a removed constant.
  - `apps/api/src/scheduling/solver.ts:19`: cites "(D4)", whose design row says 10 s, while the code uses 45 s.
  - Non-ASCII: `dates.ts:41`, `engine.ts:24,99,149`, `types.ts:15`, `__tests__/engine.test.ts:32,103-104,126,174,198,205-207,263`.
- Problem: The name and doc of `requiresDoubleCoverage` claim a fixed rule of 2. It is also used by the service and the model. AGENTS.md bans non-ASCII characters.
- Fix: Rename to `isCriticalDate` (callers: engine.ts, solver-model.ts, schedule.service.ts validatePlan/validateAssignment) with an accurate doc. Delete constraints.ts:6. Point the budget comment at options design D6. Replace em-dashes, ellipses, arrows and the `>=` symbol with ASCII.
- Confidence: High - grep for non-ASCII and callers.

<a id="eng-13"></a>
### ENG-13 - Untested date helpers
- Batch: 11
- Severity: Low
- Category: Test gap
- Location: `apps/api/src/scheduling/__tests__/dates.test.ts`; `apps/api/src/scheduling/dates.ts:9-36,46-109`
- Problem: Only `isOpenDutyDate`/`isPostOpenDutyDate` are tested. There is no coverage of `daysInMonth` for leap and non-leap February, `prevDate`/`nextDate` across year boundaries, `requiresDoubleCoverage` across a month boundary, or `slotsForDate`/`minimumForDate` picking the right tier. All of these drive persisted schedules.
- Fix: Add cases: `daysInMonth(2028, 2) === 29`, `daysInMonth(2026, 2) === 28`, `prevDate('2027-01-01') === '2026-12-31'`, `nextDate('2028-02-28') === '2028-02-29'`, and the open/post-open/closed tiers for slots and minimums.
- Confidence: High.

<a id="eng-14"></a>
### ENG-14 - solver-model tests pin LP text formatting
- Batch: 11
- Severity: Low
- Category: Test gap
- Location: `apps/api/src/scheduling/__tests__/solver-model.test.ts:31-38,53-77`
- Problem: Assertions match exact row text, term order and objective formatting (for example `^Minimize\n obj: x_1_20260901 \+ ...`). A harmless change to row naming or term order breaks them without any behaviour change, against the plan's "Do not snapshot full LP text". The behaviour (equally good, distinct options) is already covered in `solver.test.ts`.
- Fix: Keep the variable-set test. Replace the text regexes with behaviour checks: solve the built LP with `loadSolver()` and assert outcomes (the pair can't both be 1; the no-good excludes the earlier set; the objective counts overlap), or check only that the named rows exist.
- Confidence: Medium - judgment on test value; the plan text supports it.

## C. Schedule service, controller, routes

<a id="sch-01"></a>
### SCH-01 - Holiday cap ignores marked holidays when the new duty falls on a weekend
- Batch: 2
- Severity: High
- Category: Bug
- Location: `apps/api/src/services/schedule.service.ts:991-1016` (`validateAssignment`)
- Problem: `marked` is only loaded when the target date is not a weekend (`if (!isWeekendISO(date)) { ... marked = ... }`). For a Saturday or Sunday it stays `[]`, so the count query `AND (is_weekend OR duty_date::text = ANY($4))` counts weekend duties only. Example: a doctor holds one Sunday duty and one duty on 2026-10-28 (a Wednesday marked as a holiday), which is 2 holiday duties. The admin adds or reassigns a Saturday to them: the count is 1, the check passes, and the doctor ends up with 3 holiday duties. The holiday cap is 2 (`HOLIDAY_DUTY_CAP`). `computeEligibility` counts marked days (`holidayByDoctor` built from `ctx.days.isHoliday`), so the calendar shows the doctor as not eligible while the server accepts the edit.
- Fix: always load the month's marked holidays, then run the cap check when `isWeekendISO(date) || marked.includes(date)`. This goes away if SCH-04 lands (one pure checker over `ctx.days.isHoliday`). Test: `addDuty` on a non-critical Saturday for a doctor who already has 1 weekend duty and 1 marked weekday holiday duty must return 409 with "holiday cap".
- Confidence: High - read lines 991-1016. The only guard is `isWeekendISO(date)`, and `marked` defaults to `[]`.

<a id="sch-02"></a>
### SCH-02 - Saving a plan, and the engine, ignore the next month's first-day duties (back-to-back across the month boundary)
- Batch: 2
- Severity: High
- Category: Bug
- Location: `apps/api/src/services/schedule.service.ts:707-760` (`validatePlan`), `:215-222` (`buildContext` only seeds `priorDayDoctorIds`); `apps/api/src/scheduling/types.ts:29` (engine, owned by another reviewer)
- Problem: `validatePlan` checks back-to-back only against the previous day (`prev === beforeFirst && ctx.priorDayDoctorIds`). `SchedulingContext` has no "day after the month" set, so neither the solver (`solver-model.ts:114`) nor `validatePlan` sees a schedule that already exists for the next month. Scenario: the November draft exists and doctor 3 is on duty 2026-11-01. The admin deletes and regenerates October (or builds October after November). Option A, or a manual plan, puts doctor 3 on 2026-10-31, and `POST /schedules` persists it. Other paths do catch this: `validateAssignment` checks both neighbours (`:1020-1027`), and `seedAdjacentDuties` makes eligibility flag it. That violates the rule "no back-to-back days (also across month boundary)".
- Fix: in `buildContext`, load `nextDayDoctorIds` for `nextDate(last)` (same clinic-joined query as `seedAdjacentDuties`). Add it to `SchedulingContext`. `seedAdjacentDuties` should reuse it instead of querying again. Check it in `validatePlan` for the last date, and hand it to the engine owner for `solver-model.ts`/`engine.ts`/`conflicts.ts`. Test: `generate` with a plan that puts doctor X on the month's last day while a duty for X exists on the next month's day 1 must return 409 "back-to-back". This mirrors the existing "collides with the prior month last-day duty" test.
- Confidence: High - read `validatePlan`, `buildContext`, `types.ts`, and grepped `priorDayDoctorIds` across `scheduling/` (no next-day equivalent).
- **Merge note:** Same defect as ENG-01 (engine half). Implement SCH-02 and ENG-01 as one change: one `nextDayDoctorIds` field, used by buildContext, seedAdjacentDuties, validatePlan, blockingRule and indexModel.

<a id="sch-03"></a>
### SCH-03 - Duty edit validation runs before the schedule lock (races on cap, back-to-back, slots, holiday and open caps); reassign/remove log changes that didn't happen
- Batch: 2
- Severity: Medium
- Category: Correctness
- Location: `apps/api/src/services/schedule.service.ts:1048-1103` (`addDuty`), `:1105-1144` (`reassignDuty`), `:1146-1181` (`removeDuty`), `:917-1030` (`validateAssignment` uses pool `query`)
- Problem: the slot count (`existing`, `:1060`) and `validateAssignment` run on the pool before `withTransaction` + `lockScheduleForEdit`. The lock only protects the status check. Two concurrent edits on one draft (two admins, two tabs) both pass and both insert. Examples: doctor at 6/7 added on the 10th and the 20th, which gives 8 duties; the same doctor added on the 10th and the 11th, which is back-to-back; two doctors added to a day with one free slot, which exceeds `slotsForDate`. Only the same doctor twice on the same day is blocked, by `idx_duties_schedule_date_doctor`. Second issue: `reassignDuty` runs `UPDATE duties ... WHERE id = $3` and `removeDuty` runs `DELETE FROM duties WHERE id = $1` without checking the affected row count. If the duty was deleted concurrently, both still write `duty.reassigned`/`duty.removed` activity rows. Reassign then fails with 404 after the commit, and remove returns 204.
- Fix: inside the transaction, call `lockScheduleForEdit` first, then the slot count and `validateAssignment`. Pass the `PoolClient`, or keep the pool reads, since they run after the lock and competing edits are blocked. Use `UPDATE ... RETURNING id` / `DELETE ... RETURNING id` and throw 404 when no row comes back. Cross-month neighbours live in another schedule row, so locking this row alone does not serialize them; that residual race is acceptable. Test: with the `withTransaction` mock recording call order, assert the validation queries run after the `FOR UPDATE`, and assert that `reassignDuty` returns 404 with no `recordActivity` when `UPDATE` returns 0 rows.
- Confidence: High - read the three functions and `db/client.ts`. `schema.sql:124-142` has no constraint covering these rules.

<a id="sch-04"></a>
### SCH-04 - Hard rules are implemented three times and have already diverged
- Batch: 2
- Severity: Medium
- Category: Maintainability
- Location: `apps/api/src/services/schedule.service.ts:255-300` (`computeEligibility`), `:637-769` (`validatePlan`), `:917-1030` (`validateAssignment`)
- Problem: monthly cap, one-open-duty cap, holiday cap with its critical-day relaxation, unavailability and back-to-back are each written three ways: in-memory maps, plan loop, and 8 sequential SQL round trips. They already disagree:
  - SCH-01: weekend vs marked holidays in `validateAssignment`.
  - SCH-02: the next-month boundary is checked in eligibility and `validateAssignment` but not in `validatePlan`.
  - `validatePlan` accepts an over-cap holiday duty when `withinMinimum`, and `validateAssignment` never does, so a saved plan can contain duties the same admin could not add by hand.
  - Holiday duties are counted from the `is_weekend` column in one place and from `ctx.days.isHoliday` in the others.
- Fix: add one pure function, e.g. `assignmentViolation(ctx, duties, candidate, excludeDutyId): string | null`, in a pure module next to the engine constraints. It runs over `SchedulingContext` (with `nextDayDoctorIds` from SCH-02) plus the schedule's current duties. `validateAssignment` becomes `buildContext` + one duties query + this check, run under the lock (SCH-03). `validatePlan` calls it per assignment, keeping its plan-level checks (empty days, minimums, slots). Make the `withinMinimum` relaxation an explicit rule-parity decision. Move the existing addDuty/validatePlan tests onto the pure function with table cases.
- Confidence: High - read all three implementations side by side.
- Needs decision: should manual edits get the same "over-cap holiday duty allowed when the day is at its minimum" relaxation that plan saves already get?
- **Merge note:** ENG-04 reports the eligibility/plan-order part of the same duplication. Implement both as one change, on top of the ENG-03 predicate. If the decision is not made, keep each path's current `withinMinimum` behaviour and only remove the duplication.

<a id="sch-05"></a>
### SCH-05 - `getById` repeats `eligibilityFor`/`buildDutyMaps` line for line
- Batch: 9
- Severity: Medium
- Category: Simplification
- Location: `apps/api/src/services/schedule.service.ts:841-877`; also `:821-848` (non-admin calendar branch) vs `:196-212` and `:279-296`
- Problem: the admin branch rebuilds `dutiesByDate`/`dutyCountByDoctor`/`holidayByDoctor`/`openByDoctor` by hand, calls `seedAdjacentDuties`, then calls `computeEligibility`. That is exactly `eligibilityFor(ctx, duties.map(...), clinicId)`. The non-admin branch also repeats the per-day `DayInfo` assembly (day loop, `isOpenDutyDate`, `slotsForDate`, `minimumForDate`) from `buildContext`/`computeEligibility`.
- Fix: replace `:841-877` with `const days = await eligibilityFor(ctx, duties.map((d) => ({ date: d.dutyDate, doctorId: d.doctorId })))`. Extract `calendarDays(year, month, openDuty, slots, minimums)` (empty eligible lists) for the non-admin branch, and let `computeEligibility` build its `DayInfo` the same way. No behaviour change; the existing getById tests cover it.
- Confidence: High - compared the blocks.

<a id="sch-06"></a>
### SCH-06 - `POST /schedules` without `assignments` still runs a fresh solve and saves it, bypassing the options flow
- Batch: 8
- Severity: Medium
- Category: Simplification
- Location: `apps/api/src/services/schedule.service.ts:571-635` (`generate`, `enginePlanToDuties` `:622-635`), `packages/shared/src/schemas/schedule.ts:23-34`, test `schedule.service.test.ts:853-861`
- Problem: the rule is "Only the chosen option is saved as a draft via `POST /schedules`". When the body has no `assignments`, or `[]`, `generate` calls `runEngine` and saves its result (`mode: 'engine'`). That is a second save path the admin never saw. The web app always sends `option.assignments` (`apps/web/src/pages/ScheduleOptionsPage.vue:189-192`), so this path, `enginePlanToDuties`, and the "empty array = engine path" test serve no consumer.
- Fix: make `assignments` required with `.min(1)` in a separate save schema; keep `generateScheduleSchema` for preview. Delete `enginePlanToDuties`, the `runEngine` branch, and the `mode` detail. Replace the "empty assignments array" test with a 400 route test.
- Confidence: High - grepped `apps/web` for every `/schedules` call.
- Needs decision: drop engine-only saves via `POST /schedules`? This changes the API contract for any non-web client.
- **Merge note:** Same as SOL-05 in the low-resource plan. Implement once.

<a id="sch-07"></a>
### SCH-07 - `POST /schedules/preview` with a plan returns `conflicts: []` and validates nothing; the endpoint has no web consumer
- Batch: 8
- Severity: Medium
- Category: Correctness
- Location: `apps/api/src/services/schedule.service.ts:388-420`
- Problem: with `plan`, preview never checks the plan. It echoes it back, blanks `conflicts`, and recomputes eligibility only. Out-of-month dates, other clinics' doctors (names `''`), duplicates, days below their minimum and cap violations all come back as `conflicts: []`. The same plan is then rejected by `POST /schedules` one error at a time. That contradicts "preview detects conflicts before creation". `apps/web` never calls `/schedules/preview` (grep finds no match), and preview without a plan returns the same thing as option A from `POST /schedules/options`.
- Fix: either (a) run the plan-level checks of `validatePlan` (via SCH-04's pure checker) and report under-minimum days as `ConflictPlan`s, or (b) remove the plan branch, and possibly the endpoint, since options covers it. Update `schedule.service.test.ts:169-233` and `schedule.routes.test.ts:202-216` to match.
- Confidence: High - read `preview` and grepped the web app.
- Needs decision: keep preview, and if so, with real plan validation, or retire it in favour of `/schedules/options`?

<a id="sch-08"></a>
### SCH-08 - `schedule.service.ts` (1251 lines) mixes five concerns; split it
- Batch: 10
- Severity: Medium
- Category: Maintainability
- Location: `apps/api/src/services/schedule.service.ts`
- Problem: one file holds context loading, eligibility, the options cache and solver gate mapping, plan validation, CRUD/state machine, and duty editing. The duplication in SCH-04/SCH-05 grew because related code is hundreds of lines apart.
- Fix (flat, matching the existing `services/*.service.ts` naming):
  - `scheduling-context.ts`: `buildContext`, adjacency seeds, `monthBounds`, `computeEligibility`, `eligibilityFor`, `calendarDays`.
  - `schedule-rules.ts`: pure; `validatePlan` plus the shared `assignmentViolation`.
  - `schedule-options.service.ts`: the cache, `generateOptions`, `generateAlternative`, `toOption`, `changedDatesOf`, `gated`.
  - `duty.service.ts`: `addDuty`, `reassignDuty`, `removeDuty`, `lockScheduleForEdit`.
  - `schedule.service.ts`: `list`, `getById`, `getScheduleDuties`, `generate`, `remove`, `publish`, `unpublish`, `preview`.

  The controller imports from both service modules. Split the tests along the same lines.
- Confidence: High - read the whole file.

<a id="sch-09"></a>
### SCH-09 - Test gaps: manual-edit rules and the month boundary have no tests
- Batch: 2
- Severity: Medium
- Category: Test gap
- Location: `apps/api/src/__tests__/schedule.service.test.ts:284-511`
- Problem: for `validateAssignment`, only "same doctor same date", the open-day cap and the critical-Saturday skip are tested. Untested: monthly cap 409, unavailability 409, inactive doctor 409, back-to-back 409 (within the month and against the adjacent month), and the holiday cap on a non-critical weekend or marked day. That last one is how SCH-01 went unnoticed. `validatePlan` has no next-month-boundary test (SCH-02). Nothing checks that validation runs under the lock (SCH-03). The concurrency case in SCH-10 is also untested.
- Fix: add the tests listed under SCH-01, SCH-02, SCH-03 and SCH-10. Write them against the pure checker once SCH-04 lands.
- Confidence: High - listed every `it(` in the file and grepped the error messages.

<a id="sch-10"></a>
### SCH-10 - Two concurrent requests for the same alternative solve twice and store a misnumbered option
- Batch: 3
- Severity: Low
- Category: Bug
- Location: `apps/api/src/services/schedule.service.ts:549-566`
- Problem: the gate covers only `runAlternative`. After it returns, `toOption` awaits `eligibilityFor` (a DB query) before `entry.options.push(option)`. A second `index: 2` request that arrives in that window sees `entry.options[1]` undefined and solves again; `solveNext` has already pushed the first solution into `state.chosen`. It then pushes a different option whose `index` field is 2 at array position 3. Later `index: 3` requests return that cached object, and the two callers saw different "option B"s.
- Fix: after the gated solve, re-check `const raced = entry.options[index - 1]; if (raced) return { option: raced, moreAvailable: moreAvailable() }` before building. Or push a placeholder synchronously before awaiting `toOption`. Test: start two `generateAlternative(..., 2, ...)` calls with the eligibility query delayed; both must resolve to the same option, and `options.length` must be 2.
- Confidence: Medium - traced the awaits. It needs two tabs or two admins on the same clinic and month.

<a id="sch-11"></a>
### SCH-11 - The fixed `Retry-After: 10` and its comment don't match the solver budget
- Batch: 3
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/middleware/error-handler.ts:6-7,20`, `apps/api/src/services/schedule.service.ts:462-470`, `apps/api/src/scheduling/solver.ts:20`
- Problem: the comment says "one solve lasts at most one request", but a primary solve may hold the global slot for `SOLVER_BUDGET_MS` (45 s) plus the watchdog grace. Requests are not aborted when the client disconnects, so a client that obeys the header can get 429 four times or more. The same constant is also sent for rate-limit 429s, whose window is unrelated.
- Fix: keep it simple. Correct the comment and raise the constant to a realistic value, or let `gated` throw an `HttpError` carrying `retryAfterSeconds` (computed from the busy solve's start and budget) that the handler prefers over the default. Test: the service-level 429 test asserts the header value.
- Confidence: Medium - read the handler, `solver.ts:20-63` and the `highs.ts` watchdog.
- **Merge note:** Duplicate of CORE-05. Implement there.

<a id="sch-12"></a>
### SCH-12 - The publish activity log's `dutyCount` holds the number of covered days, not duties
- Batch: 3
- Severity: Low
- Category: Bug
- Location: `apps/api/src/services/schedule.service.ts:1225`
- Problem: `byDate` maps date to count, so `byDate.size` is the number of distinct dates. With 2 doctors per day for 30 days the log says `dutyCount: 30`, while `schedule.generated` (`:614`) logs 60 for the same schedule under the same key.
- Fix: `dutyCount: duties.rows.reduce((s, r) => s + r.n, 0)`. Test: in the publish success test, assert the `recordActivity` detail for a two-per-day schedule.
- Confidence: High.

<a id="sch-13"></a>
### SCH-13 - Manager sees drafts in the list but gets 403 on `GET /schedules/:id`
- Batch: 8
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/services/schedule.service.ts:815-820`, `:771-799`
- Problem: `list` filters drafts out only for doctors, so a manager (route comment "read-only drill-down") gets drafts. `getById` treats only administrator and superadmin as `isAdmin`, so a manager opening a draft gets 403 "Schedule not published", and published schedules come back with blank eligibility. `reports.service.ts:22` already gives the manager draft rosters via `getScheduleDuties`.
- Fix: decide the manager rule and apply it in both places, e.g. `const canSeeDrafts = actor.role !== 'doctor'` in `getById`. Test: manager `getById` on a draft.
- Confidence: Medium - the manager has no UI yet (see `docs/superpowers/plans/2026-10-01-web-ui-review-fixes-plan.md` M12).
- Needs decision: may a manager read draft schedules, and should they get eligibility data?

<a id="sch-14"></a>
### SCH-14 - Optional `actor`/`scope` parameters silently skip authorization
- Batch: 8
- Severity: Low
- Category: Security
- Location: `apps/api/src/services/schedule.service.ts:771-775` (`list`), `:802-813` (`getScheduleDuties`), `:815`, `:100-108` (`assertScheduleVisible(row, actor | undefined)`)
- Problem: when `actor` is omitted, `assertScheduleVisible` passes, the published check is skipped, and `list` without `scope` returns every clinic's schedules. All production callers pass both (controller, `reports.service.ts:22`); only tests omit them. A future caller that forgets the argument gets a cross-clinic read with no error.
- Fix: make `actor` and `scope` required and delete the `scope !== undefined` / `actor &&` branches. Update the tests that call `getById(99)` / `list({...})`.
- Confidence: High - grepped all callers.

<a id="sch-15"></a>
### SCH-15 - Dead exports, redundant parameters and redundant queries
- Batch: 9
- Severity: Low
- Category: Dead code
- Location: `apps/api/src/services/schedule.service.ts:422` (`export const SCHEDULE_OPTION_COUNT`), `:238` (`export interface EligibilityInput`), `:308-311`, `:360-364`, `:498-503` (`clinicId` params), `:910-915` (`getVisibleDuty`)
- Problem:
  - `SCHEDULE_OPTION_COUNT` and `EligibilityInput` are used only inside the file; grep finds no importers, and the test imports only `computeEligibility`.
  - `seedAdjacentDuties`, `eligibilityFor` and `toOption` take a `clinicId` that always equals `ctx.clinicId`.
  - `getVisibleDuty` runs a second `SELECT` on the schedule although `DutyRow` already has `schedule_clinic_id`.
  - `gated` doesn't gate anything; it only maps `SolverBusyError` to 429.
- Fix: remove the `export`s. Read `ctx.clinicId`, updating the `types.ts:22` comment "only used to identify the run in logs". Change `assertScheduleVisible` to take a clinic id and call it with `duty.schedule_clinic_id`. Rename `gated` to `mapSolverBusy`. No new tests.
- Confidence: High - grepped symbol usage across `apps/` and `packages/`.
- **Merge note:** The `gated` rename touches the same lines as CORE-05; if CORE-05 is done first, keep its `retryAfterSeconds` argument.

<a id="sch-16"></a>
### SCH-16 - Saving a draft inserts duties one row at a time
- Batch: 8
- Severity: Low
- Category: Performance
- Location: `apps/api/src/services/schedule.service.ts:595-601`
- Problem: a 31-day month with 2 slots makes 62 sequential `INSERT`s inside the transaction while it holds a pool client.
- Fix: one statement: `INSERT INTO duties (schedule_id, duty_date, doctor_id, is_weekend, reason) SELECT $1, * FROM unnest($2::date[], $3::int[], $4::bool[], $5::text[])`. The codebase already uses array params (`token.service.ts:68`). Update the generate success test to assert one duties insert carrying all rows.
- Confidence: High.
- **Merge note:** Already tracked as QRY-02 in `docs/superpowers/plans/2026-11-10-low-resource-server-plan.md`. Skip here.

<a id="sch-17"></a>
### SCH-17 - Low-value tests: mock echoes and SQL-substring pins
- Batch: 11
- Severity: Low
- Category: Test gap
- Location: `apps/api/src/__tests__/schedule.routes.test.ts:114-123`, `:218-239`, `:320-346`; `apps/api/src/__tests__/schedule.service.test.ts:136-144`, `:198-206`, `:234-240`
- Problem: the route tests mock the service to reject with 409/422 and assert 409/422 ("published-lock as 409", "409 exists; 422 unfillable"), or mock `{assignments: []}` and assert `[]`. They only test the generic error handler. The service tests check `Array.isArray(...)` or that the SQL text contains `'year ='`/`'clinic_id = $1'`, so they break on refactors without catching wrong results.
- Fix: delete the route mock-echo cases; keep the auth/403/400 and Retry-After header cases. Replace the SQL-substring tests with behaviour tests, e.g. a holiday inside the month makes that day count against the holiday cap, and a disabled unavailability does not block eligibility.
- Confidence: High.

<a id="sch-18"></a>
### SCH-18 - Non-ASCII characters and stray indentation in `schedule.service.ts`
- Batch: 13
- Severity: Low
- Category: Maintainability
- Location: `apps/api/src/services/schedule.service.ts:24-37` (import block indented one extra space), `:183-196` (`const days = []` / loop), comments at `:98`, `:150-151`, `:215`, `:306`, `:724`, `:736`, `:822`, `:968`, `:989`, `:1018`, `:1150`; `apps/api/src/scheduling/types.ts:24-29`
- Problem: AGENTS.md forbids non-ASCII characters (right arrow, em-dash, section sign). Lint passes, so ESLint doesn't catch these or the misaligned blocks.
- Fix: replace them with `->`, `-` and "section", and re-indent. No tests.
- Confidence: High - grep for `[^\x00-\x7F]`; `pnpm --filter @oncall/api lint` passes.

<a id="sch-19"></a>
### SCH-19 - `docs/database.md` describes `duties.reason` as the engine's text only
- Batch: 8
- Severity: Low
- Category: Maintainability
- Location: `docs/database.md:227`; writers at `apps/api/src/services/schedule.service.ts:766`, `:1080`, `:1117`
- Problem: the doc says "engine's explanation for the assignment". Manual edits write `manual override by admin #<id>`, and saved plans persist the client-sent `reason` or `'plan'`.
- Fix: document all three sources.
- Confidence: High.

## D. Doctors, users, unavailability, holidays, clinics, settings

<a id="adm-01"></a>
### ADM-01 - An administrator can promote any user in their clinic, including themselves, to the hospital-level `manager` role
- Batch: 1
- Severity: Critical
- Category: Security
- Location: `apps/api/src/services/user.service.ts:191-203` and `:247-250` (related: `apps/api/src/routes/clinic.routes.ts`, `apps/api/src/services/auth.service.ts:107-120`)
- Problem: `update()` only blocks `input.role === 'superadmin'` for non-superadmins. The manager checks only run when the *actor* is a manager. Example: an administrator sends `PATCH /users/<ownId> {"role":"manager"}`. `getById` passes (same clinic, clinic role). Line 248 then adds `clinic_id = NULL`, so `users_clinic_role_check` is satisfied and the UPDATE commits. On the next `/auth/refresh`, `refresh()` re-reads the role and signs a `manager` token with `clinicId: null`. That token can create, rename and deactivate any clinic (`clinic.routes.ts`), read any clinic's doctors, users and availability via `?clinicId=`, and create administrators in any clinic with a password the attacker chooses (`resolveCreateClinic`). That is a full cross-clinic takeover. `create()` already forbids this (`resolveCreateClinic` 403 "Administrators can only create clinic accounts"); `update()` does not.
- Fix: In `update()`, make the role rule match `create()`. When `actor.role === 'administrator'` and `input.role` is `'superadmin'` or `'manager'`, return 403 "Administrators can only manage clinic accounts". Better, have one helper `assertMayAssignRole(actor, role)` used by both `create` and `update`. Test in `user.service.test.ts`: an administrator updating a doctor or themselves to `role: 'manager'` gets 403 and no UPDATE is issued. Add a route test `PATCH /users/:id {role:'manager'}` with an admin token -> 403.
- Confidence: High - traced `update()` line by line, `assertRowVisible`, `users_clinic_role_check` in `database/schema.sql`, `auth.service.refresh`, `clinic.routes.ts`, `resolveClinicScope`.

<a id="adm-02"></a>
### ADM-02 - `/users` breaks the 1:1 link between doctor users and `doctors` rows
- Batch: 6
- Severity: High
- Category: Bug
- Location: `apps/api/src/services/user.service.ts:147-189` (create), `:191-324` (update role change); consumers `apps/api/src/services/schedule.service.ts:171-173`, `apps/api/src/services/settings.service.ts:96-98`, `apps/api/src/services/doctor.service.ts:69-76`; test `apps/api/src/__tests__/user.routes.test.ts:110-121`
- Problem: `docs/database.md` says `doctors` is a "1:1 extension of users rows with role = 'doctor'". `doctor.service.create` keeps this in one transaction, but `/users` does not:
  - `POST /users {role:'doctor'}` (allowed for administrators and superadmins) inserts only the `users` row. The account has no doctor profile: `/doctors/me` and `/unavailability/me` return 404, and the account is never in the doctor list or the scheduling pool.
  - `PATCH /users/:id {role:'administrator'}` on a doctor leaves the `doctors` row. The engine query `WHERE u.is_active = TRUE AND d.clinic_id = $1` has no role filter, so the new administrator keeps getting scheduled and counts toward `activeDoctors` (the slot ceiling). The same applies to `role:'manager'` by a superadmin, with `clinic_id` NULL on `users` but set on `doctors`.
  - `PATCH {role:'doctor'}` on an administrator creates a doctor user without a profile.
  
  The existing route test at line 110 locks in the orphan-creating behaviour. The web never calls `POST /users` (it creates doctors via `doctorService.create`), so only direct API callers hit this.
- Fix: In `create()`, reject `input.role === 'doctor'` with 409 "Create doctor accounts via POST /doctors". In `update()`, reject any role change into or out of `'doctor'` with 409 (`existing.role === 'doctor' || input.role === 'doctor'`, when `input.role !== existing.role`). Change `user.routes.test.ts:110` to create an administrator, and add tests for the 409 on `POST /users {role:'doctor'}` and on `PATCH` doctor <-> administrator.
- Confidence: High - read both services, the engine and settings queries, `docs/database.md` doctors section, and the web `UsersPage.vue` call sites.
- Needs decision: Should `/users` refuse doctor creation and role changes across the doctor boundary (recommended), or create/remove the `doctors` row inside the same transaction?

<a id="adm-03"></a>
### ADM-03 - Nothing stops users from deactivating, deleting, demoting or password-resetting themselves, or removing the last administrator or superadmin
- Batch: 1
- Severity: High
- Category: Security
- Location: `apps/api/src/services/user.service.ts:191-324` (update), `:326-351` (remove), `:353-378` (resetPassword)
- Problem: None of these checks `id === actor.id`, and nothing counts the remaining live administrators or superadmins. Examples:
  - An administrator sends `PATCH /users/<self> {isActive:false}` or `DELETE /users/<self>`. The clinic can be left with no administrator, and only a superadmin or manager can recover it.
  - A superadmin deletes the only superadmin account, which leaves the vendor locked out (billing and usage are superadmin-only).
  - `PATCH /users/<self>/password` sets a new password without the current one and revokes all sessions. This bypasses the current-password check in `auth.service.changePassword`, so a stolen 15-minute access token becomes a permanent account takeover.
  
  The task brief lists "cannot disable self / last admin" as a rule, and a grep for self or last-admin guards finds none.
- Fix: Add `assertNotSelf(id, actor)`, which returns 409 "You cannot change your own account here". Call it in `remove`, in `resetPassword` (self should use `/auth/change-password`), and in `update` when `isActive === false`, `role`, or `clinicId` is in the patch. Also add a last-holder check inside the write transaction: `SELECT COUNT(*) FROM users WHERE role = $1 AND is_deleted = FALSE AND is_active = TRUE AND clinic_id IS NOT DISTINCT FROM $2 FOR UPDATE`. When the target is the last active administrator of its clinic, or the last superadmin, return 409. Tests: self-delete, self-deactivate, self-reset and self-demote each give 409; deleting the last superadmin gives 409; deleting one of two administrators works.
- Confidence: High - read all three functions; grep for self or last-admin guards across `apps/api/src` found nothing.

<a id="adm-04"></a>
### ADM-04 - `/users` PATCH and DELETE on doctor accounts skip doctor rules: no draft-duty check, and audit entries are `user.*` (ADM-07 API side)
- Batch: 6
- Severity: Medium
- Category: Correctness
- Location: `apps/api/src/services/user.service.ts:281-323` (action and entity), `:326-351` (remove); compare `apps/api/src/services/doctor.service.ts:233-253`, `:259-285`
- Problem: The web fix for ADM-07 is already in place (`UsersPage.vue:260-262` and `:281-282` send doctors to `doctorService`). The API still lets `PATCH /users/:id` change a doctor's `isActive`, email, name and username, and records `user.deactivated`, `user.reactivated` or `user.updated` with `entityType: 'user'` and the *user* id. A doctor's history is therefore split across two entity types, and the `doctor.deactivated`/`doctor.reactivated` filters miss it. Worse, `DELETE /users/:id` soft-deletes a doctor with no draft-duty check. `doctor.service.remove` returns 409 "Doctor has duties in a draft schedule", but `user.remove` deletes anyway, leaving a deleted doctor's duties in a draft schedule.
- Fix: In `user.service.update` and `remove`, when `existing.role === 'doctor'`, return 409 "Manage doctor accounts via /doctors". The exception is a superadmin `clinicId` move, which has no `/doctors` equivalent and keeps its existing `doctors.clinic_id` sync. `resetPassword` stays on `/users` because it is user-level. Tests: `PATCH /users/:id {isActive:false}` and `DELETE /users/:id` on a doctor row give 409 with no UPDATE issued; the superadmin clinic move still works.
- Confidence: High - read both services and the web call sites (`UsersPage.vue:183-282`).
- Needs decision: Should doctor accounts be rejected on `/users` (recommended; the web already complies), or should `user.service` delegate to `doctorService` internally?

<a id="adm-05"></a>
### ADM-05 - `POST /unavailability` and `PUT /holidays/month` never validate the `clinicId` query parameter
- Batch: 4
- Severity: Medium
- Category: Bug
- Location: `apps/api/src/routes/unavailability.routes.ts:21`, `apps/api/src/routes/holiday.routes.ts:17-22`, `apps/api/src/controllers/unavailability.controller.ts:31-33` (comment says "typed by validate(unavailabilityQuerySchema) upstream", which is false), `apps/api/src/controllers/holiday.controller.ts` setMonth
- Problem: Neither route runs `validate(..., 'query')`, so `req.query.clinicId` reaches `resolveClinicScope` as a raw string.
  - An administrator calling `POST /unavailability?clinicId=1` with their own clinic gets 403, because `'1' !== 1`.
  - A superadmin (who must pass `clinicId` once several clinics exist) sending `?clinicId=abc` gets a pg `22P02` error, returned as 500.
  - `PUT /holidays/month?clinicId=999` hits the `holidays.clinic_id` FK (`23503`) and returns 500 instead of 404.
  
  Every other clinic-scoped write (`POST /doctors`, `PATCH /settings/*`) validates the query.
- Fix: Add one shared `clinicQuerySchema = z.object({ clinicId: z.coerce.number().int().positive().optional() })` (see ADM-16) and use `validate(clinicQuerySchema, 'query')` on both routes. Delete the false controller comment. In `holiday.setMonth`, start with `SELECT is_active FROM clinics WHERE id = $1 FOR UPDATE` and return 404 if there is no row (this also fixes ADM-12). Route tests: an admin with `?clinicId=<own>` gets 201/200; a superadmin with `?clinicId=abc` gets 400; `PUT /holidays/month?clinicId=999` gets 404.
- Confidence: High - read the routes, controllers, `resolveClinicScope` and `validate` middleware.

<a id="adm-06"></a>
### ADM-06 - Deactivating a clinic does not end existing sessions
- Batch: 1
- Severity: Medium
- Category: Security
- Location: `apps/api/src/services/clinic.service.ts:63-77`, `apps/api/src/services/auth.service.ts:107-120`
- Problem: D10 says "Users of a deactivated clinic cannot log in" (`auth.service.ts:87-89`), but only `login()` checks `clinic_is_active`. `refresh()` checks only `row.is_active`. `clinic.update({isActive:false})` revokes nothing. Every user already signed in to a deactivated clinic keeps rotating refresh tokens and working indefinitely.
- Fix: In `refresh()`, add `if (row.clinic_is_active === false) throw new HttpError(403, 'Clinic is deactivated')`. Optionally, when `clinic.update` sets `isActive=false`, also run `UPDATE refresh_tokens SET revoked_at = NOW() WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE clinic_id = $1)` in the same transaction. Test in `auth.service.test.ts`: refresh for a user row with `clinic_is_active: false` gives 403.
- Confidence: High - read `login`, `refresh` and `clinic.update`.
- **Merge note:** Duplicate of CORE-02. Implement there; do not change the code twice.

<a id="adm-07"></a>
### ADM-07 - The deployment-wide open-duty interval can be changed by any clinic's administrator
- Batch: 5
- Severity: Medium
- Category: Security
- Location: `apps/api/src/routes/settings.routes.ts:15-21`, `apps/api/src/services/settings.service.ts:45-64`; consumers `apps/api/src/services/schedule.service.ts:160,824,971,1065,1154,1190`, `stats.service.ts:87`
- Problem: `open_duty_interval_days` lives in `app_meta` (global), but `PATCH /settings/open-duty` is `authorize('administrator')`. The administrator of clinic A can change which days are open on-call days for every clinic. This changes slot counts, minimums and the one-open-duty cap used by other clinics' generation, duty edits and publish validation, and it relabels days in schedules that already exist. The audit row carries only clinic A's id, so clinic B's audit page never shows the change. This conflicts with the multi-clinic rule ("every query must be scoped to the caller's clinic").
- Fix: Either restrict the PATCH to hospital roles (`authorize('superadmin')`, or manager plus superadmin) and keep the GET for administrators, or move the interval onto `clinics` like the slots and minimums. Add a route test: an administrator PATCH gets 403 (if restricted).
- Confidence: High - read the route, service and every consumer.
- Needs decision: Is the open on-call cycle a hospital-wide fact (restrict the write to hospital roles) or per clinic (new `clinics` column plus a `schema.sql`/`docs/database.md` update)?

<a id="adm-08"></a>
### ADM-08 - Production `initialize.sql` creates `admin@oncall.local` with the public password `changeme123`, and nothing forces a change (ADM-01 carry-over, API side)
- Batch: 6
- Severity: Medium
- Category: Security
- Location: `database/initialize.sql:209-216` (hash `$2b$12$6ufrbl6w...`, the same hash the seeds document as `changeme123`), `apps/api/src/services/auth.service.ts:77-105`
- Problem: The web part of ADM-01 is fixed: grep finds no `changeme` in `apps/web/src`, and admins now type the initial password. The API still has no "must change password" state. The README says default passwords "MUST be changed on first login", but `login()` issues full tokens. Every fresh production install exposes a clinic administrator with a documented password until someone changes it by hand.
- Fix: The minimal option is to make `initialize.sql` take the admin hash from a `psql -v` variable, or to document generating it, so no known hash ships. The full option is a `users.must_change_password BOOLEAN NOT NULL DEFAULT FALSE` column (update `schema.sql`, `initialize.sql` and `docs/database.md`). `login`/`refresh` would return the flag, and `authenticate` would refuse everything except `/auth/change-password` while it is set.
- Confidence: High - compared the hashes in `initialize.sql` and `single-clinic.seed.sql`, and read `login`.
- Needs decision: Is a forced-change flag (schema change) in scope, or only removing the known hash from `initialize.sql`?

<a id="adm-09"></a>
### ADM-09 - Deactivation does not revoke refresh tokens, so reactivating an account revives old sessions
- Batch: 1
- Severity: Low
- Category: Security
- Location: `apps/api/src/services/doctor.service.ts:160-257`, `apps/api/src/services/user.service.ts:191-324`
- Problem: `remove` and `resetPassword` call `tokenService.revokeAllForUser`, but `update({isActive:false})` in both services does not. `refresh()` rejects inactive users, so the old tokens stay valid in `refresh_tokens`. When the admin later reactivates the account, any old or stolen refresh cookie works again.
- Fix: After the transaction in both `update`s, when `isActiveChanged && input.isActive === false`, call `await tokenService.revokeAllForUser(userId)`. Tests: deactivation calls `revokeAllForUser`, and reactivation does not.
- Confidence: High.

<a id="adm-10"></a>
### ADM-10 - A superadmin moving a user to `manager`/`superadmin` with a `clinicId` gets 500
- Batch: 1
- Severity: Low
- Category: Bug
- Location: `apps/api/src/services/user.service.ts:247-256`
- Problem: Line 248 nulls `clinic_id` only when `input.clinicId === undefined`. `PATCH {role:'manager', clinicId: 2}` sets `clinic_id = 2` and fails `users_clinic_role_check` (`23514`). The error handler maps only `23505`, so the response is 500.
- Fix: When `targetRole` is a hospital role and `input.clinicId !== undefined`, return 400 "Hospital roles carry no clinic". Add a test.
- Confidence: High.

<a id="adm-11"></a>
### ADM-11 - `PATCH /users/me/theme` and `/me/language` return `clinicName: null` for clinic users
- Batch: 6
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/services/user.service.ts:384-408`
- Problem: Both use `RETURNING ... NULL AS clinic_name` and copy the column list, so the `User` response says `clinicName: null` for every clinic user. The web reads only `darkMode`/`language` (`stores/auth.ts:61-71`), so nothing breaks today, but the response contradicts the shared `User` type.
- Fix: Run `UPDATE ... RETURNING id`, then `selectUserById` (which already joins clinics), and drop the duplicated column list. Add a test asserting `clinicName` is returned.
- Confidence: High.

<a id="adm-12"></a>
### ADM-12 - Two concurrent `PUT /holidays/month` for the same month merge both sets instead of keeping the last one
- Batch: 4
- Severity: Low
- Category: Bug
- Location: `apps/api/src/services/holiday.service.ts:37-75`
- Problem: Under READ COMMITTED, T2's `DELETE` does not see rows T1 inserts, and T2's `INSERT ... ON CONFLICT DO NOTHING` skips T1's conflicting rows. The result is the union of both requests, not the later one.
- Fix: As the first statement in the transaction, run `SELECT 1 FROM clinics WHERE id = $1 FOR UPDATE` (404 if missing; shared with ADM-05). Also use one month predicate everywhere (`holiday_date >= MAKE_DATE($2,$3,1) AND holiday_date < MAKE_DATE($2,$3,1) + INTERVAL '1 month'`) instead of `date_trunc` in the DELETE and `EXTRACT` in the SELECT.
- Confidence: Medium - concurrency reasoning, not reproduced.

<a id="adm-13"></a>
### ADM-13 - Unavailability edits on a soft-deleted doctor commit and then return 404
- Batch: 6
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/services/unavailability.service.ts:176-261`, `:320-425`, `:427-457`; `assertCanModify` `:66-81`
- Problem: The existence queries and the administrator clinic check (`SELECT 1 FROM doctors WHERE id = $1 AND clinic_id = $2`) ignore `users.is_deleted`. `PATCH /unavailability/:id` on a deleted doctor's record commits the UPDATE and the audit row, then `getById` (which joins `u.is_deleted = FALSE`) returns 404. `split` returns `[]`, and `remove` returns 204. `create` correctly refuses deleted doctors.
- Fix: Add `JOIN users u ON u.id = d.user_id AND u.is_deleted = FALSE` to the three `SELECT x.doctor_id, d.clinic_id ...` lookups, so a deleted doctor's records give 404 before any write. Add a test.
- Confidence: High.

<a id="adm-14"></a>
### ADM-14 - Holiday, unavailability and max-duty changes for months that already have schedules are accepted without any warning
- Batch: 6
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/services/holiday.service.ts:37-75`, `apps/api/src/services/unavailability.service.ts` (create/update/split), `apps/api/src/services/doctor.service.ts:209-214`
- Problem: Holidays are read live for the holiday cap (`schedule.service.ts:992-1010`); `duties.is_weekend` covers weekends only. Marking extra holidays in a month with a published schedule can push doctors past `HOLIDAY_DUTY_CAP = 2` after the fact. Likewise, a doctor can add unavailability on a day they hold a published duty, and an admin can lower `maxMonthlyDuties` below the duties already assigned. None of these is flagged anywhere.
- Fix: If a guard is wanted, in each write check for duties in the affected range or month and return 409 (published) or a warning list (draft). Otherwise, document that published schedules are snapshots.
- Confidence: Medium - read the writers and the schedule service holiday-cap and unavailability use; no spec rule found either way.
- Needs decision: Should holiday, unavailability and `maxMonthlyDuties` changes that conflict with an existing draft or published schedule be refused (409), warned about, or allowed silently as now?

<a id="adm-15"></a>
### ADM-15 - The hospital-role filter in `user.list` never filters anything
- Batch: 6
- Severity: Low
- Category: Dead code
- Location: `apps/api/src/services/user.service.ts:98-108`; test `apps/api/src/__tests__/user.service.test.ts:93-108`
- Problem: The query already requires `u.clinic_id = $1`. `users_clinic_role_check` forces `clinic_id IS NULL` for `superadmin`/`manager`, so `AND u.role NOT IN ('superadmin','manager')` can never remove a row. The tests at lines 98 and 106 only check that the dead SQL text is present.
- Fix: Drop `hideHospitalRoles` and the `actor` parameter of `list` (and its controller argument). Keep the comment about why hospital accounts never appear. Delete the two SQL-substring tests; keep "list maps rows to User".
- Confidence: High.

<a id="adm-16"></a>
### ADM-16 - The same account-CRUD code is copied across `doctor.service` and `user.service`
- Batch: 9
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/services/doctor.service.ts:100-120,168-181,215-253`; `apps/api/src/services/user.service.ts:88-96,147-162,215-228,259-296,412-424`; `apps/api/src/validators/{doctor,user}.ts`; `packages/shared/src/schemas/{settings,unavailability,holiday}.ts`
- Problem:
  - The email/username duplicate checks appear 7 times.
  - The `before`/`after` diff block appears twice.
  - `doctor.create` inlines a copy of `assertClinicUsable`.
  - `bcrypt.hash(..., 12)` appears in 4 places (including `auth.service.ts:148`).
  - `oneRow` and `type Actor` are redefined per service, and `?? 7` is redundant after `createDoctorSchema.default(7)` (`doctor.service.ts:131,146`).
  - Five identical `clinicId` query schemas exist (`doctorQuerySchema`, `userQuerySchema`, `dutySlotsQuerySchema`, plus the fields in `unavailabilityQuerySchema` and `holidayQuerySchema`). `idParams` lives in `validators/user.ts` and is re-exported by unrelated validators.
  - The unavailability and doctor controllers repeat `if (!req.user) throw 401` after `authenticate`, while the other controllers use `req.user!`.
- Fix: Add a small `services/account.ts` with `assertIdentityFree(client, {email, username}, excludeId?)`, `hashPassword(pw)` (the only place cost 12 appears), `assertClinicUsable(clinicId)`, and `diffFields(existing, input, keys)`. Use one `clinicQuerySchema` and one `idParams` from `@oncall/shared` (needed by ADM-05). Drop the redundant `?? 7` and the `req.user` re-checks. No behaviour change; existing tests stay green.
- Confidence: High - read both services and the validators.
- **Merge note:** The schema part (`clinicQuerySchema`, `idParams`) is done by CORE-12. The `Actor` type part is done by CORE-19. This finding keeps only the `services/account.ts` helpers and the redundant `?? 7` / `req.user` checks.

<a id="adm-17"></a>
### ADM-17 - Settings changes and their audit rows are written in separate transactions
- Batch: 5
- Severity: Low
- Category: Maintainability
- Location: `apps/api/src/services/settings.service.ts:45-64`, `:116-171`, `:201-245`
- Problem: Every other domain writes its audit row with `recordActivity(client, ...)` inside the business transaction ("a failed audit write fails the business change", `activity.service.ts:22`). Settings runs `query(UPDATE)` and then `logActivity`, which opens its own transaction. If the audit insert fails, the client gets 500 but the setting is already changed, with no audit row. The read-check-write of slots and minimums is also not atomic. It is masked by the read-side clamp, but still a second pattern.
- Fix: Wrap each setter in `withTransaction`. Lock the clinic row with `SELECT ... FROM clinics WHERE id = $1 FOR UPDATE`, re-read the slots, minimums and active-doctor count on that client, then UPDATE and `recordActivity(client, ...)`. Update `settings.service.test.ts` to assert `recordActivity` instead of `logActivity`.
- Confidence: High.
- **Merge note:** Duplicate of RPT-02 (settings half). Implement there.

<a id="adm-18"></a>
### ADM-18 - Several tests assert nothing useful or duplicate other tests
- Batch: 11
- Severity: Low
- Category: Test gap
- Location: `apps/api/src/__tests__/unavailability.service.test.ts:155-156,173-176,305-306`; `doctor.service.test.ts:93-98,235-243,258-269`; `user.service.test.ts:252-261,404-415`; `unavailability.routes.test.ts:124-131`; `doctor.isolation.test.ts:27-52`
- Problem:
  - `find(c => sql.includes('X'))` followed by `expect(sql).toContain('X')` is tautological (unavailability 156, 174, 176, 306). The "excludes self" test never checks that the id parameter is passed.
  - `remove allows deletion when duties exist only in published schedules` uses the same mocks as the success test and cannot tell draft from published.
  - `getByUserId excludes deleted`, `getById excludes deleted` and both `create duplicate checks ignore deleted accounts` only check SQL text.
  - `update skips the audit row when nothing changed` has a false comment ("early return"; the code runs the UPDATE).
  - The unavailability route test routes mocks by call count (`let n = 0`).
  - The isolation test cleans up inside the test body, so a failing assertion leaks rows.
- Fix: Delete the tautological assertions and replace the self-exclusion one with `expect(overlap?.[1]).toEqual([5, '2026-09-12', '2026-09-07', 1])`. Delete the duplicate published-schedule test, or move it to a live-DB test with a real draft and a published schedule. Delete the SQL-substring "is_deleted" tests (the live-DB isolation suite is the right place). Fix the misleading comment. Use SQL-keyed mocks. Move the isolation cleanup into `try/finally`.
- Confidence: High.

<a id="adm-19"></a>
### ADM-19 - Key admin rules have no tests
- Batch: 11
- Severity: Low
- Category: Test gap
- Location: `apps/api/src/__tests__/doctor.service.test.ts`, `user.service.test.ts`, `unavailability.routes.test.ts`, `holiday.routes.test.ts`
- Problem: There are no tests for:
  - `doctor.update` email/username 409.
  - `doctor.update` `isActive` -> `doctor.deactivated`/`doctor.reactivated` (the ADM-07 audit actions).
  - `doctor.update` with nothing changed -> no audit.
  - An administrator assigning `manager` (ADM-01).
  - Role changes involving doctors (ADM-02).
  - Self-actions (ADM-03).
  - Clinic query validation on `POST /unavailability` and `PUT /holidays/month` (ADM-05).
  - `refresh` for a deactivated clinic (ADM-06).
- Fix: Add the tests listed in each finding above, plus `doctor.service` tests for the update 409s and the deactivate/reactivate action names.
- Confidence: High.

<a id="adm-20"></a>
### ADM-20 - Non-ASCII characters in code comments
- Batch: 13
- Severity: Low
- Category: Maintainability
- Location: `apps/api/src/services/doctor.service.ts:58,102`, `user.service.ts:88,121,304,383,397`, `settings.service.ts:176`, `unavailability.service.ts:268`, `routes/user.routes.ts:19,28`, `__tests__/doctor.isolation.test.ts:4`
- Problem: Em-dashes, arrows, the less-or-equal sign and the section sign break the project's ASCII-only rule (found with `git grep -nP "[^\x00-\x7F]"`).
- Fix: Replace them with `-`, `->`, `<=` and `section`.
- Confidence: High.

## E. Stats, reports, usage, billing, activity

<a id="rpt-01"></a>
### RPT-01 - Hospital-wide settings events still never show in the activity log (rest of ADM-04)
- Batch: 5
- Severity: Medium
- Category: Correctness
- Location: `apps/api/src/services/activity.service.ts:87-88`, `apps/api/src/services/billing.service.ts:56-62`, `apps/api/src/services/settings.service.ts:55-62`, `apps/api/src/routes/settings.routes.ts:20-25`, `packages/shared/src/schemas/audit.ts:30-31`, `apps/web/src/pages/ActivityPage.vue:35-36`
- Problem: The auth part of ADM-04 is done. `login`, `logout` and `changePassword` now pass `clinicId` (`auth.service.ts:97-103,125-131,154-160`). Two events are still unreachable:
  - `billing.updated` is written with `clinic_id = NULL`. `list` always filters `a.clinic_id = $1`. `activityQuerySchema` still accepts `action=billing.updated`, but that filter always returns 0 rows, and nobody can see billing changes in any UI. The web works around this by hiding the option.
  - `open_duty_settings.updated` changes the one global `app_meta` interval, so it affects every clinic's schedules. It is logged with `clinicId: actor.clinicId`. `PATCH /settings/open-duty` is `authorize('administrator')`, which also lets superadmin in. When the superadmin (clinicId null) changes it, the row is invisible. When clinic A's administrator changes it, the row shows only in clinic A's log, while clinic B's schedules change with no audit entry.
- Fix: Treat these two as hospital-wide events. Export `HOSPITAL_WIDE_ACTIONS = ['billing.updated', 'open_duty_settings.updated'] as const` from `packages/shared/src/schemas/audit.ts`. In `setOpenDutyInterval`, stop passing `clinicId` (store NULL) and narrow `actor` back to `Pick<AuthUser,'id'|'role'>`. In `list`, change the clinic clause to `(a.clinic_id = $1 OR (a.clinic_id IS NULL AND a.action = ANY($2::text[])))` and apply it to both the count and the page query. Remove the `billing.updated` exclusion in `ActivityPage.vue:35-36` and its test (`ActivityPage.test.ts:84-93`). Tests: an activity.service test that the clinic clause includes NULL-clinic hospital-wide rows (params contain the action list); a settings.service test that `open_duty_settings.updated` is logged without `clinicId`. Update the `activity_log.clinic_id` note in `docs/database.md`.
- Confidence: High. I read `activity.service.ts list`, every `logActivity` caller, `authorize.ts:7` (administrator admits superadmin) and `settings.routes.ts:20-25`.
- Needs decision: Should hospital-wide events (billing deadline, global open-duty interval) appear in every clinic's activity view? The other option is to drop `billing.updated` from the filterable actions and accept that billing changes are never visible.

<a id="rpt-02"></a>
### RPT-02 - Billing update and its audit row are not atomic; same pattern in settings and changePassword
- Batch: 5
- Severity: Medium
- Category: Bug
- Location: `apps/api/src/services/billing.service.ts:43-64`, `apps/api/src/services/activity.service.ts:37-40`, `apps/api/src/services/settings.service.ts:47-66,146-176,215-240`, `apps/api/src/services/auth.service.ts:141-161`
- Problem: `setPaidThrough` makes three separate pool calls: it reads `previous`, upserts `app_meta`, then calls `logActivity` (its own transaction). If the audit INSERT fails (connection drop, pool exhaustion), the deadline has already changed. The superadmin gets 500 and there is no audit row. This breaks the documented contract at `activity.service.ts:22` ("a failed audit write fails the business change"). Two concurrent PATCHes can also both read the same `previous`, so the audit `detail.previous` is wrong. The `logActivity` docstring says it is for auth events only, yet billing and all three settings setters use it after unlocked writes. `changePassword` does UPDATE, revoke and log as three separate steps.
- Fix: In `setPaidThrough`, use `withTransaction(async (client) => { SELECT value FROM app_meta WHERE key = $1 FOR UPDATE; upsert; await recordActivity(client, {...}) })`, then return `getState()`. Apply the same shape to `setOpenDutyInterval`, `setDutySlots`, `setDutyMinimums`: `SELECT ... FROM clinics WHERE id = $1 FOR UPDATE` inside the transaction, which also closes the slots/minimums check-then-write race. Apply it to `changePassword` as well. Keep `logActivity` only for login/logout (where AUTH-05 in the low-resource plan suggests a plain INSERT). Test: in billing.service.test, make `recordActivity` reject and assert the error propagates and the mocked client receives the upsert inside the same `withTransaction`.
- Confidence: High. I read billing/settings/auth services and `db/client.ts withTransaction`.
- **Merge note:** ADM-17 is the settings half of this finding. CORE-07 covers `changePassword`/`resetPassword`; do not change those here.

<a id="rpt-03"></a>
### RPT-03 - Billing lock tests check a JS re-implementation, not the SQL
- Batch: 5
- Severity: Medium
- Category: Test gap
- Location: `apps/api/src/__tests__/billing.service.test.ts:24-50,52-61,87-96`
- Problem: The `query` mock computes `locked` (`value < today`) and `days_left` in JavaScript. The tests in `missing app_meta row...`, `a paidThrough in the past locks the system` and `getPaymentAlert: counts whole days` assert the mock's own output. Changing `CURRENT_DATE > value::date` to `>=` in `isLocked`, or flipping the subtraction in `getPaymentAlert`, would still pass. The lockout blocks every non-superadmin, and its boundary day (`paidThrough = today` must stay unlocked) is never tested. The comment "the DB-backed suite does the same DELETE" points to a suite that does not exist (grep found none).
- Fix: Replace these three tests with a real-database suite using the pattern in `usage.service.test.ts:1-9` (dotenv + `await import('../db/client.ts')`). Upsert `billing_paid_through` to yesterday, today and tomorrow (computed in SQL with `CURRENT_DATE +/- 1`), then assert `isLocked()` is true/false/false and `getPaymentAlert().daysLeft` is -1/0/1. Delete the key in `afterAll`. Keep the `setPaidThrough` audit-shape tests on mocks. Delete the misleading comment.
- Confidence: High. I read the test file and grepped for another billing DB suite.

<a id="rpt-04"></a>
### RPT-04 - Workload drops duties of doctors moved to another clinic; doctor dashboard mixes clinics
- Batch: 7
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/services/stats.service.ts:100-107,139-163,201-208`
- Problem: `user.service.update` lets a doctor change clinic (`UPDATE doctors SET clinic_id` at `user.service.ts:302-306`) with no duty check. After the move:
  - `adminStats` for the old clinic gets the doctor's duties in `counts` (`GROUP BY doctor_id` over the schedule). The doctor is in neither the active list (`d.clinic_id = $1`) nor the inactive list (`u.is_active = FALSE ... AND d.clinic_id = $2`), so the duties are silently left out of `workload` and `fairness`. The sum of workload is then lower than the duty count, and the Reports workload table is wrong.
  - In `meStats`, `published` and `upcoming` filter on the new clinic, but `countsRes` has no clinic filter. The dashboard can show `published: false` together with `duties: 4`.
- Fix: Replace the inactive query with one that returns every doctor who has duties in the schedule: `SELECT DISTINCT d.id, u.first_name, u.last_name, d.max_monthly_duties, (u.is_active AND d.clinic_id = $2) AS active FROM duties du JOIN doctors d ON d.id = du.doctor_id JOIN users u ON u.id = d.user_id WHERE du.schedule_id = $1`. Add the rows not already in `byId`, with `isActive: r.active`. In `meStats`, add `AND s.clinic_id = $4` to `countsRes` so all four queries use the same clinic. Test: an adminStats case where `counts` has doctor 7, who is in neither list, now appears in workload with `isActive: false`.
- Confidence: Medium. I read stats.service and user.service update. Transfers are allowed, but I did not confirm how often they happen.

<a id="rpt-05"></a>
### RPT-05 - Resolving an alert that is already resolved returns 409 instead of being idempotent
- Batch: 5
- Severity: Low
- Category: Bug
- Location: `apps/api/src/services/usage.service.ts:193-207`, `apps/api/src/__tests__/usage.routes.test.ts:61-67`
- Problem: The web in-flight guard (ADM-06) is in place (`UsagePage.vue:63-72`). But the endpoint still turns "already in the requested state" into an error. A second tab with a stale list, or a client retry after a network timeout, gets `409 Alert already resolved` for an action that succeeded, and the page shows an error. `resolveAlert` also needs two queries on that path. The 409 and 200 paths have no tests (only 404 is tested, through a mock).
- Fix: Make PATCH idempotent: `UPDATE operator_alerts SET resolved_at = COALESCE(resolved_at, NOW()) WHERE id = $1 RETURNING ...`. No row means 404; otherwise return 200 with the row, which keeps the original `resolved_at`. Remove the second SELECT and the 409 branch. Tests: a real-DB usage.service test that resolving twice returns the same `resolvedAt` both times; and resolve on a missing id gives 404.
- Confidence: High. I read usage.service, UsagePage.vue and usage.routes.test.
- Needs decision: Is dropping the 409 for an already-resolved alert acceptable to the web? (UsagePage just reloads, so no web change is needed.)

<a id="rpt-06"></a>
### RPT-06 - Clinic create/update/deactivate and alert resolution are not audited
- Batch: 5
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/services/clinic.service.ts:53-80`, `apps/api/src/services/usage.service.ts:193`, `packages/shared/src/schemas/audit.ts:4-34`
- Problem: Every other mutating service writes an `activity_log` row. `clinic.service.create` and `update` do not, and `update` includes `is_active = FALSE`, which locks every user of that clinic out at login (`auth.service.ts:88`). A manager deactivating a clinic leaves no trace. `ACTIVITY_ACTIONS` has no `clinic.*` entries.
- Fix: Add `clinic.created`, `clinic.updated`, `clinic.deactivated`, `clinic.reactivated` to `ACTIVITY_ACTIONS`. Wrap the clinic writes in `withTransaction`, call `recordActivity(client, { ..., clinicId: id, detail: { before, after } })`, and pass `req.user` from `clinic.controller`. Tests: clinic.service tests asserting `recordActivity` is called with the matching action.
- Confidence: High. I grepped every `logActivity`/`recordActivity` caller; `clinic.service.ts` has none.
- Needs decision: Should clinic lifecycle events (and operator-alert resolution) be part of the audit trail? This adds new actions to the web filter.

<a id="rpt-07"></a>
### RPT-07 - Activity filter accepts from > to and silently returns an empty page
- Batch: 4
- Severity: Low
- Category: Correctness
- Location: `packages/shared/src/schemas/audit.ts:36-44`, `apps/api/src/services/activity.service.ts:97-104`
- Problem: `?from=2026-09-30&to=2026-09-01` passes validation and runs `created_at >= '2026-09-30' AND created_at < '2026-09-02'`. The result is 200 with 0 rows, which looks like "no activity" instead of 400 bad input.
- Fix: Add `.refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, { message: 'from must not be after to', path: ['to'] })` to `activityQuerySchema`. Test: in `packages/shared/src/__tests__/schemas.test.ts`, from > to is rejected; in `activity.routes.test.ts`, the same request returns 400.
- Confidence: High.

<a id="rpt-08"></a>
### RPT-08 - "Today" and the default month are UTC calendar days, not the hospital's local day
- Batch: 7
- Severity: Low
- Category: Correctness
- Location: `apps/api/src/services/stats.service.ts:43-56,213-219`, `apps/api/src/controllers/stats.controller.ts:12-14`, `apps/api/src/controllers/reports.controller.ts:12-14`, `apps/api/src/services/activity.service.ts:99,103`
- Problem: The deployment is Greek (el UI, Greek holidays), and no timezone is configured anywhere (grep for `timezone`/`TZ` found only web formatters). Examples:
  - From 00:00 to 02:00/03:00 Athens time, `todayISO()` returns yesterday, so the doctor's "next 7 days" window starts a day early.
  - On the 1st of a month before 02:00, the dashboard and Reports default to the previous month.
  - The activity `from`/`to` dates are cast to `timestamptz` at UTC midnight, so the last 2-3 hours of a local day fall into the next day's filter.
- Fix: Add `APP_TIMEZONE` (default `Europe/Athens`) to `config/env.ts`. Compute "today" and "current year-month" through one helper, `localToday()` using `Intl.DateTimeFormat('en-CA', { timeZone })`, in `scheduling/dates.ts`. In activity `list`, use `a.created_at >= ($n::date::timestamp AT TIME ZONE $tz)` with the matching `< (($m::date + 1)::timestamp AT TIME ZONE $tz)`. Test: a pure test of `localToday` at `2026-11-10T23:30:00Z` returning `2026-11-11`.
- Confidence: Medium. I confirmed the UTC usage; impact depends on the deployment timezone.
- Needs decision: Should server-side "today" and the activity date range follow the hospital timezone instead of UTC?

<a id="rpt-09"></a>
### RPT-09 - monthlyReport passes `actor` only for an unreachable check and reads the schedule twice
- Batch: 7
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/services/reports.service.ts:6-24`, `apps/api/src/controllers/reports.controller.ts:16`, `apps/api/src/__tests__/reports.service.test.ts:96-107`
- Problem: `adminStats` already selects the schedule with `s.clinic_id = scope.clinicId`, and `resolveClinicScope` pins administrators to their own clinic. So `getScheduleDuties(stats.schedule.id, actor)` can never fail the cross-clinic check. It just reads the schedule row a second time (QRY-05). The test `propagates the cross-clinic 404 from the roster read` covers a state production cannot reach (adminStats returning another clinic's schedule).
- Fix: Drop the `actor` parameter from `monthlyReport` and the `Actor` type. Read the roster with a duties-only query: export a `listDutiesBySchedule(scheduleId)` from schedule.service that runs the existing `SELECT_DUTY ... WHERE du.schedule_id = $1 ORDER BY du.duty_date, du.id`, and reuse it inside `getScheduleDuties`. Update the controller call. Delete the 404 test and update `toHaveBeenCalledWith` in the other tests.
- Confidence: High. I read reports.service, `schedule.service.ts:100-108,802-812`, `scope.ts` and `stats.service.ts:64-70`.

<a id="rpt-10"></a>
### RPT-10 - MonthlyReport.clinicName is unused and duplicates schedule.clinicName
- Batch: 7
- Severity: Low
- Category: Dead code
- Location: `apps/api/src/services/reports.service.ts:30`, `packages/shared/src/types/reports.ts:14-15`
- Problem: `clinicName` is always `stats.schedule?.clinicName ?? null`, the same value as `report.schedule.clinicName`. No web code reads it (grep of `apps/web/src` for `clinicName` finds only `UsagePage` generation rows and test fixtures). It is also misleading: it is null for an empty month even though the clinic is known.
- Fix: Remove `clinicName` from `MonthlyReport` and from `monthlyReport`; drop the `clinicName` assertions in `reports.service.test.ts`.
- Confidence: High. I grepped the web app.

<a id="rpt-11"></a>
### RPT-11 - Identical stats/report query schemas and a duplicated default-month step in two controllers
- Batch: 7
- Severity: Low
- Category: Simplification
- Location: `packages/shared/src/schemas/stats.ts:3-7`, `packages/shared/src/schemas/reports.ts:3-7`, `packages/shared/src/types/stats.ts:3-7`, `packages/shared/src/types/reports.ts:4-8`, `apps/api/src/services/stats.service.ts:265-266`, `apps/api/src/controllers/stats.controller.ts:12-14,24`, `apps/api/src/controllers/reports.controller.ts:6,12-14`, `apps/api/src/__tests__/stats.routes.test.ts:9-16,83-91`, `apps/api/src/__tests__/reports.routes.test.ts:11-14`
- Problem: `statsQuerySchema` and `reportQuerySchema` are byte-identical, and so are `StatsQuery` and `ReportQuery`. Both controllers repeat `currentYearMonthUTC()` + `q.year ?? now.year`, using an alias re-export whose comment claims it avoids duplication. The route tests mock `currentYearMonthUTC` with a copy of its body, so the "resolves to the current month" tests check the mock, not the code. `if (!req.user) throw 401` in `statsController.me` is dead, because `authenticate` already guarantees `req.user`.
- Fix: Keep one `monthQuerySchema` / `MonthQuery` in shared (re-exported from both validator files) and delete the duplicates. Have `adminStats(scope, year?, month?)` resolve the default internally from the private `currentYearMonth()`, and remove the alias export. Drop the `currentYearMonthUTC` mocks and the two default-month route tests; add one stats.service test that `adminStats(scope)` queries the current UTC year/month. Remove the dead 401 check.
- Confidence: High.

<a id="rpt-12"></a>
### RPT-12 - Tests that cannot catch consumer-visible bugs
- Batch: 11
- Severity: Low
- Category: Test gap
- Location: `apps/api/src/__tests__/activity.routes.test.ts:100-105`, `apps/api/src/__tests__/activity.service.test.ts:73-76,90-98`, `apps/api/src/__tests__/usage.routes.test.ts:69-74`, `apps/api/src/__tests__/stats.routes.test.ts:134-160`
- Problem:
  - `administrator passing a foreign clinicId gets 403` (activity): administrators are refused by `authorize('superadmin','manager')` before scope is resolved, so the test duplicates the RBAC test and checks nothing about scope.
  - `logActivity wraps recordActivity in a transaction`: the mocked `withTransaction` just calls `work`, and the test asserts only the INSERT text, so removing the transaction would still pass.
  - `list emits one WHERE clause per filter`: checks substrings only. Dropping the `+ 1` on `to` (which loses the whole last day) would pass.
  - `usage summary no longer exists (404)`: pins the absence of a removed route.
  - The `404 for admin` part of the `/stats/me` test asserts a status the test itself injected through `meStats.mockRejectedValue`.
- Fix: Delete the activity admin-foreign-clinic test, the logActivity test, the usage-summary test, and the mocked-404 half of the stats/me test. Replace the WHERE-substring test with assertions on params (`['2026-08-01', '2026-08-31']` in order) and the exact clause `a.created_at < ($5::date + 1)`, or better, a real-DB test with rows at `2026-08-31 23:59:59Z` (included) and `2026-09-01 00:00:00Z` (excluded).
- Confidence: High.

<a id="rpt-13"></a>
### RPT-13 - Alert resolve/list and generation overlap have no tests
- Batch: 5
- Severity: Low
- Category: Test gap
- Location: `apps/api/src/services/usage.service.ts:150-170,185-207`, `apps/api/src/__tests__/usage.service.test.ts:197-210`
- Problem: `generations()` overlap is only checked as `null` (first batch per clinic). The `prev` lookup (`batches.rows.find` with a text compare on `created_at`) and the overlap value for a regeneration are never asserted. `listAlerts` ordering (unresolved first) and `resolveAlert` 200/409 are untested.
- Fix: In the real-DB suite `per-clinic partitioning`, after the clinic B regeneration, assert that the newest clinic B event has `overlapPercent === 0` and the older one `null`. Add `listAlerts` ordering and resolve tests (with RPT-05). If QRY-01 rewrites `generations()`, these tests protect that rewrite.
- Confidence: High.

<a id="rpt-14"></a>
### RPT-14 - isLocked duplicates getState's SQL
- Batch: 5
- Severity: Low
- Category: Simplification
- Location: `apps/api/src/services/billing.service.ts:13-29`
- Problem: `isLocked` and `getState` run the same `CURRENT_DATE > value::date` expression on the same row, so the lock rule lives in two strings.
- Fix: `export async function isLocked() { return (await getState()).locked }`. If DB-02 adds a cache, put it in `getState`. Covered by the RPT-03 DB tests.
- Confidence: High.

<a id="rpt-15"></a>
### RPT-15 - Billing and usage routes import validators from other domains' files
- Batch: 4
- Severity: Low
- Category: Maintainability
- Location: `apps/api/src/routes/billing.routes.ts:6`, `apps/api/src/routes/usage.routes.ts:6`
- Problem: Every other domain has `validators/<domain>.ts` re-exporting from `@oncall/shared`, and doctor/schedule/unavailability re-export `idParams`. Billing imports `updateBillingSchema` from `validators/settings.ts`, and usage imports `idParams` from `validators/user.ts`.
- Fix: Add `validators/billing.ts` (`export { updateBillingSchema } from '@oncall/shared'`) and `validators/usage.ts` (`export { idParams } from './user.ts'`), update the two imports, and remove `updateBillingSchema` from `validators/settings.ts` if nothing else uses it.
- Confidence: High.
- **Merge note:** Superseded by CORE-12 (the `validators/` folder is deleted). Skip if CORE-12 is done.

<a id="rpt-16"></a>
### RPT-16 - docs/database.md leaves `currentDoctors` out of the disjoint_regeneration detail
- Batch: 13
- Severity: Low
- Category: Maintainability
- Location: `docs/database.md:275`, `apps/api/src/services/usage.service.ts:71-90`
- Problem: The INSERT builds `detail` with `year, month, clinicId, clinicName, previousGeneratedAt, previousDoctors, currentDoctors, overlapPercent`. The docs list every key except `currentDoctors`.
- Fix: Add `currentDoctors` to the key list in `docs/database.md`.
- Confidence: High.

<a id="rpt-17"></a>
### RPT-17 - Non-ASCII characters in code and tests
- Batch: 13
- Severity: Low
- Category: Maintainability
- Location: `apps/api/src/services/billing.service.ts:10`, `apps/api/src/services/usage.service.ts:20,37-38,126`, `apps/api/src/__tests__/billing.service.test.ts:34`, `apps/api/src/__tests__/reports.service.test.ts:24`, `apps/api/src/__tests__/stats.service.test.ts:31,170`
- Problem: Em-dashes and the section sign in comments and describe titles break the "no non-ASCII" rule, and the linter does not catch them.
- Fix: Replace each em-dash with `-` and the section sign before `2.6.4` with `section 2.6.4` (or drop the spec reference).
- Confidence: High. I found them with a non-ASCII grep.

## Verified as correct (do not change)

Own checks at review time: `pnpm --filter @oncall/api typecheck` and `pnpm --filter @oncall/api lint` pass. ADM-01, ADM-05, SCH-01, CORE-01 and RPT-02 were re-read in the code after the slice reviews.

### Core and auth

- **Carried-over item (a), change-password 401 -> 400:** already done. `auth.service.ts:147` throws `HttpError(400, 'Current password is incorrect')` since commit 2fe5cbc. `auth.service.test.ts` asserts 400, the web `ProfilePage.test.ts:134` mocks 400, and web `http.ts:50-52` skips refresh for `/auth/login` and `/auth/refresh`. The only gap left is a route-level test (in CORE-03).
- **Carried-over item (b), two-tab refresh:** the web-side fix is enough; no server grace window.
  - The web fix has landed: `apps/web/src/services/auth.ts:11-12` wraps the refresh POST in `navigator.locks.request('oncall-auth-refresh', ...)`, tested in `apps/web/src/__tests__/auth.service.test.ts:26-27`.
  - Web Locks are scoped per origin per browser profile, the same scope as the cookie jar, so every browser request that could send the same refresh cookie is serialised. The second tab sends the already-rotated cookie.
  - The server's reuse detection (`token.service.ts:83-85` revoked-row path, `:104-110` lost-claim path) stays as it is.
  - A grace window would also accept a stolen token replayed within the window. To be useful it would have to hand back the successor token, which is stored only as a hash, so it would need a schema change.
  - What is left is a lost response after commit (network or proxy drop), which ends in a forced re-login. That is acceptable.
- **Token rotation:** the INSERT plus the claim `UPDATE ... WHERE revoked_at IS NULL` in one transaction is a correct atomic claim (a concurrent loser re-evaluates after the winner commits and matches 0 rows). Expiry never extends past the login deadline. `docs/database.md` matches schema.sql for `refresh_tokens` (columns, `idx_refresh_tokens_user`, `idx_refresh_tokens_replaced_by`).
- **`withTransaction`:** a broken client is not returned to the pool. pg-pool's `_release` removes clients with `!client._queryable`, so `release(err)` is not needed.
- **db client setup:** the DATE type parser returns plain strings, and a `pool.on('error')` handler is present.
- **Async errors:** `authenticate` sends async errors through `next(err)`. `rateLimit` and `validate` throw synchronously, which Express 4 catches. All 70 async controller handlers have try/catch (counted per file).
- **JWT:** `verifyAccessToken` pins HS256, checks the `sub`, `role` and `clinicId` claim types, and rejects pre-multi-clinic tokens.
- **Login:** compares against a dummy hash for unknown identifiers (timing), and only reports disabled account, deactivated clinic or billing lock after the password check.
- **Refresh cookie:** httpOnly with `Path=/auth`, matched by nginx `proxy_cookie_path /auth /api/auth`. `clearRefreshCookie` correctly strips `maxAge` for Express 4.22.
- **Client IP in compose:** nginx `$proxy_add_x_forwarded_for` plus `trust proxy 1` gives the real client IP.
- **Docker build context:** `.dockerignore` excludes `**/.env` and `**/node_modules`, so no secrets or host modules go into the image.
- **Scope resolution:** `resolveClinicScope` pins administrators and doctors to the clinic in their JWT (403 for a foreign clinic). The rules and their tests (`scope.test.ts`) are sound.
- **`vitest.d.ts`:** needed, because `health.test.ts`, `jwt-token.test.ts` and `error-handler.test.ts` use Vitest globals without importing them (`globals: true` in `vitest.config.shared.ts`).
- **Health route:** returns the standard envelope; `health.test.ts` covers the contract the compose healthcheck relies on.
- **Typecheck:** `pnpm --filter @oncall/api typecheck` passes.
- **Already tracked in `2026-11-10-low-resource-server-plan.md`, not repeated here:**
  - Deployment: INF-05 (Dockerfile toolchain, web deps, pino-pretty), INF-07 and INF-08 (logging and healthcheck).
  - Auth: AUTH-01 (1h session cap), AUTH-02 (refresh limiter keyed by IP), AUTH-03 (bcrypt CPU limits), AUTH-05 (`logActivity` transaction), AUTH-06 (limiter sweep).
  - Database: DB-01 (pool settings), DB-02 (billing-lock query on every request), DB-04 (sole-clinic query), DATA-01 (`refresh_tokens` never purged).

### Scheduling engine

- `pnpm --filter @oncall/api typecheck` and `lint` both pass.
- All date math is UTC (`prevDate`, `nextDate`, `dayOfWeekISO`, `daysInMonth` via `Date.UTC(y, m, 0)`, `isOpenDutyDate` with `Math.round`), so it is safe across DST and leap years. pg DATE is parsed as a string (`db/client.ts:6`), so the string comparisons in `isAvailable` are valid.
- Both engines enforce the monthly cap, unavailability, the one-open-day cap, one slot per doctor per day, day capacity and the previous-month back-to-back rule (`blockingRule`; `cap_`/`open_`/`b2b_`/`slots_` rows and cell omission).
- The holiday rows `hol_`/`holb_` encode `n <= max(0, 2 - c) + ho` correctly in both `hb` branches; the capacity stage has no relaxation.
- Lexicographic bounds: every minimized stage objective is integral at the optimum (u, ho, rp, ms, dev, hex), so `Math.round` gives an exact bound. `fill` is the only `>=` bound.
- No-good cuts: `bound_fill >= optimum` pins the total, so `sum(S_j) <= |S_j| - 1` excludes exactly S_j. A time-limited alternative incumbent still meets every bound row. Alternatives only run when `state.optimal`.
- The model is always feasible (x=0, u=1), so `Infeasible` in a primary stage can only mean a bug, and it correctly falls back to greedy.
- Greedy passes emit at most one conflict per day, optional passes never relax caps, and required passes stop at the minimum.
- Busy gate: `runExclusive` releases in `finally` on every path (tests cover fallback and loader failure).
- Worker:
  - FIFO queue; a job whose deadline passes while queued resolves null and never reaches the worker.
  - Watchdog fires at remaining + 5 s; a HiGHS error retires the worker.
  - Idle retire after 60 s; a new worker waits for the old one to terminate.
  - ref/unref are balanced; one set of listeners per worker, so no leak.
  - highs 1.15.3 `solve` creates and destroys a Highs instance per call, so reusing the worker carries no state over.
- highs 1.15.3 status strings match the code. Statuses with no solution omit `Primal`, and `chosenCells` guards with `'Primal' in column`.
- Determinism: doctors sorted by id, dates ascending, `threads: 1`, `random_seed: 0`, `mip_rel_gap: 0`.
- Greedy and solver reason formats match the web parser (`apps/web/src/lib/duty-reason.ts`).
- `SchedulingContext` has no pre-assigned or fixed duties, so there is nothing to enforce there.

### Schedule service

- Clinic scoping: `buildContext`, the adjacency queries and the neighbour check join through `schedules.clinic_id`. `validateAssignment` resolves the doctor with `d.clinic_id = $2` (cross-clinic gives 404). `validatePlan` rejects doctors outside `ctx.doctors` (clinic-scoped). The options cache key includes the clinic id.
- `assertScheduleVisible` hides other clinics' schedules and duties with 404 for administrator and doctor.
- Published lock: `addDuty`, `reassignDuty`, `removeDuty` and `remove` all re-check status under `SELECT ... FOR UPDATE`. `publish`/`unpublish` use conditional `UPDATE ... WHERE status = ...`, so state changes are atomic and serialize with duty edits on the same row.
- Concurrent `POST /schedules` for the same clinic and month: `UNIQUE (clinic_id, year, month)` plus the `23505 -> 409` mapping in `error-handler.ts`. Same doctor twice on one day: `idx_duties_schedule_date_doctor`.
- Solver gate: one per process via `runExclusive`, which matches "only one solver run at a time". It is released in `finally` on error. The `highs.ts` watchdog stops a stuck worker, so the gate cannot leak. `SolverBusyError` maps to 429, and the handler sets `Retry-After`. The solve keeps running after a client disconnects, but it is bounded by the 45 s budget.
- The options flow does not persist anything. Alternatives come strictly in order (400 when skipping ahead, 404 after the cache expires). Options are rejected with 409 once a schedule exists. The cache is bounded (TTL 15 min, max 20 entries). The chosen option is re-validated against a fresh context on save.
- `removeDuty` counts the critical-day minimum under the lock. `publish` checks every day's minimum inside the transaction.
- Date handling: the `pg` DATE type parser returns strings, and all date math is UTC string-based (`dates.ts`). `isoDateSchema` rejects impossible dates, and `inMonth` guards `addDuty`.
- Activity is recorded inside the business transaction for generate, delete, duty assign/reassign/remove, publish and revert.
- `docs/database.md` `schedules`/`duties` columns, constraints and indexes match `database/schema.sql:112-142`.
- Status codes: 201 create/add duty, 204 deletes, 200 others. The envelope comes through `ok()` and the error handler.
- `pnpm --filter @oncall/api typecheck` and `lint` both pass.

### Admin domains

- Every read path for doctors, users, unavailability, holidays and settings is clinic-scoped. Lists go through `resolveClinicScope`. Single-row reads use `assertRowVisible`, or `assertCanModify` for unavailability, which returns 404 across clinics. A doctor can edit only their own unavailability, and only administrators and superadmins can toggle `isDisabled`, including through `split`.
- Unavailability create, update and split lock the doctor row (`FOR UPDATE`) before the overlap check, so concurrent overlapping inserts are serialized. Disabled records still reserve their days. Ranges are inclusive. `DATE` is parsed as a string (`db/client.ts`), so no timezone shift. Split is atomic and checks bounds and overlap.
- `doctor.create` writes `users` and `doctors` in one transaction with the same `clinic_id`. The superadmin clinic move keeps `doctors.clinic_id` in step. `doctor.remove` blocks on draft duties and revokes tokens.
- Passwords: bcrypt cost 12 everywhere. `passwordSchema` rejects inputs over 72 bytes. `resetPassword` revokes sessions. The web no longer contains `changeme123`.
- Settings ranges: `maxMonthlyDuties` is 1-7 in both the zod schema and the DB CHECK. `HOLIDAY_DUTY_CAP = 2` is a constant, not an editable setting. Slots are capped at active doctors (422) and kept at or above minimums (409). The open-duty interval is limited to 1-365.
- The holiday schema checks that every date falls inside `year`/`month`, and the month is replaced in one transaction together with its audit row.
- Status codes and the response envelope are correct in all six controllers (201 create, 204 delete, 200 otherwise). The error handler maps `23505` to 409.
- `docs/database.md` matches `schema.sql` for clinics, users, doctors, unavailability and holidays.
- `pnpm --filter @oncall/api typecheck` and `lint` both pass.

### Stats, reports, usage, billing, activity

- Clinic scoping: stats/reports/activity controllers all go through `resolveClinicScope`. Administrator with a foreign clinicId gets 403, manager without clinicId gets 400, superadmin falls back to the sole clinic. Every adminStats query is bound to `scope.clinicId` or a schedule of that clinic.
- RBAC: `authorize('administrator', ...)` admits superadmin (`authorize.ts:7`). Usage and billing writes are superadmin-only. Activity is superadmin/manager. Payment-alert is administrator/manager/superadmin.
- `meStats` binds to the caller's own doctor row; upcoming/on-call are published-only and clinic-scoped.
- The activity date range is half-open (`>= from::date`, `< to::date + 1`); count and page share the same WHERE and params; LIMIT/OFFSET are parameterized; `limit` is capped at 100.
- `resolveAlert` UPDATE is atomic (`WHERE resolved_at IS NULL`), so concurrent resolves cannot double-write; only the error mapping is the issue (RPT-05).
- DATE columns come back as strings (`db/client.ts:6-7`), so `duty_date` keys match `isoDate()` output in coverage.
- `generations()` parses Postgres `timestamptz::text` correctly with `new Date(...)`. Checked in Node: `2026-11-10 12:34:56.123456+00` parses to `...56.123Z`.
- ADM-04 auth part: login/logout/password_changed now record the user's clinic. The web hides `billing.updated` and has the resolve in-flight guard (ADM-06).
- Billing lock and days-left are computed against the DB `CURRENT_DATE`; `updateBillingSchema` rejects impossible dates.
- CSV export (`packages/utils/src/csv.ts`) quotes per RFC 4180 and guards against formula injection.
- `pnpm --filter @oncall/api typecheck` passes.
