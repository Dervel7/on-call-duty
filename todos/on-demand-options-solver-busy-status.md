# on-demand-options-solver-busy - Status

## Goal

`POST /schedules/options` returns only option A; B and C are computed when the administrator opens their tab. Every solver run takes one module-level slot; a second caller gets 429 with `Retry-After`. Implements SOL-01 and SOL-06.

- Plan: `docs/superpowers/plans/2026-11-10-on-demand-options-and-solver-busy-plan.md` (T1-T7)
- Branch: `fixes_branch`

## State (2026-11-10)

| Task | State |
|---|---|
| T1 shared schema and types | Done |
| T2 solver gate, `generatePrimary`, `generateAlternative` | Done |
| T3 service cache, 429 mapping, `Retry-After` | Done |
| T4 route, validator, controller | Done |
| T5 web service and page | Done |
| T6 tests | Done |
| T7 docs | Done |

Checks: root `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (api 503, web 430).
Plan verification 2 (determinism, D10): a throwaway test ran the October 2026 fixture on the parent commit (`generateOptions`) and on the new code (`generatePrimary` then `generateAlternative` twice). The JSON of A, B and C is byte-identical (23143 bytes each). Throwaway files and worktree removed.
Plan verification 3 (busy): covered by the service test "429 while another solve holds the slot" and the solver gate tests with real HiGHS; no separate manual run.

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-11-10 | Arrow keys on the option tabs only move focus; click selects. | Selecting on arrow would start a 5 s solve per keypress. |
| 2026-11-10 | `Retry-After: 10` set for every 429 in the error handler. | One place, no per-route logic. |
| 2026-11-10 | `alternative` stores its option in the solver `state.chosen` so C avoids A and B. | Order is enforced by the service (400 on skip). |

## Next

- Batch 2 items stay open: SOL-02 to SOL-05, SOL-07 to SOL-10.
