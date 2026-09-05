# Remove Licensing — Design

Date: 2026-09-05
Status: Approved

## Goal

Delete the entire license subsystem. Nothing in the API reads, verifies, or requires a license file; production boot no longer has a license-related failure mode. The superadmin role keeps its usage statistics: generation history, `disjoint_regeneration` alerts, and alert resolution remain fully functional.

## Scope Decisions

- **Approach A (approved): full clean removal, minimal remaining surface.** The license comparison and everything that exists only to support it goes. `GET /usage/summary` and the `UsageSummary` shared type are removed — their payload was license data plus a rolling count whose only purpose was the allowance comparison; the surviving `openAlerts` number is computed on the page from the alerts list it already loads.
- **Rolling distinct-doctors count: removed** (owner decision). The 90-day rolling window concept came from the license, so it disappears with it.
- **Kept**: superadmin role, guards, seeded `superadmin@oncall.local` account, `UsagePage`, `/usage/generations`, `/usage/alerts`, `PATCH /usage/alerts/:id/resolve`, `schedule_generation_log` table, `operator_alerts` table, `disjoint_regeneration` detection (Rule 2) inside the schedule-creation transaction.
- **Removed**: Ed25519 license verification, boot-exit enforcement, dev public key, vendor keygen/issue CLI, `LICENSE_FILE` env var, compose mount, ignore-file entries, `allowance_exceeded` alert (Rule 1), `LicenseInfo`/`UsageSummary` types, License card on the usage page.
- **Historical docs** in `docs/superpowers/` are dated records and stay untouched.

## File Changes

### Deleted

| File | Reason |
|---|---|
| `apps/api/src/config/license.ts` | License verify/load + production boot-exit |
| `apps/api/src/config/license-public-key.ts` | Dev Ed25519 public key |
| `apps/api/src/config/__tests__/license.test.ts` | Tests for deleted config |
| `apps/api/scripts/license.ts` | Vendor keygen/issue CLI |

### Modified — backend

- `apps/api/src/config/env.ts`: remove `LICENSE_FILE` from the Zod schema.
- `apps/api/src/services/usage.service.ts`:
  - Remove the `license` import.
  - `recordGeneration`: delete the allowance check (Rule 1) and the rolling-window query. Keep the `schedule_generation_log` inserts and the disjoint-regeneration detection (Rule 2), unchanged in placement (same transaction) and behavior (never throws for alerts).
  - Delete `summary()`.
  - `AlertRow.type` narrows to `'disjoint_regeneration'`.
- `apps/api/src/controllers/usage.controller.ts`: remove the `summary` handler.
- `apps/api/src/routes/usage.routes.ts`: remove the `GET /summary` route.

### Modified — shared

- `packages/shared/src/types/usage.ts`: delete `LicenseInfo` and `UsageSummary`; `OperatorAlertType = 'disjoint_regeneration'`.

### Modified — web

- `apps/web/src/pages/UsagePage.vue`: remove the License card and the `summary` ref/call; open-alert count derived locally (`alerts.filter(a => a.resolvedAt === null).length`); generation history and alerts tables unchanged.
- `apps/web/src/services/usage.ts`: remove the `summary()` client function.

### Modified — database

- `database/schema.sql`: `operator_alerts.type` CHECK becomes `('disjoint_regeneration')`, applied idempotently — a `DELETE FROM operator_alerts WHERE type = 'allowance_exceeded'` (cleans legacy rows so the constraint swap cannot fail) followed by the constraint drop/re-add, following the existing constraint-evolution pattern in this file. Both fresh and existing databases converge on re-run of `db:setup`.

### Modified — config / deploy

- Root `.env.example`: remove the License section.
- `apps/api/.env.example`: remove `LICENSE_FILE` entries.
- `docker-compose.yml`: remove the `LICENSE_FILE` env var, the `./license.json:/license.json:ro` mount, and their comments.
- `.gitignore`: remove license-file/key entries.
- `.dockerignore`: remove license-file/key entries (the plain `LICENSE` exclusion stays — that is the repo's own license text, unrelated).

`README.md` and `docs/admin-manual/` contain no license references; no changes needed there.

## Error Behavior

No new error paths. Production boot no longer inspects licenses — the existing boot-exit failure modes (dev key refused in production, missing/invalid license file) disappear entirely. `recordGeneration`'s remaining contract is unchanged: generation-log write failures fail the transaction; alert conditions never throw.

## Testing

- `apps/api/src/__tests__/usage.service.test.ts`: drop allowance/summary cases and the `license` import; keep disjoint-regeneration and generation-history cases; remains the live-DB integration file.
- `apps/api/src/__tests__/usage.routes.test.ts`: drop the summary test; role-gating coverage moves to the surviving endpoints (`/usage/generations`, `/usage/alerts`).
- `apps/web/src/__tests__/UsagePage.test.ts`: remove license fixtures; assert the locally computed open-alert count plus the unchanged history/alerts rendering.
- Gate: `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.

## Out of Scope

Superadmin role/guards/seed account, disjoint alerts, generation log, historical design docs, and every other finding from the 2026-09-05 deployment audit (credentials, TLS, backups, concurrency, etc.).
