// Caps how many items a single command can fan out into D1. Without this,
// "新增 Stock 關鍵字 a,b,c,...（×5000）" would trigger 5000 INSERTs in one
// applyCommand batch — both a webhook latency hazard and a D1 quota risk.
export const MAX_ITEMS_PER_COMMAND = 20;

export type GuideAction = 'subscribe' | 'unsubscribe';
export type GuideTarget = 'keyword' | 'author';

export type Command =
  | { kind: 'subscribe_keyword'; board: string; items: string[]; truncated?: boolean }
  | { kind: 'unsubscribe_keyword'; board: string; items: string[]; truncated?: boolean }
  | { kind: 'subscribe_author'; board: string; items: string[]; truncated?: boolean }
  | { kind: 'unsubscribe_author'; board: string; items: string[]; truncated?: boolean }
  // Emitted by a bare `/add` / `/addauthor`. The webhook turns this into an
  // inline-keyboard type picker (target omitted) or a force_reply prompt
  // (target known) to drive the two-step guided subscribe flow.
  | { kind: 'guide'; action: GuideAction; target?: GuideTarget }
  // Emitted by a bare `/del` / `/delauthor`. The webhook lists the user's
  // existing subscriptions as tap-to-delete buttons — no typing needed.
  | { kind: 'remove_menu'; target: GuideTarget }
  | { kind: 'list' }
  | { kind: 'help' }
  | { kind: 'unknown'; raw: string };

type SubscribeKind =
  | 'subscribe_keyword'
  | 'unsubscribe_keyword'
  | 'subscribe_author'
  | 'unsubscribe_author';

export function parseCommand(input: string): Command {
  const t = input.trim();
  if (!t) return { kind: 'unknown', raw: input };

  if (/^(help|幫助|說明|\?)$/i.test(t)) return { kind: 'help' };
  if (/^(清單|list)$/i.test(t)) return { kind: 'list' };

  if (t.startsWith('/')) {
    return parseSlash(t) ?? { kind: 'unknown', raw: input };
  }

  return parseTextGrammar(t, input);
}

