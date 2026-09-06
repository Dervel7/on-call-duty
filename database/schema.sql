-- On-Call Duty schema — Phase 1 (smoke test). Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 2: Auth & Authorization

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'doctor'
                CHECK (role IN ('administrator', 'doctor')),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (username ~ '^[A-Za-z0-9._-]{3,32}$')
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role) WHERE is_active = TRUE;

-- Username column evolution for pre-existing databases (no migration runner exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
UPDATE users SET username = split_part(email, '@', 1) WHERE username IS NULL;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  replaced_by  INTEGER REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash)
  WHERE revoked_at IS NULL;

-- Phase 3: Doctor Management

CREATE TABLE IF NOT EXISTS doctors (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  max_monthly_duties INTEGER NOT NULL DEFAULT 7
                     CHECK (max_monthly_duties BETWEEN 1 AND 7),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 4: Availability Management

CREATE TABLE IF NOT EXISTS unavailability (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id  INTEGER NOT NULL REFERENCES doctors (id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('vacation','sick','conference','other')),
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_unavailability_doctor ON unavailability (doctor_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_unavailability_dates ON unavailability (start_date, end_date);

-- Phase 5: Scheduling Engine

-- Holidays removed: drop the table and the denormalized duty flag on existing
-- databases (is_holiday was NOT NULL with no default, so duty inserts would
-- fail if the column lingered).
DROP TABLE IF EXISTS holidays;

CREATE TABLE IF NOT EXISTS schedules (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS duties (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedules (id) ON DELETE CASCADE,
  duty_date   DATE NOT NULL,
  doctor_id   INTEGER NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  is_weekend  BOOLEAN NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE duties DROP COLUMN IF EXISTS is_holiday;
CREATE INDEX IF NOT EXISTS idx_duties_schedule ON duties (schedule_id);
CREATE INDEX IF NOT EXISTS idx_duties_doctor_date ON duties (doctor_id, duty_date);
CREATE INDEX IF NOT EXISTS idx_duties_date ON duties (duty_date);

-- Two-doctors-per-day: allow two distinct doctors per (schedule, date)
ALTER TABLE duties DROP CONSTRAINT IF EXISTS duties_schedule_id_duty_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_duties_schedule_date_doctor
  ON duties (schedule_id, duty_date, doctor_id);

-- Phase 10: Usage metering & superadmin audit

-- superadmin role (vendor auditor). Drop/re-add keeps the file idempotent.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('administrator', 'doctor', 'superadmin'));

-- Append-only: one row per doctor included in each generated schedule.
-- Never deleted by schedule deletion or doctor deactivation.
CREATE TABLE IF NOT EXISTS schedule_generation_log (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id  INTEGER NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_schedule_generation_log_doctor
  ON schedule_generation_log (doctor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_schedule_generation_log_period
  ON schedule_generation_log (year, month);

-- One-time backfill from existing duties (no-op once the log has rows).
INSERT INTO schedule_generation_log (doctor_id, year, month, created_at)
SELECT DISTINCT du.doctor_id, s.year, s.month, s.updated_at
FROM duties du JOIN schedules s ON s.id = du.schedule_id
WHERE NOT EXISTS (SELECT 1 FROM schedule_generation_log LIMIT 1);

-- Alert-only flags, visible to the superadmin only.
-- operator_alerts stays disjoint_regeneration-only; the Phase 13 billing
-- lockdown lives in app_meta, not here. Legacy allowance_exceeded rows are
-- still deleted first so the constraint swap is safe.
CREATE TABLE IF NOT EXISTS operator_alerts (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('disjoint_regeneration')),
  detail      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
DELETE FROM operator_alerts WHERE type = 'allowance_exceeded';
ALTER TABLE operator_alerts DROP CONSTRAINT IF EXISTS operator_alerts_type_check;
ALTER TABLE operator_alerts ADD CONSTRAINT operator_alerts_type_check
  CHECK (type IN ('disjoint_regeneration'));
CREATE INDEX IF NOT EXISTS idx_operator_alerts_open
  ON operator_alerts (type, resolved_at);

-- Phase 11: User Activity Log (append-only audit trail, no update/delete paths exist)

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log (action);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at);

-- Phase 12: Doctor soft delete
-- Deleted accounts: is_deleted = TRUE (and always is_active = FALSE).
-- Partial unique indexes free email/username of deleted accounts for reuse.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
DROP INDEX IF EXISTS idx_users_username;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_live
  ON users (email) WHERE is_deleted = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_live
  ON users (username) WHERE is_deleted = FALSE;

-- Phase 13: Billing lockdown
-- app_meta key 'billing_paid_through' (value 'YYYY-MM-DD'): non-superadmin
-- access is refused while CURRENT_DATE > value. A missing row means unlocked
-- (paidThrough reported as null). No DDL needed — app_meta exists since Phase 1.
