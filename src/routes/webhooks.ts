import { Hono } from 'hono';
import { timingSafeEqual } from 'hono/utils/buffer';
import type { Env } from '../env';
import {
  parseCommand,
  parseGuideCallback,
  parseRemoveCallback,
  buildGuideCallback,
  buildRemoveCallback,
  detectGuidedMode,
  parseGuidedReply,
  guidePromptTitle,
  type GuideTarget,
} from '../command/parser';
import {
  ensureUserAndBinding,
  applyCommand,
  listKeywordSubs,
  listAuthorSubs,
  deleteKeywordSubByRowid,
  deleteAuthorSubByRowid,
  type SubRow,
} from '../command/apply';
import { sendMessage, answerCallbackQuery, editMessageText } from '../telegram/api';
import type { InlineButton } from '../telegram/api';

// Telegram caps inline keyboards (~100 buttons); keep the removal menu well
// under that. A user with more subs than this can delete in waves or by text.
const REMOVE_MENU_MAX = 50;

interface TelegramMessage {
  chat: { id: number };
  text?: string;
  from?: { id: number; username?: string };
  reply_to_message?: { text?: string; from?: { is_bot?: boolean } };
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { chat: { id: number }; message_id: number };
  from: { id: number };
}

interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export const webhooks = new Hono<{ Bindings: Env }>();

webhooks.post('/telegram', async (c) => {
  // Fail closed: webhook is unauthenticated unless a secret is configured AND matches
  // the X-Telegram-Bot-Api-Secret-Token header set via setWebhook(secret_token=...).
  const expected = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    return c.text('webhook not configured', 503);
  }
  const got = c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!(await timingSafeEqual(got, expected))) {
    return c.text('forbidden', 403);
  }

  const update = await c.req.json<TelegramUpdate>();
  // Always 200 once authenticated: on a non-2xx Telegram redelivers the same
  // update (and stalls the ones behind it), and our failures are not the kind
  // a replay fixes (user blocked the bot, "message is not modified", ...).
  try {
    await handleUpdate(c.env, update);
  } catch (err) {
    console.error('telegram webhook error', err);
  }
  return c.json({ ok: true });
});

async function handleUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    return handleCallback(env, update.callback_query);
  }

  const msg = update.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat.id);
  const userId = await ensureUserAndBinding(env, 'telegram', chatId);

  // Guided two-step flow, step 2: the user replied to one of our force_reply
  // prompts. The target (keyword/author) is recovered from the prompt text —
  // no server-side conversation state. Only replies to the bot count, so a
  // group member quoting a prompt-like message doesn't trigger it.
  const prompt = msg.reply_to_message;
  const target = prompt?.from?.is_bot && prompt.text ? detectGuidedMode(prompt.text) : null;
  if (target) {
    const cmd = parseGuidedReply(target, msg.text);
    return sendMessage(env, chatId, await applyCommand(env, userId, cmd));
  }

  const cmd = parseCommand(msg.text);
  if (cmd.kind === 'guide') return startGuide(env, chatId, cmd.target);
  if (cmd.kind === 'remove_menu') return renderRemoveMenu(env, chatId, userId, cmd.target);
  return sendMessage(env, chatId, await applyCommand(env, userId, cmd));
}

// Guided subscribe flow, step 1: a bare /add or /addauthor. With no target yet,
// offer the type as inline buttons; with a target known (/addauthor), jump
// straight to the force_reply prompt.
async function startGuide(env: Env, chatId: string, target?: GuideTarget): Promise<void> {
  if (!target) {
    await sendMessage(env, chatId, '要訂閱什麼？', {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '關鍵字', callback_data: buildGuideCallback('keyword') },
            { text: '作者', callback_data: buildGuideCallback('author') },
          ],
        ],
      },
    });
    return;
  }
  await sendForceReplyPrompt(env, chatId, target);
}

async function sendForceReplyPrompt(
  env: Env,
  chatId: string,
  target: GuideTarget,
): Promise<void> {
  const title = guidePromptTitle(target);
  const itemWord = target === 'keyword' ? '關鍵字' : '作者 ID';
  const example = target === 'keyword' ? 'Stock 台積電' : 'Stock someuser';
  const text = `${title}\n回覆此訊息並輸入：<板名> <${itemWord}>\n例如：${example}`;
  await sendMessage(env, chatId, text, {
    replyMarkup: { force_reply: true, input_field_placeholder: example },
  });
}

