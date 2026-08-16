# Doctor Soft Delete — Design

Date: 2026-08-16
Status: Approved

## Problem

The Doctors page has two actions, "Disable" and "Deactivate", that do the same thing:
both set `users.is_active = FALSE` and the doctor remains visible in the list. There is
no way to remove a doctor from the list without hard-deleting rows (which is forbidden
— historical duties must be preserved).

## Decisions

- **Disable** stays: reversible, doctor remains listed with "disabled" status, excluded
  from scheduling and login.
- **Deactivate" is replaced by **Delete**: a soft delete. The doctor becomes completely
  invisible in the UI (no "show deleted" view, no restore). If deleted by mistake, the
  admin re-creates the doctor; email/username become reusable.
- **Scheduling** uses active doctors only (unchanged): `WHERE u.is_active = TRUE`.
  Deleted doctors are always `is_active = FALSE`, so they are excluded from all new
  schedules. Past duties in published schedules keep rendering the doctor's name.

## State Model (`users` table)

| State | is_active | is_deleted | Listed | Can log in | In scheduling |
|---|---|---|---|---|---|
| Active | TRUE | FALSE | yes | yes | yes |
| Disabled | FALSE | FALSE | yes ("disabled") | no (403) | no |
| Deleted | FALSE | TRUE | no | no (401) | no |

Invariant: deletion always sets `is_deleted = TRUE` AND `is_active = FALSE`.

## 1. Database (`database/schema.sql`)

Idempotent evolution block (Phase 12):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- Free email/username of deleted accounts for reuse
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
DROP INDEX IF EXISTS idx_users_username;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_live
  ON users (email) WHERE is_deleted = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_live
  ON users (username) WHERE is_deleted = FALSE;
```

No migration runner — the file is re-runnable by design.

## 2. Backend (`apps/api`)

### `doctor.service.ts`

- `list()` / `getById()`: add `AND u.is_deleted = FALSE`. Deleted doctors vanish from
  the list; `getById` returns 404.
- `getByUserId()` (used by `/doctors/me`): same filter — a deleted doctor's own
  profile endpoint 404s.
- `deactivate()` renamed to `remove()`; single transaction:
  1. Block with **409** if the doctor has duties in any schedule with status `draft`
     ("Doctor has duties in a draft schedule"). Published duties never block deletion.
  2. `UPDATE users SET is_deleted = TRUE, is_active = FALSE, updated_at = NOW()`.
  3. Revoke all refresh tokens for the user.
  4. Record `doctor.deleted` in the activity log.
- `create()` duplicate checks: `WHERE email = $1 AND is_deleted = FALSE` (same for
  username) so a deleted doctor's email/username can be used for a new account.

### `auth.service.ts`

- Login lookups (`findByEmail`, `findByUsername`): add `AND is_deleted = FALSE`.
  Deleted accounts get 401 "Invalid credentials" (does not leak account existence;
  disabled accounts keep the existing 403 "Account disabled").
- Refresh flow: revoked tokens fail naturally; deleted user lookup is defense in depth.

### `user.service.ts` (Users page)

- `list()` and duplicate email/username checks get the same `is_deleted = FALSE`
  filter.

### Unchanged

- Routes: `DELETE /doctors/:id` keeps its path/semantics; controller wires to
  `remove()`. `authorize('administrator')` already includes superadmin.
- Scheduling engine and `stats.service.ts`: existing `is_active = TRUE` filters
  already exclude deleted doctors.
- Published duties: `ON DELETE RESTRICT` FK plus locked schedules preserve history.

## 3. Frontend (`apps/web`)

- `DoctorsPage.vue`: "Deactivate" button becomes **"Delete"**. Confirm text:
  *"Delete doctor {email}? They will be permanently hidden from the list. Past duties
  in published schedules are kept. This cannot be undone."*
- Disable/Enable toggle unchanged.
- UsersPage / AdminDashboard / ReportsPage: no changes; backend no longer returns
  deleted rows.

## 4. Error Handling

| Case | Status | Message |
|---|---|---|
| Delete doctor with draft duties | 409 | Doctor has duties in a draft schedule |
| Get/edit deleted doctor | 404 | Doctor not found |
| Login as deleted doctor | 401 | Invalid credentials |
| Create with deleted account's email/username | — | Allowed (no conflict) |

## 5. Testing

- API service tests (`doctor.service.test.ts`): delete sets both flags + revokes
  tokens; 409 on draft duties; allowed with published-only duties; 404 after delete;
  email/username reusable after delete.
- `auth.service.test.ts`: deleted user login → 401.
- `user.service.test.ts`: list excludes deleted.
- Route tests renamed/updated for `remove`.
- Web `DoctorsPage.test.ts`: Delete button calls `remove`, confirm text asserted.

## Limitations

- An in-memory access token stays valid up to 15 min after deletion until it expires;
  refresh is blocked immediately (same behavior as disabled accounts today).
- Restoration from deleted state requires direct DB intervention; this is accepted.
