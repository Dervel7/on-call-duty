# On-demand options B/C and "solver busy" gate

Implements SOL-01 and SOL-06 from `2026-11-10-low-resource-server-plan.md` (batch 2). Nothing is implemented yet.

## Goal

- `POST /schedules/options` returns only option A. Options B and C are computed when the administrator opens that tab.
- Every solver run (option A, each alternative, and the engine paths used by `preview` / `POST /schedules`) takes a single module-level slot. A second caller while the slot is taken gets `429 "Solver busy, try again shortly"` with `Retry-After` immediately. No queueing.

## Decisions

| Code | Decision | Reason |
|---|---|---|
| D1 | The gate is one private `runExclusive(fn)` in `scheduling/solver.ts`. Each public entry (`generate`, `generatePrimary`, `generateAlternative`) calls it once around private, ungated workers. A gated function never calls another gated function. | No entry point can bypass it. The slot is not reentrant, so nesting would reject (today `generate` delegates to the options path; after the split it must call the private worker). |
| D2 | The gate throws `SolverBusyError` (scheduling layer). The service maps it to `HttpError(429, 'Solver busy, try again shortly')` and the error handler sets `Retry-After: 10`. The web branches on `e.status`, never on message text. | Keeps `scheduling/` free of HTTP. 429 is in the project status list and means "try again shortly". It keeps 409 for conflict-shaped cases. |
| D3 | An alternative needs the primary's stage optima and capacity bounds. They are kept server-side in an in-process cache keyed by `${clinicId}:${year}-${month}`: `{ ctx, optima, capacity, results[] }`. TTL 15 min, max 20 entries, lazy eviction. | Re-running the primary chain (up to 30 s) per alternative would defeat the purpose. A single API process is already assumed (`rate-limit.ts`). |
| D4 | Alternatives use the cached `ctx`, not a fresh `buildContext`. | Option B is then consistent with option A shown on screen. `POST /schedules` re-validates the chosen plan against fresh data (`validatePlan`), so a stale option cannot be saved. |
| D5 | Alternative request carries `index` (2 or 3). If the cache already holds that option it is returned without solving. If `index` skips ahead (needs option 2 first) the API returns 400. | One admin per clinic, so the callers are one admin's double click, two browser tabs, or a reload that resets the cache while an older tab asks for C. Without `index`, C could be built on the wrong `avoid` list. |
| D6 | Cache miss or expired entry returns `404 "Options expired, generate them again"`. The page then reloads option A. | No hidden 30 s recompute inside a 5 s step. Each failure has its own status: busy 429, exists 409, expired 404, out of order 400. |
| D7 | The solver is called through `loader()` on every alternative; the cache never holds a solver. | The worker retires after `SOLVER_IDLE_MS` (60 s); an admin may open tab B later. |
| D8 | `ScheduleOptionsResult` gains `maxOptions` and `moreAvailable`. The page drops its mirrored `OPTION_COUNT` and reads `maxOptions`. | Removes the silent frontend/API drift on the option count. |
| D9 | `moreAvailable` is false when option A is not proven optimal (time limit or greedy fallback). | Same rule as the existing D4 of the options plan: no proven optima, no equally good alternatives. |
| D10 | Determinism is kept: B = alternative with `avoid=[A]`, C = `avoid=[A, B]`, same as today. | Same input gives the same options in the same order. |

## Contract

```
POST /schedules/options
  body  { year, month }
  200   { year, month, options: [A], maxOptions: 3, moreAvailable: boolean }
  409   schedule exists
  429   Solver busy, try again shortly (Retry-After)

POST /schedules/options/alternative            (administrator only)
  body  { year, month, index: 2 | 3 }
  200   { option: ScheduleOption | null, moreAvailable: boolean }
        option null = no other equally good schedule exists (Infeasible or no incumbent in 5 s)
  409   schedule exists
  429   Solver busy, try again shortly (Retry-After)
  404   Options expired, generate them again
  400   index out of order (option 2 not generated yet)
```

## Tasks

