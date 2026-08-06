INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Phase 2: seed administrator (password: changeme123 - change on first login)
INSERT INTO users (email, password_hash, role, first_name, last_name, is_active)
VALUES (
  'admin@oncall.local',
  '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi',
  'administrator',
  'System',
  'Administrator',
  TRUE
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();
