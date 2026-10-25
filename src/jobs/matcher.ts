import type { Env, ArticleEvent, DispatchEvent, Channel } from '../env';

interface BindingRow {
  user_id: string;
  channel: Channel;
  external_id: string;
}

export interface BoardSubs {
  keywords: (BindingRow & { keyword: string })[];
  authors: (BindingRow & { author: string })[];
}

export async function handleArticleBatch(
  batch: MessageBatch<ArticleEvent>,
  env: Env,
): Promise<void> {
  // A batch is almost always one board, so load its subs once, not per message.
  const subsByBoard = new Map<string, Promise<BoardSubs>>();
  for (const msg of batch.messages) {
    try {
      const { board } = msg.body;
      let subs = subsByBoard.get(board);
      if (!subs) {
        subs = loadSubs(env, board);
        subsByBoard.set(board, subs);
      }
      const matches = findMatches(await subs, msg.body);
      // Enqueue first; ack only after the downstream queue accepted the matches.
      // Otherwise a failed sendBatch silently drops notifications.
      for (let i = 0; i < matches.length; i += 100) {
        await env.DISPATCH_QUEUE.sendBatch(
          matches.slice(i, i + 100).map((m) => ({ body: m })),
        );
      }
      msg.ack();
    } catch (err) {
      console.error('matcher error', {
        board: msg.body.board,
        articleId: msg.body.articleId,
        err,
      });
      msg.retry();
    }
  }
}

async function loadSubs(env: Env, board: string): Promise<BoardSubs> {
  const [kw, au] = await Promise.all([
    env.DB.prepare(
      `SELECT ks.user_id, ks.keyword, cb.channel, cb.external_id
       FROM keyword_subs ks
       JOIN channel_bindings cb ON cb.user_id = ks.user_id
       JOIN users u ON u.id = ks.user_id
       WHERE ks.board = ? AND u.enabled = 1`,
    ).bind(board).all<BindingRow & { keyword: string }>(),
    env.DB.prepare(
      `SELECT a.user_id, a.author, cb.channel, cb.external_id
       FROM author_subs a
       JOIN channel_bindings cb ON cb.user_id = a.user_id
       JOIN users u ON u.id = a.user_id
       WHERE a.board = ? AND u.enabled = 1`,
    ).bind(board).all<BindingRow & { author: string }>(),
  ]);
  return { keywords: kw.results, authors: au.results };
}

// One notification per (user, channel) per article, however many of their
// subs matched. Keywords are checked first, so the reason names the first
// keyword hit; author matches only fill in for users with no keyword hit.
export function findMatches(subs: BoardSubs, evt: ArticleEvent): DispatchEvent[] {
  const out: DispatchEvent[] = [];
  const seen = new Set<string>();
  const add = (r: BindingRow, reason: string): void => {
    const key = `${r.user_id}:${r.channel}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(toDispatch(r, evt, reason));
  };

  const titleLower = evt.title.toLowerCase();
  for (const r of subs.keywords) {
    if (matchesKeyword(titleLower, r.keyword)) add(r, `keyword:${r.keyword}`);
  }
  for (const r of subs.authors) {
    if (r.author === evt.author) add(r, `author:${evt.author}`);
  }
  return out;
}

// A keyword may carry space-separated AND terms ("台積電 漲停"): every term must
// appear in the (already lower-cased) title to count as a match. Multiple
// keywords on the same board are independent rows, so they act as OR. The
// common single-term keyword reduces to a plain substring check.
export function matchesKeyword(titleLower: string, keyword: string): boolean {
  const terms = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every((term) => titleLower.includes(term));
}

function toDispatch(r: BindingRow, evt: ArticleEvent, reason: string): DispatchEvent {
  return {
    type: 'notify',
    userId: r.user_id,
    channel: r.channel,
    externalId: r.external_id,
    payload: {
      board: evt.board,
      articleId: evt.articleId,
      title: evt.title,
      author: evt.author,
      url: evt.url,
      matchReason: reason,
    },
  };
}
