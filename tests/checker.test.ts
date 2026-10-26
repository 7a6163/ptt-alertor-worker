import { describe, it, expect } from 'vitest';
import { isStaleArticleId } from '../src/jobs/checker';

const DAY = 24 * 3600 * 1000;
const now = 1_800_000_000_000;
const idAt = (ms: number) => `M.${Math.floor(ms / 1000)}.A.1F3`;

describe('isStaleArticleId', () => {
  it('flags posts older than a week (pinned or purged-and-rescraped)', () => {
    expect(isStaleArticleId(idAt(now - 8 * DAY), now)).toBe(true);
    expect(isStaleArticleId(idAt(now - 400 * DAY), now)).toBe(true);
  });

  it('keeps recent posts and anything it cannot parse', () => {
    expect(isStaleArticleId(idAt(now - 5 * 60 * 1000), now)).toBe(false);
    expect(isStaleArticleId(idAt(now - 6 * DAY), now)).toBe(false);
    expect(isStaleArticleId('M.abc.A.1F3', now)).toBe(false);
    expect(isStaleArticleId('garbage', now)).toBe(false);
  });
});
