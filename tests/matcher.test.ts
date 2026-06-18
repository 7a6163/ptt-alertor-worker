import { describe, it, expect } from 'vitest';
import { matchesKeyword } from '../src/jobs/matcher';

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
