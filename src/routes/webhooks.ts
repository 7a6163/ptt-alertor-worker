import { Hono } from 'hono';
import type { Env } from '../env';
import { parseCommand } from '../command/parser';
import { ensureUserAndBinding, applyCommand } from '../command/apply';

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string };
  };
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
  const msg = update.message;
  if (!msg?.text) return c.json({ ok: true });

  const chatId = String(msg.chat.id);
  const userId = await ensureUserAndBinding(c.env, 'telegram', chatId);
  const cmd = parseCommand(msg.text);
  const reply = await applyCommand(c.env, userId, cmd);

  await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: reply }),
  });
  return c.json({ ok: true });
});

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
