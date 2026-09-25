-- Multi-clinic baseline (2026-09-19). Fresh-start seed; not applicable to
-- pre-multi-clinic databases (reset required).
--
-- Baseline: six clinics (two each in Cardiology, Neurology, Radiology) with
-- ten doctors in each. The earlier three-clinic baseline (Radiology /
-- Cardiology / Neurology) is replaced, not migrated: reset the database.

INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Clinics
INSERT INTO clinics (name) VALUES
  ('Cardiology A'),
  ('Cardiology B'),
  ('Neurology A'),
  ('Neurology B'),
  ('Radiology A'),
  ('Radiology B')
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

-- Hospital-wide manager (password: changeme123 - change on first login)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
VALUES (
  'manager@oncall.local',
  'manager',
  '$2b$12$ib69wvBRW9XbWWJagExPNe9QrDklUGCvMBlMivRVOAY03LTNsOwSi',
  'manager',
  'Hospital',
  'Manager',
  TRUE
)
ON CONFLICT (email) WHERE is_deleted = FALSE DO NOTHING;

-- Per-clinic administrators, one per clinic (password: changeme123 - change on
-- first login)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active, clinic_id)
VALUES
  (
    'cardiology-a.admin@oncall.local',
    'cardiology-a.admin',
    '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
    'administrator',
    'Cardiology A',
    'Admin',
    TRUE,
    (SELECT id FROM clinics WHERE name = 'Cardiology A')
  ),
  (
    'cardiology-b.admin@oncall.local',
    'cardiology-b.admin',
    '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
    'administrator',
    'Cardiology B',
    'Admin',
    TRUE,
    (SELECT id FROM clinics WHERE name = 'Cardiology B')
  ),
  (
    'neurology-a.admin@oncall.local',
    'neurology-a.admin',
    '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
    'administrator',
    'Neurology A',
    'Admin',
    TRUE,
    (SELECT id FROM clinics WHERE name = 'Neurology A')
  ),
  (
    'neurology-b.admin@oncall.local',
    'neurology-b.admin',
    '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
    'administrator',
    'Neurology B',
    'Admin',
    TRUE,
    (SELECT id FROM clinics WHERE name = 'Neurology B')
  ),
  (
    'radiology-a.admin@oncall.local',
    'radiology-a.admin',
    '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
    'administrator',
    'Radiology A',
    'Admin',
    TRUE,
    (SELECT id FROM clinics WHERE name = 'Radiology A')
  ),
  (
    'radiology-b.admin@oncall.local',
    'radiology-b.admin',
    '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
    'administrator',
    'Radiology B',
    'Admin',
    TRUE,
    (SELECT id FROM clinics WHERE name = 'Radiology B')
  )
ON CONFLICT (email) WHERE is_deleted = FALSE DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  clinic_id     = EXCLUDED.clinic_id,
  is_active     = TRUE,
  updated_at    = NOW();

