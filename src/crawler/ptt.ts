import type { Env } from '../env';

export interface ScrapedArticle {
  id: string;
  board: string;
  title: string;
  author: string;
  url: string;
  pushCount: number;
}

export async function fetchBoardIndex(env: Env, board: string): Promise<ScrapedArticle[]> {
  const url = `${env.PTT_BASE_URL}/bbs/${encodeURIComponent(board)}/index.html`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': env.USER_AGENT,
      Cookie: 'over18=1',
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!res.ok) {
    throw new Error(`PTT fetch ${board} failed: ${res.status}`);
  }
  const html = await res.text();
  return parseBoardIndex(env.PTT_BASE_URL, board, html);
}

export function parseBoardIndex(baseUrl: string, board: string, html: string): ScrapedArticle[] {
  const out: ScrapedArticle[] = [];
  const reEntry = /<div class="r-ent">([\s\S]*?)<\/div>\s*<\/div>/g;

  for (const match of html.matchAll(reEntry)) {
    const block = match[1];
    if (!block) continue;

    const linkMatch = block.match(/<div class="title">[\s\S]*?<a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    const href = linkMatch[1];
    const title = decodeEntities(linkMatch[2].trim());

    const idMatch = href.match(/\/([^/]+)\.html$/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const authorMatch = block.match(/<div class="author">([^<]*)<\/div>/);
    const author = (authorMatch?.[1] ?? '').trim();

    const pushMatch = block.match(/<div class="nrec">[\s\S]*?<span[^>]*>([^<]*)<\/span>/);
    const pushCount = parsePushCount((pushMatch?.[1] ?? '').trim());

    out.push({
      id,
      board,
      title,
      author,
      url: `${baseUrl}${href}`,
      pushCount,
    });
  }
  return out;
}

function parsePushCount(s: string): number {
  if (!s) return 0;
  if (s === '爆') return 100;
  if (s.startsWith('X')) {
    const n = parseInt(s.slice(1) || '1', 10);
    return -(Number.isNaN(n) ? 1 : n) * 10;
  }
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
