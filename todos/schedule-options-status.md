# schedule-options - Status

## Goal

Generate on the Schedules page computes up to 3 different, equally optimal schedule options for the month. The administrator compares them side by side and picks one. Only the picked option is saved, as a draft, through the existing `POST /schedules` path.

- Plan: `docs/superpowers/plans/2026-10-07-schedule-options-plan.md` (Tasks 0-8). Untracked user file; never commit it.
- Solver design: `docs/superpowers/specs/2026-10-05-scheduling-solver-design.md`
- Branch: `multiple_Schedules` (from `main` at `5829a13`). The agent commits on this branch (specific files only, never `commit -A`).

## State (2026-10-07 23:30)

| Task | State | Commit |
|---|---|---|
| 0 Status file | Done (this file) | - |
| 1 Alternative model (pure) | Done | `a1d21c3` |
| 2 Solver `generateOptions` | Done | `d7f570c` |
| 3 Shared types | Done | `4508f00` |
| 4 API service, controller, route | Done | `ca8ad11` |
| 5 Web service and progress composable | Done | `4f2e576` |
| 6 Options page | Done | `b9807da` |
| 7 Smoke run | Partly done (see "Smoke so far") | - |
| 8 Docs | Not started | - |

Last full check (after Task 6): root `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (shared 36, utils 34, api 486, web 387 tests).

## Handoff for the next agent (start at Task 7)

1. Read the plan sections Task 7, Task 8 and "Done when".
2. Task 7 remaining steps (step numbers from the plan):
   - Step 1: `pnpm db:seed:multi` **resets the user's dev database** (now single-clinic, with an October 2026 draft). Ask the user before running it.
   - Step 2: run Generate for the next month of 2 clinics (multi-clinic seed).
   - Step 3: "Use Plan B", check that the draft detail page shows Plan B's duties, then publish.
   - Step 4: 409 on the options page. Already checked on single-clinic; check it again on multi-clinic.
   - Step 5: a month with an unfillable day must redirect to `/schedules/preview`. Not checked live yet (covered only by the unit test).
   - Step 6: record the `POST /schedules/options` time and option count per clinic in this file. If a clinic returns fewer than 3 options, record why (Infeasible or time limit).
3. Task 8 docs: admin manual section 6.4, the "Alternative options" section in the solver design (D1-D6), a single line in `AGENTS.md` Scheduling Engine Requirements, and `docs/database.md` unchanged (confirm here).
4. At the end: root `pnpm typecheck`, `pnpm lint`, `pnpm test`; update this file; commit.

## Environment notes (this machine, Windows)

- The user's `pnpm dev` normally runs already: web on `http://localhost:5174`, API on port **3001** (from `apps/api/.env`), and the API reloads on file changes. Do not start a second API; it fails with `EADDRINUSE`, and its `tsx watch` process stays alive (kill only its own process tree).
- The `bash` service runner (named service with `ready`) fails here (`WSL ... execvpe(/bin/bash) failed`). Do not use it to start dev servers.
- Seed logins (password `changeme123`): single-clinic `admin`; multi-clinic `cardiology-a.admin`, `neurology-a.admin`, etc. The UI language follows the user's profile (the single-clinic `admin` user sees Greek).
- Browser helper (Python): `tab.text(selector)` needs a selector (for example `"main"`). `tab.fill("input[type=password]", ...)`, `tab.click("text/...")` and `tab.pushState("/schedules")` work.

## Smoke so far (2026-10-07 23:25, single-clinic DB, `admin`, Greek UI)

| Check | Result |
|---|---|
| Generate October 2026 (schedule exists) | Options page shows `Schedule already exists for this month; delete it first` and "Back to schedules" |
| Generate November 2026 | Progress bar, then 3 plans after about 3.8 s from submit; Plans B and C each differ from A on 30 of 30 days |
| Plan B tab | `aria-selected`, 30 highlighted days (ring + marker), legend entry, load table highlights the cells that differ from Plan A |
| "Use Plan B" | Confirm dialog opens with the Greek text; Cancel closes it. Nothing saved |

## Implementation map

API (Tasks 1-4):

- `POST /schedules/options`: administrator only; optional `?clinicId=` (superadmin, same scope resolution as `/preview`); body `{ year, month }` (`createScheduleSchema`). Returns a `200` envelope with `ScheduleOptionsResult`. Returns `409` `Schedule already exists for this month; delete it first` before any solve.
- `apps/api/src/services/schedule.service.ts`: `generateOptions(year, month, scope)`, `SCHEDULE_OPTION_COUNT = 3`; private helpers `eligibilityFor`, `assertNoSchedule`, `doctorSetsByDate`, `changedDatesOf`, `loadsOf`. No activity log entry, no usage metering.
- Types (`packages/shared/src/types/schedule.ts`): `ScheduleOptionsResult { year, month, options }`; `ScheduleOption extends PreviewResult { index (1-based), changedDates, loads }`; `DoctorLoad { doctorId, doctorFirstName, doctorLastName, total, holiday, friday, saturday, sunday }` (every active doctor, ordered by id; `holiday` = weekends + marked holidays).
- 1 to 3 options. Only option 1 can carry `conflicts`; alternatives exist only when the primary option is optimal (D4).
- Save path unchanged: `POST /schedules` with `{ year, month, assignments: [{ date, doctorId, reason }] }`.

Web (Tasks 5-6):

