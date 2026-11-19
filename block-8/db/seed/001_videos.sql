INSERT INTO videos (id, source_path, has_audio)
VALUES
  ('V1', NULL, TRUE),
  ('V7', NULL, TRUE),
  ('V9', '/app/videos/V9.mp4', FALSE)
ON CONFLICT (id) DO NOTHING;