// --- Tap-to-delete removal menu -------------------------------------------

function listSubs(env: Env, userId: string, target: GuideTarget): Promise<SubRow[]> {
  return target === 'keyword' ? listKeywordSubs(env, userId) : listAuthorSubs(env, userId);
}

function removeMenuTitle(target: GuideTarget, total: number): string {
  const word = target === 'keyword' ? '關鍵字' : '作者';
  const more = total > REMOVE_MENU_MAX ? `（前 ${REMOVE_MENU_MAX} 筆）` : '';
  return `點選要刪除的${word}：${more}`;
}

function buildRemoveKeyboard(target: GuideTarget, subs: SubRow[]): InlineButton[][] {
  return subs.slice(0, REMOVE_MENU_MAX).map((s) => [
    { text: `${s.board}: ${s.value}`, callback_data: buildRemoveCallback(target, s.rowid) },
  ]);
}

// Sends a fresh removal menu in response to a bare /del or /delauthor.
async function renderRemoveMenu(
  env: Env,
  chatId: string,
  userId: string,
  target: GuideTarget,
): Promise<void> {
  const subs = await listSubs(env, userId, target);
  if (subs.length === 0) {
    const word = target === 'keyword' ? '關鍵字' : '作者';
    await sendMessage(env, chatId, `目前沒有${word}訂閱可刪除。`);
    return;
  }
  await sendMessage(env, chatId, removeMenuTitle(target, subs.length), {
    replyMarkup: { inline_keyboard: buildRemoveKeyboard(target, subs) },
  });
}

// Re-renders the removal menu in place after a delete, dropping the tapped row.
async function rerenderRemoveMenu(
  env: Env,
  chatId: string,
  messageId: number,
  userId: string,
  target: GuideTarget,
): Promise<void> {
  const subs = await listSubs(env, userId, target);
  if (subs.length === 0) {
    const word = target === 'keyword' ? '關鍵字' : '作者';
    await editMessageText(env, chatId, messageId, `（已無${word}訂閱）`);
    return;
  }
  await editMessageText(env, chatId, messageId, removeMenuTitle(target, subs.length), {
    inline_keyboard: buildRemoveKeyboard(target, subs),
  });
}

async function answerToast(env: Env, callbackQueryId: string, text?: string): Promise<void> {
  // Answering clears the client spinner. A stale/expired callback answers with
  // 400; don't let that fail the webhook (Telegram would redeliver the dead
  // callback) — log and carry on.
  try {
    await answerCallbackQuery(env, callbackQueryId, text);
  } catch (err) {
    console.warn('answerCallbackQuery failed', err);
  }
}

async function handleCallback(env: Env, cq: TelegramCallbackQuery): Promise<void> {
  const chatId = cq.message ? String(cq.message.chat.id) : String(cq.from.id);
  const data = cq.data;

  // Tap-to-delete from the removal menu.
  const removal = data ? parseRemoveCallback(data) : null;
  if (removal) {
    const userId = await ensureUserAndBinding(env, 'telegram', chatId);
    const deleted =
      removal.target === 'keyword'
        ? await deleteKeywordSubByRowid(env, userId, removal.rowid)
        : await deleteAuthorSubByRowid(env, userId, removal.rowid);
    // Nothing deleted (double tap, stale menu) → the menu is already current;
    // re-rendering identical content would get a 400 from Telegram.
    await Promise.all([
      answerToast(env, cq.id, deleted ? `已取消 ${deleted.board}:${deleted.value}` : '已刪除或不存在'),
      deleted && cq.message
        ? rerenderRemoveMenu(env, chatId, cq.message.message_id, userId, removal.target)
        : undefined,
    ]);
    return;
  }

  // Guided subscribe type picker.
  await answerToast(env, cq.id);
  const target = data ? parseGuideCallback(data) : null;
  if (!target) return;
  await sendForceReplyPrompt(env, chatId, target);
}

webhooks.post('/line', async (c) => {
  return c.json({ ok: true });
});

webhooks.get('/messenger', (c) => {
  const challenge = c.req.query('hub.challenge');
  return c.text(challenge ?? '', 200);
});

webhooks.post('/messenger', async (c) => {
  return c.json({ ok: true });
});
