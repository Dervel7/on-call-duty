INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Phase 2: seed administrator (password: changeme123 - change on first login)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
VALUES (
  'admin@oncall.local',
  'admin',
  '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
  'administrator',
  'System',
  'Administrator',
  TRUE
)
ON CONFLICT (email) WHERE is_deleted = FALSE DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();

-- Phase 3: seed sample doctors (password = email, change on first login)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
VALUES
  ('dr1@oncall.local', 'dr1', '$2b$12$t65At8AmL5CM1uphNod26es83qUcLR9ycYLLVnyN8YCHgg.IxQ3aO', 'doctor', 'Nikos',    'Papadopoulos', TRUE),
  ('dr2@oncall.local', 'dr2', '$2b$12$9.HqiDEdLTFpiWJN5noAAOsDfSa/6oLFpP/.HnulzEADAQIOBOQW6', 'doctor', 'Eleni',    'Dimitriou',    TRUE),
  ('dr3@oncall.local', 'dr3', '$2b$12$8KF959sMdv3ifN6tr0uTuu5eKC1UVUqlg30lD/e1UtrNRtNi0lLgm', 'doctor', 'Giorgos',  'Konstantinou', TRUE),
  ('dr4@oncall.local', 'dr4', '$2b$12$fb/aJHYKFEcnL2zCkSlb..2LZN0xfjAcijROn87iZmdorr1cmE/QO', 'doctor', 'Maria',    'Georgiou',     TRUE),
  ('dr5@oncall.local', 'dr5', '$2b$12$jYi9MCqGip4V.Ynb0fCTh.EPrHBYVjvCnM.9Ke7KLohIMLvUvniA2', 'doctor', 'Yannis',   'Ioannou',      TRUE),
  ('dr6@oncall.local', 'dr6', '$2b$12$ZJVUxCgDZlVJfoXtQbh91OZwfqnV0aG3V1kJbS2QPy8Ok1a/ZexdS', 'doctor', 'Sofia',    'Vlachou',      TRUE),
  ('dr7@oncall.local', 'dr7', '$2b$12$47LuPzklNu2otUNM2PKKXOG8OUYGd.7XiGa2Fve6OwcGYCvDp1FLm', 'doctor', 'Dimitris', 'Antoniou',     TRUE),
  ('dr8@oncall.local', 'dr8', '$2b$12$pk./7Qh2MP/iJaYcD8UyAOR1Ys/kmXarnMYvSg/FuY0pI3sokXwiO', 'doctor', 'Katerina', 'Pavlidou',     TRUE)
ON CONFLICT (email) WHERE is_deleted = FALSE DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();

INSERT INTO doctors (user_id, max_monthly_duties)
VALUES
  ((SELECT id FROM users WHERE email = 'dr1@oncall.local' AND is_deleted = FALSE), 7),
  ((SELECT id FROM users WHERE email = 'dr2@oncall.local' AND is_deleted = FALSE), 7),
  ((SELECT id FROM users WHERE email = 'dr3@oncall.local' AND is_deleted = FALSE), 7),
  ((SELECT id FROM users WHERE email = 'dr4@oncall.local' AND is_deleted = FALSE), 7),
  ((SELECT id FROM users WHERE email = 'dr5@oncall.local' AND is_deleted = FALSE), 7),
  ((SELECT id FROM users WHERE email = 'dr6@oncall.local' AND is_deleted = FALSE), 6),
  ((SELECT id FROM users WHERE email = 'dr7@oncall.local' AND is_deleted = FALSE), 6),
  ((SELECT id FROM users WHERE email = 'dr8@oncall.local' AND is_deleted = FALSE), 6)
ON CONFLICT (user_id) DO UPDATE SET
  max_monthly_duties = EXCLUDED.max_monthly_duties,
  updated_at         = NOW();

-- Phase 4: seed sample unavailability (fixed sample month 2026-09)
INSERT INTO unavailability (doctor_id, type, start_date, end_date, note)
SELECT d.id, 'vacation', '2026-09-07', '2026-09-11', 'Summer break'
FROM doctors d JOIN users u ON u.id = d.user_id
WHERE u.email = 'dr1@oncall.local' AND u.is_deleted = FALSE
AND NOT EXISTS (SELECT 1 FROM unavailability x WHERE x.doctor_id = d.id AND x.start_date = '2026-09-07' AND x.end_date = '2026-09-11');

INSERT INTO unavailability (doctor_id, type, start_date, end_date, note)
SELECT d.id, 'sick', '2026-09-15', '2026-09-15', NULL
FROM doctors d JOIN users u ON u.id = d.user_id
WHERE u.email = 'dr2@oncall.local' AND u.is_deleted = FALSE
AND NOT EXISTS (SELECT 1 FROM unavailability x WHERE x.doctor_id = d.id AND x.start_date = '2026-09-15' AND x.end_date = '2026-09-15');

-- Phase 10: seed superadmin (vendor audit account, password: changeme123)
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

-- Phase 13: seed the billing deadline 30 days ahead. DO NOTHING is deliberate:
-- re-seeding must never extend an existing deadline.
INSERT INTO app_meta (key, value)
VALUES ('billing_paid_through', to_char(CURRENT_DATE + INTERVAL '30 days', 'YYYY-MM-DD'))
ON CONFLICT (key) DO NOTHING;
