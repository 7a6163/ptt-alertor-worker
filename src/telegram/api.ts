import type { Env } from '../env';
import { PermanentChannelError } from '../errors';

// Low-level Telegram Bot API client shared by the notify channel
// (src/channels/telegram.ts) and the webhook command surface
// (src/routes/webhooks.ts). Centralises token redaction and the
// transient-vs-permanent error split so callers don't repeat it.

export interface InlineButton {
  text: string;
  callback_data: string;
}

export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | { force_reply: true; input_field_placeholder?: string };

export interface SendOptions {
  replyMarkup?: ReplyMarkup;
  parseMode?: 'HTML';
}

export interface BotCommand {
  command: string;
  description: string;
}

async function callTelegram(env: Env, method: string, body: unknown): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return;

  // Telegram error bodies can echo the request URL, which contains the bot
  // token. Parse the description if available and scrub any token leak.
  let detail = '';
  try {
    const parsed = (await res.json()) as { description?: string };
    detail = parsed.description ?? '';
  } catch {
    // body wasn't JSON; drop it to avoid leaking the URL/token
  }
  detail = detail.replaceAll(env.TELEGRAM_BOT_TOKEN, '<redacted>');
  const message = `telegram ${method} ${res.status}${detail ? `: ${detail}` : ''}`;
  // 429 is rate-limit (transient); other 4xx (400 bad chat_id, 403 bot blocked,
  // 404 chat not found) won't fix on retry — surface as permanent so the
  // dispatcher can ack instead of burning the full retry budget before DLQ.
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    throw new PermanentChannelError(res.status, message);
  }
  throw new Error(message);
}

export async function sendMessage(
  env: Env,
  chatId: string,
  text: string,
  opts: SendOptions = {},
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  if (opts.replyMarkup) body.reply_markup = opts.replyMarkup;
  await callTelegram(env, 'sendMessage', body);
}

export async function answerCallbackQuery(
  env: Env,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (text) body.text = text;
  await callTelegram(env, 'answerCallbackQuery', body);
}

// Edits an existing message in place — used to re-render the tap-to-delete
// menu after a removal. Passing replyMarkup omits/replaces the buttons.
export async function editMessageText(
  env: Env,
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup?: ReplyMarkup,
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await callTelegram(env, 'editMessageText', body);
}

export async function setMyCommands(env: Env, commands: BotCommand[]): Promise<void> {
  await callTelegram(env, 'setMyCommands', { commands });
}

export async function setWebhook(env: Env, url: string, secretToken: string): Promise<void> {
  await callTelegram(env, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
  });
}
