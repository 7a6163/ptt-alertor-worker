import type { Env, DispatchEvent } from '../env';
import { sendTelegram } from '../channels/telegram';
import { sendLine } from '../channels/line';
import { sendMessenger } from '../channels/messenger';
import { sendMail } from '../channels/mail';

export async function handleDispatchBatch(
  batch: MessageBatch<DispatchEvent>,
  env: Env,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (msg) => {
      try {
        await dispatch(env, msg.body);
        msg.ack();
      } catch (err) {
        console.error('dispatch error', err);
        msg.retry({ delaySeconds: 30 });
      }
    }),
  );
}

async function dispatch(env: Env, evt: DispatchEvent): Promise<void> {
  switch (evt.channel) {
    case 'telegram':
      return sendTelegram(env, evt);
    case 'line':
      return sendLine(env, evt);
    case 'messenger':
      return sendMessenger(env, evt);
    case 'mail':
      return sendMail(env, evt);
  }
}
