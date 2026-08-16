# User Activity Log — Design

Date: 2026-08-16
Status: Approved

## Goal

A complete audit trail of user actions. Every mutation (create/update/delete across all domains) and every auth event (login, logout, password change) is recorded with who did it, when, what entity it affected, and what changed. Administrators (and superadmins) get a "User Activity" tab with filtering by action, user, and time range.

## Scope Decisions

- **Logged**: all mutations + auth events (`login`, `logout`, `password_changed`). Token refresh is NOT logged (routine noise). Reads (GETs) are NOT logged.
- **Actor filter**: by the user who performed the action (not by target doctor).
- **Detail level**: JSON snapshot of changed data (before/after on edits). Password hashes and secrets never enter `detail`.
- **Retention**: keep forever. No auto-purge.
- **Write mechanism**: in-transaction audit writes (approach A) — the audit INSERT runs on the same `PoolClient` as the business change, inside the same `withTransaction`. A failed audit write fails the business operation (same deliberate coupling as `recordGeneration` in `usage.service.ts`).

## Data Model

Append-only table in `database/schema.sql` (single idempotent DDL, no migration runner):

```sql
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- `user_id` is the acting user; `ON DELETE SET NULL` preserves history (same pattern as `schedules.created_by`).
- `entity_id` is NULL for auth events.
- Indexes: `idx_activity_log_user (user_id)`, `idx_activity_log_action (action)`, `idx_activity_log_created_at (created_at)` — one per filter.
- The table is strictly append-only: no update/delete endpoints ever exist.

## Action Taxonomy

Namespaced `domain.verb` strings, validated as a literal union (`ActivityAction`) in `@oncall/shared` — not a DB enum, so adding actions stays cheap.

| Domain | Actions |
|---|---|
| `auth` | `login`, `logout`, `password_changed` |
| `user` | `created`, `updated`, `deactivated`, `reactivated` |
| `doctor` | `created`, `updated` |
| `availability` | `created`, `updated`, `deleted` |
| `holiday` | `created`, `updated`, `deleted` |
| `schedule` | `generated`, `published`, `reverted`, `deleted` |
| `duty` | `assigned`, `reassigned`, `removed` |

`detail` examples:

- availability created → `{ type, startDate, endDate }`
- schedule published → `{ year, month, dutyCount }`
- user updated → `{ before: { role, isActive }, after: { role, isActive } }`

## Backend

### Write path

`services/activity.service.ts` exports:

```ts
recordActivity(client, { userId, action, entityType, entityId, detail })
```

A single parameterized INSERT on the passed `PoolClient`. Services already using `withTransaction` (unavailability, schedule, duty, …) add one call inside it. Non-transactional events (auth) use a small wrapper that opens its own transaction.

Touch points: `auth.service` (login/logout/password), `user.service`, `doctor.service`, `unavailability.service`, `holiday.service`, `schedule.service` (generate/publish/revert/delete + duty assign/reassign/remove).

A shared detail-builder helper keeps secret exclusion consistent (password fields never included).

### Read API

```
GET /activity?action=&userId=&from=&to=&page=&limit=
```

- `authenticate` → `authorize('administrator')` (superadmin implicitly included) → `validate(activityQuerySchema, 'query')`.
- All params optional; filters combine with AND.
- First paginated endpoint in the repo: returns `{ items, total, page, limit }`; `limit` default 50, capped at 100; ordered `created_at DESC, id DESC`.
- `from`/`to` filter on `created_at`; page beyond range returns empty `items` with correct `total`.
- Items include actor `{ id, username, role, firstName, lastName }` via JOIN to `users`; actor is `null` for deleted users.

### Shared package

- `packages/shared/src/types/audit.ts`: `ActivityAction`, `ActivityLogEntry`, `ActivityQuery`, `PaginatedActivity`.
- `packages/shared/src/schemas/audit.ts`: `activityQuerySchema` (Zod).
- Both re-exported from the existing barrels.

## Frontend

- **Route**: `/activity` → `pages/ActivityPage.vue`, `meta.roles: ['administrator']` (guard treats superadmin as superset).
- **Nav**: "Activity" link in `AppHeader.vue` `navItems`, gated on `auth.isAdmin` — same pattern as other admin tabs. No new Pinia store; page holds local state.
- **Service**: `services/activity.ts` — `getActivity(query)` via `apiGet`.

### Page layout

- Filter bar (Card): action select (grouped by domain, value `domain.verb`, empty = all), user select (from existing `services/user.ts`), from/to date inputs, clear-filters button.
- Table (existing `ui/table` primitives): Timestamp, User (name + role badge), Action (domain badge), Entity, Details (truncated JSON, full value on expand/tooltip).
- Pagination footer: "Showing X–Y of Z" + Prev/Next; limit fixed at 50.
- Loading/empty states match existing pages; deleted actor renders "Deleted user".

## Error Handling

- Audit INSERT failure rolls back the business operation (intentional); surfaces as 500 via the existing error handler.
- Invalid filter params → 400 via `validate()`.
- Deleted actors → `user_id` NULL → API/UI render "Deleted user" (safety net; users are normally deactivated, not deleted).

## Testing

- **Unit (API)**: `activity.service` — record + paginated query with each filter combination, empty-page behavior, actor JOIN with NULL user.
- **Integration (supertest)**: per domain, a mutation writes and commits a log row (e.g. POST /unavailability → `availability.created` row with detail); rollback leaves no row; GET /activity requires administrator; pagination envelope shape.
- **Web (jsdom + @vue/test-utils)**: `ActivityPage` — renders rows, filters trigger refetch with correct params, Prev/Next pagination, empty state.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` all green before done.
