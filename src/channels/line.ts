import type { Env, DispatchEvent } from '../env';

export async function sendLine(env: Env, evt: DispatchEvent): Promise<void> {
  if (!env.LINE_CHANNEL_TOKEN) {
    console.warn('LINE_CHANNEL_TOKEN missing — skipping line send');
    return;
  }
  const text = `[${evt.payload.board}] ${evt.payload.title}\n${evt.payload.url}`;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}`,
    },
    body: JSON.stringify({
      to: evt.externalId,
      messages: [{ type: 'text', text }],
    }),
  });
  if (!res.ok) {
    throw new Error(`line send ${res.status}: ${await res.text()}`);
  }
}
