CREATE TABLE ratings (
  place_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_place ON ratings (place_id);
CREATE INDEX idx_ip_time ON ratings (ip_hash, created_at);
