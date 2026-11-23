CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudo TEXT NOT NULL,
  pseudo_key TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clashes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent TEXT NOT NULL,
  my_score INTEGER NOT NULL,
  their_score INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('V','D','N')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS clashes_user ON clashes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS friends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','ok')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS friends_target ON friends(friend_id, status);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guest_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cfg TEXT NOT NULL,
  seed INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('invited','accepted','cancelled','done')),
  host_ready INTEGER NOT NULL DEFAULT 0,
  guest_ready INTEGER NOT NULL DEFAULT 0,
  start_at INTEGER,
  host_vote INTEGER,
  guest_vote INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_guest ON matches(guest_id, status, created_at);
CREATE INDEX IF NOT EXISTS matches_host ON matches(host_id, status);
