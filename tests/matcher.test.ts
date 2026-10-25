import { describe, it, expect } from 'vitest';
import { matchesKeyword, findMatches, type BoardSubs } from '../src/jobs/matcher';
import type { ArticleEvent } from '../src/env';

// Titles arrive lower-cased from findMatches; mirror that here.
const title = (s: string) => s.toLowerCase();

describe('matchesKeyword', () => {
  it('matches a single substring keyword case-insensitively', () => {
    expect(matchesKeyword(title('[新聞] 台積電法說會'), '台積電')).toBe(true);
    expect(matchesKeyword(title('GOLANG tips'), 'golang')).toBe(true);
    expect(matchesKeyword(title('[新聞] 聯電除息'), '台積電')).toBe(false);
  });

  it('requires every space-separated term (AND)', () => {
    expect(matchesKeyword(title('台積電今日漲停'), '台積電 漲停')).toBe(true);
    expect(matchesKeyword(title('台積電除息'), '台積電 漲停')).toBe(false);
    expect(matchesKeyword(title('大盤漲停'), '台積電 漲停')).toBe(false);
  });

  it('does not require AND terms to be adjacent or ordered', () => {
    expect(matchesKeyword(title('漲停的台積電'), '台積電 漲停')).toBe(true);
  });

  it('returns false for an empty/whitespace-only keyword', () => {
    expect(matchesKeyword(title('anything'), '')).toBe(false);
    expect(matchesKeyword(title('anything'), '   ')).toBe(false);
  });
});

describe('findMatches', () => {
  const evt: ArticleEvent = {
    type: 'new_article',
    board: 'Stock',
    articleId: 'M.1',
    title: '[新聞] 台積電漲停',
    author: 'alice',
    url: 'https://www.ptt.cc/bbs/Stock/M.1.html',
  };
  const tg = { channel: 'telegram' as const, external_id: '1' };

  it('sends one notification per (user, channel) even when several subs match', () => {
    const subs: BoardSubs = {
      keywords: [
        { user_id: 'u1', keyword: '台積電', ...tg },
        { user_id: 'u1', keyword: '台積電 漲停', ...tg },
        { user_id: 'u2', keyword: '聯電', ...tg },
      ],
      authors: [
        { user_id: 'u1', author: 'alice', ...tg },
        { user_id: 'u3', author: 'alice', ...tg },
        { user_id: 'u4', author: 'Alice', ...tg },
      ],
    };
    expect(findMatches(subs, evt).map((m) => [m.userId, m.payload.matchReason])).toEqual([
      ['u1', 'keyword:台積電'],
      ['u3', 'author:alice'],
    ]);
  });
});
