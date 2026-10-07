# scheduling-solver - Status

## Goal

Replace the greedy scheduling engine with an exact MIP solver (HiGHS via the `highs` npm package) behind the same `generate()` contract, so each doctor gets one Friday, one Saturday and one Sunday where the calendar allows, with the greedy engine kept as a fallback.

- Design: `docs/superpowers/specs/2026-10-05-scheduling-solver-design.md` (section 9 lists implementation deviations)
- Plan: `docs/superpowers/plans/2026-10-05-scheduling-solver-plan.md`
- Branch: `solver_branch` (from `main` at `a9f7693`)

## State (2026-10-05)

- Tasks 0-6 and 8 done and committed on `solver_branch`. Task 7: timings done; `docker compose build api` not run (Docker daemon was not running on this machine).
- Independent review done (reviewer subagent, including a 1,800-case brute-force fuzz of small contexts against an exhaustive optimum): one bug found and fixed (worker watchdog counted queue wait).
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (API 469, web 366, shared 36, utils 34). One earlier root run had `apps/web/src/__tests__/main.test.ts` time out at 5 s under parallel load (passes alone in 169 ms, and in the next root run); see Open items.
- Next: user review of the branch; Docker build check when Docker is running.

## Repository facts the next session needs

- Task 0: F1 was NOT committed to `main`; it is still only in `stash@{0}` ("On main", GitHub Desktop) with the user's web WIP. The greedy fallback therefore runs without F1; the solver implements D2 itself. Stash untouched.
- `highs` pinned at **1.15.3** (exact, no caret). Installing on this machine needs `NODE_OPTIONS=--use-system-ca` (TLS interception by a security gateway; plain `pnpm add` fails with UNABLE_TO_GET_ISSUER_CERT_LOCALLY).
- `node dist/server.js` does not start, before and after this change: tsc emits extensionless ESM imports (`./app`). Production runs `tsx src/server.ts` (Dockerfile), which works with the solver (HTTP preview verified).
- New files: `scheduling/solver.ts` (stages loop, decode, fallback), `solver-model.ts` (LP text per stage), `highs.ts` (worker thread + FIFO queue + watchdog), `conflicts.ts` (shared `blockingRule`/`conflictFor` for both engines). Greedy export renamed `generateGreedy`. `SchedulingContext` gained `clinicId` (for the fallback log).
- Tests: `engine.test.ts` runs the outcome suite against both engines; `greedy.test.ts` (greedy internals), `solver.test.ts` (October acceptance, D2, holiday cap, mixed caps, long leave, time limit, fallback), `solver-model.test.ts`, `highs.test.ts`. Fixture: `__tests__/fixtures/october-2026.ts`.

## Measurements (2026-10-05, this machine, Node 24.15)

| Input | Result | Time |
|---|---|---|
| October 2026 Main Clinic fixture | 59 duties, 0 conflicts, all 9 doctors 1 Fri + 1 Sat, 8 with 1 Sun, totals 6-7, holiday <= 2, `solver optimal` | 1.6-2.1 s (fill stage about 1.5 s) |
| Same, doctor 9 cap 3 | 59 duties; others 7, doctor 9 = 3 | 0.66 s |
| Same, doctor 9 away 1-27 | 58 duties; others 7, doctor 9 = 2 | 0.21 s |
| `db:seed:multi` (separate DB `oncall_solver_bench`, dropped after), `preview()` per clinic, Nov 2026 | 60 duties, 0 conflicts each | 0.25-0.62 s (first includes worker start) |
| Same, Dec 2026 | 62 duties, 0 conflicts each | 0.55-0.65 s |
| HTTP `POST /schedules/preview` (tsx server, bench DB, Cardiology A, Nov) | 200, 60 duties | 0.74 s |
| Event loop during October solve (worker) | max gap 22 ms | - |

October exceeds 1 s, so the solve runs in a `worker_threads` worker (plan Task 7.2).

## Decisions

| When | Code | Decision | Reason |
|---|---|---|---|
| 2026-10-05 | C | Exact solver instead of greedy repair (F2) | October showed the greedy engine misses an achievable 1/1/1 pattern; repair stays heuristic |
| 2026-10-05 | D1 | Levels: coverage > relaxations > 1/1/1 > total spread > holiday spread > fill extra slots | Default accepted by the user |
| 2026-10-05 | D2 | Empty extra slot beats a repeated Fri/Sat/Sun | Same as F1 |
| 2026-10-05 | D3 | `highs` 1.15.3 (HiGHS WebAssembly), exact pin | MIT, no native build, MIP-capable |
| 2026-10-05 | D4 | 10 s budget; greedy fallback with `; fallback` reason suffix | Generation never fails because of the solver |
| 2026-10-05 | D5 | Deterministic: fixed order, 1 thread, fixed seed, pinned version | Same input, same output (unless the time limit is hit) |
| 2026-10-05 | D6 | Tests assert aggregates and objective values, not exact assignments | Equal optima may differ across versions |
| 2026-10-05 21:40 | I1 | Level 1 split into coverage stages: critical days position 1..n, then regular days position 1..n | `sum short` does not prefer "1 doctor on every day" over doubling one day, nor critical days first; rules.md section 2 requires both (existing tests caught it) |
| 2026-10-05 21:40 | I2 | Level 4 = fair share: `abs(E*t - cap*total) <= E - 1 + dev`, capacity from a stage-0 solve (per-doctor rules only); minimize `dev` | `tmax - tmin` above fill forces equal totals when possible, and a low-cap or long-leave doctor drags everyone down; fair share keeps October at 59 and mixed caps at others 7 / capped 3 |
| 2026-10-05 21:40 | I3 | Level 5 = `max(0, hmax - hmin - 1)` over doctors with a possible holiday duty | Same rounding issue as level 4 |
| 2026-10-05 21:40 | I4 | `repeat weekday to reach minimum` goes on the later (count - 1) duties of that weekday at their minimum | The repeat is the extra duty |
| 2026-10-05 21:40 | I5 | Time limit at a later stage with no incumbent keeps the previous stage's solution (`time limit`); greedy only when no solution exists at all | A valid solver schedule beats the fallback |
| 2026-10-05 21:55 | I6 | Worker thread from an eval'd CommonJS source (resolves `highs` with `createRequire`) | Runs unchanged under tsx, Vitest and Node 20 without a separate worker file or loader flags |
| 2026-10-05 22:15 | I7 | HiGHS errors retire the worker inside `highs.ts`; a captured solver of a retired worker rejects at once; watchdog = deadline + 5 s | Found in self-review: a request could hang on a terminated worker |
| 2026-10-05 22:30 | I8 | One solve in flight; FIFO queue on the main thread; watchdog armed at dispatch; a request that expires in the queue resolves `null` | Review finding: the watchdog counted queue time and could kill another clinic's healthy solve (reproduced, fixed, re-verified) |
| 2026-10-05 21:30 | I9 | `clinicId` added to `SchedulingContext` | Fallback `warn` log must name the clinic (design risk table) |

## Open items

- `docker compose build api` and a container generation: not run (Docker daemon down). Code avoids Node 22+ APIs (`Promise.withResolvers` not used); not run on Node 20.
- Concurrent generations share one worker and queue; a later request waits for the earlier one and its 10 s budget includes the wait. Acceptable for a medium hospital; a small pool would remove it.
- Root `pnpm test` runs API and web suites in parallel; the solver tests add CPU load, and `main.test.ts` (web, dynamic `import('../main')`) timed out once at 5 s. Watch for repeats.
- F1 in `stash@{0}`: if the user applies it to `main`, merge `main` into `solver_branch` so the fallback includes it.
