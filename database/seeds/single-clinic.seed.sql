-- Single-clinic seed. Applied by `pnpm db:seed:single`, which resets the
-- database, applies schema.sql, then this file (idempotent upserts).
--
-- Baseline: one clinic ('Main Clinic') holding the whole hospital staff -
-- one administrator, nine doctors (dr1-dr9), plus the vendor superadmin.

INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- The hospital's single clinic
INSERT INTO clinics (name) VALUES ('Main Clinic')
ON CONFLICT (name) DO UPDATE SET updated_at = NOW();

-- Vendor audit account (password: changeme123 - change on first login)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
VALUES (
  'superadmin@oncall.local',
  'superadmin',
  '$2b$12$ib69wvBRW9XbWWJagExPNe9QrDklUGCvMBlMivRVOAY03LTNsOwSi',
  'superadmin',
  'Vendor',
  'Superadmin',
  TRUE
)
ON CONFLICT (email) WHERE is_deleted = FALSE DO NOTHING;

-- Administrator (password: changeme123 - change on first login)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active, clinic_id)
VALUES (
  'admin@oncall.local',
  'admin',
  '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
  'administrator',
  'System',
  'Administrator',
  TRUE,
  (SELECT id FROM clinics WHERE name = 'Main Clinic')
)
ON CONFLICT (email) WHERE is_deleted = FALSE DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  clinic_id     = EXCLUDED.clinic_id,
  is_active     = TRUE,
  updated_at    = NOW();

-- Seed sample doctors (password = email, change on first login)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active, clinic_id)
VALUES
  ('dr1@oncall.local', 'dr1', '$2b$12$t65At8AmL5CM1uphNod26es83qUcLR9ycYLLVnyN8YCHgg.IxQ3aO', 'doctor', 'Kostas',     'Fitsilis',        TRUE, (SELECT id FROM clinics WHERE name = 'Main Clinic')),
  ('dr2@oncall.local', 'dr2', '$2b$12$9.HqiDEdLTFpiWJN5noAAOsDfSa/6oLFpP/.HnulzEADAQIOBOQW6', 'doctor', 'Maria',      'Ivanidou',        TRUE, (SELECT id FROM clinics WHERE name = 'Main Clinic')),
  ('dr3@oncall.local', 'dr3', '$2b$12$8KF959sMdv3ifN6tr0uTuu5eKC1UVUqlg30lD/e1UtrNRtNi0lLgm', 'doctor', 'Nikos',      'Soultanis',       TRUE, (SELECT id FROM clinics WHERE name = 'Main Clinic')),
  ('dr4@oncall.local', 'dr4', '$2b$12$fb/aJHYKFEcnL2zCkSlb..2LZN0xfjAcijROn87iZmdorr1cmE/QO', 'doctor', 'Penny',      'Gavala',          TRUE, (SELECT id FROM clinics WHERE name = 'Main Clinic')),
  ('dr5@oncall.local', 'dr5', '$2b$12$jYi9MCqGip4V.Ynb0fCTh.EPrHBYVjvCnM.9Ke7KLohIMLvUvniA2', 'doctor', 'Anna',       'Sokopoulou',      TRUE, (SELECT id FROM clinics WHERE name = 'Main Clinic')),
  ('dr6@oncall.local', 'dr6', '$2b$12$ZJVUxCgDZlVJfoXtQbh91OZwfqnV0aG3V1kJbS2QPy8Ok1a/ZexdS', 'doctor', 'Pavlos',     'Paraskevopoulos', TRUE, (SELECT id FROM clinics WHERE name = 'Main Clinic')),
  ('dr7@oncall.local', 'dr7', '$2b$12$47LuPzklNu2otUNM2PKKXOG8OUYGd.7XiGa2Fve6OwcGYCvDp1FLm', 'doctor', 'Kostas',     'Fanaras',         TRUE, (SELECT id FROM clinics WHERE name = 'Main Clinic')),
  ('dr8@oncall.local', 'dr8', '$2b$12$pk./7Qh2MP/iJaYcD8UyAOR1Ys/kmXarnMYvSg/FuY0pI3sokXwiO', 'doctor', 'Eleutheria', 'Eleutheriadou',   TRUE, (SELECT id FROM clinics WHERE name = 'Main Clinic')),
  ('dr9@oncall.local', 'dr9', '$2b$12$/6TzOQA7Xpnxvei3hI5OG.Vfu5LxdAEHuhdglFxAN/dow0xCPcIF2', 'doctor', 'Ioanna',     'Plousi',          TRUE, (SELECT id FROM clinics WHERE name = 'Main Clinic'))
ON CONFLICT (email) WHERE is_deleted = FALSE DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  clinic_id     = EXCLUDED.clinic_id,
  is_active     = TRUE,
  updated_at    = NOW();

INSERT INTO doctors (user_id, clinic_id, max_monthly_duties)
VALUES
  ((SELECT id FROM users WHERE email = 'dr1@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Main Clinic'), 7),
  ((SELECT id FROM users WHERE email = 'dr2@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Main Clinic'), 7),
  ((SELECT id FROM users WHERE email = 'dr3@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Main Clinic'), 7),
  ((SELECT id FROM users WHERE email = 'dr4@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Main Clinic'), 7),
  ((SELECT id FROM users WHERE email = 'dr5@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Main Clinic'), 7),
  ((SELECT id FROM users WHERE email = 'dr6@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Main Clinic'), 7),
  ((SELECT id FROM users WHERE email = 'dr7@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Main Clinic'), 7),
  ((SELECT id FROM users WHERE email = 'dr8@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Main Clinic'), 7),
  ((SELECT id FROM users WHERE email = 'dr9@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Main Clinic'), 7)
ON CONFLICT (user_id) DO UPDATE SET
  clinic_id          = EXCLUDED.clinic_id,
  max_monthly_duties = EXCLUDED.max_monthly_duties,
  updated_at         = NOW();

-- Random unavailability for every doctor (sample window 2026-09). Values are
-- derived from each doctor's email with hashtext, so every seed run produces
-- the same "random" dates. Doctors who already have unavailability are skipped.
-- dr3 and dr8 arrive disabled, so the Disabled state (exclusions the
-- scheduler ignores until re-enabled) is visible out of the box.
INSERT INTO unavailability (doctor_id, start_date, end_date, is_disabled)
SELECT
  d.id,
  DATE '2026-09-01' + r.start_offset,
  DATE '2026-09-01' + r.start_offset + r.span_days,
  u.email IN ('dr3@oncall.local', 'dr8@oncall.local')
FROM doctors d
JOIN users u ON u.id = d.user_id
CROSS JOIN LATERAL (
  SELECT
    (abs(hashtext(u.email || ':start')::bigint) % 20)::int AS start_offset,
    (abs(hashtext(u.email || ':len')::bigint) % 5)::int   AS span_days
) r
WHERE u.is_deleted = FALSE
  AND NOT EXISTS (SELECT 1 FROM unavailability x WHERE x.doctor_id = d.id);

-- Phase 13: seed the billing deadline 30 days ahead. DO NOTHING is deliberate:
-- re-seeding must never extend an existing deadline.
INSERT INTO app_meta (key, value)
VALUES ('billing_paid_through', to_char(CURRENT_DATE + INTERVAL '30 days', 'YYYY-MM-DD'))
ON CONFLICT (key) DO NOTHING;