-- Seed sample doctors (password: changeme123 - change on first login)
-- dr1-dr10 Cardiology A, dr11-dr20 Cardiology B, dr21-dr30 Neurology A,
-- dr31-dr40 Neurology B, dr41-dr50 Radiology A, dr51-dr60 Radiology B.
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active, clinic_id)
VALUES
  ('dr1@oncall.local', 'dr1', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Nikos', 'Papadopoulos', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr2@oncall.local', 'dr2', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Eleni', 'Dimitriou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr3@oncall.local', 'dr3', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Giorgos', 'Konstantinou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr4@oncall.local', 'dr4', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Maria', 'Georgiou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr5@oncall.local', 'dr5', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Yannis', 'Ioannou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr6@oncall.local', 'dr6', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Sofia', 'Vlachou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr7@oncall.local', 'dr7', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Dimitris', 'Antoniou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr8@oncall.local', 'dr8', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Katerina', 'Pavlidou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr9@oncall.local', 'dr9', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Stavros', 'Laskaris', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr10@oncall.local', 'dr10', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Anna', 'Kourti', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology A')),
  ('dr11@oncall.local', 'dr11', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Petros', 'Alexandrou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr12@oncall.local', 'dr12', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Despina', 'Maltezou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr13@oncall.local', 'dr13', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Kostas', 'Theodorou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr14@oncall.local', 'dr14', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Christina', 'Samara', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr15@oncall.local', 'dr15', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Alexis', 'Fotiou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr16@oncall.local', 'dr16', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Ioanna', 'Kalogirou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr17@oncall.local', 'dr17', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Theodoros', 'Vasileiou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr18@oncall.local', 'dr18', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Marina', 'Stefanidou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr19@oncall.local', 'dr19', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Vasilis', 'Chatzis', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr20@oncall.local', 'dr20', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Eirini', 'Nikolopoulou', TRUE, (SELECT id FROM clinics WHERE name = 'Cardiology B')),
  ('dr21@oncall.local', 'dr21', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Andreas', 'Michailidis', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr22@oncall.local', 'dr22', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Vasiliki', 'Zerva', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr23@oncall.local', 'dr23', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Christos', 'Papanikolaou', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr24@oncall.local', 'dr24', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Zoi', 'Arvaniti', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr25@oncall.local', 'dr25', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Spyros', 'Doukas', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr26@oncall.local', 'dr26', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Georgia', 'Kanellopoulou', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr27@oncall.local', 'dr27', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Manolis', 'Raptis', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr28@oncall.local', 'dr28', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Danai', 'Skordili', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr29@oncall.local', 'dr29', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Filippos', 'Mavridis', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr30@oncall.local', 'dr30', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Thalia', 'Gkika', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology A')),
  ('dr31@oncall.local', 'dr31', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Nikolaos', 'Sarantis', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr32@oncall.local', 'dr32', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Ifigeneia', 'Douka', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr33@oncall.local', 'dr33', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Pavlos', 'Xanthopoulos', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr34@oncall.local', 'dr34', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Chrysoula', 'Tsikrika', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr35@oncall.local', 'dr35', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Stelios', 'Mavromatis', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr36@oncall.local', 'dr36', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Kalliope', 'Sideri', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr37@oncall.local', 'dr37', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Aris', 'Vasilakos', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr38@oncall.local', 'dr38', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Nefeli', 'Andreadou', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr39@oncall.local', 'dr39', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Grigoris', 'Tsakiris', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr40@oncall.local', 'dr40', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Antigoni', 'Petridou', TRUE, (SELECT id FROM clinics WHERE name = 'Neurology B')),
  ('dr41@oncall.local', 'dr41', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Thanasis', 'Karras', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr42@oncall.local', 'dr42', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Melina', 'Zografou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr43@oncall.local', 'dr43', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Ilias', 'Boutos', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr44@oncall.local', 'dr44', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Agapi', 'Christodoulou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr45@oncall.local', 'dr45', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Sotiris', 'Georgiadis', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr46@oncall.local', 'dr46', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Lydia', 'Panagiotou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr47@oncall.local', 'dr47', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Panos', 'Kyriakidis', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr48@oncall.local', 'dr48', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Evdokia', 'Tsiara', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr49@oncall.local', 'dr49', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Leonidas', 'Adamidis', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr50@oncall.local', 'dr50', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Ioanna', 'Chalkidou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology A')),
  ('dr51@oncall.local', 'dr51', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Charalampos', 'Venizelos', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B')),
  ('dr52@oncall.local', 'dr52', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Aikaterini', 'Lampropoulou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B')),
  ('dr53@oncall.local', 'dr53', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Michalis', 'Roumeliotis', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B')),
  ('dr54@oncall.local', 'dr54', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Fotini', 'Zachariou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B')),
  ('dr55@oncall.local', 'dr55', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Dimitrios', 'Kefalas', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B')),
  ('dr56@oncall.local', 'dr56', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Elpida', 'Michou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B')),
  ('dr57@oncall.local', 'dr57', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Rafail', 'Papatheodorou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B')),
  ('dr58@oncall.local', 'dr58', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Anastasia', 'Kolovou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B')),
  ('dr59@oncall.local', 'dr59', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Odysseas', 'Tsekouras', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B')),
  ('dr60@oncall.local', 'dr60', '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi', 'doctor', 'Kleio', 'Vrettou', TRUE, (SELECT id FROM clinics WHERE name = 'Radiology B'))
ON CONFLICT (email) WHERE is_deleted = FALSE DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  clinic_id     = EXCLUDED.clinic_id,
  is_active     = TRUE,
  updated_at    = NOW();

INSERT INTO doctors (user_id, clinic_id, max_monthly_duties)
VALUES
  ((SELECT id FROM users WHERE email = 'dr1@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr2@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr3@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr4@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr5@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr6@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr7@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr8@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr9@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr10@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr11@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr12@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr13@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr14@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr15@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr16@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr17@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr18@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr19@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr20@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Cardiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr21@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr22@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr23@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr24@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr25@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr26@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr27@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr28@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr29@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr30@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr31@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr32@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr33@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr34@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr35@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr36@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr37@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr38@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr39@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr40@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Neurology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr41@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr42@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr43@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr44@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr45@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr46@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr47@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr48@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr49@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr50@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology A'), 7),
  ((SELECT id FROM users WHERE email = 'dr51@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr52@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr53@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr54@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr55@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr56@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr57@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr58@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr59@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7),
  ((SELECT id FROM users WHERE email = 'dr60@oncall.local' AND is_deleted = FALSE), (SELECT id FROM clinics WHERE name = 'Radiology B'), 7)
ON CONFLICT (user_id) DO UPDATE SET
  clinic_id          = EXCLUDED.clinic_id,
  max_monthly_duties = EXCLUDED.max_monthly_duties,
  updated_at         = NOW();

-- Seed sample unavailability (fixed sample month 2026-09; dr1/dr2 are Cardiology A)
INSERT INTO unavailability (doctor_id, start_date, end_date)
SELECT d.id, '2026-09-07', '2026-09-11'
FROM doctors d JOIN users u ON u.id = d.user_id
WHERE u.email = 'dr1@oncall.local' AND u.is_deleted = FALSE
AND NOT EXISTS (SELECT 1 FROM unavailability x WHERE x.doctor_id = d.id AND x.start_date = '2026-09-07' AND x.end_date = '2026-09-11');

INSERT INTO unavailability (doctor_id, start_date, end_date)
SELECT d.id, '2026-09-15', '2026-09-15'
FROM doctors d JOIN users u ON u.id = d.user_id
WHERE u.email = 'dr2@oncall.local' AND u.is_deleted = FALSE
AND NOT EXISTS (SELECT 1 FROM unavailability x WHERE x.doctor_id = d.id AND x.start_date = '2026-09-15' AND x.end_date = '2026-09-15');

-- Phase 13: seed the billing deadline 30 days ahead. DO NOTHING is deliberate:
-- re-seeding must never extend an existing deadline.
INSERT INTO app_meta (key, value)
VALUES ('billing_paid_through', to_char(CURRENT_DATE + INTERVAL '30 days', 'YYYY-MM-DD'))
ON CONFLICT (key) DO NOTHING;
