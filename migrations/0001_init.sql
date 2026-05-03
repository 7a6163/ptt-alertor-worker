-- D1 schema for ptt-alertor-workers
-- Apply with: wrangler d1 migrations apply ptt-alertor --local|--remote

CREATE TABLE IF NOT EXISTS boards (
  name              TEXT PRIMARY KEY,
  last_article_id   TEXT,
  last_checked_at   INTEGER NOT NULL DEFAULT 0,
  is_high_traffic   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id           TEXT PRIMARY KEY,
  board        TEXT NOT NULL,
  title        TEXT NOT NULL,
  author       TEXT NOT NULL,
  url          TEXT NOT NULL,
  push_count   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (board) REFERENCES boards(name)
);
CREATE INDEX IF NOT EXISTS idx_articles_board_created ON articles(board, created_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS channel_bindings (
  user_id      TEXT NOT NULL,
  channel      TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  PRIMARY KEY (user_id, channel),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_channel_bindings_external
  ON channel_bindings(channel, external_id);

CREATE TABLE IF NOT EXISTS keyword_subs (
  user_id      TEXT NOT NULL,
  board        TEXT NOT NULL,
  keyword      TEXT NOT NULL,
  PRIMARY KEY (user_id, board, keyword),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (board)   REFERENCES boards(name)
);
CREATE INDEX IF NOT EXISTS idx_keyword_subs_board ON keyword_subs(board);

CREATE TABLE IF NOT EXISTS author_subs (
  user_id      TEXT NOT NULL,
  board        TEXT NOT NULL,
  author       TEXT NOT NULL,
  PRIMARY KEY (user_id, board, author),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (board)   REFERENCES boards(name)
);
CREATE INDEX IF NOT EXISTS idx_author_subs_board_author ON author_subs(board, author);
