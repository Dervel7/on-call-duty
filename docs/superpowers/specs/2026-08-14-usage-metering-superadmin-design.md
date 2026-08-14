# Design: Per-Instance Usage Metering & Superadmin Audit

Date: 2026-08-14
Status: Approved (pending user spec review)

## Problem

The application is sold as a flat per-clinic license, deployed one-server-per-clinic (docker-compose, no central database). Two abuse scenarios cost sales:

1. **Roster swap:** A clinic schedules 10 doctors, deletes them, inserts 10 different doctors, and schedules again — effectively running two rosters through one license.
2. **Alternating rosters:** Two clinics share one installation. Each keeps its doctors in the system and marks the other clinic's doctors unavailable, so each month only one clinic's roster is scheduled. Or: doctors are toggled active/deactivated in alternating groups before each generation.
3. **Disjoint regeneration:** A schedule for a month is deleted and regenerated with a largely different doctor set (e.g. "August" generated on July 25, then a different "August" on July 28).

Current schema defeats detection: deleting a schedule cascade-deletes its `duties`, and deleting a doctor cascade-deletes the user — the evidence disappears.

Deployment is 1:1 (one server per clinic), so there is no central database and no clinic/tenant entity. The vendor (operator) holds a superadmin account on each installation and audits usage there.

## Chosen Posture

- **Alert-only.** Metering never blocks schedule generation. Abuse is surfaced to the superadmin and handled commercially.
- **No phone-home.** All metering data stays in the clinic's local database.
- **Signed license file** carries the entitlement (doctor allowance, expiry) so the clinic administrator cannot raise their own allowance.

## Design

### 1. Superadmin Role

- New role `superadmin` added to the existing `users.role` CHECK (`administrator`, `doctor`, `superadmin`), with enum update in `@oncall/shared`.
- Superadmin is the vendor, not clinic staff. It can do everything an administrator can, plus access the usage/audit endpoints and page.
- Superadmin accounts are created only via the setup/seed script (or by an existing superadmin through user management); never self-serve.
- `authorize('administrator')` middleware must accept `superadmin` as a superset of administrator privileges.

### 2. Doctor Deactivation Instead of Deletion

- The doctor delete endpoint becomes deactivate: sets `users.is_active = FALSE` (and therefore removes the doctor from the scheduling pool).
- Deactivated doctors remain in `doctors`/`duties`/generation log; their duties are untouched (existing `ON DELETE RESTRICT` stays as defense in depth).
- Reactivation (same endpoint/flag) restores the doctor. True row deletion is removed from the API surface.
- Roster UI shows active/deactivated status and allows filtering.

### 3. Append-Only Generation Log

New table `schedule_generation_log`:

```sql
CREATE TABLE IF NOT EXISTS schedule_generation_log (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id  INTEGER NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_schedule_generation_log_doctor ON schedule_generation_log (doctor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_schedule_generation_log_period ON schedule_generation_log (year, month);
```

- One row per doctor included in each **generated** schedule (preview does not log; only actual schedule creation, including creation from an edited preview).
- Rows are never deleted by application code. Schedule deletion does not touch this table.
- One-time idempotent backfill: insert from existing `duties` (distinct doctor per schedule period) if the table is empty.

### 4. Metering Rules (Alert-Only)

Computed in a `usage` service at schedule-generation time, after the generation log is written.

**Rule 1 — Rolling allowance:**
- Distinct `doctor_id` in `schedule_generation_log` with `created_at >= NOW() - rolling_window_days` (default 90) exceeds `license.doctor_allowance` (default 25) → alert `allowance_exceeded`.
- Catches roster swaps and alternating active/deactivate groups: instantaneous active count stays low, but the distinct union over the window does not.

**Rule 2 — Disjoint regeneration:**
- The **most recent** prior generation of the same `(year, month)` exists and its doctor-set overlap with the new generation is < 50%, with both sets having >= 4 doctors → alert `disjoint_regeneration`.
- The alert detail stores `{ year, month }` (used for dedup), both doctor sets (ids + names), and both generation timestamps.
- Regenerating the same month with tweaked availabilities but a similar roster is normal and produces no alert.

**Alert storage:**

```sql
CREATE TABLE IF NOT EXISTS operator_alerts (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('allowance_exceeded','disjoint_regeneration')),
  detail     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
```

- Deduplicated: at most one unresolved `disjoint_regeneration` alert per `(year, month)` and one unresolved `allowance_exceeded` at a time.
- Generation always proceeds regardless of alerts.

### 5. Signed License File

- `apps/api/license.json` (gitignored; `.env.example` documents `LICENSE_FILE` path, default `./license.json`): a JWT signed with Ed25519 (or RS256) — payload `{ doctor_allowance: number, rolling_window_days: number, expires_at: date, licensee: string }`.
- The signing private key stays with the vendor; the public key is baked into the API source. `src/config/env.ts` validates and loads it at boot; invalid signature or expired license → process exits (existing env-validation behavior).
- A vendor script (`scripts/` in the repo root or `apps/api`) generates a license from the private key.
- Missing license file is allowed only when `NODE_ENV !== 'production'` (dev convenience), falling back to defaults (allowance 25, window 90).
- Rationale: the clinic admin controls the server, so a plain env/config allowance would be self-service pricing. The signature prevents that. Direct DB edits remain possible for the admin; the generation log is an audit trail for the vendor, not tamper-proofing — the license contract covers that residual risk.

### 6. Superadmin Usage Page & API

**API** (`src/routes/usage.routes.ts` etc., superadmin-only):
- `GET /usage/summary` — license info (allowance, window, expiry, licensee), rolling distinct-doctor count (with window), open alert count.
- `GET /usage/generations` — generation history grouped by (year, month, created_at): doctor count, doctor names, overlap percentage with the previous generation of the same month.
- `GET /usage/alerts` — list, with unresolved first.
- `PATCH /usage/alerts/:id/resolve` — set `resolved_at` (superadmin only).
- `GET /doctors` extended with `is_active` filtering for the roster view.

**Web** (`pages/UsagePage.vue`, route `meta.roles: ['superadmin']`):
- License card (allowance, expiry, current rolling count vs allowance).
- Generation history table (when, month, doctors, overlap with previous).
- Alerts list with resolve action.
- Doctor roster with active/deactivated status.

### 7. What This Catches / Residual Risk

- Catches: roster swaps (rolling count), alternating-group activation (rolling count), disjoint same-month regeneration (overlap rule).
- Does not catch: sharing slower than the rolling window, or two small clinics whose union stays under the allowance. Residual risk is handled contractually; the generation log provides the data to add behavioral detection later if needed.

## Error Handling

- Metering/log-write failures inside the generation transaction fail the generation (the log is the product's audit trail; a silent gap is worse than a failed request).
- License load errors at boot follow existing env-validation behavior: log and exit.
- All new endpoints use the standard response envelope and status codes (403 for non-superadmin).

## Testing

- `usage` service unit tests: allowance rule (window boundary, distinct counting), disjoint-regeneration rule (overlap threshold, min-set-size guard, dedup), backfill idempotence.
- Route tests: role guards (administrator/doctor get 403 on usage routes), doctor deactivate/reactivate lifecycle, generation log survives schedule deletion.
- Web: one test file for `UsagePage.vue` (summary rendering, alert resolve action, role-gated route).
- `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass.

## Out of Scope

- Phone-home telemetry / central licensing server.
- Anomaly detection beyond the two rules (churn scoring, clustering).
- Self-serve clinic signup and billing.
- Hard blocking on allowance exceedance.
