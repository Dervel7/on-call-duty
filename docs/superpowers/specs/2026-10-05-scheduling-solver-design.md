# Scheduling Solver (exact MIP engine) - Design

Date: 2026-10-05. Branch: `solver_branch` (based on `main` at `a9f7693`).
Implementation steps: `docs/superpowers/plans/2026-10-05-scheduling-solver-plan.md`.
Handoff state: `todos/scheduling-solver-status.md`.

## 1. Problem

The current engine (`apps/api/src/scheduling/engine.ts`) is greedy: it fills one slot at a time in a fixed pass order (critical days to minimum, regular days to minimum, critical extra slots, regular extra slots) and never revisits a choice. The "one Friday, one Saturday, one Sunday per doctor" goal is only a +5 score term (`scoring.ts`, `W_FRI_SAT_SUN`), which loses to the workload term (3 per remaining duty) and the weekend budget term (4 per missing weekend duty). Ties fall to the lowest doctor id.

Evidence, Main Clinic, October 2026 (published schedule 274, reproduced 1:1 by replaying `generate()` on the DB context):

| Doctor id | Total | Fri | Sat | Sun |
|---|---|---|---|---|
| 1 | 7 | 1 | 0 | 1 |
| 2 | 7 | 2 | 1 | 1 |
| 3 | 7 | 0 | 1 | 1 |
| 4 | 6 | 1 | 1 | 0 |
| 5 | 7 | 1 | 1 | 1 |
| 6 | 7 | 2 | 2 | 0 |
| 7 | 6 | 1 | 1 | 1 |
| 8 | 6 | 1 | 1 | 1 |
| 9 | 6 | 1 | 1 | 1 |

Doctor 6 lost Sundays 11 and 18 on 34-34 ties (lower id won), lost Sunday 4 to back-to-back with his Saturday 3, and received Saturday 17 as an optional second slot where only he and doctor 4 were eligible.

An exact model (PuLP/CBC, same hard rules, solved in about 1 s) found for the same inputs: 59 duties, 0 conflicts, every doctor exactly 1 Friday and 1 Saturday, 8 of 9 doctors exactly 1 Sunday (only 4 Sundays x 2 slots = 8 exist), totals 6-7. A greedy repair pass (option F2) was rejected because it stays a heuristic and its swap logic grows with every rule.

## 2. Goal

Replace the greedy core of `generate(ctx)` with an exact mixed-integer model solved by HiGHS, keeping:

- the `generate(ctx: SchedulingContext): GenerateResult` contract (it becomes `async`),
- every hard rule, minimum-coverage rule, and the conflict report shape,
- an explainable `reason` on every duty,
- determinism (same input, same output).

Non-goals: no schema change, no API shape change, no change to `validatePlan` (manual plans), single-duty edits, eligibility (`computeEligibility`), stats, or reports beyond the reason text.

## 3. Decisions

Defaults chosen 2026-10-05; the user may change any of them before implementation starts. Record changes in the status file.

| Code | Decision | Chosen default | Alternative |
|---|---|---|---|
| D1 | Objective priority (lexicographic, highest first) | Minimum coverage > hard-rule relaxations used only for coverage > 1 Fri / 1 Sat / 1 Sun per doctor > balanced totals > balanced holiday duties > fill extra slots | Put "fill extra slots" above balance (more overnight cover, larger total spread) |
| D2 | Extra slot vs repeated Fri/Sat/Sun | An extra slot stays empty rather than give a doctor a second Friday, Saturday or Sunday (F1 semantics). A repeat is allowed only when a day cannot otherwise reach its minimum | Allow repeats on extra slots with a penalty |
| D3 | Solver library | `highs` (npm, lovasoa/highs-js, HiGHS compiled to WebAssembly, MIT, TypeScript types, no native add-on). Pin an exact version (no caret) | `glpk.js` (GPL), `javascript-lp-solver` (pure JS, weak on MIP) |
| D4 | Time limit and fallback | 10 s total solver budget per `generate()` call. On solver error, or no feasible solution within the budget, run the greedy engine and mark every reason with `fallback`. A feasible non-optimal solution at the limit is used and marked `time limit` | Fail with 500 |
| D5 | Determinism | Fixed variable and row order (doctor id ascending, date ascending), single thread, fixed `random_seed`, pinned solver version | None |
| D6 | Acceptance test strictness | Tests pin objective values and aggregate profiles (duty count, per-doctor Fri/Sat/Sun counts, spreads, conflicts), never exact duty-by-duty assignments. Equally optimal schedules may differ across solver versions and platforms | Snapshot exact assignments (brittle) |

