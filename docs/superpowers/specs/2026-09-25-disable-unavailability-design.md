# Disable Unavailability — Design

Date: 2026-09-25
Status: Approved

## Goal

Give administrators a reversible alternative to deleting a doctor's exclusion: a "Disabled" state on `unavailability` records. A disabled record is kept exactly as-is, but the scheduling engine (preview, generate, eligibility, manual duty validation) treats the excluded days as available.

## Scope Decisions

- **New boolean column** `unavailability.is_disabled` (`NOT NULL DEFAULT FALSE`), per the owner's request. Disabled ≠ deleted: history and the original range survive, and re-enabling restores the exclusion with one click.
- **Toggle is admin-only.** `PATCH /unavailability/:id/disabled` requires `authorize('administrator')` (superadmin admitted as usual); the service additionally rejects every non-administrator/superadmin actor, so doctors cannot toggle even their own records — availability claims belong to the doctor, whether the scheduler honors them belongs to the administrator.
- **Disabled records still reserve their days.** The overlap checks in create/update keep counting disabled records. Consequence: enabling a disabled record can never produce an overlap, and an overlapping new record next to a disabled one is rejected with the existing 409. No new validation paths.
- **Filtering happens in SQL, not in the engine.** `buildContext` and `validateAssignment` add `is_disabled = FALSE` to their unavailability queries; the pure scheduling functions (`scheduling/*`) are untouched.
- **Activity log reuses `availability.updated`** with `detail.before/after.isDisabled`. No new action string, so `ACTIVITY_ACTIONS` and the activity UI are unchanged.
- Doctors' self-service page (`MyAvailabilityPage`) is untouched; the additive `isDisabled` field changes nothing there.

## API

`PATCH /unavailability/:id/disabled` — body `{ "isDisabled": true | false }` (Zod: `setUnavailabilityDisabledSchema`).

- 200 `{ success: true, data: { unavailability } }` — the updated record.
- 400 invalid body, 401 unauthenticated, 403 non-admin (manager, doctor), 404 unknown id (and, for an administrator, records outside their clinic — existence hidden), 409 never (no overlap interaction).
- Updates `updated_at`; logs `availability.updated` only when the stored value actually changes.

## File Changes

### Modified — database

- `database/schema.sql`: `is_disabled BOOLEAN NOT NULL DEFAULT FALSE` on `unavailability` (in `CREATE TABLE IF NOT EXISTS`) plus the idempotent evolution `ALTER TABLE unavailability ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE;`.

- `database/seeds/single-clinic.seed.sql`: the random per-doctor exclusion now also sets `is_disabled` — deterministically TRUE for `dr3` and `dr8` — so the Disabled state is visible out of the box after `pnpm db:seed:single`. `multi-clinic.seed.sql` unchanged (default FALSE keeps behavior identical).

- `packages/shared/src/types/unavailability.ts`: `Unavailability.isDisabled: boolean`; new `SetUnavailabilityDisabledRequest`.
- `packages/shared/src/schemas/unavailability.ts`: `setUnavailabilityDisabledSchema` (`{ isDisabled: z.boolean() }`); both barrels export the new symbols.

### Modified — backend

- `apps/api/src/services/unavailability.service.ts`: row mapping gains `is_disabled`/`isDisabled`; new `setDisabled(id, isDisabled, actor)` following the existing `update()` shape (pre-fetch + `assertCanModify`, `FOR UPDATE` re-read inside a transaction, activity only on real change).
- `apps/api/src/services/schedule.service.ts`: `is_disabled = FALSE` added to the `buildContext` unavailability query and the `validateAssignment` unavailability query.
- `apps/api/src/controllers/unavailability.controller.ts`, `routes/unavailability.routes.ts`, `validators/unavailability.ts`: route, handler, schema re-export.

### Modified — web

- `apps/web/src/services/unavailability.ts`: `setDisabled(id, isDisabled)` client function.
- `apps/web/src/pages/AvailabilityPage.vue`: disabled days render struck-through/dimmed with a `title` hint; the doctor group header shows the disabled count; the edit dialog gains a `Disable`/`Enable` button (immediate action, no confirm — reversible — closes the dialog and reloads). Save semantics (day-range reconciliation) unchanged.

## Error Behavior

No new error paths beyond the route above. Scheduling behavior with a disabled record is identical to the record not existing — the existing conflict/unfillable flows apply when a doctor is available again.

## Testing

- `packages/shared/src/__tests__/schemas.test.ts`: `setUnavailabilityDisabledSchema` accepts booleans, rejects missing/non-boolean.
- `apps/api/src/__tests__/unavailability.service.test.ts`: `setDisabled` happy path (SQL + activity), doctor/manager 403, unknown 404, no-op without activity.
- `apps/api/src/__tests__/unavailability.routes.test.ts`: PATCH route role-gating and body validation.
- `apps/api/src/__tests__/schedule.service.test.ts`: scheduling SQL filters `is_disabled = FALSE`.
- `apps/web/src/__tests__/AvailabilityPage.test.ts`: disabled chip styling/header count; Disable/Enable button calls the service and closes the dialog.
- Gate: `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass; schema.sql applied against the dev database (idempotent re-run).

## Out of Scope

Bulk enable/disable, per-day (rather than per-record) disabling, expiry timestamps for the disabled state, exposing the toggle to doctors, and UI changes on `MyAvailabilityPage`.
