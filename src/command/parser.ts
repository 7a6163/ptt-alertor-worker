// Caps how many items a single command can fan out into D1. Without this,
// "新增 Stock 關鍵字 a,b,c,...（×5000）" would trigger 5000 INSERTs in one
// applyCommand batch — both a webhook latency hazard and a D1 quota risk.
export const MAX_ITEMS_PER_COMMAND = 20;

export type Command =
  | { kind: 'subscribe_keyword'; board: string; items: string[]; truncated?: boolean }
  | { kind: 'unsubscribe_keyword'; board: string; items: string[]; truncated?: boolean }
  | { kind: 'subscribe_author'; board: string; items: string[]; truncated?: boolean }
  | { kind: 'unsubscribe_author'; board: string; items: string[]; truncated?: boolean }
  | { kind: 'list' }
  | { kind: 'help' }
  | { kind: 'unknown'; raw: string };

export function parseCommand(input: string): Command {
  const t = input.trim();
  if (!t) return { kind: 'unknown', raw: input };

  if (/^(help|幫助|說明|\?)$/i.test(t)) return { kind: 'help' };
  if (/^(清單|list)$/i.test(t)) return { kind: 'list' };

  const re = /^(新增|刪除)\s+(\S+)\s+(關鍵字|作者|keyword|author)\s+(.+)$/i;
  const m = t.match(re);
  if (!m) return { kind: 'unknown', raw: input };

  const verb = m[1] ?? '';
  const board = m[2] ?? '';
  const kindWord = m[3] ?? '';
  const list = m[4] ?? '';
  const allItems = list.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  const items = allItems.slice(0, MAX_ITEMS_PER_COMMAND);
  const truncated = allItems.length > MAX_ITEMS_PER_COMMAND;
  const isAuthor = /author|作者/i.test(kindWord);
  const isAdd = verb === '新增';

  if (isAuthor && isAdd) return { kind: 'subscribe_author', board, items, truncated };
  if (isAuthor) return { kind: 'unsubscribe_author', board, items, truncated };
  if (isAdd) return { kind: 'subscribe_keyword', board, items, truncated };
  return { kind: 'unsubscribe_keyword', board, items, truncated };
}
