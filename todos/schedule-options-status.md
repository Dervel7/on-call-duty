# schedule-options - Status

## Goal

Generate on the Schedules page computes up to 3 different, equally optimal schedule options for the month. The administrator compares them side by side and picks one. Only the picked option is saved, as a draft, through the existing `POST /schedules` path.

- Plan: `docs/superpowers/plans/2026-10-07-schedule-options-plan.md` (Tasks 0-8). Untracked user file; never commit it.
- Solver design: `docs/superpowers/specs/2026-10-05-scheduling-solver-design.md`
- Branch: `multiple_Schedules` (from `main` at `5829a13`). The agent commits on this branch (specific files only, never `commit -A`).

## State (2026-10-07 23:50)

| Task | State | Commit |
|---|---|---|
| 0 Status file | Done (this file) | - |
| 1 Alternative model (pure) | Done | `a1d21c3` |
| 2 Solver `generateOptions` | Done | `d7f570c` |
| 3 Shared types | Done | `4508f00` |
| 4 API service, controller, route | Done | `ca8ad11` |
| 5 Web service and progress composable | Done | `4f2e576` |
| 6 Options page | Done | `b9807da` |
| 7 Smoke run | Done (see "Smoke run, multi-clinic") | - |
| 8 Docs | Done | see git log |

Last full check (after Task 8, 2026-10-07 23:50): root `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (shared 36, utils 34, api 486, web 387 tests).

`docs/database.md`: no change (no schema change; `git diff 5829a13 -- database docs/database.md` is empty).

Task 8 changes: admin manual 6.4 rewritten (text only; 6.4 had no screenshot), solver design section 10 "Alternative options" (D1-D6), one line in `AGENTS.md` Scheduling Engine Requirements.

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

## Smoke run, multi-clinic (2026-10-07 23:35-23:45)

Setup (user choice, to keep the dev DB): separate database `oncall_smoke` seeded with `DATABASE_URL=...oncall_smoke pnpm db:seed:multi` (seed log confirmed `database: "oncall_smoke"`; process env wins over `apps/api/.env`), a second API on port 3002 and a second Vite on port 5175 (`API_PROXY_TARGET=http://localhost:3002`). After the run: both servers stopped, `oncall_smoke` dropped, dev DB `oncall_duty` checked (still only the October 2026 draft).

| Step | Check | Result |
|---|---|---|
| 2 | `POST /schedules/options` November 2026, Cardiology A | 200, **3 options**, 0.70 s; 60 duties each; B and C share 0 duties with A; changedDates 0/30/30 |
| 2 | Same, Neurology A | 200, **3 options**, 0.36 s; same shape as Cardiology A |
| 2 | Equal quality (both clinics, every option) | totals 6-6, holiday duties 1-2, 0 Fri/Sat/Sun repeats, all reasons `solver optimal...` |
| 2 | Determinism (Cardiology A, second call) | identical assignments, same order |
| 2 | UI (Neurology A, English) | 3 tabs; Plan B tab: 30 `[data-highlight-marker]` days |
| 3 | API: save Cardiology A Plan B through `POST /schedules`, then publish | 201; detail duties equal Plan B exactly; publish 200 |
| 3 | UI: "Use Plan B" -> confirm (Neurology A) | Navigates to `/schedules/2`, draft; stored duties equal the API Plan B; Publish via UI -> `published` |
| 4 | Generate November again (API and UI dialog) | 409 `Schedule already exists for this month; delete it first` on `/schedules/options?year=2026&month=11` |
| 5 | Neurology A, all 10 doctors excluded on 2026-12-10, Generate December via the dialog | API: 3 options, 1.06 s, each with 1 conflict (2026-12-10); UI redirects to `/schedules/preview?year=2026&month=12` showing "1 day(s) with no doctor" |
| 6 | Fewer than 3 options | Not seen in any clinic/month tried |

## Implementation map

API (Tasks 1-4):

- `POST /schedules/options`: administrator only; optional `?clinicId=` (superadmin, same scope resolution as `/preview`); body `{ year, month }` (`createScheduleSchema`). Returns a `200` envelope with `ScheduleOptionsResult`. Returns `409` `Schedule already exists for this month; delete it first` before any solve.
- `apps/api/src/services/schedule.service.ts`: `generateOptions(year, month, scope)`, `SCHEDULE_OPTION_COUNT = 3`; private helpers `eligibilityFor`, `assertNoSchedule`, `doctorSetsByDate`, `changedDatesOf`. No activity log entry, no usage metering.
- Types (`packages/shared/src/types/schedule.ts`): `ScheduleOptionsResult { year, month, options }`; `ScheduleOption extends PreviewResult { index (1-based), changedDates }`.
- 1 to 3 options. Every option carries the same `conflicts` (same coverage optimum, D10); the web app checks option 1 only. Alternatives exist only when the primary option is optimal (D4).
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
| 2026-10-08 | U1 | User: remove the per-doctor comparison table ("DUTIES PER DOCTOR"); the options page shows only the calendar per plan. `loads`, `DoctorLoad`, `loadsOf`, the table locale keys, the table test and the manual bullet are removed with it | User steer; `loads` had no other consumer |

## Open items (waiting for user steer)

| Code | Item | Default if no steer |
|---|---|---|
| O1 | With the 20 s estimate, the bar is at about 10% when a 2 s solve returns; the 8x fill then adds about 2.3 s. Option: cap the fill time (for example 500 ms) in `useEstimatedProgress.finish` | No change (plan behaviour) |
| O2 | When B and C differ on every day (30/30 in the smoke run), the calendar marks every day, so the marker carries little information | No change (D2 asks for maximum difference) |
| O3 | Task 7 step 1 resets the user's dev database | Resolved 2026-10-07 23:35: user chose a separate smoke DB (`oncall_smoke`, dropped after the run) |
| O4 | Admin manual 6.2 still says the New schedule dialog has a **Preview** button; the dialog has only Generate (already so on `main` at `5829a13`, not caused by this branch) | No change (out of Task 8 scope) |
