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
ON CONFLICT (email) DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();

-- Phase 3: seed sample doctors (password = email, change on first login)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
VALUES
  ('dr1@oncall.local', 'dr1',  '$2b$12$sf0hxnuWvwI17HpZNo.VBubjp35/R3CXtabJsFMpjQxA/erV9m21G', 'doctor', 'Jane',   'Roe',     TRUE),
  ('dr2@oncall.local', 'dr2',  '$2b$12$CxcEXDtGy52WGatK9YCNlOdyS6yp1uNd4Ac8f68YZOmHYXN2HR8Sq', 'doctor', 'John',   'Smith',   TRUE),
  ('dr3@oncall.local', 'dr3',  '$2b$12$nXzGkWp0gNlyFOj8/dp6oOQ0BH7twg.VkgYF95PqOzagOTZsBrJOW', 'doctor', 'Maria',  'Garcia',  TRUE),
  ('dr4@oncall.local', 'dr4',  '$2b$12$33333333333333333333333333333333333333333333333333333',   'doctor', 'Ahmed',  'Hassan',  TRUE),
  ('dr5@oncall.local', 'dr5',  '$2b$12$44444444444444444444444444444444444444444444444444444',    'doctor', 'Sara',   'Cohen',   TRUE),
  ('dr6@oncall.local', 'dr6',  '$2b$12$55555555555555555555555555555555555555555555555555555',    'doctor', 'Liam',   'Novak',   TRUE),
  ('dr7@oncall.local', 'dr7',  '$2b$12$66666666666666666666666666666666666666666666666666666',    'doctor', 'Emma',   'Muller',  TRUE),
  ('dr8@oncall.local', 'dr8',  '$2b$12$77777777777777777777777777777777777777777777777777777',    'doctor', 'Noah',   'Rossi',   TRUE),
  ('dr9@oncall.local', 'dr9',  '$2b$12$88888888888888888888888888888888888888888888888888888',   'doctor', 'Olivia', 'Petrov',  TRUE),
  ('dr10@oncall.local','dr10', '$2b$12$99999999999999999999999999999999999999999999999999999',   'doctor', 'Lucas',  'Diaz',    TRUE),
  ('dr11@oncall.local','dr11', '$2b$12$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',   'doctor', 'Ava',    'Kowalski',TRUE),
  ('dr12@oncall.local','dr12', '$2b$12$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',   'doctor', 'Ethan',  'Yamada',  TRUE)
ON CONFLICT (email) DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();

INSERT INTO doctors (user_id, max_monthly_duties)
VALUES
  ((SELECT id FROM users WHERE email = 'dr1@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr2@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr3@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr4@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr5@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr6@oncall.local'),  6),
  ((SELECT id FROM users WHERE email = 'dr7@oncall.local'),  6),
  ((SELECT id FROM users WHERE email = 'dr8@oncall.local'),  6),
  ((SELECT id FROM users WHERE email = 'dr9@oncall.local'),  6),
  ((SELECT id FROM users WHERE email = 'dr10@oncall.local'), 5),
  ((SELECT id FROM users WHERE email = 'dr11@oncall.local'), 5),
  ((SELECT id FROM users WHERE email = 'dr12@oncall.local'), 5)
ON CONFLICT (user_id) DO UPDATE SET
  max_monthly_duties = EXCLUDED.max_monthly_duties,
  updated_at         = NOW();

-- Phase 4: seed sample unavailability (fixed sample month 2026-09)
INSERT INTO unavailability (doctor_id, type, start_date, end_date, note)
SELECT d.id, 'vacation', '2026-09-07', '2026-09-11', 'Summer break'
FROM doctors d JOIN users u ON u.id = d.user_id
WHERE u.email = 'dr1@oncall.local'
AND NOT EXISTS (SELECT 1 FROM unavailability x WHERE x.doctor_id = d.id AND x.start_date = '2026-09-07' AND x.end_date = '2026-09-11');

INSERT INTO unavailability (doctor_id, type, start_date, end_date, note)
SELECT d.id, 'sick', '2026-09-15', '2026-09-15', NULL
FROM doctors d JOIN users u ON u.id = d.user_id
WHERE u.email = 'dr2@oncall.local'
AND NOT EXISTS (SELECT 1 FROM unavailability x WHERE x.doctor_id = d.id AND x.start_date = '2026-09-15' AND x.end_date = '2026-09-15');

-- Phase 5: seed sample holidays (fixed sample month 2026-09)
INSERT INTO holidays (name, date)
SELECT 'Sample Holiday', '2026-09-01'
WHERE NOT EXISTS (SELECT 1 FROM holidays WHERE date = '2026-09-01');

INSERT INTO holidays (name, date)
SELECT 'Another Holiday', '2026-09-17'
WHERE NOT EXISTS (SELECT 1 FROM holidays WHERE date = '2026-09-17');
