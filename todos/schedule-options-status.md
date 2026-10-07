# schedule-options - Status

## Goal

Generate on the Schedules page computes up to 3 different, equally optimal schedule options for the month. The administrator compares them side by side and picks one. Only the picked option is saved, as a draft, through the existing `POST /schedules` path.

- Plan: `docs/superpowers/plans/2026-10-07-schedule-options-plan.md` (Tasks 0-8). The plan file is untracked in the working tree (user's file, not committed by the agent).
- Solver design: `docs/superpowers/specs/2026-10-05-scheduling-solver-design.md`
- Branch: `multiple_Schedules` (from `main` at `5829a13`). The agent commits on this branch.

## State (2026-10-07)

| Task | State |
|---|---|
| 0 Status file | Done (this file) |
| 1 Alternative model (pure) | Done, committed |
| 2 Solver `generateOptions` | Done, committed |
| 3 Shared types | Not started |
| 4 API service, controller, route | Not started |
| 5 Web service and progress composable | Not started |
| 6 Options page | Not started |
| 7 Smoke run | Not started |
| 8 Docs | Not started |

Checks after Task 2 (`apps/api` only): `typecheck` pass, `lint` pass, `test` pass (42 files, 482 tests). Root `pnpm typecheck/lint/test` not run yet (web and shared not touched).

## Handoff for the next agent (start at Task 3)

What exists now:

- `solver-model.ts`: `Stage` has `'alternative'` (not in `index.stages`). `ModelBounds.avoid?: readonly ReadonlySet<string>[]`. `buildModel(index, 'alternative', { optima, capacity, avoid })` builds every block, emits `bound_<stage>` (`<=`) for every minimized stage with terms, `bound_fill` (`>=`), one `nogood_<k>` row per earlier option (`k` is 1-based, the option number), and minimizes the overlap with earlier options (coefficient = number of earlier options holding the cell). Returns null when there are no cells, `avoid` is empty, or an earlier option is empty.
- `solver.ts`: `ALTERNATIVE_BUDGET_MS = 5_000` exported beside `SOLVER_BUDGET_MS`. `generateOptions(ctx, count, loader = loadSolver): Promise<GenerateResult[]>` always returns at least 1 result; `generate(ctx, loader)` is `(await generateOptions(ctx, 1, loader))[0]!`. `solveStages` returns `{ solution, optima, capacity }` (`fill` optimum was already stored in `optima`).
- `scheduling/index.ts` exports `generateOptions`. Import it in the service as `generateOptions as runEngineOptions` (Task 4).
- Tests: `solver-model.test.ts` (`alternative stage` describe), `solver.test.ts` (`solver: options` describe).

Facts for Task 4 (service):

- Options are returned in order: index 0 is the primary option (equal to `generate`).
- Alternatives have reasons `solver optimal...` (D9). A time-limited or fallback primary gives exactly 1 option.
- `GenerateResult` assignments carry `date`, `doctorId`, names, `isWeekend`, `reason`; conflicts only on option 1 matter (D10, all options share the coverage optimum).

## Measurements (2026-10-07, this machine, Node 24.15)

| Input | Result | Time |
|---|---|---|
| October 2026 Main Clinic fixture, `generate` | 59 duties | 2.06 s |
| Same, `generateOptions(c, 3)` | 3 options; option 2 shares 0 of 59 duties with option 1, option 3 shares 4 | 2.08 s (both alternatives solve fast) |

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

## Open items

- None from Tasks 1-2.
