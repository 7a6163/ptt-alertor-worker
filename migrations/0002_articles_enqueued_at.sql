-- Adds an enqueued_at marker so the checker can recover articles that were
-- inserted into D1 but never made it onto ARTICLE_QUEUE (e.g. the worker was
-- killed between db.batch and queue.sendBatch). The next checker sweep of the
-- same board re-enqueues any row where enqueued_at IS NULL.
--
-- Existing rows are backfilled with their created_at so the recovery path
-- doesn't replay history on first deploy.
ALTER TABLE articles ADD COLUMN enqueued_at INTEGER;
UPDATE articles SET enqueued_at = created_at WHERE enqueued_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_articles_board_pending
  ON articles(board) WHERE enqueued_at IS NULL;