## 4. Rules the model must reproduce

Source of truth: `rules.md`, `engine.ts` (`collect()` inside `fillDay`), `constraints.ts`, `dates.ts`. Notation: `x[i,d]` binary, doctor `i` on day `d`.

### 4.1 Hard (never relaxed)

| Rule | Engine source | Model |
|---|---|---|
| Unavailable | `isAvailable` | `x[i,d] = 0` (omit the variable) for every excluded day |
| Monthly cap | `underCap` | `sum_d x[i,d] <= maxMonthlyDuties[i]` |
| No back-to-back | `notConsecutive`, `priorDayDoctorIds` | `x[i,d] + x[i,d+1] <= 1`; `x[i,day1] = 0` when `i` is in `priorDayDoctorIds`. Parity with greedy: the first day of the next month is not checked |
| One open on-call duty | `underOpenDutyCap`, `OPEN_DUTY_DUTY_CAP = 1` | `sum over open days of x[i,d] <= 1` |
| One slot per doctor per day | `already on duty` | implicit (binary) |
| Day capacity | `slotsForDate` | `sum_i x[i,d] <= slots(d)` |

### 4.2 Minimum coverage (strict, may become a conflict)

`sum_i x[i,d] + short[d] >= minimum(d)` with `short[d] >= 0` integer. Level 1 minimizes `sum short[d]`. Any day with `short[d] > 0` becomes a `ConflictPlan`.

### 4.3 Holiday cap (fairness cap, yields to coverage)

Greedy semantics: holiday days are `isHoliday` (weekends plus marked dates). The cap of 2 (`HOLIDAY_DUTY_CAP`) is not checked on critical days (open days and the day after), but critical holiday duties still count toward the doctor's total. Critical days are filled first, so a non-critical holiday duty is allowed only while the doctor's holiday count is below 2. On regular days the cap is lifted only when the day would otherwise stay below its minimum (reason note `day-fill guarantee overrode fairness caps`).

Model, per doctor: `c[i]` = critical holiday duties, `n[i]` = non-critical holiday duties.
- Rule: `n[i] <= max(0, 2 - c[i]) + over[i]`. Linearize with a binary `b[i]`: `n[i] + c[i] <= 2 + M*b[i] + over[i]` and `n[i] <= M*(1 - b[i]) + over[i]`, with `M` = number of holiday days in the month.
- `over[i] >= 0` integer is the day-fill relaxation, minimized at level 2.

### 4.4 Fri/Sat/Sun repeats (D2)

For each doctor and each weekday `w` in {Fri, Sat, Sun}: `sum over days with weekday w of x[i,d] <= 1 + rep[i,w]`, with `rep[i,w] >= 0` integer minimized at level 2. Fri/Sat/Sun is `isFriSatSun(day)`: `dayOfWeek === 5 || isWeekend`. A marked weekday holiday is not part of the pattern.

### 4.5 Objective levels (D1)

Solve sequentially. After each level, add `level expression <= optimum` (or `>=` for maximization) and solve the next. Use integer optima only, so the bounds are exact.

| Level | Minimize | Purpose |
|---|---|---|
| 1 | `sum short[d]` | Minimum coverage |
| 2 | `sum over[i] + sum rep[i,w]` | Relax fairness caps only when coverage needs it |
| 3 | `sum over i, w of miss[i,w]`, where `miss[i,w] >= 1 - count[i,w]`, `miss >= 0`, `w` in {Fri, Sat, Sun} | One Friday, one Saturday, one Sunday per doctor |
| 4 | `tmax - tmin`, where `tmin <= total[i] <= tmax` | Balanced totals |
| 5 | `hmax - hmin` over holiday duties | Balanced holiday duties |
| 6 | maximize `sum x[i,d]` | Fill extra slots |

