# schedule-options - Status

## Goal

Generate on the Schedules page computes up to 3 different, equally optimal schedule options for the month. The administrator compares them side by side and picks one. Only the picked option is saved, as a draft, through the existing `POST /schedules` path.

- Plan: `docs/superpowers/plans/2026-10-07-schedule-options-plan.md` (Tasks 0-8). The plan file is untracked in the working tree (user's file, not committed by the agent).
- Solver design: `docs/superpowers/specs/2026-10-05-scheduling-solver-design.md`
- Branch: `multiple_Schedules` (from `main` at `5829a13`). The agent commits on this branch.

## State (2026-10-07)

| Task | State | Commit |
|---|---|---|
| 0 Status file | Done (this file) | - |
| 1 Alternative model (pure) | Done | `a1d21c3` |
| 2 Solver `generateOptions` | Done | `d7f570c` |
| 3 Shared types | Done | `4508f00` |
| 4 API service, controller, route | Done | `ca8ad11` |
| 5 Web service and progress composable | Done | see git log |
| 6 Options page | Done | see git log |
| 7 Smoke run | Partly done (see below) | - |
| 8 Docs | Not started | - |

Checks after Task 6: root `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (shared 36, utils 34, api 486, web 387 tests).

Smoke after Task 6 (2026-10-07 23:25, user's running `pnpm dev`, single-clinic DB, `admin`, Greek UI):

- Generate for October 2026 (schedule exists): options page shows `Schedule already exists for this month; delete it first` and "Back to schedules".
- Generate for November 2026: progress bar, then 3 plans after about 3.8 s (B and C: 30 of 30 days differ). Load table highlights differing cells; Plan B tab shows ring + marker on 30 days and the legend entry.
- "Use Plan B" opens the confirm dialog; Cancel closes it. No schedule was saved (user's DB).
- Not done (Task 7): save a chosen option, multi-clinic run, conflict month routing.

## Handoff for the next agent (start at Task 7)

Read the plan sections Task 7 and Task 8. Tasks 5-6 notes are in the decision table (T5a-T6e).

API contract (done, Tasks 3-4):

- `POST /schedules/options`, administrator only, optional `?clinicId=` (superadmin; same scope resolution as `/preview`), body `{ year, month }` (`createScheduleSchema`). Response `200` envelope with `ScheduleOptionsResult`.
- `409` `Schedule already exists for this month; delete it first` before any solve (same message as `POST /schedules`).
- Types in `@oncall/shared` (`packages/shared/src/types/schedule.ts`):
  - `ScheduleOptionsResult { year, month, options: ScheduleOption[] }`
  - `ScheduleOption extends PreviewResult { index, changedDates, loads }`. `index` is 1-based; option 1 is the primary option. `days` is eligibility computed against that option. `changedDates` lists dates whose doctor set differs from option 1 (always `[]` for option 1), in month order.
  - `DoctorLoad { doctorId, doctorFirstName, doctorLastName, total, holiday, friday, saturday, sunday }`. One entry for every active doctor of the clinic, including doctors with 0 duties, ordered by doctor id. `holiday` counts weekends plus marked holidays (`ctx.days[].isHoliday`).
- 1 to 3 options. Only option 1 can carry `conflicts`; alternatives exist only when the primary option is optimal (D4, D10). The web page routes to `/schedules/preview` when option 1 has conflicts.
- Save path is unchanged: `POST /schedules` with `{ year, month, assignments: [{ date, doctorId, reason }] }` from the chosen option.

API implementation notes (`apps/api/src/services/schedule.service.ts`):

- New private helpers: `eligibilityFor(ctx, assignments, clinicId)` (used by both `preview()` branches and `generateOptions`), `assertNoSchedule(year, month, clinicId)` (used by `generate()` and `generateOptions`), `doctorSetsByDate`, `changedDatesOf`, `loadsOf`.
- Exported: `generateOptions(year, month, scope)`, `SCHEDULE_OPTION_COUNT = 3`. No activity log entry, no usage metering.
- Controller `scheduleController.options`; route registered after `/preview`, before `POST /`.

Facts for Task 5:

- Progress estimate constant for the web: `SOLVER_BUDGET_MS (10_000) + 2 * ALTERNATIVE_BUDGET_MS (5_000)` = 20 000 ms. Measured real time for the October 2026 Main Clinic fixture is about 2.1 s for 3 options, so the bar finishes early in most months.

## Measurements (2026-10-07, this machine, Node 24.15)

| Input | Result | Time |
|---|---|---|
| October 2026 Main Clinic fixture, `generate` | 59 duties | 2.06 s |
| Same, `generateOptions(c, 3)` | 3 options; option 2 shares 0 of 59 duties with option 1, option 3 shares 4 | 2.08 s (both alternatives solve fast) |
| `schedule.service.test.ts` options test (12 doctors, September 2026, mocked DB) | 1-3 options (count not pinned) | 0.44 s |

## Decisions

| When | Code | Decision | Reason |
|---|---|---|---|
| 2026-10-07 23:00 | D1-D11 | Adopted as written in the plan (equally optimal alternatives, max difference + no-good rows, fewer than 3 is valid, alternatives only after an optimal primary, determinism, 5 s per alternative, no DB change, `POST /schedules/options`, same reason format, conflicts route to preview, options page owns the request) | Plan design table |
| 2026-10-07 23:00 | Q1 | Default: activity log `detail.mode` stays `'manual'` for a saved option | No user steer |
| 2026-10-07 23:00 | Q2 | Default: keep the engine path of `POST /schedules` without `assignments` | No user steer; scripts and tests use it |
| 2026-10-07 23:00 | Q3 | Default: no "Edit in preview" on an option | No user steer; out of scope |
| 2026-10-07 23:05 | T2a | Alternatives call `solver.solve` directly in `solveAlternative` and check the status there, instead of an `allowInfeasible` flag on `solveOnce` | Simpler: `solveOnce` stays unchanged for the primary chain; `Infeasible`, no budget (`null`) and time limit without incumbent stop the chain silently; any other status or a thrown error logs `warn` (`clinicId`, `year`, `month`, `option`) and stops the chain without greedy fallback |
| 2026-10-07 23:05 | T1a | An empty earlier option makes the alternative model return null | Empty option means the fill optimum is 0, so no other schedule exists; avoids an LP row with no terms |
| 2026-10-07 23:05 | T2b | Test "alternative at time limit without incumbent" overrides every alternative solve (not only the first) | The first override already stops the chain; same assertion |
| 2026-10-07 23:15 | T4a | `changedDates` compares doctor id sets per date over every day of the month (a date missing in one option counts as an empty set) | Matches the type doc "dates whose doctor set differs from option 1" |
| 2026-10-07 23:15 | T4b | The service 409 test asserts exactly 1 DB query ran, as proof that no context load or solve happened | The service tests use the real engine (not mocked); the query count is the observable signal |
| 2026-10-07 23:15 | T4c | `validators/schedule.ts` unchanged | It already re-exports `createScheduleSchema` |
| 2026-10-07 23:25 | T5a | Composable comment says "8x speed" instead of "double speed" | The code fills at speed 8; the old comment was wrong |
| 2026-10-07 23:25 | T5b | `ESTIMATED_OPTIONS_MS` (20 000) and `OPTION_COUNT` (3) live in `ScheduleOptionsPage.vue`, with a comment that they mirror the API constants | The page is the only consumer; the services module is fully mocked in tests |
| 2026-10-07 23:25 | T5c | The 3 old SchedulesPage progress tests failed before this change (they expected a 3 s estimate); replaced as the plan says | Pre-existing drift, removed with the behaviour |
| 2026-10-07 23:25 | T6a | The options page does not call `doctorService.list()`; it passes `doctors=[]` to DutyCalendar | Readonly mode renders names from the assignments; loads come from `loads`. The request had no consumer |
| 2026-10-07 23:25 | T6b | DutyCalendar shows the ring plus an icon with screen-reader text (`dutyCalendar.highlighted`); the legend entry is in the page header row, like the preview page legend | DutyCalendar has no legend of its own; the key sits in `dutyCalendar` because the component owns it |
| 2026-10-07 23:25 | T6c | The 409 case uses the header "Back to schedules" button; header and invalid-month block reuse `schedulePreview.backToSchedules` | No duplicate key |
| 2026-10-07 23:25 | T6d | Plan letters stay Latin A/B/C in the Greek UI | Letters are identifiers, same in both languages |
| 2026-10-07 23:25 | T6e | Greek confirm text puts the month in parentheses | `monthLabel` is nominative; "για Νοέμβριος" is not grammatical |

## Open items

| Code | Item | Default if no steer |
|---|---|---|
| O1 | With the 20 s estimate, the bar is at about 10% when a 2 s solve returns; the 8x fill then adds about 2.3 s (smoke: 3.8 s total). Option: cap the fill time (for example 500 ms) in `useEstimatedProgress.finish` | No change (plan behaviour) |
| O2 | When B and C differ on every day (smoke: 30/30), the calendar marks every day, so the marker carries little information | No change (D2 asks for maximum difference) |
