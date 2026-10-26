import type { Env, ArticleEvent } from '../env';
import { fetchBoardIndex } from '../crawler/ptt';

const PER_BOARD_DELAY_MS = 250;
const PER_BOARD_DELAY_OFF_PEAK_MS = 500;
// Stop starting new boards after this so one sweep never overlaps the next
// cron tick (60s). Boards are swept oldest-first, so a board skipped this
// minute is first in line the next.
const TIME_BUDGET_MS = 45_000;
// Queues accept at most 100 messages per sendBatch and D1 at most 100 bound
// parameters per statement (the enqueued_at UPDATE binds chunk + 1).
const ENQUEUE_CHUNK = 50;
// A post whose id timestamp is this old showing up as "unseen" is a pinned
// (置底) post or one purged from D1, not news: store it without notifying.
const STALE_ARTICLE_MS = 7 * 24 * 3600 * 1000;
const PURGE_AFTER_MS = 90 * 24 * 3600 * 1000;

interface BoardRow {
  name: string;
  last_article_id: string | null;
}

export async function runChecker(env: Env): Promise<void> {
  const started = Date.now();
  const boards = await loadBoards(env);
  const offPeak = isOffPeakCST(new Date());
  const delay = offPeak ? PER_BOARD_DELAY_OFF_PEAK_MS : PER_BOARD_DELAY_MS;

  for (const board of boards) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      await checkBoard(env, board);
    } catch (err) {
      console.error(`checker: board=${board.name}`, err);
    }
    // Stamp even after a failure so a dead board rotates to the back instead
    // of eating the budget first every minute.
    await env.DB.prepare(`UPDATE boards SET last_checked_at = ? WHERE name = ?`)
      .bind(Date.now(), board.name)
      .run();
    await sleep(delay);
  }

  await env.DB.prepare(
    `DELETE FROM articles WHERE created_at < ? AND enqueued_at IS NOT NULL`,
  ).bind(started - PURGE_AFTER_MS).run();
}

interface ArticleRow {
  id: string;
  board: string;
  title: string;
  author: string;
  url: string;
  enqueued_at: number | null;
}

async function checkBoard(env: Env, board: BoardRow): Promise<void> {
  const articles = await fetchBoardIndex(env, board.name);
  const ids = articles.map((a) => a.id);

  // One query serves two purposes: which scraped ids we already hold, and
  // recovery of rows from prior runs that landed in D1 but never made it onto
  // ARTICLE_QUEUE (worker killed between db.batch and queue.sendBatch).
  const inList = ids.length > 0 ? ` OR id IN (${ids.map(() => '?').join(',')})` : '';
  const rows = await env.DB.prepare(
    `SELECT id, board, title, author, url, enqueued_at FROM articles
     WHERE (board = ? AND enqueued_at IS NULL)${inList}`,
  ).bind(board.name, ...ids).all<ArticleRow>();

  const known = new Set(rows.results.map((r) => r.id));
  const toEnqueue = rows.results.filter((r) => r.enqueued_at === null);

  const fresh = articles.filter((a) => !known.has(a.id));
  const head = fresh[0];
  if (head) {
    const now = Date.now();
    // First sweep of a new board: the index page is history, not news. Stale
    // posts (pinned, or purged and re-scraped) likewise. Both are stored as
    // already enqueued; everything else gets enqueued_at = NULL and is
    // stamped only after sendBatch resolves, so a crash in between leaves a
    // recoverable row.
    const firstRun = board.last_article_id === null;
    const notify = new Set(firstRun ? [] : fresh.filter((a) => !isStaleArticleId(a.id, now)));
    await env.DB.batch([
      ...fresh.map((a) =>
        env.DB.prepare(
          `INSERT INTO articles (id, board, title, author, url, push_count, created_at, enqueued_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(a.id, a.board, a.title, a.author, a.url, a.pushCount, now, notify.has(a) ? null : now),
      ),
      env.DB.prepare(`UPDATE boards SET last_article_id = ? WHERE name = ?`).bind(head.id, board.name),
    ]);
    for (const a of notify) {
      toEnqueue.push({
        id: a.id,
        board: a.board,
        title: a.title,
        author: a.author,
        url: a.url,
        enqueued_at: null,
      });
    }
  }

  for (let i = 0; i < toEnqueue.length; i += ENQUEUE_CHUNK) {
    const chunk = toEnqueue.slice(i, i + ENQUEUE_CHUNK);
    await env.ARTICLE_QUEUE.sendBatch(
      chunk.map((a) => ({
        body: {
          type: 'new_article' as const,
          board: a.board,
          articleId: a.id,
          title: a.title,
          author: a.author,
          url: a.url,
        } satisfies ArticleEvent,
      })),
    );
    await env.DB.prepare(
      `UPDATE articles SET enqueued_at = ? WHERE id IN (${chunk.map(() => '?').join(',')})`,
    ).bind(Date.now(), ...chunk.map((a) => a.id)).run();
  }
}

// PTT ids look like M.1700000000.A.1F3 — the middle segment is the post's
// unix time. An unparseable id is treated as fresh rather than dropped.
export function isStaleArticleId(id: string, now: number): boolean {
  const unix = Number(id.split('.')[1]);
  return Number.isFinite(unix) && unix > 0 && now - unix * 1000 > STALE_ARTICLE_MS;
}

async function loadBoards(env: Env): Promise<BoardRow[]> {
  const res = await env.DB.prepare(
    `SELECT name, last_article_id FROM boards ORDER BY last_checked_at ASC`,
  ).all<BoardRow>();
  return res.results;
}

function isOffPeakCST(d: Date): boolean {
  const cstHour = (d.getUTCHours() + 8) % 24;
  return cstHour >= 3 && cstHour < 7;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
