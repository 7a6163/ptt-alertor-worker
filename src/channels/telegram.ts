import type { Env, DispatchEvent } from '../env';
import { sendMessage } from '../telegram/api';

export async function sendTelegram(env: Env, evt: DispatchEvent): Promise<void> {
  // Token redaction and the transient-vs-permanent (PermanentChannelError)
  // error split live in the shared client; dispatcher.ts branches on the
  // error type to decide retry vs ack.
  await sendMessage(env, evt.externalId, formatMessage(evt), { parseMode: 'HTML' });
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