Doctors whose `maxMonthlyDuties` is below the others still enter level 4. If this makes the spread objective dominated by the cap, use `total[i] / max[i]` buckets instead. Decide this during implementation with a unit test and record it in the status file.

### 4.6 Explainable reasons

Every duty keeps a `reason`. Solver format (parsed by the web, see 4.7):

```
solver <status>[; <note>]*
status = optimal | time limit
note   = first friday | first saturday | first sunday
       | day-fill guarantee overrode fairness caps
       | repeat weekday to reach minimum
```

- `first friday/saturday/sunday`: the duty is the doctor's only duty on that weekday this month.
- `day-fill guarantee overrode fairness caps`: the doctor's non-critical holiday duties exceed the cap and this duty is on a day at exactly its minimum (chronologically last such duties first). Same text as greedy, so the web mapping is shared.
- `repeat weekday to reach minimum`: the doctor holds more than one duty on this Fri/Sat/Sun weekday and the day is at exactly its minimum.

Fallback (D4): greedy reasons are unchanged and get a `; fallback` suffix.

Conflicts keep the greedy text exactly (`conflictFor` in `engine.ts`): `only X of Y doctors assigned; of N active doctor(s): ... unavailable, ... at monthly cap, ... at open on-call cap, ... at holiday cap, ... back-to-back`. Compute the tally for each short day against the final solution with the same checks as `collect()`. Existing tests and the UI match on these substrings.

### 4.7 Web reason mapping

`apps/web/src/lib/duty-reason.ts` maps stored reasons to plain language (en/el in `apps/web/src/locales/*.json`, keys under `dutyReason`).

Existing bug, fix in this change: `ENGINE_REASON` expects `score N (workload +a, weekend +b, friday +c)`, but the engine writes `..., friday +c, first fri/sat/sun +d)`. Every engine reason is currently shown raw in reports. The regex must accept the current greedy format with an optional `; fallback`, and a second regex must cover the solver format.

## 5. Integration

- `apps/api/src/scheduling/engine.ts` keeps the greedy engine (renamed export `generateGreedy`) for the D4 fallback.
- New `apps/api/src/scheduling/solver.ts`: builds the model from `SchedulingContext`, solves the levels, decodes assignments and reasons, computes conflicts. Export `generate` (async) from `scheduling/index.ts`.
- HiGHS instance: load once per process (module-level promise). If a solve throws, drop the cached instance so the next call reloads (a WebAssembly instance can be left in a bad state after an abort; verify against the highs-js README "model lifetime" section). Prefer `highs.solve(lpText, options)` with CPLEX LP text; variable names must be deterministic, e.g. `x_<doctorId>_<yyyymmdd>`.
- Options per solve: `output_flag: false`, `threads: 1`, `random_seed: 0`, `mip_rel_gap: 0`, `time_limit` = remaining budget.
- `schedule.service.ts`: `runEngine(ctx)` is called in `preview()` (line ~381) and `generate()` (line ~424). Both are already async; add `await`. `enginePlanToDuties` (422 on conflicts) is unchanged.
- Event loop: `highs.solve` is synchronous and blocks the API process for the solve duration. Measure on `pnpm db:seed:multi` (6 clinics). If any month takes more than 1 s, move the solve into a `worker_threads` worker in the same change.
- Docker: `apps/api/Dockerfile` uses `node:20-slim`. WebAssembly needs no build tools; check the image builds and the `.wasm` file is in the installed package.
- `AGENTS.md` describes `src/scheduling/` as pure functions. The solver is still deterministic and free of I/O, but async. Update that line.

## 6. Acceptance criteria

