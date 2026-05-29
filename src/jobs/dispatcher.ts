import type { Env, DispatchEvent } from '../env';
import { sendTelegram } from '../channels/telegram';
import { sendLine } from '../channels/line';
import { sendMessenger } from '../channels/messenger';
import { sendMail } from '../channels/mail';
import { PermanentChannelError } from '../errors';

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
        if (err instanceof PermanentChannelError) {
          // Channel rejected the message permanently (e.g. user blocked the bot).
          // Ack so we don't burn the retry budget pushing it to DLQ.
          console.warn('dispatch permanent failure', {
            channel: msg.body.channel,
            userId: msg.body.userId,
            status: err.status,
            message: err.message,
          });
          msg.ack();
          return;
        }
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
