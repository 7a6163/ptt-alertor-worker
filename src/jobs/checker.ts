import type { Env, ArticleEvent } from '../env';
import { fetchBoardIndex } from '../crawler/ptt';

const PER_BOARD_DELAY_MS = 250;
const PER_BOARD_DELAY_OFF_PEAK_MS = 500;

export async function runChecker(env: Env): Promise<void> {
  const boards = await loadBoards(env);
  const offPeak = isOffPeakCST(new Date());
  const delay = offPeak ? PER_BOARD_DELAY_OFF_PEAK_MS : PER_BOARD_DELAY_MS;

  for (const { name } of boards) {
    try {
      await checkBoard(env, name);
    } catch (err) {
      console.error(`checker: board=${name}`, err);
    }
    await sleep(delay);
  }
}

async function checkBoard(env: Env, board: string): Promise<void> {
  const articles = await fetchBoardIndex(env, board);
  if (articles.length === 0) return;

  const ids = articles.map((a) => a.id);
  const placeholders = ids.map(() => '?').join(',');
  const existing = await env.DB.prepare(
    `SELECT id FROM articles WHERE id IN (${placeholders})`,
  ).bind(...ids).all<{ id: string }>();
  const known = new Set(existing.results.map((r) => r.id));

  const fresh = articles.filter((a) => !known.has(a.id));
  if (fresh.length === 0) return;

  const now = Date.now();
  const inserts = fresh.map((a) =>
    env.DB.prepare(
      `INSERT INTO articles (id, board, title, author, url, push_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(a.id, a.board, a.title, a.author, a.url, a.pushCount, now),
  );
  await env.DB.batch(inserts);

  await env.DB.prepare(
    `UPDATE boards SET last_article_id = ?, last_checked_at = ? WHERE name = ?`,
  ).bind(fresh[0].id, now, board).run();

  await env.ARTICLE_QUEUE.sendBatch(
    fresh.map((a) => ({
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
}

async function loadBoards(env: Env): Promise<{ name: string }[]> {
  const res = await env.DB.prepare(`SELECT name FROM boards`).all<{ name: string }>();
  return res.results;
}

function isOffPeakCST(d: Date): boolean {
  const cstHour = (d.getUTCHours() + 8) % 24;
  return cstHour >= 3 && cstHour < 7;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