1. October 2026 fixture (section 7), solver path: 0 conflicts; 59 duties; every doctor exactly 1 Friday and 1 Saturday; exactly 8 doctors with 1 Sunday and 1 with 0; no doctor with 2 or more of any of Fri/Sat/Sun; totals spread <= 1; holiday duties <= 2 for every doctor; every hard rule in 4.1 holds per duty (assert with the real `constraints.ts` and `dates.ts` helpers, not with model code).
2. Same fixture run twice gives identical output (D5).
3. Existing engine behavior tests (`apps/api/src/scheduling/__tests__/engine.test.ts`) pass against the solver where they assert outcomes (coverage, caps, conflicts text, day-fill note). Tests that assert greedy internals (score regex, pass order) move to a greedy test file and keep running against `generateGreedy`.
4. Fallback: with a forced solver failure (inject a loader that throws), `generate()` returns the greedy result and every reason ends with `; fallback`.
5. Web: `duty-reason.test.ts` covers current greedy reasons (with `first fri/sat/sun`), fallback suffix, and each solver note, in both locales.
6. `pnpm typecheck`, `pnpm lint`, `pnpm test` pass. Solve time on the 6-clinic seed is recorded in the status file.
7. Docs: `rules.md` sections 4 and 5 rewritten as the objective levels; admin manual sections 9.3 and 9.4 updated (solver, new reason text). `docs/database.md` unchanged (no schema change).

## 7. October 2026 fixture (Main Clinic, captured 2026-10-05)

Use doctor ids only in tests. All doctors are active, `maxMonthlyDuties = 7`. No duty on 2026-09-30 (`priorDayDoctorIds` empty).

- Settings: slots open/post-open/closed = 2/2/2; minimums = 2/2/1; open on-call anchor `2026-10-02`, interval 8 (open days 2, 10, 18, 26; post-open days 3, 11, 19, 27).
- Marked holiday: 2026-10-28 (Wednesday). `isHoliday` = weekend or marked.
- Exclusions (inclusive, October 2026):

| Doctor id | Excluded days |
|---|---|
| 1 | 14-18 |
| 2 | 1-4, 7-10 |
| 3 | 10-12, 30-31 |
| 4 | 1-3, 15, 22-26, 29 |
| 5 | 1-3, 11, 31 |
| 6 | 8, 10, 15, 19-20, 22, 24-26, 29 |
| 7 | 1, 15, 29 |
| 8 | 6-8, 13, 15, 19-22 |
| 9 | 7, 21-27 |

## 8. Risks

| Risk | Mitigation |
|---|---|
| Event loop blocked during solve | Measure (5); worker thread if > 1 s |
| Solver version changes the chosen optimum | D5 pinning; D6 aggregate assertions |
| Level-4 spread with mixed monthly caps gives odd results | Unit test with mixed caps; ratio buckets if needed (4.5) |
| WebAssembly instance corrupted after an abort | Drop the cached instance on error (5) |
| Greedy fallback hides solver bugs | Log a `warn` with clinic, year, month, and error on every fallback |

## 9. Implementation notes (2026-10-05)

Where the implementation differs from sections 4-5, and why. Details and dates: `todos/scheduling-solver-status.md`.

| Topic | Implemented | Reason |
|---|---|---|
| Level 1 | Split into ordered coverage stages: critical days position by position, then regular days position by position (`u_<date>_<p>` = day has fewer than p doctors) | `sum short[d]` treats "one empty day" and "two days at 1 of 2" as equal; rules.md section 2 requires critical days first and the first doctor on every day before a second |
| Capacity stage | Stage 0 maximizes duties with per-doctor rules only (no day rows, no relaxations); the result is each doctor's capacity | Needed for level 4 |
| Level 4 | Fair share: `abs(E*t[i] - cap[i]*total) <= E - 1 + dev`, E = sum of capacities; minimize `dev` | Minimizing `tmax - tmin` above the fill level makes the duty count a multiple of the doctor count whenever an even split is feasible, and lets one low-cap or long-leave doctor cap everyone else |
| Level 5 | Minimize `max(0, hmax - hmin - 1)` over doctors with a possible holiday duty | Same rounding issue as level 4 |
| Repeat note | On the later (count - 1) duties of that weekday at their minimum | A repeat is the extra duty, not the first one |
| Time limit | No solution at a later stage keeps the previous stage's solution (`time limit`); greedy only when no solution exists | A valid schedule is better than the fallback |
| Worker | HiGHS runs in a `worker_threads` worker; a HiGHS error retires the worker; a silent worker is stopped 5 s after the deadline | October takes about 2 s; generation must never hang |
| `clinicId` | Added to `SchedulingContext` | The fallback `warn` log names the clinic |
