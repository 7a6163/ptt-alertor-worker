import type { Env, DispatchEvent } from '../env';

export async function sendMessenger(env: Env, evt: DispatchEvent): Promise<void> {
  if (!env.MESSENGER_PAGE_TOKEN) {
    console.warn('MESSENGER_PAGE_TOKEN missing — skipping messenger send');
    return;
  }
  const text = `[${evt.payload.board}] ${evt.payload.title}\n${evt.payload.url}`;
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${env.MESSENGER_PAGE_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: evt.externalId },
      message: { text },
      messaging_type: 'MESSAGE_TAG',
      tag: 'ACCOUNT_UPDATE',
    }),
  });
  if (!res.ok) {
    throw new Error(`messenger send ${res.status}: ${await res.text()}`);
  }
}
