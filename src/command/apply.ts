import type { Env, Channel } from '../env';
import type { Command } from './parser';

export async function ensureUserAndBinding(
  env: Env,
  channel: Channel,
  externalId: string,
): Promise<string> {
  const existing = await env.DB.prepare(
    `SELECT user_id FROM channel_bindings WHERE channel = ? AND external_id = ?`,
  ).bind(channel, externalId).first<{ user_id: string }>();
  if (existing) return existing.user_id;

  const userId = `${channel}:${externalId}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, created_at, enabled) VALUES (?, ?, 1)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(userId, now),
    env.DB.prepare(
      `INSERT INTO channel_bindings (user_id, channel, external_id) VALUES (?, ?, ?)
       ON CONFLICT(user_id, channel) DO NOTHING`,
    ).bind(userId, channel, externalId),
  ]);
  return userId;
}

export async function applyCommand(env: Env, userId: string, cmd: Command): Promise<string> {
  switch (cmd.kind) {
    case 'help':
      return helpText();
    case 'list':
      return formatList(env, userId);
    case 'subscribe_keyword':
      await ensureBoard(env, cmd.board);
      await env.DB.batch(
        cmd.items.map((k) =>
          env.DB.prepare(
            `INSERT INTO keyword_subs (user_id, board, keyword) VALUES (?, ?, ?)
             ON CONFLICT(user_id, board, keyword) DO NOTHING`,
          ).bind(userId, cmd.board, k),
        ),
      );
      return `已訂閱 ${cmd.board} 關鍵字:${cmd.items.join(', ')}`;
    case 'unsubscribe_keyword':
      await env.DB.batch(
        cmd.items.map((k) =>
          env.DB.prepare(
            `DELETE FROM keyword_subs WHERE user_id = ? AND board = ? AND keyword = ?`,
          ).bind(userId, cmd.board, k),
        ),
      );
      return `已取消 ${cmd.board} 關鍵字:${cmd.items.join(', ')}`;
    case 'subscribe_author':
      await ensureBoard(env, cmd.board);
      await env.DB.batch(
        cmd.items.map((a) =>
          env.DB.prepare(
            `INSERT INTO author_subs (user_id, board, author) VALUES (?, ?, ?)
             ON CONFLICT(user_id, board, author) DO NOTHING`,
          ).bind(userId, cmd.board, a),
        ),
      );
      return `已訂閱 ${cmd.board} 作者:${cmd.items.join(', ')}`;
    case 'unsubscribe_author':
      await env.DB.batch(
        cmd.items.map((a) =>
          env.DB.prepare(
            `DELETE FROM author_subs WHERE user_id = ? AND board = ? AND author = ?`,
          ).bind(userId, cmd.board, a),
        ),
      );
      return `已取消 ${cmd.board} 作者:${cmd.items.join(', ')}`;
    case 'unknown':
      return '無法理解的指令。輸入 help 查看用法。';
  }
}

async function ensureBoard(env: Env, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO boards (name, last_checked_at) VALUES (?, 0)
     ON CONFLICT(name) DO NOTHING`,
  ).bind(name).run();
}

export async function formatList(env: Env, userId: string): Promise<string> {
  const kws = await env.DB.prepare(
    `SELECT board, keyword FROM keyword_subs WHERE user_id = ? ORDER BY board, keyword`,
  ).bind(userId).all<{ board: string; keyword: string }>();
  const aus = await env.DB.prepare(
    `SELECT board, author FROM author_subs WHERE user_id = ? ORDER BY board, author`,
  ).bind(userId).all<{ board: string; author: string }>();

  if (kws.results.length === 0 && aus.results.length === 0) return '（沒有訂閱）';

  const lines: string[] = [];
  if (kws.results.length) {
    lines.push('關鍵字:');
    for (const r of kws.results) lines.push(`  ${r.board}: ${r.keyword}`);
  }
  if (aus.results.length) {
    lines.push('作者:');
    for (const r of aus.results) lines.push(`  ${r.board}: ${r.author}`);
  }
  return lines.join('\n');
}

export function helpText(): string {
  return [
    '用法:',
    '  新增 <板名> 關鍵字 <關鍵字1>,<關鍵字2>',
    '  刪除 <板名> 關鍵字 <關鍵字1>',
    '  新增 <板名> 作者 <ID1>,<ID2>',
    '  刪除 <板名> 作者 <ID1>',
    '  清單   - 顯示目前訂閱',
    '  help   - 顯示此說明',
  ].join('\n');
}
