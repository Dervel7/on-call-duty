# Scheduling Solver - Implementation Plan

Design: `docs/superpowers/specs/2026-10-05-scheduling-solver-design.md` (read it first; section numbers below refer to it).
Branch: `solver_branch`. Commits are made on this branch by the implementing agent (AGENTS.md: never on `main`).
State and decisions log: `todos/scheduling-solver-status.md`. Update it after every task.

## Instructions for the implementing agent

- Read `AGENTS.md`, `rules.md`, and the design doc first. Use subagent-driven development.
- No Prettier, no lint rule changes, no GitHub Actions version changes. ASCII only in new code and docs.
- Keep the public contract: `SchedulingContext` in, `GenerateResult` out. Only `generate` becomes async.
- Tests: Vitest, `__tests__/` beside the source, `<name>.test.ts`. Assert aggregates, not exact assignments (D6).
- Before each commit, run the touched workspace's `typecheck`, `lint`, and `test`. At the end, run `pnpm typecheck`, `pnpm lint`, and `pnpm test` from the root.
- Do not touch `git stash` entries. `stash@{0}` (GitHub Desktop, "On main") holds the user's web WIP and the uncommitted F1 change (see the status file).

## Task 0 - Prerequisite check

- Confirm with the status file whether F1 (no repeated Fri/Sat/Sun on extra slots in the greedy engine) has been committed to `main` and merged into `solver_branch`. If yes, the greedy fallback includes F1. If not, continue without it; the solver implements D2 itself. Do not apply the stash.

## Task 1 - Dependency and loader

Files: `apps/api/package.json`, `pnpm-lock.yaml`, new `apps/api/src/scheduling/highs.ts`.

1. `pnpm --filter @oncall/api add highs@<exact latest stable>` (no caret; record the version in the status file).
2. `highs.ts`: `loadSolver()` returns a cached promise of the HiGHS instance; `resetSolver()` drops it. Export a small `SolverLoader` type so tests can inject a failing loader.
3. Verify the import works under `tsx` (dev), `vitest`, and the built `dist` (`pnpm --filter @oncall/api build` then `node dist/server.js` starts).

## Task 2 - Model builder

File: new `apps/api/src/scheduling/solver-model.ts` (pure, no solver import).

1. `buildModel(ctx, level, bounds)` returns CPLEX LP text for one level (design 4.1-4.5).
2. Deterministic names and order: `x_<doctorId>_<yyyymmdd>`, doctors by id, dates ascending; constraint names likewise.
3. Omit variables for excluded days and for day 1 when the doctor is in `priorDayDoctorIds`.
4. Reuse `isOpenDutyDate`, `requiresDoubleCoverage`, `slotsForDate`, `minimumForDate` (`dates.ts`) and `isFriSatSun`. If `isFriSatSun` is not on the branch (F1 absent), add it to `scoring.ts` and use it in `scoreCandidate` too, so one definition exists.
5. Unit tests (`__tests__/solver-model.test.ts`): a 3-day context produces the expected variable set (excluded day omitted, back-to-back rows present, open-day cap row present). Do not snapshot full LP text.

## Task 3 - Solve and decode

File: new `apps/api/src/scheduling/solver.ts`.

1. `generate(ctx, loader = loadSolver): Promise<GenerateResult>`: solve levels 1-6 sequentially; after each, bound that level's expression by its optimum (design 4.5). Options: `output_flag: false`, `threads: 1`, `random_seed: 0`, `mip_rel_gap: 0`, `time_limit` = remaining share of the 10 s budget (D4).
2. Status handling: `Optimal` continues; time limit with a feasible solution stops the level chain and decodes the best solution with status `time limit`; any error or no feasible solution calls `resetSolver()`, logs a `warn`, and returns `generateGreedy(ctx)` with `; fallback` appended to every reason.
3. Decode: assignments sorted by date then doctor id; `isWeekend` from the day; reasons per design 4.6.
4. Conflicts: for each day with `short > 0`, build the tally against the final solution with the same checks and order as `collect()` in `engine.ts`. Extract `conflictFor` from `engine.ts` into a shared helper rather than copying it.
5. Rename the greedy export to `generateGreedy`; `scheduling/index.ts` exports `generate` from `solver.ts` and `generateGreedy` from `engine.ts`.

## Task 4 - Service wiring

File: `apps/api/src/services/schedule.service.ts`.

1. `runEngine(ctx)` becomes `await runEngine(ctx)` in `preview()` and `generate()`. No other service change.
2. Update `apps/api/src/__tests__/schedule.service.test.ts` mocks or expectations that assume a synchronous engine.

## Task 5 - Tests

Files under `apps/api/src/scheduling/__tests__/`.

1. Split `engine.test.ts`: outcome tests (coverage, caps, conflicts text, day-fill note, open on-call rules, minimums vs slots) run against the solver `generate`; greedy-internal tests (score regex, pass order, tie-break text) move to `greedy.test.ts` against `generateGreedy`. Adjust outcome assertions only where the solver's optimum is legitimately different, and say why in the test comment.
2. New `fixtures/october-2026.ts` with the design section 7 data (ids only).
3. New `solver.test.ts`:
   - October acceptance (design 6.1), asserting each hard rule per duty with the real `constraints.ts` / `dates.ts` helpers.
   - Determinism: two runs, deep-equal results.
   - D2: two Saturdays, two doctors, minimum 1 of 2: extra slots stay empty, no doctor has two Saturdays.
   - D2 relaxation: a day that can reach its minimum only with a repeated Saturday gets it, and the reason contains `repeat weekday to reach minimum`.
   - Holiday cap: a regular holiday that needs a capped doctor gets them, with `day-fill guarantee overrode fairness caps`; a critical holiday never counts as an override.
   - Mixed monthly caps (one doctor at max 3): level 4 still gives a sensible spread (design 4.5 note); record the chosen spread definition in the status file.
   - Fallback: an injected failing loader gives greedy output with `; fallback` on every reason.

## Task 6 - Web reason mapping

Files: `apps/web/src/lib/duty-reason.ts`, `apps/web/src/locales/en.json`, `apps/web/src/locales/el.json`, `apps/web/src/__tests__/duty-reason.test.ts`.

1. Fix `ENGINE_REASON` to accept the current greedy format (`..., first fri/sat/sun +N)`) and an optional `; fallback`.
2. Add a solver regex for design 4.6 and plain-language keys for each status and note (en and el).
3. Tests for each format and note in both locales.

## Task 7 - Performance and Docker

1. `pnpm db:seed:multi`, then time `POST /schedules/preview` for each clinic for the next month. Record the times in the status file.
2. If any solve takes more than 1 s, move the solve into a `worker_threads` worker (same `generate` signature) and re-measure.
3. `docker compose build api` succeeds; the container generates a schedule.

## Task 8 - Docs

1. `rules.md`: sections 4 and 5 become the objective levels (design 4.5) and the solver reason notes; section 1-3 rules unchanged in meaning.
2. `docs/admin-manual/manual.html` sections 9.3 and 9.4: how the solver balances work; new reason texts.
3. `AGENTS.md`, Backend Structure: the scheduling engine line mentions the solver and the greedy fallback.
4. `docs/database.md`: no change (no schema change). Confirm.

## Done when

All acceptance criteria in design section 6 hold, the status file lists the pinned `highs` version, the measured solve times, and every decision taken during implementation.