- `apps/web/src/services/schedule.ts`: `options(year, month)`.
- `apps/web/src/composables/useEstimatedProgress.ts`: `useEstimatedProgress(estimateMs)` returns `EstimatedProgress { progress, start, finish, stop }`, holds at 95% and fills at 8x on `finish`, and stops on scope dispose.
- `apps/web/src/pages/SchedulesPage.vue`: the dialog only validates, then `router.push({ path: '/schedules/options', query: { year, month } })`.
- `apps/web/src/pages/ScheduleOptionsPage.vue`: route `schedule-options` (`/schedules/options`, administrator, registered before `schedules/:id`). Constants `OPTION_COUNT = 3`, `ESTIMATED_OPTIONS_MS = 20_000` (mirror the API). Request guarded by `useLatestRequest`. Option 1 with conflicts calls `router.replace` to the preview page. Save goes through `useConfirm`, then `scheduleService.generate`, then `/schedules/<id>`.
- `apps/web/src/components/schedule/DutyCalendar.vue`: optional `highlightDates?: Set<string>` adds a ring, an `ArrowLeftRight` icon and screen-reader text (`[data-highlight-marker]`).
- Locales: `scheduleOptions.*` and `dutyCalendar.highlighted` in `en.json` and `el.json`.
- Tests: `ScheduleOptionsPage.test.ts`, `useEstimatedProgress.test.ts`, `SchedulesPage.test.ts` (navigation tests), `DutyCalendar.test.ts` (marker tests).

## Measurements (2026-10-07, this machine, Node 24.15)

| Input | Result | Time |
|---|---|---|
| October 2026 Main Clinic fixture, `generate` | 59 duties | 2.06 s |
| Same, `generateOptions(c, 3)` | 3 options; option 2 shares 0 of 59 duties with option 1, option 3 shares 4 | 2.08 s |
| `schedule.service.test.ts` options test (12 doctors, September 2026, mocked DB) | 1-3 options (count not pinned) | 0.44 s |
| Live UI, November 2026 single-clinic | 3 options | about 3.8 s from submit to plans shown (includes the bar fill, see O1) |

## Decisions

| When | Code | Decision | Reason |
|---|---|---|---|
| 2026-10-07 23:00 | D1-D11 | Adopted as written in the plan (equally optimal alternatives, max difference + no-good rows, fewer than 3 is valid, alternatives only after an optimal primary, determinism, 5 s per alternative, no DB change, `POST /schedules/options`, same reason format, conflicts route to preview, options page owns the request) | Plan design table |
| 2026-10-07 23:00 | Q1 | Default: activity log `detail.mode` stays `'manual'` for a saved option | No user steer |
| 2026-10-07 23:00 | Q2 | Default: keep the engine path of `POST /schedules` without `assignments` | No user steer; scripts and tests use it |
| 2026-10-07 23:00 | Q3 | Default: no "Edit in preview" on an option | No user steer; out of scope |
| 2026-10-07 23:05 | T1a | An empty earlier option makes the alternative model return null | Empty option means the fill optimum is 0, so no other schedule exists; avoids an LP row with no terms |
| 2026-10-07 23:05 | T2a | Alternatives call `solver.solve` directly in `solveAlternative` and check the status there | `solveOnce` stays unchanged; `Infeasible`, no budget and time limit without incumbent stop the chain silently; any other status or a thrown error logs `warn` and stops the chain without greedy fallback |
| 2026-10-07 23:05 | T2b | Test "alternative at time limit without incumbent" overrides every alternative solve | The first override already stops the chain; same assertion |
| 2026-10-07 23:15 | T4a | `changedDates` compares doctor id sets per date over every day of the month (a missing date counts as an empty set) | Matches the type doc |
| 2026-10-07 23:15 | T4b | The service 409 test asserts exactly 1 DB query ran | Proof that no context load or solve happened |
| 2026-10-07 23:15 | T4c | `validators/schedule.ts` unchanged | It already re-exports `createScheduleSchema` |
| 2026-10-07 23:25 | T5a | Composable comment says "8x speed" instead of "double speed" | The code fills at speed 8; the old comment was wrong |
| 2026-10-07 23:25 | T5b | `ESTIMATED_OPTIONS_MS` and `OPTION_COUNT` live in `ScheduleOptionsPage.vue` | Only consumer; the services module is fully mocked in tests |
| 2026-10-07 23:25 | T5c | The 3 old SchedulesPage progress tests already failed before Task 5 (they expected an older estimate); replaced as the plan says | Pre-existing drift, removed with the behaviour |
| 2026-10-07 23:25 | T6a | The options page does not call `doctorService.list()`; it passes `doctors=[]` to DutyCalendar | Readonly mode renders names from the assignments; the request had no consumer |
| 2026-10-07 23:25 | T6b | The legend entry is in the page header row; DutyCalendar owns the marker and the `dutyCalendar.highlighted` key | DutyCalendar has no legend of its own; same pattern as the preview page |
| 2026-10-07 23:25 | T6c | The 409 case uses the header "Back to schedules" button; reuses `schedulePreview.backToSchedules` | No duplicate key |
| 2026-10-07 23:25 | T6d | Plan letters stay Latin A/B/C in the Greek UI | Letters are identifiers |
| 2026-10-07 23:25 | T6e | Greek confirm text puts the month in parentheses | `monthLabel` is nominative; "για Νοέμβριος" is not grammatical |

## Open items (waiting for user steer)

| Code | Item | Default if no steer |
|---|---|---|
| O1 | With the 20 s estimate, the bar is at about 10% when a 2 s solve returns; the 8x fill then adds about 2.3 s. Option: cap the fill time (for example 500 ms) in `useEstimatedProgress.finish` | No change (plan behaviour) |
| O2 | When B and C differ on every day (30/30 in the smoke run), the calendar marks every day, so the marker carries little information | No change (D2 asks for maximum difference) |
| O3 | Task 7 step 1 resets the user's dev database | Ask the user before `pnpm db:seed:multi` |