// Slash grammar (Telegram-native), e.g. `/add Stock 台積電,聯電`. A bare verb
// with no args (`/add`) returns a `guide` command so the webhook can prompt.
// `@botname` suffixes (added by Telegram in groups) are stripped.
function parseSlash(t: string): Command | null {
  const m = t.match(/^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  const cmd = (m[1] ?? '').toLowerCase();
  const rest = (m[2] ?? '').trim();

  switch (cmd) {
    case 'start':
    case 'help':
      return { kind: 'help' };
    case 'list':
    case 'ls':
      return { kind: 'list' };
    case 'add':
      return rest
        ? buildSubscribe('subscribe_keyword', rest)
        : { kind: 'guide', action: 'subscribe' };
    case 'del':
    case 'remove':
    case 'rm':
      return rest
        ? buildSubscribe('unsubscribe_keyword', rest)
        : { kind: 'remove_menu', target: 'keyword' };
    case 'addauthor':
      return rest
        ? buildSubscribe('subscribe_author', rest)
        : { kind: 'guide', action: 'subscribe', target: 'author' };
    case 'delauthor':
    case 'removeauthor':
      return rest
        ? buildSubscribe('unsubscribe_author', rest)
        : { kind: 'remove_menu', target: 'author' };
    default:
      return null;
  }
}

// Existing Chinese free-text grammar: 新增/刪除 <Board> 關鍵字|作者 <items>.
function parseTextGrammar(t: string, raw: string): Command {
  const re = /^(新增|刪除)\s+(\S+)\s+(關鍵字|作者|keyword|author)\s+(.+)$/i;
  const m = t.match(re);
  if (!m) return { kind: 'unknown', raw };

  const verb = m[1] ?? '';
  const board = m[2] ?? '';
  const kindWord = m[3] ?? '';
  const { items, truncated } = capItems(splitTokens(m[4] ?? ''));
  const isAuthor = /author|作者/i.test(kindWord);
  const isAdd = verb === '新增';

  if (isAuthor && isAdd) return { kind: 'subscribe_author', board, items, truncated };
  if (isAuthor) return { kind: 'unsubscribe_author', board, items, truncated };
  if (isAdd) return { kind: 'subscribe_keyword', board, items, truncated };
  return { kind: 'unsubscribe_keyword', board, items, truncated };
}

// "<board> <item> <item>..." → a subscribe/unsubscribe command. Shared by the
// slash one-shot path and the guided reply path.
function buildSubscribe(kind: SubscribeKind, rest: string): Command {
  const tokens = splitTokens(rest);
  const board = tokens[0] ?? '';
  const { items, truncated } = capItems(tokens.slice(1));
  return { kind, board, items, truncated };
}

function splitTokens(s: string): string[] {
  return s.split(/[,，\s]+/).map((tok) => tok.trim()).filter(Boolean);
}

function capItems(all: string[]): { items: string[]; truncated: boolean } {
  return {
    items: all.slice(0, MAX_ITEMS_PER_COMMAND),
    truncated: all.length > MAX_ITEMS_PER_COMMAND,
  };
}

// --- Guided two-step flow helpers (stateless) -----------------------------
// State is carried in the force_reply prompt text and the inline-keyboard
// callback_data, so no conversation table is needed.

function guideKind(action: GuideAction, target: GuideTarget): SubscribeKind {
  if (action === 'subscribe') {
    return target === 'keyword' ? 'subscribe_keyword' : 'subscribe_author';
  }
  return target === 'keyword' ? 'unsubscribe_keyword' : 'unsubscribe_author';
}

// Title line embedded in the force_reply prompt. detectGuidedMode() reads it
// back from reply_to_message.text to recover which flow the reply belongs to.
export function guidePromptTitle(action: GuideAction, target: GuideTarget): string {
  const verb = action === 'subscribe' ? '新增' : '刪除';
  const what = target === 'keyword' ? '關鍵字' : '作者';
  return `${verb}${what}訂閱`;
}

const GUIDE_COMBOS: ReadonlyArray<readonly [GuideAction, GuideTarget]> = [
  ['subscribe', 'keyword'],
  ['subscribe', 'author'],
  ['unsubscribe', 'keyword'],
  ['unsubscribe', 'author'],
];

export function detectGuidedMode(
  promptText: string,
): { action: GuideAction; target: GuideTarget } | null {
  for (const [action, target] of GUIDE_COMBOS) {
    if (promptText.includes(guidePromptTitle(action, target))) return { action, target };
  }
  return null;
}

// Second step of the guided flow: the user's "<board> <item>..." reply.
export function parseGuidedReply(
  action: GuideAction,
  target: GuideTarget,
  replyText: string,
): Command {
  return buildSubscribe(guideKind(action, target), replyText.trim());
}

// callback_data is capped at 64 bytes by Telegram, so keep it terse.
export function buildGuideCallback(action: GuideAction, target: GuideTarget): string {
  return `g:${action === 'subscribe' ? 'sub' : 'unsub'}:${target === 'keyword' ? 'kw' : 'au'}`;
}

export function parseGuideCallback(
  data: string,
): { action: GuideAction; target: GuideTarget } | null {
  const m = data.match(/^g:(sub|unsub):(kw|au)$/);
  if (!m) return null;
  return {
    action: m[1] === 'sub' ? 'subscribe' : 'unsubscribe',
    target: m[2] === 'kw' ? 'keyword' : 'author',
  };
}

// Tap-to-delete callback for the removal menu. Carries only the table rowid
// (an integer), so the keyword/author text — however long — never has to fit
// in the 64-byte callback_data budget.
export function buildRemoveCallback(target: GuideTarget, rowid: number): string {
  return `${target === 'keyword' ? 'rk' : 'ra'}:${rowid}`;
}

export function parseRemoveCallback(
  data: string,
): { target: GuideTarget; rowid: number } | null {
  const m = data.match(/^r(k|a):(\d+)$/);
  if (!m) return null;
  return {
    target: m[1] === 'k' ? 'keyword' : 'author',
    rowid: Number(m[2]),
  };
}
