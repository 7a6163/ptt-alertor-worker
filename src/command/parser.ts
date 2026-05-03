export type Command =
  | { kind: 'subscribe_keyword'; board: string; items: string[] }
  | { kind: 'unsubscribe_keyword'; board: string; items: string[] }
  | { kind: 'subscribe_author'; board: string; items: string[] }
  | { kind: 'unsubscribe_author'; board: string; items: string[] }
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

  const verb = m[1];
  const board = m[2];
  const kindWord = m[3];
  const list = m[4];
  const items = list.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  const isAuthor = /author|作者/i.test(kindWord);
  const isAdd = verb === '新增';

  if (isAuthor && isAdd) return { kind: 'subscribe_author', board, items };
  if (isAuthor) return { kind: 'unsubscribe_author', board, items };
  if (isAdd) return { kind: 'subscribe_keyword', board, items };
  return { kind: 'unsubscribe_keyword', board, items };
}
