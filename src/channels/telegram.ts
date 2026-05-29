import type { Env, DispatchEvent } from '../env';
import { PermanentChannelError } from '../errors';

export async function sendTelegram(env: Env, evt: DispatchEvent): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }
  const text = formatMessage(evt);
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: evt.externalId,
      text,
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) {
    // Telegram error bodies can echo the request URL, which contains the bot token.
    // Parse the description if available and scrub any token leak before throwing.
    let detail = '';
    try {
      const body = (await res.json()) as { description?: string };
      detail = body.description ?? '';
    } catch {
      // body wasn't JSON; drop it to avoid leaking the URL/token
    }
    detail = detail.replaceAll(env.TELEGRAM_BOT_TOKEN, '<redacted>');
    const message = `telegram send ${res.status}${detail ? `: ${detail}` : ''}`;
    // 429 is rate-limit (transient); other 4xx (400 bad chat_id, 403 bot blocked,
    // 404 chat not found) won't fix on retry — let the dispatcher ack these instead
    // of burning the full retry budget before DLQ.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      throw new PermanentChannelError(res.status, message);
    }
    throw new Error(message);
  }
}

function formatMessage(evt: DispatchEvent): string {
  const { payload } = evt;
  const reason = payload.matchReason.startsWith('keyword:')
    ? `關鍵字「${payload.matchReason.slice(8)}」`
    : `作者「${payload.matchReason.slice(7)}」`;
  return `<b>[${esc(payload.board)}]</b> ${reason}\n${esc(payload.title)}\n— ${esc(payload.author)}\n${payload.url}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