| ID | Files | Change |
|---|---|---|
| T1 | `packages/shared/src/schemas/schedule.ts`, `schemas/index.ts`, `types/schedule.ts`, `types/index.ts`, `__tests__/schemas.test.ts` | Add `alternativeOptionSchema` (`year`, `month`, `index` int 2..3). Add `maxOptions`, `moreAvailable` to `ScheduleOptionsResult`. Add `ScheduleAlternativeResult`. |
| T2 | `apps/api/src/scheduling/solver.ts`, `index.ts` | Add `runExclusive(fn)` (`let busy`) and `SolverBusyError`. Split `generateOptions` into private ungated workers and public `generatePrimary(ctx)` returning `{ result, state }`, `generateAlternative(state)` returning `{ result } or null`, and `generate(ctx)`; each public entry wraps its worker in `runExclusive` once. `state = { optima, capacity, chosen: Set<string>[], optimal: boolean }`. Remove `generateOptions`. |
| T3 | `apps/api/src/services/schedule.service.ts`, `lib/http-error` consumers (`middleware/error-handler.ts`) | Replace `SCHEDULE_OPTION_COUNT` loop: `generateOptions` returns A, stores the cache entry. New `generateAlternative(year, month, index, scope)` per D5/D6. Map `SolverBusyError` to `HttpError(429)`; error handler adds `Retry-After`. Cache helper with TTL and size cap. `changedDates` computed against A as today. |
| T4 | `apps/api/src/validators/schedule.ts`, `routes/schedule.routes.ts`, `controllers/schedule.controller.ts` | New route `POST /schedules/options/alternative` (administrator, `validate(alternativeOptionSchema)`), thin controller. |
| T5 | `apps/web/src/services/schedule.ts`, `pages/ScheduleOptionsPage.vue`, `locales/en.json`, `locales/el.json` | `alternative(year, month, index)` service. Page: A tab shown at once; tabs B and C appear from `maxOptions` when `moreAvailable`. Opening an empty tab calls the API (5 s progress via `useEstimatedProgress`). While one alternative loads, other empty tabs are disabled. Branch on `ApiError.status`: 429 shows the message plus retry on that tab; 404 reloads option A; other errors show the message. `option: null`: tab marked "no other equally good plan", later tabs disabled. `ESTIMATED_OPTIONS_MS` becomes the primary estimate only; new `ESTIMATED_ALTERNATIVE_MS = 5_000`. Confirm `ApiError` exposes `status` before coding. |
| T6 | tests (see below) | Update `solver.test.ts`, `schedule.service.test.ts`, `schedule.routes.test.ts`, `ScheduleOptionsPage.test.ts`. |
| T7 | docs | `docs/superpowers/specs/2026-10-05-scheduling-solver-design.md:193`, `docs/superpowers/plans/2026-10-07-schedule-options-plan.md` (note: superseded for D6/D8/D11 flow), admin manual section on options if it states "three plans at once", `AGENTS.md` scheduling line ("Generate returns up to 3 ..."). `docs/database.md` unchanged (no DB change). |

## Tests

| Area | Cases |
|---|---|
| Gate (solver) | second concurrent call rejects with `SolverBusyError`; slot is released after success, after a thrown error, and after the greedy fallback; `generate`, `generatePrimary` and `generateAlternative` are each gated and none deadlocks or rejects itself. |
| Alternatives (solver) | B avoids A; C avoids A and B; time-limited primary gives `optimal = false` so no alternative; `Infeasible` alternative returns null. Uses the real HiGHS fixture already in `solver.test.ts`. |
| Service | A returns 1 option and stores the cache; B on cache hit solves once; repeat `index` returns the cached option with no solve; `index: 3` before 2 gives 400; expired or missing entry gives 404; existing schedule gives 409 before any solve; busy maps to 429 with `Retry-After`. |
| Routes | doctor 403; administrator 200; superadmin default clinic; invalid `index` 400; busy 429 header. |
| Web | only tab A before interaction; opening B calls `alternative` with `index 2`; 429 shows the message and retry works; `option: null` disables later tabs; 404 reloads A. Replace the tests that expect three options from one call. |

## Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
2. Real HiGHS: one script runs A then B then C for the October 2026 fixture; the options equal the current 3-option output (determinism, D10).
3. Real HiGHS: start A for one clinic and call A again before it ends; the second call returns 409 busy and the first still finishes.
4. Branch is not `main`: commit task files only, with a detailed message.

## Out of scope (stay in batch 2)

SOL-02 budgets and rate limits, SOL-03 abort on disconnect, SOL-04 idle and gap tuning, SOL-05 removal of the engine endpoints, SOL-07 to SOL-10. The gate wraps them as they are today.

## Risks

| Risk | Mitigation |
|---|---|
| Busy 409 hits B while another admin runs A | Retry on the tab; a busy solve lasts at most one request. |
| Cache lost on API restart | D6: page reloads A. |
| Cached `ctx` older than live data | D4: save path re-validates. |
