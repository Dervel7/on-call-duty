# Generate Button Press Counter — Design

Date: 2026-09-03
Status: Approved

## Goal

Count how many times administrators press a Generate button, and let only the
superadmin view the counters. Also remove the Preview button from the
"New schedule" dialog on the Schedules page, leaving only Generate.

## Background

Two Generate buttons exist, both administrator-only:

1. `SchedulesPage.vue` — "Generate" in the New schedule dialog (`POST /schedules`).
2. `SchedulePreviewPage.vue` — "Generate schedule" (`POST /schedules` with assignments).

A `superadmin` role exists; the Usage page (`/usage`) and its `/usage/*` API
routes are already superadmin-only. The codebase already uses append-only
metering tables (`schedule_generation_log`).

## Decisions

- Count **literal button presses** (clicked = counted), not successful generations.
- Count **both** Generate buttons.
- Per-user counters plus a grand total.
- One row per user per day: the counter is **upserted** on conflict of
  `(user_id, press_date)` instead of appending one row per press.
- The press endpoint accepts **administrator (and superadmin)** only — the
  server enforces that only admins can record presses.
- The read endpoint is **superadmin-only**.

## Database

`database/schema.sql` (idempotent DDL, no migration runner):

```sql
CREATE TABLE IF NOT EXISTS generate_press_counters (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  press_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INT NOT NULL,
  CONSTRAINT pk_generate_press_counters PRIMARY KEY (user_id, press_date)
);
```

No `id`, no timestamps, no note — minimal by request. Upsert path:

```sql
INSERT INTO generate_press_counters (user_id, press_date, count)
VALUES ($1, CURRENT_DATE, 1)
ON CONFLICT (user_id, press_date) DO UPDATE SET count = generate_press_counters.count + 1;
```

## API

Follows the existing `routes -> controller -> service` pattern under the
usage domain.

- `POST /usage/generate-presses` — `authenticate` + `authorize('administrator')`.
  Inserts/increments today's counter for the authenticated user. Always
  returns `204 No Content`. Failures surface as normal error envelopes;
  the frontend never blocks on them.
- `GET /usage/generate-presses` — `authenticate` + `authorize('superadmin')`.
  Returns per-user sums and the grand total:

```json
{
  "success": true,
  "data": {
    "total": 23,
    "byUser": [
      { "userId": 2, "username": "admin1", "firstName": "Ada", "lastName": "Lovelace", "presses": 14 }
    ]
  }
}
```

## Frontend

- `services/usage.ts` (or new small module): `recordGeneratePress()` and
  `getGeneratePresses()`.
- Both Generate buttons call `recordGeneratePress()` **fire-and-forget**
  (`void recordGeneratePress().catch(() => {})`) before their normal logic,
  so a failed log never blocks or breaks generation.
- `SchedulesPage.vue` dialog: remove the Preview button, the `goPreview`
  handler, and the "Use Preview..." helper text. The preview page remains
  reachable through the failed-generation redirect added earlier.
- `UsagePage.vue`: new "Generate button presses" card showing the total and
  the per-user list.

## Error handling

- Press recording failures are swallowed in the UI (counter is metering,
  not business logic).
- Read endpoint errors render in the Usage card like other usage data.

## Testing

- API: route tests — POST requires auth + admin, upsert increments
  (mocked service), GET superadmin-only (403 for administrator/doctor).
- Service test: upsert SQL uses `ON CONFLICT`, aggregation query correct.
- Web: SchedulesPage — dialog has no Preview button; Generate fires press
  then generate. SchedulePreviewPage — Generate fires press. UsagePage —
  renders total + per-user rows.
