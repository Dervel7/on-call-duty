-- On-Call Duty: initialize a new, empty production database.
--
-- Creates every table, constraint and index in the final shape defined by
-- schema.sql, then adds the minimum data to sign in: one clinic, the vendor
-- superadmin and one administrator account. All settings use their default
-- values.
--
-- Usage (run against an empty database you created first):
--   createdb oncall_duty
--   psql -d oncall_duty -v ON_ERROR_STOP=1 -f database/initialize.sql
--
-- schema.sql stays the source of truth: when it changes, update this file in
-- the same change so the two shapes never drift.

BEGIN;

-- Tables -------------------------------------------------------------------

CREATE TABLE app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clinics (
  id                     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                   TEXT NOT NULL UNIQUE,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  open_duty_slots        INTEGER NOT NULL DEFAULT 2 CHECK (open_duty_slots >= 1),
  post_open_duty_slots   INTEGER NOT NULL DEFAULT 2 CHECK (post_open_duty_slots >= 1),
  closed_duty_slots      INTEGER NOT NULL DEFAULT 2 CHECK (closed_duty_slots >= 1),
  open_duty_minimum      INTEGER NOT NULL DEFAULT 2 CHECK (open_duty_minimum >= 1),
  post_open_duty_minimum INTEGER NOT NULL DEFAULT 2 CHECK (post_open_duty_minimum >= 1),
  closed_duty_minimum    INTEGER NOT NULL DEFAULT 2 CHECK (closed_duty_minimum >= 1)
);

CREATE TABLE users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'doctor',
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  clinic_id     INTEGER REFERENCES clinics (id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  dark_mode     BOOLEAN NOT NULL DEFAULT FALSE,
  language      TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'el')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (username ~ '^[A-Za-z0-9._-]{3,32}$'),
  CONSTRAINT users_role_check
    CHECK (role IN ('superadmin', 'manager', 'administrator', 'doctor')),
  -- superadmin/manager are hospital level (no clinic); administrator/doctor
  -- belong to exactly one clinic.
  CONSTRAINT users_clinic_role_check
    CHECK ( (role IN ('administrator','doctor') AND clinic_id IS NOT NULL)
         OR (role IN ('superadmin','manager')   AND clinic_id IS NULL) )
);

CREATE TABLE refresh_tokens (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by INTEGER REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE doctors (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  clinic_id          INTEGER NOT NULL REFERENCES clinics (id),
  max_monthly_duties INTEGER NOT NULL DEFAULT 7
                     CHECK (max_monthly_duties BETWEEN 1 AND 7),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE unavailability (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id   INTEGER NOT NULL REFERENCES doctors (id) ON DELETE CASCADE,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TABLE holidays (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinic_id    INTEGER NOT NULL REFERENCES clinics (id),
  holiday_date DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, holiday_date)
);

CREATE TABLE schedules (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinic_id  INTEGER NOT NULL REFERENCES clinics (id),
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, year, month)
);

CREATE TABLE duties (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedules (id) ON DELETE CASCADE,
  duty_date   DATE NOT NULL,
  doctor_id   INTEGER NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  is_weekend  BOOLEAN NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE schedule_generation_log (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id  INTEGER NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  clinic_id  INTEGER NOT NULL REFERENCES clinics (id),
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE operator_alerts (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type        TEXT NOT NULL,
  detail      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT operator_alerts_type_check CHECK (type IN ('disjoint_regeneration'))
);

CREATE TABLE activity_log (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  clinic_id   INTEGER REFERENCES clinics (id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes ------------------------------------------------------------------

-- Email and username are unique among live (not soft-deleted) accounts only.
CREATE UNIQUE INDEX idx_users_email_live ON users (email) WHERE is_deleted = FALSE;
CREATE UNIQUE INDEX idx_users_username_live ON users (username) WHERE is_deleted = FALSE;
CREATE INDEX idx_users_clinic ON users (clinic_id) WHERE is_deleted = FALSE;

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_replaced_by ON refresh_tokens (replaced_by);

CREATE INDEX idx_doctors_clinic ON doctors (clinic_id);

CREATE INDEX idx_unavailability_doctor ON unavailability (doctor_id, start_date, end_date);
CREATE INDEX idx_unavailability_dates ON unavailability (start_date, end_date);

CREATE INDEX idx_duties_doctor_date ON duties (doctor_id, duty_date);
CREATE INDEX idx_duties_date ON duties (duty_date);
-- Two distinct doctors may share a day; the same doctor never twice.
CREATE UNIQUE INDEX idx_duties_schedule_date_doctor ON duties (schedule_id, duty_date, doctor_id);

CREATE INDEX idx_schedule_generation_log_doctor ON schedule_generation_log (doctor_id, created_at);
CREATE INDEX idx_schedule_generation_log_clinic_period
  ON schedule_generation_log (clinic_id, year, month, created_at);

CREATE INDEX idx_operator_alerts_open ON operator_alerts (type, resolved_at);

CREATE INDEX idx_activity_log_user ON activity_log (user_id);
CREATE INDEX idx_activity_log_action ON activity_log (action);
CREATE INDEX idx_activity_log_clinic_created ON activity_log (clinic_id, created_at, id);

-- Data ---------------------------------------------------------------------

-- Settings at their seeded defaults. No 'billing_paid_through' row: a missing
-- row means the system is not locked.
INSERT INTO app_meta (key, value) VALUES
  ('schema_version', '1'),
  ('open_duty_anchor_date', '2026-10-02'),
  ('open_duty_interval_days', '8');

-- An administrator must belong to a clinic. Slot counts and minimums use the
-- column defaults.
INSERT INTO clinics (name) VALUES ('Main Clinic');

-- Both accounts keep their current password hashes (bcrypt, cost 12).
-- The superadmin is hospital level, so it has no clinic.
INSERT INTO users (email, username, password_hash, role, first_name, last_name)
VALUES (
  'superadmin@oncall.local',
  'superadmin',
  '$2b$12$ib69wvBRW9XbWWJagExPNe9QrDklUGCvMBlMivRVOAY03LTNsOwSi',
  'superadmin',
  'Vendor',
  'Superadmin'
);

INSERT INTO users (email, username, password_hash, role, first_name, last_name, clinic_id)
VALUES (
  'admin@oncall.local',
  'admin',
  '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
  'administrator',
  'System',
  'Administrator',
  (SELECT id FROM clinics WHERE name = 'Main Clinic')
);

COMMIT;
