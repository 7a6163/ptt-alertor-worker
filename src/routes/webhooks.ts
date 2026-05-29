import { Hono } from 'hono';
import type { Env } from '../env';
import {
  parseCommand,
  parseGuideCallback,
  detectGuidedMode,
  parseGuidedReply,
  buildGuideCallback,
  guidePromptTitle,
  type GuideAction,
  type GuideTarget,
} from '../command/parser';
import { ensureUserAndBinding, applyCommand } from '../command/apply';
import { sendMessage, answerCallbackQuery } from '../telegram/api';

interface TelegramMessage {
  chat: { id: number };
  text?: string;
  from?: { id: number; username?: string };
  reply_to_message?: { text?: string };
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { chat: { id: number } };
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
  const got = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (got !== expected) {
    return c.text('forbidden', 403);
  }

  const update = await c.req.json<TelegramUpdate>();

  if (update.callback_query) {
    await handleCallback(c.env, update.callback_query);
    return c.json({ ok: true });
  }

  const msg = update.message;
  if (!msg?.text) return c.json({ ok: true });

  const chatId = String(msg.chat.id);
  const userId = await ensureUserAndBinding(c.env, 'telegram', chatId);

  // Guided two-step flow, step 2: the user replied to one of our force_reply
  // prompts. The mode (subscribe/unsubscribe × keyword/author) is recovered
  // from the prompt text — no server-side conversation state.
  const promptText = msg.reply_to_message?.text;
  const mode = promptText ? detectGuidedMode(promptText) : null;
  if (mode) {
    const cmd = parseGuidedReply(mode.action, mode.target, msg.text);
    const reply = await applyCommand(c.env, userId, cmd);
    await sendMessage(c.env, chatId, reply);
    return c.json({ ok: true });
  }

  const cmd = parseCommand(msg.text);
  if (cmd.kind === 'guide') {
    await startGuide(c.env, chatId, cmd.action, cmd.target);
    return c.json({ ok: true });
  }

  const reply = await applyCommand(c.env, userId, cmd);
  await sendMessage(c.env, chatId, reply);
  return c.json({ ok: true });
});

// Guided flow, step 1: a bare slash verb. With no target yet, offer the type
// as inline buttons; with a target already known (e.g. /addauthor), jump
// straight to the force_reply prompt.
async function startGuide(
  env: Env,
  chatId: string,
  action: GuideAction,
  target?: GuideTarget,
): Promise<void> {
  if (!target) {
    const verb = action === 'subscribe' ? '訂閱' : '取消訂閱';
    await sendMessage(env, chatId, `要${verb}什麼？`, {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '關鍵字', callback_data: buildGuideCallback(action, 'keyword') },
            { text: '作者', callback_data: buildGuideCallback(action, 'author') },
          ],
        ],
      },
    });
    return;
  }
  await sendForceReplyPrompt(env, chatId, action, target);
}

async function sendForceReplyPrompt(
  env: Env,
  chatId: string,
  action: GuideAction,
  target: GuideTarget,
): Promise<void> {
  const title = guidePromptTitle(action, target);
  const itemWord = target === 'keyword' ? '關鍵字' : '作者 ID';
  const example = target === 'keyword' ? 'Stock 台積電' : 'Stock someuser';
  const text = `${title}\n回覆此訊息並輸入：<板名> <${itemWord}>\n例如：${example}`;
  await sendMessage(env, chatId, text, {
    replyMarkup: { force_reply: true, input_field_placeholder: example },
  });
}

async function handleCallback(env: Env, cq: TelegramCallbackQuery): Promise<void> {
  // Always answer first so the client's loading spinner clears. A stale/expired
  // callback answers with 400; don't let that fail the webhook (Telegram would
  // just redeliver the same dead callback) — log and carry on.
  try {
    await answerCallbackQuery(env, cq.id);
  } catch (err) {
    console.warn('answerCallbackQuery failed', err);
  }

  const data = cq.data;
  if (!data) return;
  const parsed = parseGuideCallback(data);
  if (!parsed) return;

  const chatId = cq.message ? String(cq.message.chat.id) : String(cq.from.id);
  await sendForceReplyPrompt(env, chatId, parsed.action, parsed.target);
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
