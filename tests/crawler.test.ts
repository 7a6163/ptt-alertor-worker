import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseBoardIndex } from '../src/crawler/ptt';

const BASE = 'https://www.ptt.cc';

function rEnt(inner: string): string {
  return `<div class="r-ent">\n${inner}\n<div class="meta">\n<div class="author">${' '}</div>\n</div>\n</div>`;
}

function articleEnt(href: string, title: string, author: string): string {
  return [
    '<div class="r-ent">',
    '<div class="nrec"><span class="hl f3">10</span></div>',
    '<div class="title">',
    `\t<a href="${href}">${title}</a>`,
    '</div>',
    '<div class="meta">',
    `<div class="author">${author}</div>`,
    '<div class="date"> 5/29</div>',
    '</div>',
    '</div>',
  ].join('\n');
}

function deletedEnt(label: string): string {
  return [
    '<div class="r-ent">',
    '<div class="nrec"></div>',
    '<div class="title">',
    `\t${label}`,
    '</div>',
    '<div class="meta">',
    '<div class="author">-</div>',
    '<div class="date"> 5/29</div>',
    '</div>',
    '</div>',
  ].join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseBoardIndex', () => {
  it('extracts article fields and ignores deleted rows without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html =
      articleEnt('/bbs/Stock/M.1.A.html', '[標的] 2330 台積電', 'user1') +
      deletedEnt('(本文已被刪除) [user2]') +
      deletedEnt('(本文已被 bm 刪除)');

    const out = parseBoardIndex(BASE, 'Stock', html);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'M.1.A',
      board: 'Stock',
      title: '[標的] 2330 台積電',
      author: 'user1',
      url: 'https://www.ptt.cc/bbs/Stock/M.1.A.html',
    });
    // deleted posts are expected, not layout drift → no warn
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when a no-link row is not a deleted post (layout drift)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html =
      articleEnt('/bbs/Stock/M.1.A.html', '[標的] 台積電', 'user1') +
      // no <a>, and not a deletion marker → genuine miss
      rEnt('<div class="title">\n\t某種沒有連結的新版面\n</div>');

    const out = parseBoardIndex(BASE, 'Stock', html);

    expect(out).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    const payload = warn.mock.calls[0]?.[1] as { missed: number; deleted: number };
    expect(payload.missed).toBe(1);
    expect(payload.deleted).toBe(0);
  });
});
